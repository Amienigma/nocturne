import {
  midiToHz,
  toMusical,
  DEFAULT_PATCH,
  hitById,
  sourceIsPit,
  sourceIsN808,
  sourceIsChord,
  pitWaveFromSource,
  sampleSlotFromSource,
  sourceIsTr808,
} from "./music.mjs";
import { pickRecordType, extensionForType } from "./state-io.mjs";
import { makeBuffer } from "./samples.mjs";

function distortionCurve(amount) {
  const n = 256;
  const curve = new Float32Array(n);
  const k = Math.max(0.01, amount);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * k) / norm;
  }
  return curve;
}

// Curves are pure functions of `amount`; cache them so each hit doesn't
// allocate and fill a fresh 44,100-sample Float32Array (heavy GC churn on phones).
const curveCache = new Map();
function nocturneCurve(amount = 50) {
  const n = typeof amount === "number" ? amount : 50;
  const cached = curveCache.get(n);
  if (cached) return cached;
  const r = new Float32Array(44100);
  const l = Math.PI / 180;
  for (let u = 0; u < 44100; ++u) {
    const o = (u * 2) / 44100 - 1;
    r[u] = ((3 + n) * o * 20 * l) / (Math.PI + n * Math.abs(o));
  }
  curveCache.set(n, r);
  return r;
}

// Loudness of a curve driven by a full-scale sine; used to level-match drive
// settings so "more drive" means more grit, not a louder (speaker-cooking) sub.
const curveRmsCache = new Map();
function curveSineRms(amount) {
  const hit = curveRmsCache.get(amount);
  if (hit) return hit;
  const curve = nocturneCurve(amount);
  const n = 2048;
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const x = Math.sin((2 * Math.PI * i) / n);
    const idx = Math.min(curve.length - 1, Math.round(((x + 1) / 2) * (curve.length - 1)));
    ss += curve[idx] * curve[idx];
  }
  const rms = Math.sqrt(ss / n);
  curveRmsCache.set(amount, rms);
  return rms;
}

// ---- Speaker protection -------------------------------------------------
// Gain staging: the mix bus is trimmed so a typical pattern peaks around
// -6 dBFS before any limiting; a fixed makeup after the (musical) limiter
// restores loudness, and the always-on safety stage keeps the output under
// SAFETY_CEILING no matter what is stacked.
export const MIX_TRIM = 0.5; // ~-6 dB: default pattern peaks near -6 dBFS here
export const POST_GAIN_LIMITER = 0.9; // after the musical LIMITER (it has auto makeup)
export const POST_GAIN_DIRECT = 1.28; // LIMITER off: the safety stage does the limiting
export const SAFETY_HPF_HZ = 28;
export const SAFETY_CEILING = 0.87; // ~-1.2 dBFS sample peak, leaves room for inter-sample peaks
export const SUB_FLOOR_HZ = 30;

// Soft-clip curve: transparent below `knee`, smooth tanh shoulder above it,
// and the endpoints (where any input beyond +/-1 lands) never exceed the ceiling.
function ceilingCurve(ceiling = SAFETY_CEILING, knee = 0.8 * SAFETY_CEILING) {
  const n = 4097;
  const curve = new Float32Array(n);
  const room = ceiling - knee;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + room * Math.tanh((a - knee) / room);
    curve[i] = Math.sign(x) * Math.min(ceiling, y);
  }
  return curve;
}

// Identity up to `ceiling`, flat above it (inputs beyond +/-1 land on the ends).
function hardCeilingCurve(ceiling) {
  const n = 4097;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.max(-ceiling, Math.min(ceiling, x));
  }
  return curve;
}

export const TR808_LEVEL = 0.75; // classic 808 kit voice trim (see play808)
export const METRO_MAX = 0.3; // click peak at full metronome volume

// Fold sub-sonic fundamentals up by octaves so the note name stays the same
// but nothing below ~30 Hz is asked of the speaker.
export function foldSub(hz, floor = SUB_FLOOR_HZ) {
  let f = hz;
  while (f > 0 && f < floor) f *= 2;
  return f;
}

export class Studio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.compressor = null;
    this.analyser = null;
    this.freqAnalyser = null;
    this.recDest = null;
    this.pitFilter = null;
    this.timeBuf = null;
    this.freqBuf = null;
    this.white = null;
    this.pink = null;
    this.verbShort = null;
    this.verbLong = null;
    this.reverbSends = new Map();
    this.out = null;
    this.scopeTapped = false;
    this.recTapped = false;
    this.lastUse = 0;
    this.keepAwake = false;
    this.idleTimer = 0;
    this.onActivity = () => {};
    this.mild = null;
    this.heavy = null;
    this.buses = {};
    // Per-track mixer (sequenced voices only): strips are created on first use.
    this.mix = [];
    this.strips = [];
    this.sends = null; // shared reverb + delay return buses, created on first send
    this.sendBpm = 100;
    this.route = null; // strip the voice being triggered right now goes to
    this.glide = null; // { fromHz, sec } while triggering a slid step
    this.trackHz = new Map();
    this.sampleRecs = new Map(); // slot (1-8) -> { name, rate, pcm }
    this.samples = new Map(); // slot -> AudioBuffer for this.ctx (built on first use)
    this.limiterOn = true;
    this.masterGain = 0.85;
    this.patch = { ...DEFAULT_PATCH };
    this.voices = new Map();
    this.owners = new Map();
    this.born = new Map();
    this.seq = 0;
    this.loopGen = 0;
    this.stepTimer = 0;
    this.gateTimer = 0;
    this.ambience = {};
    this.recorder = null;
    this.recChunks = [];
    this.lastHz = 55;
    this.gateSec = 0;
    this.chokes = new Map();
    this.fadeMs = 30;
    this.idleMs = 7000; // longest one-shot (~2.6 s) + long reverb tail (4.2 s)
    this.hiddenSuspend = false;
    this.onNotes = () => {};
    this.n808 = {
      octave: 0,
      fine: 0,
      attack: 0.01,
      decay: 0.35,
      sustain: 0.6,
      release: 0.3,
      drive: 18,
      lp: 8000,
      hp: 20,
      reverb: 0.15,
      delay: 0,
      glide: 85,
      voice: "Deep Clean",
    };
  }

  get armed() {
    return this.ctx !== null;
  }

  arm() {
    // Offline (WAV export) studios own a pre-made OfflineAudioContext: no
    // resume, idle-suspend or UI callbacks.
    if (this.offline) return this.ctx !== null;
    if (typeof window === "undefined") return false;
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return false;
        this.ctx = new Ctor();
        this.build();
        this.applyPatch();
      }
      this.lastUse = performance.now();
      if (this.ctx.state !== "running" && !this.hiddenSuspend) this.resumeFaded();
      this.armIdleCheck();
      this.onActivity();
      return true;
    } catch {
      return false;
    }
  }

  build() {
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.masterGain;
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -18;
    this.compressor.knee.value = 8;
    this.compressor.ratio.value = 12;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.2;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.78;
    this.timeBuf = new Uint8Array(this.analyser.frequencyBinCount);
    this.freqAnalyser = ctx.createAnalyser();
    this.freqAnalyser.fftSize = 512;
    this.freqBuf = new Uint8Array(this.freqAnalyser.frequencyBinCount);
    this.recDest = typeof ctx.createMediaStreamDestination === "function" ? ctx.createMediaStreamDestination() : null;
    this.pitFilter = ctx.createBiquadFilter();
    this.pitFilter.type = "lowpass";
    this.analyser.connect(this.freqAnalyser);
    this.buildSafety();
    this.rewireMaster();

    const white = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const wd = white.getChannelData(0);
    for (let i = 0; i < wd.length; i++) wd[i] = Math.random() * 2 - 1;
    this.white = white;

    const pink = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const pd = pink.getChannelData(0);
    let H = 0, V = 0, J = 0, Ce = 0, Kn = 0, Zn = 0, Ie = 0;
    for (let i = 0; i < pd.length; i++) {
      const ie = Math.random() * 2 - 1;
      H = 0.99886 * H + ie * 0.0555179;
      V = 0.99332 * V + ie * 0.0750759;
      J = 0.969 * J + ie * 0.153852;
      Ce = 0.8665 * Ce + ie * 0.3104856;
      Kn = 0.55 * Kn + ie * 0.5329522;
      Zn = -0.7616 * Zn - ie * 0.016898;
      pd[i] = (H + V + J + Ce + Kn + Zn + Ie + ie * 0.5362) * 0.11;
      Ie = ie * 0.115926;
    }
    this.pink = pink;

    const ir = (seconds, power) => {
      const len = ctx.sampleRate * seconds;
      const buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const data = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, power);
      }
      return buf;
    };
    this.verbShort = ir(1.8, 3);
    this.verbLong = ir(4.2, 1.8);
    this.mild = distortionCurve(1.5);
    this.heavy = distortionCurve(3.4);

    for (const name of ["808", "Drums", "Memphis", "Coldwave", "House", "DSBM", "Vocals", "Ambience", "Samples"]) {
      const g = ctx.createGain();
      g.gain.value = 0.85;
      g.connect(this.master);
      this.buses[name] = g;
    }
    this.pitFilter.connect(this.buses["808"]);
  }

  // Always-on safety stage (cannot be bypassed by the LIMITER button):
  //   trim -> fade -> DC block -> 4th-order 28 Hz highpass -> brickwall-ish
  //   compressor (-3 dBFS, 20:1, 1 ms) -> soft-clip ceiling (~-1 dBFS) -> out
  // `out` feeds the speakers, the recorder and the scope taps.
  buildSafety() {
    const ctx = this.ctx;
    this.trim = ctx.createGain();
    this.trim.gain.value = MIX_TRIM;
    this.post = ctx.createGain();
    this.post.gain.value = POST_GAIN_DIRECT;
    this.fade = ctx.createGain();
    this.fade.gain.value = 1;
    const dc = ctx.createBiquadFilter();
    dc.type = "highpass";
    dc.frequency.value = 5;
    dc.Q.value = 0.5;
    const hp1 = ctx.createBiquadFilter();
    hp1.type = "highpass";
    hp1.frequency.value = SAFETY_HPF_HZ;
    hp1.Q.value = 0.5412; // two stages = 4th-order Butterworth
    const hp2 = ctx.createBiquadFilter();
    hp2.type = "highpass";
    hp2.frequency.value = SAFETY_HPF_HZ;
    hp2.Q.value = 1.3066;
    const brick = ctx.createDynamicsCompressor();
    brick.threshold.value = -4;
    brick.knee.value = 0;
    brick.ratio.value = 20;
    brick.attack.value = 0.001;
    brick.release.value = 0.08;
    const ceiling = ctx.createWaveShaper();
    ceiling.curve = ceilingCurve();
    ceiling.oversample = "4x"; // tames aliasing / inter-sample peaks from the soft clip
    this.post.connect(this.fade);
    this.fade.connect(dc);
    dc.connect(hp1);
    hp1.connect(hp2);
    hp2.connect(brick);
    brick.connect(ceiling);
    this.safetyIn = this.post;
    this.safetyLimiter = brick;
    this.out = ceiling;
    // Speaker bus: music (`out`, which is also what REC captures) plus the
    // metronome. The metronome joins *after* the recording tap, so clicks are
    // never recorded. A final identity-below-ceiling clamp keeps music
    // bit-exact while guaranteeing music + click never exceeds the ceiling.
    this.metroBus = ctx.createGain();
    this.metroBus.gain.value = 0;
    this.speakerSum = ctx.createGain();
    const clamp = ctx.createWaveShaper();
    clamp.curve = hardCeilingCurve(SAFETY_CEILING);
    clamp.oversample = "none";
    this.out.connect(this.speakerSum);
    this.metroBus.connect(this.speakerSum);
    this.speakerSum.connect(clamp);
    clamp.connect(ctx.destination);
    // Same hard ceiling on the recording path, so REC files also stay under
    // -1.2 dBFS sample peak even when the soft clip overshoots slightly.
    this.recClamp = ctx.createWaveShaper();
    this.recClamp.curve = hardCeilingCurve(SAFETY_CEILING);
    this.recClamp.oversample = "none";
    if (this.recDest) this.recClamp.connect(this.recDest);
  }

  // Mix path: master -> trim -> (musical LIMITER, optional) -> safety stage.
  // The analysers and the recording destination are side taps on the safety
  // output, connected only while needed.
  rewireMaster() {
    try { this.master.disconnect(); } catch { /* first wire */ }
    try { this.trim.disconnect(); } catch { /* first wire */ }
    try { this.compressor.disconnect(); } catch { /* first wire */ }
    this.master.connect(this.trim);
    const post = this.limiterOn ? POST_GAIN_LIMITER : POST_GAIN_DIRECT;
    this.post.gain.setTargetAtTime(post, this.ctx.currentTime, 0.02);
    if (this.limiterOn) {
      this.trim.connect(this.compressor);
      this.compressor.connect(this.safetyIn);
      this.preSafety = this.compressor;
    } else {
      this.trim.connect(this.safetyIn);
      this.preSafety = this.trim;
    }
  }

  // Fade the output before suspending / after resuming so pausing never pops.
  suspendFaded() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return Promise.resolve();
    const t = ctx.currentTime;
    const g = this.fade.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + this.fadeMs / 1000);
    return new Promise((resolve) => {
      window.setTimeout(() => {
        // Only suspend if nothing woke the context during the fade.
        if (this.ctx.state === "running" && this.fadingOut) void this.ctx.suspend();
        this.fadingOut = false;
        resolve();
      }, this.fadeMs + 20);
      this.fadingOut = true;
    });
  }

  resumeFaded() {
    const ctx = this.ctx;
    this.fadingOut = false;
    const g = this.fade.gain;
    const fadeIn = () => {
      const t = ctx.currentTime;
      g.cancelScheduledValues(t);
      g.setValueAtTime(Math.min(g.value, 1), t);
      g.linearRampToValueAtTime(1, t + this.fadeMs / 1000);
    };
    if (ctx.state === "running") {
      fadeIn();
      return;
    }
    // Start the ramp from silence and let it run as the context comes back.
    g.cancelScheduledValues(ctx.currentTime);
    g.setValueAtTime(0, ctx.currentTime);
    void ctx.resume().then(fadeIn, () => {});
  }

  // Monophonic 808 behaviour: a new hit on the same group chokes the previous
  // one with a short fade, instead of stacking tails into huge sub peaks.
  choke(group, when, vca, stopAll) {
    const prev = this.chokes.get(group);
    if (prev && prev.vca !== vca) {
      const t = Math.max(when, prev.start);
      prev.vca.gain.setValueAtTime(1, t);
      prev.vca.gain.linearRampToValueAtTime(0, t + 0.012);
      // (callers pass their dedicated choke gain as `vca`)
      prev.stopAll(t + 0.03);
    }
    this.chokes.set(group, { vca, stopAll, start: when });
  }

  setScopeTap(on) {
    on = !!on;
    if (!this.ctx || !this.out || on === this.scopeTapped) return;
    this.scopeTapped = on;
    if (on) this.out.connect(this.analyser);
    else try { this.out.disconnect(this.analyser); } catch { /* not connected */ }
  }

  setRecTap(on) {
    on = !!on;
    if (!this.ctx || !this.out || !this.recDest || on === this.recTapped) return;
    this.recTapped = on;
    if (on) this.out.connect(this.recClamp);
    else try { this.out.disconnect(this.recClamp); } catch { /* not connected */ }
  }

  // One shared ConvolverNode per (impulse, destination bus). Convolution is
  // linear, so hit -> sendGain -> sharedConvolver sounds the same as the old
  // hit -> ownConvolver -> gain, but costs one convolver instead of one per hit.
  reverbSend(buffer, dest) {
    let byDest = this.reverbSends.get(buffer);
    if (!byDest) {
      byDest = new Map();
      this.reverbSends.set(buffer, byDest);
    }
    let conv = byDest.get(dest);
    if (!conv) {
      conv = this.ctx.createConvolver();
      conv.buffer = buffer;
      conv.connect(dest);
      byDest.set(dest, conv);
    }
    return conv;
  }

  canSleep() {
    return !this.keepAwake && !this.recorder && this.voices.size === 0 &&
      !this.stepTimer && Object.keys(this.ambience).length === 0;
  }

  // Suspend the AudioContext once nothing has used it for a while (longest
  // reverb tail is 4.2 s), so the phone's audio hardware can go idle.
  armIdleCheck() {
    if (this.idleTimer || typeof window === "undefined") return;
    const check = () => {
      this.idleTimer = 0;
      if (!this.ctx || this.ctx.state !== "running") return;
      if (this.canSleep() && performance.now() - this.lastUse > this.idleMs) {
        void this.suspendFaded();
        return;
      }
      this.idleTimer = window.setTimeout(check, 1000);
    };
    this.idleTimer = window.setTimeout(check, 1000);
  }

  // Page hidden: suspend immediately unless recording. Visible: resume only if
  // the app still needs audio (playing); otherwise the next tap resumes it.
  setHidden(hidden) {
    if (!this.ctx) return;
    if (hidden) {
      if (this.recorder) return;
      this.hiddenSuspend = true;
      void this.suspendFaded();
    } else {
      this.hiddenSuspend = false;
      if (this.keepAwake && this.ctx.state !== "running") {
        this.resumeFaded();
        this.lastUse = performance.now();
        this.armIdleCheck();
      }
    }
  }

  setLimiter(on) {
    this.limiterOn = !!on;
    if (this.ctx) this.rewireMaster();
  }

  setMasterGain(v) {
    this.masterGain = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.015);
  }

  setPatch(patch) {
    this.patch = { ...this.patch, ...patch };
    this.applyPatch();
  }

  applyPatch() {
    if (!this.ctx || !this.pitFilter) return;
    const musical = toMusical(this.patch);
    const t = this.ctx.currentTime;
    const hz = Math.min(18000, Math.max(40, musical.cutoffHz));
    for (const f of [this.pitFilter, ...this.strips.map((st) => st?.pit).filter(Boolean)]) {
      f.frequency.setTargetAtTime(hz, t, 0.02);
      f.Q.setTargetAtTime(Math.max(0.1, musical.q), t, 0.02);
    }
  }

  // ---- Per-track mixer ----------------------------------------------------
  // strip: in (gain, forced stereo so mono voices keep their level) -> pan -> master
  //                                                       pan -> rev send / dly send
  // Sequenced voices go to their track's strip; pads, keys and MIDI keep the
  // category buses. Unity defaults sound exactly like the category buses.
  busFor(name) {
    if (this.route) return this.route.in;
    return this.buses[name] || this.master;
  }

  strip(track) {
    if (!this.ctx || !Number.isInteger(track) || track < 0) return null;
    let st = this.strips[track];
    if (st) return st;
    const ctx = this.ctx;
    const input = ctx.createGain();
    input.channelCount = 2;
    input.channelCountMode = "explicit";
    const pan = ctx.createStereoPanner();
    input.connect(pan);
    pan.connect(this.master);
    st = { in: input, pan, rev: null, dly: null, pit: null };
    this.strips[track] = st;
    this.applyMix(track);
    return st;
  }

  stripPit(st) {
    if (!st.pit) {
      const f = this.ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = this.pitFilter.frequency.value;
      f.Q.value = this.pitFilter.Q.value;
      f.connect(st.in);
      st.pit = f;
      this.applyPatch();
    }
    return st.pit;
  }

  ensureSends() {
    if (this.sends || !this.ctx) return this.sends;
    const ctx = this.ctx;
    const rev = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.buffer = this.verbLong;
    const revRet = ctx.createGain();
    revRet.gain.value = 0.5;
    rev.connect(conv);
    conv.connect(revRet);
    revRet.connect(this.master);
    // Tempo-synced dotted-eighth ping with a darkening feedback loop.
    const dly = ctx.createGain();
    const delay = ctx.createDelay(2);
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 3200;
    const dlyRet = ctx.createGain();
    dlyRet.gain.value = 0.6;
    dly.connect(delay);
    delay.connect(tone);
    tone.connect(fb);
    fb.connect(delay);
    tone.connect(dlyRet);
    dlyRet.connect(this.master);
    this.sends = { rev, conv, revRet, dly, delay, fb, tone, dlyRet };
    this.setSendTempo(this.sendBpm);
    return this.sends;
  }

  setSendTempo(bpm) {
    this.sendBpm = bpm;
    if (!this.sends) return;
    const sec = Math.min(1.5, (60 / bpm) * 0.75);
    this.sends.delay.delayTime.setTargetAtTime(sec, this.ctx.currentTime, 0.05);
    if (this.offline) this.sends.delay.delayTime.value = sec;
  }

  /** mix: array of { vol, pan, rev, dly } per track (from state.mixer). */
  setMixer(mix) {
    this.mix = Array.isArray(mix) ? mix.map((m) => ({ ...m })) : [];
    this.strips.forEach((st, i) => { if (st) this.applyMix(i); });
  }

  setTrackMix(track, m) {
    this.mix[track] = { ...m };
    if (this.strips[track]) this.applyMix(track);
  }

  applyMix(track) {
    const st = this.strips[track];
    if (!st) return;
    const m = this.mix[track] || { vol: 1, pan: 0, rev: 0, dly: 0 };
    const t = this.ctx.currentTime;
    const set = (param, v) => {
      if (this.offline) param.value = v;
      else param.setTargetAtTime(v, t, 0.015);
    };
    // 0.85 = the category bus gain these voices used before; vol is squared for a natural fader feel.
    set(st.in.gain, 0.85 * m.vol * m.vol);
    set(st.pan.pan, m.pan);
    for (const kind of ["rev", "dly"]) {
      const amt = m[kind] || 0;
      if (amt > 0.001 && !st[kind]) {
        const sends = this.ensureSends();
        const g = this.ctx.createGain();
        g.gain.value = 0;
        st.pan.connect(g);
        g.connect(sends[kind]);
        st[kind] = g;
      }
      if (st[kind]) set(st[kind].gain, amt * amt);
    }
  }

  readFrame(wantFreq = true) {
    if (!this.analyser || !this.timeBuf) {
      if (!this.silentFrame) this.silentFrame = { time: new Uint8Array(512).fill(128), freq: new Uint8Array(256), level: 0 };
      return this.silentFrame;
    }
    this.analyser.getByteTimeDomainData(this.timeBuf);
    if (wantFreq && this.freqAnalyser && this.freqBuf) this.freqAnalyser.getByteFrequencyData(this.freqBuf);
    let sum = 0;
    for (let i = 0; i < this.timeBuf.length; i++) {
      const v = (this.timeBuf[i] - 128) / 128;
      sum += v * v;
    }
    const level = Math.min(1, Math.sqrt(sum / this.timeBuf.length) * 3.4);
    return { time: this.timeBuf, freq: this.freqBuf, level };
  }

  down(midi, owner, velocity = 0.9, wave) {
    if (!this.arm() || !this.ctx) return;
    let owners = this.owners.get(midi);
    if (!owners) {
      owners = new Set();
      this.owners.set(midi, owners);
    }
    if (owners.has(owner)) return;
    const fresh = owners.size === 0;
    owners.add(owner);
    if (fresh) {
      this.stealIfNeeded(midi);
      const voice = this.spawn(midi, this.ctx.currentTime, velocity, wave);
      this.voices.set(midi, voice);
      this.born.set(midi, ++this.seq);
    }
    this.emit();
  }

  up(midi, owner) {
    const owners = this.owners.get(midi);
    if (!owners || !owners.has(owner)) return;
    owners.delete(owner);
    if (owners.size === 0) {
      this.voices.get(midi)?.release(this.ctx?.currentTime ?? 0);
      this.voices.delete(midi);
      this.owners.delete(midi);
      this.born.delete(midi);
    }
    this.emit();
  }

  releaseOwner(owner) {
    for (const [midi, set] of [...this.owners.entries()]) {
      if (set.has(owner)) this.up(midi, owner);
    }
  }

  releaseOwnerPrefix(prefix) {
    for (const [midi, set] of [...this.owners.entries()]) {
      for (const owner of [...set]) {
        if (owner.startsWith(prefix)) this.up(midi, owner);
      }
    }
  }

  allOff() {
    this.stopLoop();
    const now = this.ctx?.currentTime ?? 0;
    for (const voice of this.voices.values()) voice.release(now);
    this.voices.clear();
    this.owners.clear();
    this.born.clear();
    for (const name of Object.keys(this.ambience)) this.toggleAmbience(name, true);
    this.emit();
  }

  emit() {
    this.onNotes([...this.owners.keys()].sort((a, b) => a - b));
  }

  stealIfNeeded(midi) {
    if (this.voices.has(midi) || this.voices.size < 16 || !this.ctx) return;
    let oldestMidi = -1;
    let oldest = Infinity;
    for (const [m, born] of this.born) {
      if (m !== midi && born < oldest) {
        oldest = born;
        oldestMidi = m;
      }
    }
    if (oldestMidi < 0) return;
    this.voices.get(oldestMidi)?.release(this.ctx.currentTime);
    this.voices.delete(oldestMidi);
    this.owners.delete(oldestMidi);
    this.born.delete(oldestMidi);
  }

  spawnAt(midi, time, velocity, wave) {
    if (!this.arm() || !this.ctx) return null;
    return this.spawn(midi, time, velocity, wave);
  }

  spawn(midi, time, velocity, waveOverride) {
    const ctx = this.ctx;
    const filter = this.route ? this.stripPit(this.route) : this.pitFilter;
    const glide = this.glide;
    const musical = toMusical(this.patch);
    const wave = waveOverride || musical.wave;
    const freq = foldSub(Math.max(20, midiToHz(midi)));
    const attack = Math.max(0.003, musical.attack);
    const decay = Math.max(0.01, musical.decay);
    const sustain = musical.sustain;
    const releaseTime = Math.max(0.02, musical.release);
    const env = ctx.createGain();
    // `vca` sits after the envelope; release and choke fade it from 1 to 0, so
    // they never have to guess the envelope's value at a future time (no clicks).
    const vca = ctx.createGain();
    // Separate choke gain so a choke never fights the release automation.
    const chk = ctx.createGain();
    vca.connect(chk);
    const peak = this.peakFor(wave, midi, velocity) * (0.4 + musical.volume * 0.8);
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(peak, time + attack);
    env.gain.linearRampToValueAtTime(peak * sustain, time + attack + decay);
    const oscs = [];
    const extras = [];

    const startOsc = (type, frequency, detune = 0) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(Math.max(20, frequency), time);
      osc.detune.setValueAtTime(detune, time);
      osc.start(time);
      oscs.push(osc);
      return osc;
    };

    // 808 slide: start at the previous note's pitch and glide (no new punch).
    const slideTo = (osc, mult) => {
      osc.frequency.setValueAtTime(Math.max(20, glide.fromHz * mult), time);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * mult), time + glide.sec);
    };
    if (wave === "808") {
      const bass = midi < 48 && !glide;
      const osc = startOsc("sine", bass ? freq * 2.4 : freq);
      if (bass) osc.frequency.exponentialRampToValueAtTime(freq, time + 0.05);
      const harm = startOsc("sine", freq * 2);
      if (glide) {
        slideTo(osc, 1);
        slideTo(harm, 2);
      }
      const harmGain = ctx.createGain();
      harmGain.gain.setValueAtTime(bass ? 0.1 : 0.04, time);
      const shaper = ctx.createWaveShaper();
      shaper.curve = this.mild;
      shaper.oversample = "2x";
      osc.connect(shaper);
      harm.connect(harmGain);
      harmGain.connect(shaper);
      shaper.connect(env);
      extras.push(harmGain, shaper);
      if (bass && this.white) {
        const src = ctx.createBufferSource();
        src.buffer = this.white;
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.setValueAtTime(1400, time);
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.22, time);
        ng.gain.exponentialRampToValueAtTime(0.001, time + 0.035);
        src.connect(hp);
        hp.connect(ng);
        ng.connect(env);
        src.start(time);
        src.stop(time + 0.06);
        extras.push(src, hp, ng);
      }
    } else if (wave === "horror") {
      const mix = ctx.createGain();
      mix.gain.setValueAtTime(0.55, time);
      startOsc("sawtooth", freq, -14).connect(mix);
      startOsc("sawtooth", freq, 14).connect(mix);
      const high = startOsc("square", freq * 2);
      const highGain = ctx.createGain();
      highGain.gain.setValueAtTime(0.14, time);
      high.connect(highGain);
      highGain.connect(mix);
      const shaper = ctx.createWaveShaper();
      shaper.curve = this.heavy;
      shaper.oversample = "2x";
      const trem = ctx.createGain();
      trem.gain.setValueAtTime(0.86, time);
      const lfo = startOsc("sine", 5.2);
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.setValueAtTime(0.14, time);
      lfo.connect(lfoDepth);
      lfoDepth.connect(trem.gain);
      mix.connect(shaper);
      shaper.connect(env);
      env.connect(trem);
      trem.connect(vca);
      extras.push(mix, highGain, shaper, trem, lfoDepth);
    } else {
      const osc = startOsc(wave, freq);
      if (glide) slideTo(osc, 1);
      osc.connect(env);
    }

    if (wave !== "horror") env.connect(vca);
    chk.connect(filter);

    let stopped = false;
    const release = (when) => {
      if (stopped) return;
      stopped = true;
      const t = Math.max(when, ctx.currentTime);
      vca.gain.setValueAtTime(1, t);
      vca.gain.linearRampToValueAtTime(0, t + releaseTime);
      for (const osc of oscs) {
        try { osc.stop(t + releaseTime + 0.03); } catch { /* already stopped */ }
      }
    };
    const stopAll = (t) => {
      stopped = true;
      for (const osc of oscs) {
        try { osc.stop(t); } catch { /* already stopped */ }
      }
    };

    const head = oscs[0];
    if (head) {
      head.addEventListener("ended", () => {
        try { env.disconnect(); } catch { /* gone */ }
        try { vca.disconnect(); } catch { /* gone */ }
        try { chk.disconnect(); } catch { /* gone */ }
        for (const node of extras) {
          try { node.disconnect(); } catch { /* gone */ }
        }
      });
    }
    this.lastHz = freq;
    return { env, vca, chk, oscs, extras, release, stopAll };
  }

  peakFor(wave, midi, velocity) {
    const vel = Math.min(1, Math.max(0.05, velocity));
    if (wave === "808") return vel * (midi < 48 ? 0.62 : 0.22);
    if (wave === "horror") return vel * 0.28;
    if (wave === "square") return vel * 0.22;
    return vel * 0.3;
  }

  firePit(midi, when, velocity, wave, dur, chokeGroup = null) {
    if (!this.arm()) return;
    const voice = this.spawnAt(midi, when, velocity, wave);
    if (!voice) return;
    voice.release(when + Math.max(0.05, dur));
    if (chokeGroup) this.choke(chokeGroup, when, voice.chk, voice.stopAll);
  }

  startLoop(steps, stepMs, gate) {
    this.stopLoop();
    if (!this.arm() || !this.ctx) return;
    const gen = ++this.loopGen;
    let i = 0;
    const fire = () => {
      if (gen !== this.loopGen || !this.ctx) return;
      if (this.gateTimer) window.clearTimeout(this.gateTimer);
      this.releaseOwner("loop");
      const chord = steps[i % steps.length] ?? [];
      i += 1;
      for (const n of chord) this.down(n, "loop", 0.82);
      this.gateTimer = window.setTimeout(() => {
        if (gen !== this.loopGen) return;
        this.releaseOwner("loop");
      }, Math.max(40, stepMs * gate));
      this.stepTimer = window.setTimeout(fire, stepMs);
    };
    fire();
  }

  stopLoop() {
    this.loopGen += 1;
    if (this.stepTimer) window.clearTimeout(this.stepTimer);
    if (this.gateTimer) window.clearTimeout(this.gateTimer);
    this.stepTimer = 0;
    this.gateTimer = 0;
    this.releaseOwner("loop");
  }

  playHit(hit, when = null, velocity = 0.9) {
    if (!hit || !this.arm()) return;
    const t = when == null ? this.ctx.currentTime : when;
    const prev = { ...this.patch };
    this.setPatch(Object.assign({}, this.patch, {
      wave: hit.tone.wave,
      attack: hit.tone.attack < 1 && hit.tone.attack > 0 && hit.tone.attack <= 1 ? this.patch.attack : this.patch.attack,
    }));
    // Apply the hit tone as a temporary musical overlay by spawning with that wave
    // and a locally constructed env via current patch mutation:
    const saved = { ...this.patch };
    this.patch = {
      ...this.patch,
      wave: hit.tone.wave,
      cutoff: hit.tone.cutoff,
      resonance: hit.tone.resonance,
      sustain: hit.tone.sustain,
      attack: Math.max(0, Math.min(1, hit.tone.attack <= 1 ? hit.tone.attack : this.patch.attack)),
      decay: this.patch.decay,
      release: this.patch.release,
    };
    // Better: convert tone (already musical seconds for a/d/r) using withTone-equivalent
    // The pad path in the UI uses withTone before calling down(). This method is a fallback.
    this.patch = saved;
    this.setPatch(prev);
    const wave = hit.tone.wave;
    const notes = hit.notes ?? [];
    const hold = Math.max(0.12, (hit.tone.attack || 0) + (hit.tone.decay || 0) + (hit.tone.release || 0.2));
    for (const n of notes) this.firePit(n, t, velocity, wave, hold);
  }

  playNocturne808(freq, voice, when, velocity = 0.9) {
    if (!this.arm()) return;
    const C = this.ctx;
    const m = when;
    const y = this.busFor("808");
    const p = this.n808;
    const g = C.createOscillator();
    g.type = "sine";
    const P = C.createOscillator();
    P.type = voice === "Metallic" ? "triangle" : "sine";
    const I = C.createGain();
    I.gain.setValueAtTime(0, m);
    const H = C.createBiquadFilter();
    H.type = "lowpass";
    H.frequency.value = p.lp;
    const V = C.createBiquadFilter();
    V.type = "highpass";
    V.frequency.value = p.hp;
    const J = C.createWaveShaper();
    const driveAmt = p.drive + (voice === "Distorted" ? 60 : voice === "Saturated" ? 30 : voice === "Overdriven Memphis" ? 85 : 0);
    J.curve = nocturneCurve(driveAmt);
    J.oversample = "2x";
    // Drive makeup compensation: level-match to the default drive's loudness.
    const driveComp = C.createGain();
    driveComp.gain.value = Math.min(1, curveSineRms(p.drive) / curveSineRms(driveAmt));
    const kn = C.createDelay(0.5);
    kn.delayTime.value = 0.22;
    const zn = C.createGain();
    zn.gain.value = p.delay * 0.35;
    let Ie = freq * Math.pow(2, p.fine) * Math.pow(2, p.octave / 12);
    if (voice === "Sub-Heavy") Ie *= 0.75;
    if (voice === "Short Punchy") Ie *= 1.1;
    if (voice === "House Sub") Ie *= 0.9;
    Ie = foldSub(Ie); // e.g. Sub-Heavy on C1 (24.5 Hz) plays an octave up instead of below 30 Hz
    const slide = this.glide;
    const bt = foldSub(slide ? slide.fromHz : this.lastHz);
    const qu = slide ? slide.sec : p.glide / 1000;
    if (slide || p.glide > 5) {
      g.frequency.setValueAtTime(bt, m);
      g.frequency.linearRampToValueAtTime(Ie, m + qu);
      P.frequency.setValueAtTime(bt * 1.01, m);
      P.frequency.linearRampToValueAtTime(Ie * 1.01, m + qu);
    } else {
      g.frequency.setValueAtTime(Ie, m);
      P.frequency.setValueAtTime(Ie * 1.01, m);
    }
    this.lastHz = Ie;
    if (!slide && voice !== "Long Sustained" && voice !== "Dark Verb") {
      g.frequency.setValueAtTime(Ie * (voice === "Short Punchy" ? 2.2 : 1.6), m);
      g.frequency.exponentialRampToValueAtTime(Ie, m + 0.09);
    }
    let hold = voice === "Long Sustained" ? 0.9 : voice === "Short Punchy" ? 0.08 : 0.35;
    if (voice === "Sliding") hold = 0.6;
    if (this.gateSec > 0) hold = Math.max(0.03, this.gateSec - p.attack - p.decay);
    const ue = p.attack, ie = p.decay, $e = p.sustain, pt = p.release;
    // Per-voice cap: the clean sine plus the driven layer used to sum to ~1.3x
    // full scale per hit; 0.7 keeps a single NOCTURNE 808 under ~-1 dBFS.
    const cap = 0.7;
    I.gain.linearRampToValueAtTime(velocity * 0.95 * cap, m + ue);
    I.gain.linearRampToValueAtTime(velocity * $e * cap, m + ue + ie);
    I.gain.linearRampToValueAtTime(0, m + ue + ie + hold + pt);
    g.connect(V);
    V.connect(H);
    H.connect(J);
    J.connect(driveComp);
    driveComp.connect(I);
    P.connect(I);
    // Choke gain: a new NOCTURNE 808 hit fades this one out (mono, like an 808).
    const chk = C.createGain();
    I.connect(chk);
    if (p.reverb > 0.01 && this.verbShort) {
      const Sn = C.createGain();
      Sn.gain.value = p.reverb;
      chk.connect(Sn);
      Sn.connect(this.reverbSend(voice === "Dark Verb" ? this.verbLong : this.verbShort, y));
    }
    if (p.delay > 0.01) {
      chk.connect(kn);
      kn.connect(zn);
      zn.connect(y);
    }
    chk.connect(y);
    g.start(m);
    P.start(m);
    g.stop(m + ue + ie + hold + pt + 0.1);
    P.stop(m + ue + ie + hold + pt + 0.1);
    this.choke("n808", m, chk, (t) => {
      try { g.stop(t); } catch { /* done */ }
      try { P.stop(t); } catch { /* done */ }
    });
  }

  playDrum(name, when, velocity = 0.9) {
    if (!this.arm()) return;
    const C = this.ctx;
    const m = when;
    const y = this.busFor("Drums");
    const h = velocity;
    if (name.includes("Kick") || name === "Short Punch" || name === "Analog Kick") {
      const g = C.createOscillator();
      const startF = name === "Sub Kick" ? 110 : name === "Analog Kick" ? 130 : 150;
      const endF = name === "Sub Kick" ? 32 : 38;
      g.frequency.setValueAtTime(startF, m);
      g.frequency.exponentialRampToValueAtTime(endF, m + 0.12);
      const P = C.createGain();
      P.gain.setValueAtTime(0, m);
      P.gain.linearRampToValueAtTime(h, m + 0.001);
      P.gain.exponentialRampToValueAtTime(0.001, m + (name === "Short Punch" ? 0.22 : 0.45));
      const I = C.createWaveShaper();
      I.curve = nocturneCurve(name === "Distorted Kick" ? 80 : name === "Hard Kick" ? 20 : 0);
      g.connect(I);
      I.connect(P);
      P.connect(y);
      const H = C.createBufferSource();
      H.buffer = this.white;
      const V = C.createGain();
      V.gain.setValueAtTime(h * 0.25, m);
      V.gain.exponentialRampToValueAtTime(0.001, m + 0.03);
      H.connect(V);
      V.connect(y);
      H.start(m);
      g.start(m);
      g.stop(m + 0.5);
    } else if (name.includes("Snare") || name.includes("Sharp")) {
      const g = C.createBufferSource();
      g.buffer = this.white;
      const P = C.createBiquadFilter();
      P.type = "bandpass";
      P.frequency.value = name.includes("Metallic") ? 2600 : name.includes("Memphis") ? 1400 : 1800;
      P.Q.value = 0.8;
      const I = C.createGain();
      I.gain.setValueAtTime(h * 0.9, m);
      I.gain.exponentialRampToValueAtTime(0.01, m + (name.includes("Verb") ? 0.45 : 0.22));
      g.connect(P);
      P.connect(I);
      I.connect(y);
      const H = C.createOscillator();
      H.frequency.value = 190;
      const V = C.createGain();
      V.gain.setValueAtTime(h * 0.6, m);
      V.gain.exponentialRampToValueAtTime(0.01, m + 0.12);
      H.connect(V);
      V.connect(y);
      if (name.includes("Verb") && this.verbShort) {
        const cg = C.createGain();
        cg.gain.value = 0.45;
        I.connect(cg);
        cg.connect(this.reverbSend(this.verbShort, y));
      }
      g.start(m);
      H.start(m);
      g.stop(m + 0.25);
      H.stop(m + 0.15);
    } else if (name.includes("Clap")) {
      const bursts = name.includes("Wide") ? 4 : 3;
      for (let g = 0; g < bursts; g++) {
        const P = C.createBufferSource();
        P.buffer = this.white;
        const I = C.createGain();
        I.gain.setValueAtTime(0, m + g * 0.03);
        I.gain.linearRampToValueAtTime(h * 0.7, m + g * 0.03 + 0.005);
        I.gain.exponentialRampToValueAtTime(0.01, m + g * 0.03 + (name.includes("Industrial") ? 0.22 : 0.15));
        const H = C.createBiquadFilter();
        H.type = "highpass";
        H.frequency.value = name.includes("Dark") ? 700 : 900;
        P.connect(H);
        H.connect(I);
        I.connect(y);
        P.start(m + g * 0.03);
        P.stop(m + g * 0.03 + 0.2);
      }
    } else {
      const g = C.createBufferSource();
      g.buffer = this.white;
      const P = C.createBiquadFilter();
      P.type = "highpass";
      P.frequency.value = name.includes("Metallic") ? 6000 : 4500;
      const I = C.createBiquadFilter();
      I.type = "bandpass";
      I.frequency.value = 8000;
      I.Q.value = 1;
      const H = C.createGain();
      const V = name.includes("Open") ? 0.35 : name.includes("Short") ? 0.04 : 0.11;
      H.gain.setValueAtTime(h * 0.6, m);
      H.gain.exponentialRampToValueAtTime(0.01, m + V);
      const J = C.createOscillator();
      J.type = "square";
      J.frequency.value = 9000;
      const Ce = C.createGain();
      Ce.gain.setValueAtTime(h * 0.12, m);
      Ce.gain.exponentialRampToValueAtTime(0.01, m + V);
      g.connect(P);
      P.connect(I);
      I.connect(H);
      H.connect(y);
      if (name.includes("Metallic") || name.includes("Noisy")) {
        J.connect(Ce);
        Ce.connect(y);
        J.start(m);
        J.stop(m + V);
      }
      g.start(m);
      g.stop(m + V + 0.02);
    }
  }

  playMemphis(name, when) {
    if (!this.arm()) return;
    const c = this.ctx;
    const h = when;
    const dest = this.busFor("Memphis");
    if (name === "Cassette Hiss" || name === "VHS Noise") {
      const m = c.createBufferSource();
      m.buffer = this.white;
      m.loop = true;
      const y = c.createBiquadFilter();
      y.type = "bandpass";
      y.frequency.value = name === "Cassette Hiss" ? 3400 : 1800;
      const g = c.createGain();
      g.gain.setValueAtTime(0.22, h);
      const P = c.createWaveShaper();
      P.curve = nocturneCurve(20);
      m.connect(y);
      y.connect(P);
      P.connect(g);
      g.connect(dest);
      m.start(h);
      m.stop(h + 1.4);
    } else {
      const m = c.createOscillator();
      m.type = "sawtooth";
      m.frequency.value = name === "Metallic Perc" ? 220 : 90;
      const y = c.createGain();
      y.gain.setValueAtTime(0.7, h);
      y.gain.exponentialRampToValueAtTime(0.01, h + 0.6);
      const g = c.createWaveShaper();
      g.curve = nocturneCurve(name === "Dirty 808" ? 70 : 24);
      m.connect(g);
      g.connect(y);
      y.connect(dest);
      m.start(h);
      m.stop(h + 0.7);
    }
  }

  playColdwave(name, when) {
    if (!this.arm()) return;
    const c = this.ctx;
    const h = when;
    const dest = this.busFor("Coldwave");
    const m = c.createOscillator();
    m.type = "sawtooth";
    m.frequency.value = name === "Juno Bass" ? 55 : name === "Cold Pluck" ? 220 : 110;
    const y = c.createOscillator();
    y.type = "square";
    y.frequency.value = m.frequency.value * 1.007;
    const g = c.createGain();
    g.gain.setValueAtTime(0, h);
    g.gain.linearRampToValueAtTime(0.55, h + (name === "Cold Pluck" ? 0.01 : 0.08));
    g.gain.exponentialRampToValueAtTime(0.01, h + (name === "Cold Pluck" ? 0.45 : 1.6));
    const P = c.createBiquadFilter();
    P.type = "lowpass";
    P.frequency.value = 2400;
    P.Q.value = 1.6;
    m.connect(P);
    y.connect(P);
    P.connect(g);
    if (this.verbShort) {
      const Ce = c.createGain();
      Ce.gain.value = 0.35;
      g.connect(Ce);
      Ce.connect(this.reverbSend(this.verbShort, dest));
    }
    g.connect(dest);
    m.start(h);
    y.start(h);
    m.stop(h + 1.7);
    y.stop(h + 1.7);
  }

  playHouse(name, when) {
    if (!this.arm()) return;
    const c = this.ctx;
    const h = when;
    const dest = this.busFor("House");
    if (name.includes("Kick")) {
      const m = c.createOscillator();
      m.frequency.setValueAtTime(60, h);
      m.frequency.exponentialRampToValueAtTime(40, h + 0.15);
      const y = c.createGain();
      y.gain.setValueAtTime(1, h);
      y.gain.exponentialRampToValueAtTime(0.01, h + 0.4);
      m.connect(y);
      y.connect(dest);
      m.start(h);
      m.stop(h + 0.5);
    } else if (name.includes("Bass")) {
      const m = c.createOscillator();
      m.type = "sine";
      m.frequency.value = name.includes("Dark") ? 41 : 55;
      const y = c.createBiquadFilter();
      y.type = "lowpass";
      y.frequency.value = 400;
      const g = c.createGain();
      g.gain.setValueAtTime(0.7, h);
      g.gain.exponentialRampToValueAtTime(0.01, h + 0.8);
      m.connect(y);
      y.connect(g);
      g.connect(dest);
      m.start(h);
      m.stop(h + 0.9);
    } else if (name.includes("Acid")) {
      const m = c.createOscillator();
      m.type = "sawtooth";
      m.frequency.value = 110;
      const y = c.createBiquadFilter();
      y.type = "lowpass";
      y.frequency.value = 300;
      y.frequency.linearRampToValueAtTime(2200, h + 0.5);
      y.frequency.linearRampToValueAtTime(300, h + 1.1);
      const g = c.createGain();
      g.gain.setValueAtTime(0.5, h);
      g.gain.exponentialRampToValueAtTime(0.01, h + 1.2);
      m.connect(y);
      y.connect(g);
      g.connect(dest);
      m.start(h);
      m.stop(h + 1.3);
    } else if (name.includes("Shaker")) {
      for (let i = 0; i < 4; i++) {
        const y = c.createBufferSource();
        y.buffer = this.white;
        const g = c.createBiquadFilter();
        g.type = "bandpass";
        g.frequency.value = 3000;
        const P = c.createGain();
        P.gain.setValueAtTime(0, h + i * 0.12);
        P.gain.linearRampToValueAtTime(0.4, h + i * 0.12 + 0.01);
        P.gain.exponentialRampToValueAtTime(0.01, h + i * 0.12 + 0.08);
        y.connect(g);
        g.connect(P);
        P.connect(dest);
        y.start(h + i * 0.12);
        y.stop(h + i * 0.12 + 0.1);
      }
    } else {
      const notes = name.includes("Piano") ? [130.81, 164.81, 196, 246.94] : [110, 138, 174];
      for (const y of notes) {
        const g = c.createOscillator();
        g.frequency.value = y;
        const P = c.createGain();
        P.gain.setValueAtTime(0.25, h);
        P.gain.exponentialRampToValueAtTime(0.01, h + 0.9);
        g.connect(P);
        P.connect(dest);
        g.start(h);
        g.stop(h + 1);
      }
    }
  }

  playDsbm(name, when) {
    if (!this.arm()) return;
    const c = this.ctx;
    const h = when;
    const dest = this.busFor("DSBM");
    if (name.includes("Tremolo")) {
      for (let i = 0; i < 16; i++) {
        const y = c.createOscillator();
        y.type = "sawtooth";
        y.frequency.value = 110 + Math.random() * 10;
        const g = c.createGain();
        g.gain.setValueAtTime(0, h + i * 0.04);
        g.gain.linearRampToValueAtTime(0.22, h + i * 0.04 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.01, h + i * 0.04 + 0.06);
        const P = c.createWaveShaper();
        P.curve = nocturneCurve(120);
        y.connect(P);
        P.connect(g);
        g.connect(dest);
        y.start(h + i * 0.04);
        y.stop(h + i * 0.04 + 0.08);
      }
    } else if (name.includes("Wind")) {
      const m = c.createBufferSource();
      m.buffer = this.white;
      const y = c.createBiquadFilter();
      y.type = "bandpass";
      y.frequency.value = 400 + Math.random() * 200;
      const g = c.createGain();
      g.gain.setValueAtTime(0.3, h);
      g.gain.exponentialRampToValueAtTime(0.01, h + 2.2);
      m.connect(y);
      y.connect(g);
      g.connect(dest);
      m.start(h);
      m.stop(h + 2.5);
    } else if (name.includes("Feedback")) {
      const m = c.createOscillator();
      m.frequency.value = 1800;
      const y = c.createBiquadFilter();
      y.type = "bandpass";
      y.Q.value = 18;
      y.frequency.value = 1800;
      const g = c.createGain();
      g.gain.setValueAtTime(0.4, h);
      g.gain.exponentialRampToValueAtTime(0.01, h + 2.5);
      m.connect(y);
      y.connect(g);
      g.connect(dest);
      m.start(h);
      m.stop(h + 2.6);
    } else {
      const m = c.createOscillator();
      m.type = "sawtooth";
      m.frequency.value = 55;
      const y = c.createGain();
      y.gain.setValueAtTime(0.45, h);
      y.gain.exponentialRampToValueAtTime(0.01, h + 2);
      const g = c.createWaveShaper();
      g.curve = nocturneCurve(90);
      m.connect(g);
      g.connect(y);
      if (this.verbLong) {
        const I = c.createGain();
        I.gain.value = 0.6;
        y.connect(I);
        I.connect(this.reverbSend(this.verbLong, dest));
      }
      y.connect(dest);
      m.start(h);
      m.stop(h + 2.2);
    }
  }

  playVocal(name, when) {
    if (!this.arm()) return;
    const c = this.ctx;
    const h = when;
    const dest = this.busFor("Vocals");
    if (name.includes("Telephone") || name.includes("Radio") || name.includes("Breath") || name.includes("Whisper")) {
      const m = c.createBufferSource();
      m.buffer = name.includes("Whisper") ? this.pink : this.white;
      const y = c.createBiquadFilter();
      y.type = "bandpass";
      y.frequency.value = name.includes("Telephone") ? 1200 : name.includes("Whisper") ? 2800 : 800;
      y.Q.value = 0.9;
      const g = c.createGain();
      g.gain.setValueAtTime(0.35, h);
      g.gain.exponentialRampToValueAtTime(0.01, h + 1.2);
      const P = c.createWaveShaper();
      P.curve = nocturneCurve(name.includes("Distorted") ? 70 : 0);
      m.connect(y);
      y.connect(P);
      P.connect(g);
      g.connect(dest);
      m.start(h);
      m.stop(h + 1.3);
    } else if (name.includes("Choir")) {
      for (const off of [0, 7, 12]) {
        const y = c.createOscillator();
        y.type = "sawtooth";
        y.frequency.value = 110 * Math.pow(2, off / 12);
        y.detune.value = Math.random() * 10 - 5;
        const g = c.createGain();
        g.gain.setValueAtTime(0.18, h);
        g.gain.exponentialRampToValueAtTime(0.01, h + 2);
        y.connect(g);
        g.connect(dest);
        y.start(h);
        y.stop(h + 2.2);
      }
    } else if (name.includes("Robotic")) {
      const m = c.createOscillator();
      m.frequency.value = 120;
      const y = c.createOscillator();
      y.frequency.value = 30;
      const P = c.createGain();
      y.connect(P.gain);
      m.connect(P);
      P.connect(dest);
      m.start(h);
      y.start(h);
      m.stop(h + 1);
      y.stop(h + 1);
    } else {
      const m = c.createOscillator();
      m.frequency.value = name.includes("Deep") ? 80 : name.includes("Scream") ? 300 : 150;
      const y = c.createWaveShaper();
      y.curve = nocturneCurve(name.includes("Distorted") || name.includes("Scream") ? 100 : 15);
      const g = c.createGain();
      g.gain.setValueAtTime(0.45, h);
      g.gain.exponentialRampToValueAtTime(0.01, h + 1.5);
      m.connect(y);
      y.connect(g);
      if (this.verbShort) {
        const I = c.createGain();
        I.gain.value = name.includes("Distant") ? 0.7 : 0.2;
        g.connect(I);
        I.connect(this.reverbSend(this.verbShort, dest));
      }
      g.connect(dest);
      m.start(h);
      m.stop(h + 1.6);
    }
  }

  toggleAmbience(name, forceOff = false) {
    if (!this.arm()) return false;
    const existing = this.ambience[name];
    if (existing) {
      try { existing.src.stop(); } catch { /* already */ }
      delete this.ambience[name];
      return false;
    }
    if (forceOff) return false;
    const k = this.ctx;
    const dest = this.busFor("Ambience");
    const C = k.createBufferSource();
    if (name === "Electrical Hum") {
      const P = k.createBuffer(1, k.sampleRate * 2, k.sampleRate);
      const I = P.getChannelData(0);
      for (let i = 0; i < I.length; i++) {
        I[i] = Math.sin((2 * Math.PI * 60 * i) / k.sampleRate) * 0.3 + Math.sin((2 * Math.PI * 120 * i) / k.sampleRate) * 0.15 + (Math.random() * 2 - 1) * 0.05;
      }
      C.buffer = P;
    } else if (name === "Rain" || name === "Wind" || name === "City Night" || name === "Industrial") {
      C.buffer = name === "Rain" ? this.white : this.pink;
    } else {
      C.buffer = this.pink;
    }
    C.loop = true;
    const m = k.createBiquadFilter();
    m.type = "lowpass";
    m.frequency.value = name === "Rain" ? 3200 : name === "Wind" ? 800 : name === "Electrical Hum" ? 6000 : 1200;
    const y = k.createGain();
    y.gain.value = name === "Rain" ? 0.18 : 0.22;
    const g = k.createStereoPanner();
    g.pan.value = Math.random() * 0.4 - 0.2;
    C.connect(m);
    m.connect(y);
    y.connect(g);
    g.connect(dest);
    C.start();
    this.ambience[name] = { src: C, gain: y };
    return true;
  }

  /**
   * Play one sequenced step. opts: { track, gate (sec, 0 = sound's own length), slide }.
   * With `track`, the voice goes through that track's mixer strip.
   */
  triggerSource(source, step, when, velocity, opts = {}) {
    if (!this.arm()) return;
    const track = Number.isInteger(opts.track) ? opts.track : -1;
    const route = track >= 0 ? this.strip(track) : null;
    this.route = route;
    const prevHz = this.trackHz.get(track);
    const melodic = sourceIsPit(source) || sourceIsN808(source);
    this.glide = opts.slide && melodic && prevHz ? { fromHz: prevHz, sec: Math.max(0.03, opts.slideSec || 0.08) } : null;
    this.gateSec = opts.gate > 0 ? opts.gate : 0;
    try {
      this.playSource(source, step, when, velocity);
    } finally {
      this.route = null;
      this.glide = null;
      this.gateSec = 0;
    }
    if (melodic && track >= 0) this.trackHz.set(track, this.lastHz);
  }

  playSource(source, step, when, velocity) {
    const t = when;
    const vel = velocity;
    const gate = this.gateSec;
    if (sourceIsPit(source)) {
      const wave = pitWaveFromSource(source);
      const midi = step?.note ?? 36;
      const musical = toMusical(this.patch);
      const dur = gate > 0 ? gate : Math.max(0.16, musical.attack + musical.decay + musical.release * 0.65 + 0.18);
      // Sequenced 808 subs are monophonic per source, like a real 808.
      this.firePit(midi, t, vel, wave, dur, wave === "808" ? `seq:${source}` : null);
      return;
    }
    if (sourceIsN808(source)) {
      const voice = source.slice(5);
      const midi = step?.note ?? 36;
      this.playNocturne808(midiToHz(midi), voice, t, vel);
      return;
    }
    if (sourceIsChord(source)) {
      const id = step?.chordId || source.slice(6);
      const hit = hitById(id);
      if (!hit) return;
      const wave = hit.tone.wave;
      const hold = gate > 0 ? gate : 0.28;
      for (const n of hit.notes ?? []) this.firePit(n, t, vel, wave, hold);
      return;
    }
    if (sourceIsTr808(source)) {
      this.play808(source.slice(3), t, vel, step?.note, gate);
      return;
    }
    const slot = sampleSlotFromSource(source);
    if (slot) {
      this.playSample(slot, t, vel, gate);
      return;
    }
    this.playNamed(source, t, vel);
  }

  // ---- Classic TR-808 voices ----------------------------------------------
  // Modelled on the 808's circuits: bridged-T sine bass drum with a short
  // pitch blip, two-tone snare + snappy noise, multi-burst clap, six detuned
  // square "metal" oscillators (205-800 Hz) for hats/cymbal, two-square
  // cowbell, tuned toms, rimshot, clave and maracas. Hats share one
  // pre-rendered metal buffer, so a 1/32 roll costs one buffer source per hit.
  metalBuffer() {
    if (this.metal808 && this.metal808.sampleRate === this.ctx.sampleRate) return this.metal808;
    const rate = this.ctx.sampleRate;
    const n = Math.round(rate * 0.6);
    const buf = this.ctx.createBuffer(1, n, rate);
    const d = buf.getChannelData(0);
    const freqs = [205.3, 304.4, 369.6, 522.7, 540, 800];
    for (let i = 0; i < n; i++) {
      let x = 0;
      for (const f of freqs) x += ((i * f) / rate) % 1 < 0.5 ? 1 : -1;
      d[i] = x / freqs.length;
    }
    this.metal808 = buf;
    return buf;
  }

  play808(id, when, velocity = 0.9, midi = null, gate = 0) {
    if (!this.arm()) return;
    const C = this.ctx;
    const t = when;
    // TR808_LEVEL gain-stages the kit so a busy classic groove peaks around
    // -6 dBFS before the safety stage, like the rest of the app.
    const v = Math.min(1, Math.max(0.05, velocity)) * TR808_LEVEL;
    const out = this.busFor("Drums");
    const chk = C.createGain(); // choke / gate gain (1 -> 0 on choke)
    chk.connect(out);
    const srcs = [];
    let end = t + 0.1;
    const decayEnv = (g, peak, dec, start = t, attack = 0.0015) => {
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(peak, start + attack);
      g.gain.exponentialRampToValueAtTime(0.0005, start + attack + dec);
      g.gain.setValueAtTime(0, start + attack + dec + 0.001);
      end = Math.max(end, start + attack + dec + 0.02);
    };
    const osc = (type, hz, dest) => {
      const o = C.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(hz, t);
      o.connect(dest);
      srcs.push(o);
      return o;
    };
    const noise = (dest, buffer = this.white) => {
      const b = C.createBufferSource();
      b.buffer = buffer;
      b.connect(dest);
      srcs.push(b);
      return b;
    };
    const filter = (type, hz, q, dest) => {
      const f = C.createBiquadFilter();
      f.type = type;
      f.frequency.value = hz;
      f.Q.value = q;
      f.connect(dest);
      return f;
    };
    const amp = (dest = chk) => {
      const g = C.createGain();
      g.connect(dest);
      return g;
    };
    let group = null;
    if (id === "BD") {
      // ~49 Hz body (a hair above the safety high-pass), 4:1 pitch blip, long boom.
      const body = amp();
      const o = osc("sine", 49 * 3.2, body);
      o.frequency.exponentialRampToValueAtTime(49 * 1.15, t + 0.025);
      o.frequency.exponentialRampToValueAtTime(49, t + 0.12);
      decayEnv(body, v * 0.95, 0.42 + v * 0.38);
      const click = amp();
      noise(filter("lowpass", 2600, 0.7, click));
      decayEnv(click, v * 0.18, 0.008);
      group = "tr:BD";
    } else if (id === "SD") {
      const tone = amp();
      osc("triangle", 238, tone);
      decayEnv(tone, v * 0.5, 0.11);
      const tone2 = amp();
      osc("sine", 476, tone2);
      decayEnv(tone2, v * 0.22, 0.07);
      const snap = amp();
      noise(filter("highpass", 1800, 0.6, filter("lowpass", 9000, 0.5, snap)));
      decayEnv(snap, v * 0.48, 0.17 + v * 0.05);
    } else if (id === "CP") {
      const g = amp();
      noise(filter("bandpass", 1150, 1.3, filter("highpass", 600, 0.5, g)));
      g.gain.setValueAtTime(0, t);
      for (let k = 0; k < 3; k++) {
        const s = t + k * 0.0105;
        g.gain.setValueAtTime(v * 0.95, s);
        g.gain.exponentialRampToValueAtTime(v * 0.12, s + 0.0095);
      }
      const tail = t + 0.0315;
      g.gain.setValueAtTime(v * 0.8, tail);
      g.gain.exponentialRampToValueAtTime(0.0005, tail + 0.19);
      g.gain.setValueAtTime(0, tail + 0.191);
      end = tail + 0.21;
    } else if (id === "CH" || id === "OH") {
      const g = amp();
      const b = noise(filter("highpass", 7200, 0.7, filter("bandpass", 10000, 0.9, g)), this.metalBuffer());
      b.loop = true;
      decayEnv(g, v * (id === "OH" ? 0.62 : 0.7), id === "OH" ? 0.34 + v * 0.12 : 0.045);
      group = "tr:HH"; // closed hat chokes the open hat, like the real machine
    } else if (id === "CB") {
      const g = amp();
      const f = filter("bandpass", 1150, 0.55, g);
      osc("square", 540, f);
      osc("square", 800, f);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(v * 0.42, t + 0.001);
      g.gain.exponentialRampToValueAtTime(v * 0.13, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.34);
      g.gain.setValueAtTime(0, t + 0.341);
      end = t + 0.36;
      group = "tr:CB";
    } else if (id === "TOM") {
      const hz = Math.min(400, Math.max(60, midiToHz(midi ?? 48)));
      const g = amp();
      const o = osc("sine", hz * 1.3, g);
      o.frequency.exponentialRampToValueAtTime(hz, t + 0.07);
      decayEnv(g, v * 0.78, hz < 110 ? 0.5 : hz < 160 ? 0.38 : 0.3);
      const n = amp();
      noise(filter("lowpass", hz * 6, 0.7, n), this.pink);
      decayEnv(n, v * 0.06, 0.08);
      group = "tr:TOM";
    } else if (id === "RS") {
      const g = amp();
      const hp = filter("highpass", 380, 0.7, g);
      osc("triangle", 1700, hp);
      osc("sine", 455, hp);
      decayEnv(g, v * 0.5, 0.028);
    } else if (id === "CL") {
      const g = amp();
      osc("sine", 2500, g);
      decayEnv(g, v * 0.42, 0.035);
    } else if (id === "MA") {
      const g = amp();
      noise(filter("highpass", 5200, 0.7, g));
      decayEnv(g, v * 0.32, 0.045, t, 0.004);
    } else {
      chk.disconnect();
      return;
    }
    if (gate > 0 && t + gate < end) {
      chk.gain.setValueAtTime(1, t + gate);
      chk.gain.linearRampToValueAtTime(0, t + gate + 0.012);
      end = t + gate + 0.03;
    }
    for (const s of srcs) {
      s.start(t);
      s.stop(end);
    }
    srcs[0]?.addEventListener("ended", () => {
      try { chk.disconnect(); } catch { /* gone */ }
    });
    if (group) this.choke(group, t, chk, (at) => { for (const s of srcs) { try { s.stop(at); } catch { /* done */ } } });
  }

  /** Install (or remove with null) a user sample record { name, rate, pcm: Int16Array }. */
  setSample(slot, rec) {
    this.samples.delete(slot);
    if (rec) this.sampleRecs.set(slot, rec);
    else this.sampleRecs.delete(slot);
  }

  sampleBuffer(slot) {
    let buf = this.samples.get(slot);
    if (!buf) {
      const rec = this.sampleRecs.get(slot);
      if (!rec || !this.ctx) return null;
      buf = makeBuffer(this.ctx, rec);
      this.samples.set(slot, buf);
    }
    return buf;
  }

  // One-shot sample voice. Samples are stored normalised to -6 dBFS; a new
  // hit on the same slot chokes the last one (mono, like an MPC pad), so
  // rolls never stack up.
  playSample(slot, when, velocity = 0.9, gate = 0) {
    if (!this.arm()) return;
    const buf = this.sampleBuffer(slot);
    if (!buf) return;
    const C = this.ctx;
    const src = C.createBufferSource();
    src.buffer = buf;
    const g = C.createGain();
    const vel = Math.min(1, Math.max(0.05, velocity));
    g.gain.setValueAtTime(vel, when);
    const chk = C.createGain();
    src.connect(g);
    g.connect(chk);
    chk.connect(this.busFor("Samples"));
    const dur = gate > 0 ? Math.min(gate, buf.duration) : buf.duration;
    if (dur < buf.duration) {
      g.gain.setValueAtTime(vel, when + Math.max(0, dur - 0.01));
      g.gain.linearRampToValueAtTime(0, when + dur);
    }
    src.start(when);
    src.stop(when + dur + 0.02);
    src.addEventListener("ended", () => {
      try { g.disconnect(); } catch { /* gone */ }
      try { chk.disconnect(); } catch { /* gone */ }
    });
    this.choke(`smp:${slot}`, when, chk, (t) => { try { src.stop(t); } catch { /* done */ } });
  }

  playNamed(name, when, velocity = 0.9) {
    const drums = ["Kick", "Snare", "Clap", "Hat", "Punch", "Perc", "Dirty 808"];
    if (drums.some((d) => name.includes(d))) {
      if (name === "Warped Perc" || name === "Metallic Perc" || name === "Dirty 808") {
        this.playMemphis(name, when);
        return;
      }
      this.playDrum(name, when, velocity);
      return;
    }
    if (name === "Cassette Hiss" || name === "VHS Noise") return this.playMemphis(name, when);
    if (name === "Juno Bass" || name === "Cold Pad" || name === "Cold Pluck") return this.playColdwave(name, when);
    if (["Deep House Bass", "Dark Bass", "Acid Sweep", "Shaker Loop", "Dark Piano", "Minimal Stab"].includes(name)) return this.playHouse(name, when);
    if (["Drone Distorted", "Tremolo Texture", "Feedback", "Wind Ambience"].includes(name)) return this.playDsbm(name, when);
    if (["Distant", "Telephone", "Whisper", "Choir", "Robotic", "Scream Texture", "Deep Voice"].includes(name)) return this.playVocal(name, when);
    if (["Rain", "Wind", "Vinyl", "Electrical Hum", "City Night"].includes(name)) {
      this.toggleAmbience(name);
      return;
    }
    this.playDrum(name, when, velocity);
  }

  hatRoll(divCount, velocity = 0.9) {
    if (!this.arm()) return;
    const now = this.ctx.currentTime;
    const n = Math.min(32, Math.max(2, divCount));
    for (let i = 0; i < Math.min(12, n); i++) {
      const name = Math.random() < 0.3 ? "Metallic Hat" : "Closed Hat";
      this.playDrum(name, now + i * 0.055, (0.7 + Math.random() * 0.3) * velocity);
    }
  }

  // ---- Metronome (speakers only, never recorded) ----
  setMetronomeVolume(vol) {
    if (!this.metroBus) return;
    const v = Math.min(1, Math.max(0, vol)) * METRO_MAX;
    this.metroBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01);
  }

  click(when, accent = false) {
    if (!this.ctx || !this.metroBus) return;
    const c = this.ctx;
    const t = Math.max(when, c.currentTime);
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.value = accent ? 1600 : 1000;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(accent ? 1 : 0.6, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.03);
    g.gain.linearRampToValueAtTime(0, t + 0.035);
    osc.connect(g);
    g.connect(this.metroBus);
    osc.start(t);
    osc.stop(t + 0.04);
    osc.onended = () => { try { g.disconnect(); } catch { /* gone */ } };
  }

  async toggleRecord() {
    if (!this.arm() || !this.recDest) return false;
    if (!this.recorder) {
      this.recChunks = [];
      this.setRecTap(true);
      // Safari records MP4/AAC, Chrome/Firefox WebM/Opus: ask, don't assume.
      const wanted = pickRecordType(typeof MediaRecorder.isTypeSupported === "function" ? (t) => MediaRecorder.isTypeSupported(t) : null);
      const rec = wanted ? new MediaRecorder(this.recDest.stream, { mimeType: wanted }) : new MediaRecorder(this.recDest.stream);
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) this.recChunks.push(e.data);
      };
      rec.onstop = () => {
        this.setRecTap(false);
        const type = rec.mimeType || wanted || this.recChunks[0]?.type || "audio/webm";
        const blob = new Blob(this.recChunks, { type });
        this.lastRecording = blob;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `nocturne-808-${Date.now()}.${extensionForType(type)}`;
        a.click();
      };
      rec.start();
      this.recorder = rec;
      return true;
    }
    this.recorder.stop();
    this.recorder = null;
    return false;
  }
}

export function getStudio() {
  const key = "__nocturne808";
  if (!globalThis[key]) globalThis[key] = new Studio();
  return globalThis[key];
}

import {
  midiToHz,
  toMusical,
  DEFAULT_PATCH,
  hitById,
  sourceIsPit,
  sourceIsN808,
  sourceIsChord,
  pitWaveFromSource,
} from "./music.mjs";

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

function nocturneCurve(amount = 50) {
  const n = typeof amount === "number" ? amount : 50;
  const r = new Float32Array(44100);
  const l = Math.PI / 180;
  for (let u = 0; u < 44100; ++u) {
    const o = (u * 2) / 44100 - 1;
    r[u] = ((3 + n) * o * 20 * l) / (Math.PI + n * Math.abs(o));
  }
  return r;
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
    this.mild = null;
    this.heavy = null;
    this.buses = {};
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
    if (typeof window === "undefined") return false;
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return false;
        this.ctx = new Ctor();
        this.build();
        this.applyPatch();
      }
      if (this.ctx.state !== "running") void this.ctx.resume();
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
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.78;
    this.timeBuf = new Uint8Array(this.analyser.frequencyBinCount);
    this.freqAnalyser = ctx.createAnalyser();
    this.freqAnalyser.fftSize = 512;
    this.freqBuf = new Uint8Array(this.freqAnalyser.frequencyBinCount);
    this.recDest = ctx.createMediaStreamDestination();
    this.pitFilter = ctx.createBiquadFilter();
    this.pitFilter.type = "lowpass";
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

    for (const name of ["808", "Drums", "Memphis", "Coldwave", "House", "DSBM", "Vocals", "Ambience"]) {
      const g = ctx.createGain();
      g.gain.value = 0.85;
      g.connect(this.master);
      this.buses[name] = g;
    }
    this.pitFilter.connect(this.buses["808"]);
  }

  rewireMaster() {
    try { this.master.disconnect(); } catch { /* first wire */ }
    try { this.compressor.disconnect(); } catch { /* first wire */ }
    if (this.limiterOn) {
      this.master.connect(this.compressor);
      this.compressor.connect(this.analyser);
    } else {
      this.master.connect(this.analyser);
    }
    this.analyser.connect(this.ctx.destination);
    this.analyser.connect(this.freqAnalyser);
    this.freqAnalyser.connect(this.recDest);
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
    this.pitFilter.frequency.setTargetAtTime(hz, t, 0.02);
    this.pitFilter.Q.setTargetAtTime(Math.max(0.1, musical.q), t, 0.02);
  }

  readFrame() {
    if (!this.analyser || !this.timeBuf) {
      return { time: new Uint8Array(1024).fill(128), freq: new Uint8Array(256), level: 0 };
    }
    this.analyser.getByteTimeDomainData(this.timeBuf);
    if (this.freqAnalyser && this.freqBuf) this.freqAnalyser.getByteFrequencyData(this.freqBuf);
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
    const filter = this.pitFilter;
    const musical = toMusical(this.patch);
    const wave = waveOverride || musical.wave;
    const freq = Math.max(20, midiToHz(midi));
    const attack = Math.max(0.003, musical.attack);
    const decay = Math.max(0.01, musical.decay);
    const sustain = musical.sustain;
    const releaseTime = Math.max(0.02, musical.release);
    const env = ctx.createGain();
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

    if (wave === "808") {
      const bass = midi < 48;
      const osc = startOsc("sine", bass ? freq * 2.4 : freq);
      if (bass) osc.frequency.exponentialRampToValueAtTime(freq, time + 0.05);
      const harm = startOsc("sine", freq * 2);
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
      trem.connect(filter);
      extras.push(mix, highGain, shaper, trem, lfoDepth);
    } else {
      startOsc(wave, freq).connect(env);
    }

    if (wave !== "horror") env.connect(filter);

    let stopped = false;
    const release = (when) => {
      if (stopped) return;
      stopped = true;
      const t = Math.max(when, ctx.currentTime);
      env.gain.cancelScheduledValues(t);
      env.gain.setValueAtTime(Math.max(env.gain.value, 0.0001), t);
      env.gain.linearRampToValueAtTime(0, t + releaseTime);
      for (const osc of oscs) {
        try { osc.stop(t + releaseTime + 0.03); } catch { /* already stopped */ }
      }
    };

    const head = oscs[0];
    if (head) {
      head.addEventListener("ended", () => {
        try { env.disconnect(); } catch { /* gone */ }
        for (const node of extras) {
          try { node.disconnect(); } catch { /* gone */ }
        }
      });
    }
    this.lastHz = freq;
    return { env, oscs, extras, release };
  }

  peakFor(wave, midi, velocity) {
    const vel = Math.min(1, Math.max(0.05, velocity));
    if (wave === "808") return vel * (midi < 48 ? 0.62 : 0.22);
    if (wave === "horror") return vel * 0.28;
    if (wave === "square") return vel * 0.22;
    return vel * 0.3;
  }

  firePit(midi, when, velocity, wave, dur) {
    if (!this.arm()) return;
    const voice = this.spawnAt(midi, when, velocity, wave);
    if (voice) voice.release(when + Math.max(0.05, dur));
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
    const y = this.buses["808"] || this.master;
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
    J.curve = nocturneCurve(p.drive + (voice === "Distorted" ? 60 : voice === "Saturated" ? 30 : voice === "Overdriven Memphis" ? 85 : 0));
    J.oversample = "4x";
    const kn = C.createDelay(0.5);
    kn.delayTime.value = 0.22;
    const zn = C.createGain();
    zn.gain.value = p.delay * 0.35;
    let Ie = freq * Math.pow(2, p.fine) * Math.pow(2, p.octave / 12);
    if (voice === "Sub-Heavy") Ie *= 0.75;
    if (voice === "Short Punchy") Ie *= 1.1;
    if (voice === "House Sub") Ie *= 0.9;
    const bt = this.lastHz;
    const qu = p.glide / 1000;
    if (p.glide > 5) {
      g.frequency.setValueAtTime(bt, m);
      g.frequency.linearRampToValueAtTime(Ie, m + qu);
      P.frequency.setValueAtTime(bt * 1.01, m);
      P.frequency.linearRampToValueAtTime(Ie * 1.01, m + qu);
    } else {
      g.frequency.setValueAtTime(Ie, m);
      P.frequency.setValueAtTime(Ie * 1.01, m);
    }
    this.lastHz = Ie;
    if (voice !== "Long Sustained" && voice !== "Dark Verb") {
      g.frequency.setValueAtTime(Ie * (voice === "Short Punchy" ? 2.2 : 1.6), m);
      g.frequency.exponentialRampToValueAtTime(Ie, m + 0.09);
    }
    let hold = voice === "Long Sustained" ? 0.9 : voice === "Short Punchy" ? 0.08 : 0.35;
    if (voice === "Sliding") hold = 0.6;
    const ue = p.attack, ie = p.decay, $e = p.sustain, pt = p.release;
    I.gain.linearRampToValueAtTime(velocity * 0.95, m + ue);
    I.gain.linearRampToValueAtTime(velocity * $e, m + ue + ie);
    I.gain.linearRampToValueAtTime(0, m + ue + ie + hold + pt);
    g.connect(V);
    V.connect(H);
    H.connect(J);
    J.connect(I);
    P.connect(I);
    if (p.reverb > 0.01 && this.verbShort) {
      const er = C.createConvolver();
      er.buffer = voice === "Dark Verb" ? this.verbLong : this.verbShort;
      const Sn = C.createGain();
      Sn.gain.value = p.reverb;
      I.connect(er);
      er.connect(Sn);
      Sn.connect(y);
    }
    if (p.delay > 0.01) {
      I.connect(kn);
      kn.connect(zn);
      zn.connect(y);
    }
    I.connect(y);
    g.start(m);
    P.start(m);
    g.stop(m + ue + ie + hold + pt + 0.1);
    P.stop(m + ue + ie + hold + pt + 0.1);
  }

  playDrum(name, when, velocity = 0.9) {
    if (!this.arm()) return;
    const C = this.ctx;
    const m = when;
    const y = this.buses.Drums || this.master;
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
        const conv = C.createConvolver();
        conv.buffer = this.verbShort;
        const cg = C.createGain();
        cg.gain.value = 0.45;
        I.connect(conv);
        conv.connect(cg);
        cg.connect(y);
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
    const dest = this.buses.Memphis || this.master;
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
    const dest = this.buses.Coldwave || this.master;
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
      const J = c.createConvolver();
      J.buffer = this.verbShort;
      const Ce = c.createGain();
      Ce.gain.value = 0.35;
      g.connect(J);
      J.connect(Ce);
      Ce.connect(dest);
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
    const dest = this.buses.House || this.master;
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
    const dest = this.buses.DSBM || this.master;
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
        const P = c.createConvolver();
        P.buffer = this.verbLong;
        const I = c.createGain();
        I.gain.value = 0.6;
        y.connect(P);
        P.connect(I);
        I.connect(dest);
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
    const dest = this.buses.Vocals || this.master;
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
        const P = c.createConvolver();
        P.buffer = this.verbShort;
        const I = c.createGain();
        I.gain.value = name.includes("Distant") ? 0.7 : 0.2;
        g.connect(P);
        P.connect(I);
        I.connect(dest);
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
    const dest = this.buses.Ambience || this.master;
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

  triggerSource(source, step, when, velocity) {
    if (!this.arm()) return;
    const t = when;
    const vel = velocity;
    if (sourceIsPit(source)) {
      const wave = pitWaveFromSource(source);
      const midi = step?.note ?? 36;
      const musical = toMusical(this.patch);
      const dur = Math.max(0.16, musical.attack + musical.decay + musical.release * 0.65 + 0.18);
      this.firePit(midi, t, vel, wave, dur);
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
      const hold = 0.28;
      for (const n of hit.notes ?? []) this.firePit(n, t, vel, wave, hold);
      return;
    }
    this.playNamed(source, t, vel);
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

  async toggleRecord() {
    if (!this.arm() || !this.recDest) return false;
    if (!this.recorder) {
      this.recChunks = [];
      const rec = new MediaRecorder(this.recDest.stream);
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) this.recChunks.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(this.recChunks, { type: "audio/webm" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `nocturne-808-${Date.now()}.webm`;
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

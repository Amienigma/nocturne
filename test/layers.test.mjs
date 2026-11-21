// Layering over uploads (engine level, offline): pad taps overlap instead of
// choking (CHOKE is opt-in per pad), sequenced hits never cut pad taps or beds,
// bed loops survive CUT / allOff and only stopBeds() ends them, and the worst
// layered case (8 looping uploads + 6 stacked pad taps + all four sections +
// dense chords, everything maxed) stays <= -1.2 dBFS sample and true peak.
import assert from "node:assert/strict";
import test from "node:test";

let WA = null;
try { WA = await import("node-web-audio-api"); } catch { /* optional dev dependency */ }
const skip = !WA && "node-web-audio-api not installed (npm install)";
const db = (x) => 20 * Math.log10(Math.max(1e-9, x));

function truePeak(x) {
  const L = 4, T = 12, h = [];
  for (let n = -T * L; n <= T * L; n++) {
    const t = n / L;
    h.push((t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t)) * (0.5 + 0.5 * Math.cos((Math.PI * n) / (T * L + 1))));
  }
  let pk = 0;
  for (let i = T; i < x.length - T; i++) {
    pk = Math.max(pk, Math.abs(x[i]));
    if (Math.abs(x[i]) < 0.6 && Math.abs(x[i + 1]) < 0.6) continue;
    for (let p = 1; p < L; p++) {
      let acc = 0;
      for (let k = -T; k <= T; k++) { const j = k * L - p + T * L; if (j >= 0 && j < h.length) acc += x[i + k] * h[j]; }
      pk = Math.max(pk, Math.abs(acc));
    }
  }
  return pk;
}

async function studio(seconds = 3) {
  globalThis.OfflineAudioContext ??= WA.OfflineAudioContext;
  globalThis.window ??= globalThis;
  const { Studio } = await import("../src/audio.mjs");
  const ctx = new OfflineAudioContext(2, Math.ceil(48000 * seconds), 48000);
  const s = new Studio();
  s.offline = true;
  s.ctx = ctx;
  s.keepAwake = true;
  s.build();
  s.applyPatch();
  return s;
}

async function uploads(kind = "tone") {
  const { prepareSample } = await import("../src/samples.mjs");
  const rate = 48000;
  const out = new Map();
  let seed = 7; // deterministic "noise" so the peak numbers are reproducible
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let slot = 1; slot <= 8; slot++) {
    const n = rate * 2;
    const x = Float32Array.from({ length: n }, (_, i) => (kind === "tone" ? Math.sin((2 * Math.PI * 220 * i) / rate)
      : slot % 2 ? Math.sign(Math.sin((2 * Math.PI * (40 + slot * 30) * i) / rate)) : rnd() * 2 - 1));
    const p = prepareSample([x], rate);
    out.set(slot, { name: `u${slot}`, rate: p.rate, pcm: p.pcm });
  }
  return out;
}

// RMS of the rendered output in a window [a, b) seconds.
const rmsAt = (buf, a, b) => {
  const c = buf.getChannelData(0);
  let ss = 0, n = 0;
  for (let i = Math.floor(a * buf.sampleRate); i < Math.floor(b * buf.sampleRate); i++) { ss += c[i] * c[i]; n++; }
  return db(Math.sqrt(ss / n));
};

test("pads: taps overlap by default; CHOKE makes a pad cut its last tap", { skip }, async () => {
  const recs = await uploads();
  const s = await studio();
  s.setSample(1, recs.get(1));
  for (const t of [0.1, 0.2, 0.3]) s.playSample(1, t, 0.9, 0, { pad: true });
  assert.equal(s.padVoices.get(1).size, 3, "three overlapping taps");
  s.setSampleChoke(2, true);
  s.setSample(2, recs.get(2));
  for (const t of [0.1, 0.2, 0.3]) s.playSample(2, t, 0.9, 0, { pad: true });
  assert.equal(s.padVoices.get(2).size, 1, "choked pad keeps one voice");
  // Polyphony cap: the oldest of > PAD_POLY taps fades out.
  for (let i = 0; i < 10; i++) s.playSample(1, 0.4 + i * 0.01, 0.5, 0, { pad: true });
  assert.equal(s.padVoices.get(1).size, s.constructor.PAD_POLY);
});

test("sequenced sample hits never cut a pad tap or a bed on the same slot", { skip }, async () => {
  const recs = await uploads();
  // Reference: a pad tap alone vs a pad tap + a sequenced hit 0.5 s later.
  const a = await studio(2);
  a.setSample(1, recs.get(1));
  a.playSample(1, 0.1, 0.9, 0, { pad: true });
  const refBuf = await a.ctx.startRendering();
  const b = await studio(2);
  b.setSample(1, recs.get(1));
  b.playSample(1, 0.1, 0.9, 0, { pad: true });
  // Sequenced (non-pad) hits on the same slot, short gates: they choke each
  // other only. If they still choked the pad tap, it would go silent at 0.5 s.
  b.playSample(1, 0.5, 0.9, 0.1);
  b.playSample(1, 0.6, 0.9, 0.1);
  const buf = await b.ctx.startRendering();
  const ref = rmsAt(refBuf, 1.4, 1.6), got = rmsAt(buf, 1.4, 1.6);
  assert.ok(got > -40 && Math.abs(got - ref) < 1, `pad tap still sounding after the sequenced hits (${got.toFixed(1)} vs ${ref.toFixed(1)} dBFS)`);
});

test("bed loops keep going past the file length, survive CUT (allOff), stop only via stopBed/stopBeds", { skip }, async () => {
  const recs = await uploads();
  const s = await studio(6);
  s.setSample(1, recs.get(1));
  assert.ok(s.startBed(1, 0.05));
  assert.equal(s.canSleep(), false, "a looping bed keeps the context awake");
  s.allOff(); // CUT / Escape
  for (let i = 0; i < 8; i++) s.playSample(1, 0.5 + i * 0.1, 0.9, 0, { pad: true });
  s.triggerSource("smp:1", { note: 60 }, 1.0, 0.9, {});
  s.setSample(2, recs.get(2)); // loading another file doesn't touch the bed
  assert.ok(s.bedPlaying(1));
  const buf = await s.ctx.startRendering();
  // The upload is 2 s; the bed is still there at 4.5–5.5 s.
  assert.ok(rmsAt(buf, 4.5, 5.5) > -40, `bed loops (${rmsAt(buf, 4.5, 5.5).toFixed(1)} dBFS)`);
  const s2 = await studio(3);
  s2.setSample(1, recs.get(1));
  s2.startBed(1, 0.05);
  s2.stopBeds();
  assert.equal(s2.beds.size, 0);
  const buf2 = await s2.ctx.startRendering();
  assert.ok(rmsAt(buf2, 1, 2) < -80, "STOP ALL silences it");
});

test("worst layered case: 8 looping uploads + 6 stacked pad taps + all 4 sections + dense chords, maxed: <= -1.2 dBFS sample and true peak", { skip, timeout: 240000 }, async () => {
  globalThis.OfflineAudioContext ??= WA.OfflineAudioContext;
  globalThis.window ??= globalThis;
  const { renderWav } = await import("../src/export.mjs");
  const { defaultState, serializeState } = await import("../src/state-io.mjs");
  const { classicBanks } = await import("../src/classics.mjs");
  const { writeChords, defaultChordSettings } = await import("../src/chords.mjs");
  const { defaultLoopers } = await import("../src/loopers.mjs");
  const worst = { peak: -99, tp: -99 };
  for (const kind of ["tone", "harsh"]) {
    const s = defaultState();
    s.banks = classicBanks();
    s.bpm = 145;
    s.banks[3] = writeChords(s.banks[3], { ...defaultChordSettings(), type: "9", voicing: "spread", rhythm: "pulse", strum: 1 }, { synthSource: "syn:keys", length: 32 });
    s.limiter = false;
    s.mixer = s.mixer.map((_, i) => ({ vol: 1, pan: i % 2 ? 0.5 : -0.5, rev: 1, dly: 1 }));
    const loopers = defaultLoopers(4).map((l) => ({ ...l, on: true }));
    const r = await renderWav(serializeState(s), {
      bars: 2, masterGain: 1, samples: await uploads(kind), loopers, beds: [1, 2, 3, 4, 5, 6, 7, 8],
      onStudio: (st, start) => { for (let i = 0; i < 6; i++) st.playSample(1 + (i % 2), start + 0.4 + i * 0.002, 1, 0, { pad: true }); },
    });
    const peak = db(r.peak);
    const tp = db(Math.max(...r.channels.map(truePeak)));
    assert.ok(peak <= -1.2, `${kind}: sample peak ${peak.toFixed(2)}`);
    assert.ok(tp <= -1.2, `${kind}: true peak ${tp.toFixed(2)}`);
    worst.peak = Math.max(worst.peak, peak);
    worst.tp = Math.max(worst.tp, tp);
  }
  console.log(`# layered worst case: sample ${worst.peak.toFixed(2)} dBFS, true peak ${worst.tp.toFixed(2)} dBFS`);
});

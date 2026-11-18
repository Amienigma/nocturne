// Offline-render loudness regression: renders worst-case beats through the real
// Studio graph (same code as EXPORT WAV) with node-web-audio-api and checks
// that nothing reaches -1 dBFS. Skips if the dev dependency isn't installed.
import assert from "node:assert/strict";
import test from "node:test";

let WA = null;
try {
  WA = await import("node-web-audio-api");
} catch { /* optional dev dependency */ }

const CEILING_DBFS = -1;
const dbfs = (x) => 20 * Math.log10(Math.max(1e-9, x));

async function render(mutate, opts = {}) {
  globalThis.OfflineAudioContext ??= WA.OfflineAudioContext;
  globalThis.window ??= globalThis;
  const { renderWav } = await import("../src/export.mjs");
  const { defaultState, serializeState } = await import("../src/state-io.mjs");
  const M = await import("../src/music.mjs");
  const s = defaultState();
  mutate(s, M);
  const r = await renderWav(serializeState(s), { bars: opts.bars ?? 1, masterGain: opts.vol ?? 0.85, samples: opts.samples });
  let ss = 0;
  let n = 0;
  for (const c of r.channels) for (let i = 0; i < c.length; i++) { ss += c[i] * c[i]; n++; }
  return { peak: dbfs(r.peak), rms: dbfs(Math.sqrt(ss / n)) };
}

const allOn = (s, extra = {}) => {
  s.pattern = s.pattern.map((row) => ({ ...row, steps: row.steps.map((c, i) => (i < 16 ? { ...c, on: true, vel: 1, ...extra } : c)) }));
};

const SCENARIOS = [
  ["every preset at default settings", (s, M) => { s.pattern = M.applyPreset("BLACK ICE"); s.banks[1] = M.applyPreset("ATLANTA NIGHT"); s.banks[2] = M.applyPreset("COLD CITY"); s.banks[3] = M.applyPreset("NIGHT DRIVE"); s.chain = [0, 1, 2, 3]; s.song = true; }, {}],
  ["all 12 tracks every step, vol 1, limiter off", (s) => { s.limiter = false; allOn(s); }, { vol: 1 }],
  ["all tracks ×6 rolls + mixer sends max + hard pans, vol 1, limiter off", (s) => {
    s.limiter = false;
    allOn(s, { rat: 6 });
    s.mixer = s.mixer.map((_, i) => ({ vol: 1, pan: i % 2 ? 1 : -1, rev: 1, dly: 1 }));
  }, { vol: 1 }],
  ["808 slides + long gates (n808 Overdriven + PIT 808), vol 1, limiter off", (s) => {
    s.limiter = false;
    s.pattern[6].source = "n808:Overdriven Memphis";
    s.pattern[7].source = "pit:808";
    for (const t of [6, 7]) {
      s.pattern[t].steps = s.pattern[t].steps.map((c, i) => (i < 16 ? { ...c, on: true, vel: 1, note: [24, 36, 19, 31][i % 4], slide: i % 2 === 1, gate: [8, 4, 2, 0.5][i % 4] } : c));
    }
    s.mixer = s.mixer.map(() => ({ vol: 1, pan: 0, rev: 1, dly: 1 }));
  }, { vol: 1 }],
];

// User samples at their worst: full-scale square waves and noise (normalised to
// -6 dBFS like real imports) on every track, ×4 rolls, sends maxed.
async function worstSamples() {
  const { prepareSample } = await import("../src/samples.mjs");
  const rate = 48000;
  const samples = new Map();
  for (let slot = 1; slot <= 8; slot++) {
    const n = rate * 2;
    const x = Float32Array.from({ length: n }, (_, i) => (slot % 2 ? Math.sign(Math.sin((2 * Math.PI * (40 + slot * 30) * i) / rate)) : Math.random() * 2 - 1));
    const p = prepareSample([x], rate);
    samples.set(slot, { name: `s${slot}`, rate: p.rate, pcm: p.pcm });
  }
  return samples;
}
if (WA) {
  SCENARIOS.push(["user samples on every track (square/noise, ×4 rolls, sends max), vol 1, limiter off", (s) => {
    s.limiter = false;
    allOn(s, { rat: 4 });
    s.pattern = s.pattern.map((row, t) => ({ ...row, source: `smp:${(t % 8) + 1}` }));
    s.mixer = s.mixer.map(() => ({ vol: 1, pan: 0, rev: 1, dly: 1 }));
  }, { vol: 1, samples: await worstSamples() }]);
}

for (const [name, mutate, opts] of SCENARIOS) {
  test(`loudness: ${name} stays below ${CEILING_DBFS} dBFS`, { skip: !WA && "node-web-audio-api not installed (npm install)" }, async () => {
    const r = await render(mutate, opts);
    assert.ok(r.peak < CEILING_DBFS, `peak ${r.peak.toFixed(2)} dBFS`);
    assert.ok(r.rms > -40, `not silent (rms ${r.rms.toFixed(1)} dBFS)`);
  });
}

async function renderNote(mix, track) {
  globalThis.OfflineAudioContext ??= WA.OfflineAudioContext;
  globalThis.window ??= globalThis;
  const { Studio } = await import("../src/audio.mjs");
  const ctx = new OfflineAudioContext(2, 48000, 48000);
  const s = new Studio();
  s.offline = true;
  s.ctx = ctx;
  s.keepAwake = true;
  s.build();
  s.applyPatch();
  if (mix) s.setMixer(mix);
  s.triggerSource("pit:sine", { note: 57 }, 0.05, 0.8, track == null ? {} : { track });
  const buf = await ctx.startRendering();
  const rms = (c) => { let ss = 0; for (const x of c) ss += x * x; return dbfs(Math.sqrt(ss / c.length)); };
  return [rms(buf.getChannelData(0)), rms(buf.getChannelData(1))];
}

test("mixer: unity strip matches the old bus level (no −3 dB pan-law drop); vol and pan work", { skip: !WA && "node-web-audio-api not installed" }, async () => {
  const [l0, r0] = await renderNote(null, null); // pads / keys path (category bus)
  const [l1, r1] = await renderNote(null, 0); // sequenced path, default mixer
  assert.ok(Math.abs(l0 - l1) < 0.1 && Math.abs(r0 - r1) < 0.1, `${l0} ${l1}`);
  const [lh] = await renderNote([{ vol: 0.5, pan: 0, rev: 0, dly: 0 }], 0);
  assert.ok(Math.abs(lh - (l1 - 12.04)) < 0.2, `vol 0.5 = -12 dB (${lh} vs ${l1})`);
  const [lp, rp] = await renderNote([{ vol: 1, pan: -1, rev: 0, dly: 0 }], 0);
  assert.ok(rp < lp - 40, `hard left (${lp} / ${rp})`);
});

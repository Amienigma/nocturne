// Section loopers: one looper per section, layering several in sync, bar-line
// starts, export of what is playing, the retired ATLANTA NIGHT starter, and the
// loudness ceiling with all four sections layered at max.
import assert from "node:assert/strict";
import test from "node:test";
import { emptyPattern, setStepProps, applyPreset } from "../src/music.mjs";
import { defaultState, serializeState, toStored, fromStored } from "../src/state-io.mjs";
import { defaultLoopers, sanitizeLoopers, looperStep, looperHits, activeLoopers, applyLooperQueue, layerGain, SECTION_LENS } from "../src/loopers.mjs";
import { scheduleSteps } from "../src/export.mjs";
import { classicState, isLegacyStarter } from "../src/classics.mjs";

let WA = null;
try { WA = await import("node-web-audio-api"); } catch { /* optional dev dependency */ }
const SEC = 0.1;
// True peak: 4x oversampled with a windowed-sinc interpolator (BS.1770-style).
function truePeak(x) {
  const L = 4, T = 12, h = [];
  for (let n = -T * L; n <= T * L; n++) {
    const t = n / L;
    h.push((t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t)) * (0.5 + 0.5 * Math.cos((Math.PI * n) / (T * L + 1))));
  }
  let pk = 0;
  for (let i = T; i < x.length - T; i++) {
    pk = Math.max(pk, Math.abs(x[i]));
    if (Math.abs(x[i]) < 0.6 && Math.abs(x[i + 1]) < 0.6) continue; // overs only happen near the ceiling
    for (let p = 1; p < L; p++) {
      let acc = 0;
      for (let k = -T; k <= T; k++) { const j = k * L - p + T * L; if (j >= 0 && j < h.length) acc += x[i + k] * h[j]; }
      pk = Math.max(pk, Math.abs(acc));
    }
  }
  return pk;
}

test("looper basics: defaults stopped at 2 bars; lengths ½ / 1 / 2 bars; only lengths persist", () => {
  assert.deepEqual(defaultLoopers(), Array.from({ length: 4 }, () => ({ on: false, len: 32, origin: 0 })));
  assert.deepEqual(SECTION_LENS, [8, 16, 32]);
  const l = sanitizeLoopers([8, { len: 16, on: true }, 7, "x"]);
  assert.deepEqual(l.map((x) => [x.on, x.len]), [[false, 8], [false, 16], [false, 32], [false, 32]]);
  // A looper started on bar 2 runs its own ½-bar loop from there.
  const half = { on: true, len: 8, origin: 16 };
  assert.deepEqual([16, 23, 24, 40].map((i) => looperStep(half, i)), [0, 7, 0, 0]);
  assert.equal(looperStep({ on: true, len: 32, origin: 0 }, 40, 16), 8, "pattern length caps the loop");
});

test("several section loopers layer in sync; stopped sections are silent", () => {
  const banks = [0, 1, 2, 3].map(() => emptyPattern());
  banks[0] = setStepProps(banks[0], 0, 0, { on: true }); // A: kick on step 1
  banks[1] = setStepProps(banks[1], 3, 0, { on: true }); // B: hat on step 1
  banks[2] = setStepProps(banks[2], 1, 0, { on: true }); // C: snare (stays stopped)
  const loopers = defaultLoopers();
  loopers[0].on = true;
  const at = (abs) => looperHits(banks, loopers, null, abs, SEC).map((h) => `${h.bank}:${h.track}`);
  assert.deepEqual(at(0), ["0:0"]);
  // Queue B to join at bar 2: it starts from its own step 1 there, layered with A.
  const q = new Map([[1, { on: true }]]);
  applyLooperQueue(loopers, q, 16);
  assert.equal(q.size, 0);
  assert.deepEqual(activeLoopers(loopers), [0, 1]);
  // Layered sections are gain-staged: each hit a little softer per extra section.
  assert.equal(layerGain(1), 1);
  assert.ok(layerGain(2) < 1 && layerGain(4) < layerGain(2) && layerGain(4) > 0.5);
  const solo = looperHits(banks, [{ on: true, len: 32, origin: 0 }, { on: false, len: 32, origin: 0 }], null, 0, SEC)[0].vel;
  assert.equal(looperHits(banks, loopers, null, 32, SEC)[0].vel, Math.round(solo * layerGain(2) * 100) / 100);
  assert.deepEqual(at(16), ["1:3"], "A is mid-loop (step 17 empty), B starts at its step 1");
  assert.deepEqual(at(32), ["0:0"], "A wraps after 2 bars; B is on its step 17");
  assert.deepEqual(at(48), ["1:3"]);
  // Restart with a new length at a bar, then stop.
  applyLooperQueue(loopers, new Map([[1, { on: true, len: 8 }]]), 64);
  assert.deepEqual([loopers[1].len, loopers[1].origin], [8, 64]);
  assert.deepEqual(at(72), ["1:3"], "½-bar loop repeats every 8 steps");
  applyLooperQueue(loopers, new Map([[0, { on: false }]]), 80);
  assert.deepEqual(activeLoopers(loopers), [1]);
});

test("export renders exactly the playing loopers, never another section or a preset", () => {
  const s = defaultState();
  s.bpm = 120;
  s.length = 32;
  s.banks[0] = setStepProps(emptyPattern(), 0, 0, { on: true });
  s.banks[1] = setStepProps(emptyPattern(), 3, 4, { on: true });
  s.banks[2] = applyPreset("ATLANTA NIGHT");
  s.bank = 0;
  const st = serializeState(s);
  const tracks = (loopers) => [...new Set(scheduleSteps(st, 2, 0, () => 0, null, loopers).map((e) => e.opts.track))].sort();
  assert.deepEqual(tracks(null), [0], "no loopers: the section you're on");
  const l = defaultLoopers();
  l[1].on = true;
  assert.deepEqual(tracks(l), [3], "only B");
  l[0].on = true;
  assert.deepEqual(tracks(l), [0, 3], "A + B layered");
});

test("the old ATLANTA NIGHT starter save is recognised (and only when untouched)", () => {
  const s = defaultState();
  s.banks[0] = applyPreset("ATLANTA NIGHT");
  assert.equal(isLegacyStarter(fromStored(toStored(s))), true);
  assert.equal(isLegacyStarter(classicState()), false);
  const edited = fromStored(toStored(s));
  edited.banks[0] = setStepProps(edited.banks[0], 2, 5, { on: true });
  assert.equal(isLegacyStarter(edited), false, "edited A is the user's beat");
  const more = fromStored(toStored(s));
  more.banks[1] = setStepProps(more.banks[1], 0, 0, { on: true });
  assert.equal(isLegacyStarter(more), false, "work in B is kept");
  assert.equal(isLegacyStarter(defaultState()), false);
});

test("loudness: all four section loopers layered, mixer + sends + master at max, limiter off (and with TAPE) stay below -1.2 dBFS sample and true peak", { skip: !WA && "node-web-audio-api not installed (npm install)" }, async () => {
  globalThis.OfflineAudioContext ??= WA.OfflineAudioContext;
  globalThis.window ??= globalThis;
  const { renderWav } = await import("../src/export.mjs");
  const s = classicState();
  s.limiter = false;
  s.mixer = s.mixer.map((_, i) => ({ vol: 1, pan: i % 2 ? 0.5 : -0.5, rev: 1, dly: 1 }));
  const all = defaultLoopers().map((l) => ({ ...l, on: true }));
  const mixed = defaultLoopers().map((l, i) => ({ ...l, on: true, len: [32, 16, 8, 32][i] }));
  for (const [loopers, tape] of [[all, false], [all, true], [mixed, false]]) {
    const r = await renderWav(serializeState(s), { bars: 4, masterGain: 1, loopers, tape });
    const peak = 20 * Math.log10(r.peak);
    let ss = 0, n = 0;
    for (const c of r.channels) for (const x of c) { ss += x * x; n++; }
    assert.ok(peak <= -1.2, `peak ${peak.toFixed(2)} dBFS (tape ${tape})`);
    const tp = 20 * Math.log10(Math.max(...r.channels.map(truePeak)));
    assert.ok(tp <= -1.2, `true peak ${tp.toFixed(2)} dBFS (tape ${tape})`);
    assert.ok(10 * Math.log10(ss / n) > -30, "audible");
  }
});

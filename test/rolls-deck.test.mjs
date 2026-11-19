// Rolling-hat engine (roll rates + velocity/pitch ramps) and the per-layer
// tape-deck transports: backward compatibility, round trips and polymetric loops.
import assert from "node:assert/strict";
import test from "node:test";
import { emptyPattern, setStepProps, RATCHETS, RAMPS, rollShape, STEP_DEFAULTS } from "../src/music.mjs";
import { defaultState, packState, unpackState, sanitizeState, serializeState } from "../src/state-io.mjs";
import { stepHits, layerHits, layerStep, sanitizeLayers, defaultLayer } from "../src/sequencer.mjs";
import { scheduleSteps } from "../src/export.mjs";

const SEC = 0.1;

test("roll shapes: straight rolls fill one step, triplet runs span 2 or 4 steps", () => {
  assert.deepEqual(rollShape(1), { hits: 1, span: 1 });
  assert.deepEqual(rollShape(8), { hits: 8, span: 1 });
  assert.deepEqual(rollShape(1.5), { hits: 3, span: 2 });
  assert.deepEqual(rollShape(0.75), { hits: 3, span: 4 });
  const at = (rat) => stepHits(setStepProps(emptyPattern(), 3, 0, { on: true, vel: 1, rat }), 0, SEC, () => 0).map((h) => Math.round(h.at * 1000));
  assert.deepEqual(at(4), [0, 25, 50, 75]);
  assert.deepEqual(at(8).length, 8);
  assert.deepEqual(at(1.5), [0, 67, 133]); // 1/24 triplets over 2 steps
  assert.deepEqual(at(0.75), [0, 133, 267]); // 1/12 triplets over 4 steps
});

test("ramps: velocity climbs or falls across the roll, pitch rises or falls; no ramp = legacy curve", () => {
  const hits = (ramp, rat = 4) => stepHits(setStepProps(emptyPattern(), 3, 0, { on: true, vel: 1, rat, ramp }), 0, SEC, () => 0);
  const up = hits(1).map((h) => h.vel);
  assert.ok(up.every((v, i) => i === 0 || v > up[i - 1]) && up[3] === 1, `up ${up}`);
  const down = hits(2).map((h) => h.vel);
  assert.ok(down.every((v, i) => i === 0 || v < down[i - 1]), `down ${down}`);
  const rise = hits(3).map((h) => h.opts.pitch);
  assert.deepEqual(rise.map((p) => Math.round(p * 100) / 100), [0, 1.67, 3.33, 5]);
  assert.ok(hits(6).every((h, i) => i === 0 || h.opts.pitch < 0));
  // No ramp: identical to the pre-ramp engine (first hit full, later hits a touch softer, no pitch).
  const legacy = hits(0);
  assert.deepEqual(legacy.map((h) => h.vel), [1, 0.97, 0.94, 0.91]);
  assert.ok(legacy.every((h) => !h.opts.pitch));
  assert.equal(STEP_DEFAULTS.ramp, 0);
  assert.equal(RAMPS[0].vel, 0);
  assert.deepEqual(RATCHETS.slice(0, 5), [1, 2, 3, 4, 6]);
});

test("share links: old v2 links decode the same; rolls + ramps round trip; bad ramp bytes rejected", () => {
  // A state without ramps packs exactly as before (no extra bytes), so old links are unchanged.
  const plain = defaultState();
  plain.banks[0] = setStepProps(setStepProps(emptyPattern(), 3, 2, { on: true, rat: 3 }), 6, 0, { on: true, slide: true, gate: 2 });
  const before = packState(serializeState(plain));
  const back = unpackState(before);
  assert.deepEqual(packState(back), before);
  assert.equal(back.banks[0][3].steps[2].ramp, 0);
  // Rich rolls and ramps survive the trip.
  const rich = defaultState();
  let p = emptyPattern();
  p = setStepProps(p, 3, 4, { on: true, rat: 1.5, ramp: 1 });
  p = setStepProps(p, 3, 7, { on: true, rat: 4, ramp: 5 });
  p = setStepProps(p, 3, 31, { on: true, rat: 8, ramp: 6 });
  p = setStepProps(p, 3, 12, { on: true, rat: 0.75, ramp: 3, prob: 0.5 });
  rich.banks[0] = p;
  const bytes = packState(serializeState(rich));
  const flat = defaultState();
  flat.banks[0] = p.map((row) => ({ ...row, steps: row.steps.map((c) => ({ ...c, ramp: 0 })) }));
  const flatBytes = packState(serializeState(flat));
  assert.equal(bytes.length, flatBytes.length + 4, "exactly one extra byte per ramped step");
  const got = unpackState(bytes).banks[0][3].steps;
  assert.deepEqual([4, 7, 31, 12].map((j) => [got[j].rat, got[j].ramp]), [[1.5, 1], [4, 5], [8, 6], [0.75, 3]]);
  assert.equal(got[12].prob, 0.5);
  // Corrupt ramp byte (0 or out of range) is rejected. The first ramp byte is
  // where the two encodings first drift apart after the flagged ext byte.
  const ext = bytes.findIndex((v, i) => v !== flatBytes[i]);
  const rampAt = bytes.findIndex((v, i) => i > ext && v !== flatBytes[i]);
  assert.ok(rampAt > ext && bytes[rampAt] === 1, `ramp byte at ${rampAt}`);
  for (const v of [0, RAMPS.length, 255]) {
    const bad = Uint8Array.from(bytes);
    bad[rampAt] = v;
    assert.throws(() => unpackState(bad), `ramp byte ${v}`);
  }
  // Sanitizer repairs nonsense ramps.
  const fixed = sanitizeState({ v: 2, banks: [setStepProps(emptyPattern(), 3, 0, { on: true, ramp: 99 })] }).banks[0][3].steps[0];
  assert.equal(fixed.ramp, 0);
});

test("layers: play follows the beat, loop runs its own window on the global clock, stop is silent", () => {
  assert.deepEqual(defaultLayer(), { mode: "play", start: 0, end: 16, origin: 0 });
  const play = { mode: "play", start: 0, end: 16, origin: 0 };
  const loop8 = { mode: "loop", start: 8, end: 16, origin: 0 };
  const loop12 = { mode: "loop", start: 0, end: 12, origin: 16 };
  assert.equal(layerStep(play, 40, 8), 8);
  assert.deepEqual([0, 7, 8, 9, 31].map((i) => layerStep(loop8, i, i % 32)), [8, 15, 8, 9, 15]);
  // Polymetric: a 12-step loop started on bar 2 restarts every 12 steps, independent of the 32-step pattern.
  assert.deepEqual([16, 27, 28, 40, 15].map((i) => layerStep(loop12, i, i % 32)), [0, 11, 0, 0, 11]);
  // layerHits: track 0 plays on the beat, track 3 loops 1 bar of bar 2, track 1 is stopped.
  let p = emptyPattern();
  p = setStepProps(p, 0, 0, { on: true });
  p = setStepProps(p, 1, 0, { on: true });
  p = setStepProps(p, 3, 16, { on: true });
  const layers = sanitizeLayers([play, { mode: "stop" }, null, { mode: "loop", start: 16, end: 32 }], 12);
  const tracks = (abs) => layerHits(p, layers, abs, abs % 32, SEC, () => 0).map((h) => h.track);
  assert.deepEqual(tracks(0), [0, 3]); // hat (from bar 2) already plays on bar 1
  assert.deepEqual(tracks(16), [3]);
  assert.deepEqual(tracks(32), [0, 3]);
  // No layers = plain stepHits (old behaviour); mute/solo still apply on loop layers.
  assert.deepEqual(layerHits(p, null, 0, 0, SEC, () => 0).map((h) => h.track), [0, 1]);
  p[3] = { ...p[3], mute: true };
  assert.deepEqual(layerHits(p, layers, 0, 0, SEC, () => 0).map((h) => h.track), [0]);
});

test("sanitizeLayers repairs bad windows and modes", () => {
  const l = sanitizeLayers([{ mode: "rewind", start: -3, end: 99 }, { start: 20, end: 4 }, "x"], 3);
  assert.deepEqual(l[0], { mode: "play", start: 0, end: 32, origin: 0 });
  assert.deepEqual(l[1], { mode: "play", start: 20, end: 21, origin: 0 });
  assert.deepEqual(l[2], defaultLayer());
});

test("export honours layer loops (each loop starts at the top of the render)", () => {
  const s = defaultState();
  s.bpm = 120;
  s.length = 32;
  let p = emptyPattern();
  p = setStepProps(p, 3, 4, { on: true });
  s.banks[0] = p;
  const st = serializeState(s);
  const plain = scheduleSteps(st, 2, 0, () => 0).filter((e) => e.opts.track === 3).length;
  const layers = sanitizeLayers([null, null, null, { mode: "loop", start: 0, end: 8 }], 12);
  const looped = scheduleSteps(st, 2, 0, () => 0, layers).filter((e) => e.opts.track === 3).length;
  assert.equal(plain, 1);
  assert.equal(looped, 4, "an 8-step loop repeats 4x in 2 bars");
});

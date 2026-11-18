import assert from "node:assert/strict";
import test from "node:test";
import { applyPreset, emptyPattern, DEFAULT_PATCH, cycleStepVelocity, VEL_LEVELS, DRUM_KEYS, COMPUTER_KEYS } from "../src/music.mjs";
import {
  defaultState,
  sanitizeState,
  serializeState,
  packState,
  unpackState,
  encodeShare,
  decodeShare,
  shareCodeFromHash,
  UndoStack,
  TapTempo,
  pickRecordType,
  extensionForType,
  STATE_VERSION,
} from "../src/state-io.mjs";

function sample() {
  const s = defaultState();
  s.bpm = 142;
  s.swing = 17;
  s.length = 32;
  s.limiter = false;
  s.patch = { ...DEFAULT_PATCH, wave: "horror", cutoff: 0.3 };
  s.pattern = applyPreset("BLACK ICE");
  s.pattern[6].steps[31] = { on: true, vel: 0.4, note: 24, chordId: "cm" };
  s.pattern[3].mute = true;
  s.pattern[1].solo = true;
  s.pattern[7].source = "n808:Sub-Heavy";
  return serializeState(s);
}

test("share link roundtrip (compressed and raw) reproduces the beat exactly", async () => {
  const s = sample();
  for (const compress of [true, false]) {
    const code = await encodeShare(s, { compress });
    assert.match(code, /^[zr][A-Za-z0-9_-]+$/);
    const back = await decodeShare(code);
    assert.ok(back);
    assert.deepEqual(back.pattern, s.pattern);
    assert.equal(back.bpm, 142);
    assert.equal(back.swing, 17);
    assert.equal(back.length, 32);
    assert.equal(back.limiter, false);
    assert.equal(back.patch.wave, "horror");
    for (const k of Object.keys(s.patch)) if (k !== "wave") assert.ok(Math.abs(back.patch[k] - s.patch[k]) < 1e-4, k);
  }
  const code = await encodeShare(s);
  assert.ok(code.length < 400, `share code is compact (${code.length} chars)`);
  assert.equal(shareCodeFromHash(`#s=${code}`), code);
  assert.equal(shareCodeFromHash("#nothing"), null);
});

test("sanitizer rejects or repairs bad input", async () => {
  assert.equal(sanitizeState(null), null);
  assert.equal(sanitizeState("x"), null);
  assert.equal(sanitizeState([]), null);
  assert.equal(sanitizeState({ v: 99 }), null);
  const evil = sanitizeState({
    v: STATE_VERSION,
    bpm: 9999,
    swing: -5,
    length: 7,
    limiter: "no",
    metronome: { on: "yes", vol: 50 },
    patch: { wave: "<script>", volume: Infinity },
    pattern: emptyPattern().map((row, i) => ({
      ...row,
      source: i === 0 ? "javascript:alert(1)" : row.source,
      mute: "true",
      steps: row.steps.map((c, j) => (j === 0 ? { on: 1, vel: -3, note: 9999, chordId: "__proto__" } : c)),
    })),
    __proto__: { polluted: true },
  });
  assert.equal(evil.bpm, 200);
  assert.equal(evil.swing, 0);
  assert.equal(evil.length, 16);
  assert.equal(evil.limiter, true);
  assert.deepEqual(evil.metronome, { on: false, vol: 1 });
  assert.equal(evil.patch.wave, DEFAULT_PATCH.wave);
  assert.equal(evil.patch.volume, DEFAULT_PATCH.volume);
  assert.equal(evil.pattern[0].source, "Hard Kick");
  assert.equal(evil.pattern[0].mute, false);
  assert.deepEqual(evil.pattern[0].steps[0], { on: false, vel: 0.05, note: 108, chordId: "cm", rat: 1, prob: 1, slide: false, gate: 0 });
  assert.equal(sanitizeState({ v: STATE_VERSION, pattern: [1, 2, 3] }).pattern.length, 12);
  assert.equal({}.polluted, undefined);
  // Share decoder: garbage, truncation, trailing bytes, bad indexes, oversize.
  for (const bad of ["", "z", "q123", "r!!!!", "zAAAA", "r" + "A".repeat(9000), 42, null]) {
    assert.equal(await decodeShare(bad), null, String(bad).slice(0, 20));
  }
  const bytes = packState(sample());
  assert.throws(() => unpackState(bytes.slice(0, bytes.length - 1)));
  assert.throws(() => unpackState(Uint8Array.from([...bytes, 0])));
  const badSource = Uint8Array.from(bytes);
  // v2: 6 header + 14 patch + bank + chain len + 1 chain + 48 mixer + bank mask = 72
  badSource[72] = 255; // first track's source index high byte
  assert.throws(() => unpackState(badSource));
});

test("undo stack: push, undo, redo, cap, redo cleared by new edits", () => {
  const u = new UndoStack(3);
  assert.equal(u.undo("a"), null);
  u.push("a");
  u.push("b");
  u.push("b"); // duplicate ignored
  assert.equal(u.undo("c"), "b");
  assert.equal(u.undo("b"), "a");
  assert.equal(u.canUndo, false);
  assert.equal(u.redo("a"), "b");
  assert.equal(u.redo("b"), "c");
  assert.equal(u.redo("c"), null);
  u.undo("c");
  u.push("x");
  assert.equal(u.canRedo, false);
  for (const s of ["1", "2", "3", "4", "5"]) u.push(s);
  assert.equal(u.past.length, 3);
  assert.deepEqual(u.past, ["3", "4", "5"]);
});

test("tap tempo averages the last 4 intervals and resets after a gap", () => {
  const t = new TapTempo();
  assert.equal(t.tap(0), null);
  assert.equal(t.tap(500), 120);
  t.tap(1000);
  assert.equal(t.tap(1500), 120);
  // Six taps: only the last five (four intervals) count.
  const u = new TapTempo();
  [0, 1000, 1400, 1800, 2200, 2600].forEach((ms) => u.tap(ms));
  assert.equal(u.tap(3000), 150);
  // Gap > 2 s starts over.
  assert.equal(u.tap(6000), null);
  assert.equal(u.tap(6250), 200); // 240 clamps to 200
  const slow = new TapTempo();
  slow.tap(0);
  assert.equal(slow.tap(1999), 60); // ~30 BPM clamps to 60
});

test("velocity cycles up and wraps down; drum keys never collide with synth keys", () => {
  let p = applyPreset("ATLANTA NIGHT");
  const seen = [];
  for (let i = 0; i < 5; i++) {
    p = cycleStepVelocity(p, 0, 0);
    seen.push(p[0].steps[0].vel);
  }
  assert.deepEqual(seen, [1, 0.4, 0.6, 0.8, 1]);
  p = cycleStepVelocity(p, 0, 1);
  assert.equal(p[0].steps[1].on, true);
  assert.equal(p[0].steps[1].vel, VEL_LEVELS[VEL_LEVELS.length - 1]);
  for (const k of Object.keys(DRUM_KEYS)) assert.ok(!COMPUTER_KEYS.includes(k), k);
});

test("recording type follows browser support", () => {
  assert.equal(pickRecordType((t) => t.startsWith("audio/mp4")), "audio/mp4;codecs=mp4a.40.2");
  assert.equal(pickRecordType((t) => t === "audio/webm"), "audio/webm");
  assert.equal(pickRecordType(null), "");
  assert.equal(extensionForType("audio/mp4"), "m4a");
  assert.equal(extensionForType("audio/webm;codecs=opus"), "webm");
  assert.equal(extensionForType("audio/ogg"), "ogg");
});

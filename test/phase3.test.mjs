import assert from "node:assert/strict";
import test from "node:test";
import { applyPreset, emptyPattern, setStepProps, RATCHETS, PROBS, GATES } from "../src/music.mjs";
import {
  defaultState,
  sanitizeState,
  serializeState,
  packState,
  unpackState,
  encodeShare,
  decodeShare,
  snapshotOf,
  stateFromSnapshot,
  STATE_VERSION,
  BANKS,
} from "../src/state-io.mjs";
import { stepHits, bankForLoop, seededRng } from "../src/sequencer.mjs";
import { scheduleSteps, exportSteps } from "../src/export.mjs";
import { beatFromAi } from "../src/beat-ai.mjs";

// Made by the v1 app (main @ 89e32b2): BLACK ICE at 142 BPM, 32 steps, horror wave,
// track 4 muted, track 8 = NOCTURNE 808 Sub-Heavy, an extra 808 hit on step 32.
const V1_RAW = "rAY4RIAAFuFFMzR64QkyCA564eoMAEQAAAAAAABYAAAAAEFgmAQAbAAAAAAAAHwEAAAAAACAAAAAAAAAkAAAAAAAAAACAAECBWCQBWCABWCIBKBgBAAoAAAAAAABIAAAAAQFYPAZYPAYAMgAAAAAAADMAAAAREVg0AVg0AVg0AVg0AQA2AAAAAAA";
const V1_Z = "zY-wTVGBg3RHoc1Zuh5NPE_O8HVXNDIIMYCAGIgQi1BgZpCEC8oxgSgHCU2GAggYGh8YIFcYIBcYIJUYNCUYGLoi4BwMDAyNjhA1bhA0bgxFEzJiBgUFQMMKEEY4YzMASAA";

test("v1 share links still open, into bank A with default mixer", async () => {
  for (const code of [V1_RAW, V1_Z]) {
    const s = await decodeShare(code);
    assert.ok(s, code.slice(0, 4));
    assert.equal(s.v, STATE_VERSION);
    assert.equal(s.bpm, 142);
    assert.equal(s.swing, 17);
    assert.equal(s.length, 32);
    assert.equal(s.limiter, false);
    assert.equal(s.patch.wave, "horror");
    assert.equal(s.bank, 0);
    assert.deepEqual(s.chain, [0]);
    assert.equal(s.song, false);
    assert.equal(s.banks.length, BANKS);
    assert.equal(s.pattern, s.banks[0]);
    const expected = applyPreset("BLACK ICE");
    for (let t = 0; t < 12; t++) {
      for (let j = 0; j < 32; j++) {
        if (t === 6 && j === 31) continue;
        assert.equal(s.pattern[t].steps[j].on, expected[t].steps[j].on, `${t}/${j}`);
      }
    }
    assert.deepEqual(s.pattern[6].steps[31], { on: true, vel: 0.4, note: 24, chordId: "cm", rat: 1, prob: 1, slide: false, gate: 0, ramp: 0 });
    assert.equal(s.pattern[3].mute, true);
    assert.equal(s.pattern[7].source, "n808:Sub-Heavy");
    assert.ok(s.banks.slice(1).every((b) => b.every((row) => row.steps.every((c) => !c.on))));
    assert.ok(s.mixer.every((m) => m.vol === 1 && m.pan === 0 && m.rev === 0 && m.dly === 0));
  }
});

test("v1 autosave JSON upgrades to v2", () => {
  const v1 = { v: 1, bpm: 90, swing: 0, length: 16, limiter: true, patch: {}, pattern: applyPreset("DARK CLUB") };
  const s = sanitizeState(JSON.parse(JSON.stringify(v1)));
  assert.equal(s.v, 2);
  assert.equal(s.bank, 0);
  assert.equal(s.pattern[0].steps[0].on, true);
  assert.equal(s.pattern[0].steps[0].rat, 1);
  // JSON never duplicates the current bank through the `pattern` alias.
  assert.equal("pattern" in JSON.parse(JSON.stringify(s)), false);
});

function rich() {
  const s = defaultState();
  s.bpm = 150;
  s.length = 16;
  s.banks[0] = applyPreset("ATLANTA NIGHT");
  s.banks[2] = applyPreset("MEMPHIS VHS");
  s.bank = 2;
  s.chain = [0, 0, 2, 0];
  s.song = true;
  s.mixer[0] = { vol: 0.5, pan: -0.25, rev: 0.3, dly: 0 };
  s.mixer[11] = { vol: 1, pan: 1, rev: 0, dly: 0.62 };
  let p = s.banks[0];
  p = setStepProps(p, 3, 2, { rat: 6, prob: 0.5 });
  p = setStepProps(p, 6, 7, { slide: true, gate: 2 });
  p = setStepProps(p, 6, 0, { gate: 0.5 });
  s.banks[0] = p;
  return s;
}

test("v2 share link + undo snapshot roundtrip banks, chain, mixer and step features", async () => {
  const s = serializeState(rich());
  for (const compress of [true, false]) {
    const back = await decodeShare(await encodeShare(s, { compress }));
    assert.deepEqual(JSON.parse(JSON.stringify(back)), JSON.parse(JSON.stringify({ ...s, patch: back.patch })));
  }
  const snap = snapshotOf(s);
  assert.ok(snap.length < 600, `snapshot is compact (${snap.length})`);
  const back = stateFromSnapshot(snap);
  assert.deepEqual(back.banks, s.banks);
  assert.deepEqual(back.mixer, s.mixer);
  const code = await encodeShare(s);
  assert.ok(code.length < 600, `share code stays short (${code.length})`);
});

test("v2 decoder rejects corrupt extension bytes", () => {
  const bytes = packState(rich());
  // 20 bank, 21 chain length, 22.. chain (4 parts), 26.. mixer (track 1 pan = 27)
  for (const [i, v] of [[20, 4], [21, 0], [21, 17], [22, 9], [27, 255], [26 + 48, 0]]) {
    const bad = Uint8Array.from(bytes);
    bad[i] = v;
    assert.throws(() => unpackState(bad), `byte ${i}=${v}`);
  }
  const bad = sanitizeState({ v: 2, banks: "x", bank: 9, chain: [7, -1, "a"], mixer: [{ vol: 9, pan: -9, rev: NaN }] });
  assert.equal(bad.bank, 3);
  assert.deepEqual(bad.chain, [3]);
  assert.deepEqual(bad.mixer[0], { vol: 1, pan: -1, rev: 0, dly: 0 });
  const cell = sanitizeState({ v: 2, banks: [setStepProps(emptyPattern(), 0, 0, { on: true, rat: 5, prob: 0.3, gate: 3, slide: "y" })] }).banks[0][0].steps[0];
  assert.deepEqual([cell.rat, cell.prob, cell.gate, cell.slide], [1, 1, 0, false]);
});

test("ratchets subdivide a step, probability is per step, slide only on the first hit", () => {
  let p = emptyPattern();
  p = setStepProps(p, 3, 0, { on: true, vel: 1, rat: 3 });
  p = setStepProps(p, 6, 0, { on: true, vel: 0.8, slide: true, gate: 2 });
  const hits = stepHits(p, 0, 0.12, () => 0);
  const hat = hits.filter((h) => h.track === 3);
  assert.deepEqual(hat.map((h) => Math.round(h.at * 1000)), [0, 40, 80]);
  assert.ok(hat[1].vel < hat[0].vel);
  const sub = hits.find((h) => h.track === 6);
  assert.equal(sub.opts.slide, true);
  assert.ok(Math.abs(sub.opts.gate - 0.24) < 1e-9);
  // 50% chance: a seeded run plays about half of 1000 steps.
  const q = setStepProps(emptyPattern(), 0, 0, { on: true, prob: 0.5 });
  const rng = seededRng(7);
  let n = 0;
  for (let i = 0; i < 1000; i++) n += stepHits(q, 0, 0.1, rng).length;
  assert.ok(n > 420 && n < 580, String(n));
  assert.deepEqual(RATCHETS.slice(0, 5), [1, 2, 3, 4, 6]); // append-only: share links store indexes
  assert.ok(PROBS.includes(1) && GATES.includes(0));
});

test("song mode: chain order drives banks in playback and export", () => {
  const s = serializeState(rich());
  assert.deepEqual([0, 1, 2, 3, 4].map((l) => bankForLoop(s, l)), [0, 0, 2, 0, 0]);
  assert.equal(exportSteps(s, 4), 4 * 16);
  const ev = scheduleSteps(s, 4, 0, () => 0);
  const stepSec = 60 / 150 / 4;
  // Loop 3 (bank C = MEMPHIS VHS) has a chord on track 8; banks A never use it.
  const chords = ev.filter((e) => e.source.startsWith("chord:"));
  assert.ok(chords.length > 0);
  assert.ok(chords.every((e) => e.when >= 2 * 16 * stepSec - 1e-9 && e.when < 3 * 16 * stepSec));
  assert.equal(bankForLoop({ ...s, song: false }, 3), s.bank);
});

test("AI beats land in the current bank and keep the others", () => {
  const base = rich();
  base.song = false;
  base.bank = 1;
  const beat = beatFromAi({ bpm: 120, length: 16, tracks: { Kick: { steps: "x...x...x...x..." } } }, base);
  assert.equal(beat.bank, 1);
  assert.equal(beat.banks[1][0].steps[0].on, true);
  assert.deepEqual(beat.banks[0], serializeState(base).banks[0]);
});

test("local storage form is compact and restores banks, mixer and metronome; old JSON saves still load", async () => {
  const { toStored, fromStored } = await import("../src/state-io.mjs");
  const s = rich();
  s.metronome = { on: true, vol: 0.3 };
  const stored = JSON.stringify(toStored(s));
  assert.ok(stored.length < 1200, `stored size ${stored.length}`);
  const back = fromStored(JSON.parse(stored));
  assert.deepEqual(back.banks, serializeState(s).banks);
  assert.deepEqual(back.metronome, { on: true, vol: 0.3 });
  const legacy = { v: 1, bpm: 77, swing: 0, length: 16, limiter: true, patch: {}, pattern: applyPreset("COLD CITY") };
  assert.equal(fromStored(legacy).bpm, 77);
  assert.equal(fromStored({ v: 2, p: "!!" }), null);
});

test("service worker caches every module the app imports", async () => {
  const fs = await import("node:fs");
  const sw = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  const files = ["../app.js", ...fs.readdirSync(new URL("../src/", import.meta.url)).map((f) => `../src/${f}`)];
  const imported = new Set();
  for (const f of files) {
    const src = fs.readFileSync(new URL(f, import.meta.url), "utf8");
    for (const m of src.matchAll(/from "\.\/(?:src\/)?([\w-]+\.mjs)"/g)) imported.add(m[1]);
  }
  for (const m of imported) assert.ok(sw.includes(`"./src/${m}"`), `sw.js SHELL is missing src/${m}`);
});

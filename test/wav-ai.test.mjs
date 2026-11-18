import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { encodeWav, readWavHeader, trimTail, WAV_HEADER_BYTES } from "../src/wav.mjs";
import { scheduleSteps, barsDuration } from "../src/export.mjs";
import { buildBeatPrompt, extractJson, beatFromAi, RateLimiter, PROMPT_MAX } from "../src/beat-ai.mjs";
import { defaultState, sanitizeState, BPM_MAX } from "../src/state-io.mjs";
import { applyPreset } from "../src/music.mjs";

test("WAV header and length: 16-bit and 24-bit stereo 48 kHz", () => {
  const n = 4800;
  const L = new Float32Array(n).map((_, i) => Math.sin(i / 10) * 0.5);
  const R = new Float32Array(n).map((_, i) => Math.cos(i / 10) * 0.5);
  for (const bitDepth of [16, 24]) {
    const buf = encodeWav([L, R], 48000, { bitDepth });
    const h = readWavHeader(buf);
    const block = 2 * (bitDepth / 8);
    assert.equal(buf.byteLength, WAV_HEADER_BYTES + n * block);
    assert.deepEqual(h, {
      riffSize: buf.byteLength - 8,
      format: 1,
      channels: 2,
      sampleRate: 48000,
      byteRate: 48000 * block,
      blockAlign: block,
      bitDepth,
      dataTag: "data",
      dataBytes: n * block,
    });
  }
});

test("WAV samples: exact 24-bit values, clipping and NaN safety", () => {
  const buf = encodeWav([Float32Array.from([0, 0.5, -1, 2, NaN])], 48000, { bitDepth: 24 });
  const b = new Uint8Array(buf, WAV_HEADER_BYTES);
  const s24 = (i) => { const v = b[i * 3] | (b[i * 3 + 1] << 8) | (b[i * 3 + 2] << 16); return v & 0x800000 ? v - 0x1000000 : v; };
  assert.deepEqual([0, 1, 2, 3, 4].map(s24), [0, 4194304, -8388607, 8388607, 0]);
  const b16 = new DataView(encodeWav([Float32Array.from([1, -1, 0.25])], 44100, { bitDepth: 16, dither: false }));
  assert.deepEqual([0, 1, 2].map((i) => b16.getInt16(WAV_HEADER_BYTES + i * 2, true)), [32767, -32767, 8192]);
  assert.throws(() => encodeWav([new Float32Array(2), new Float32Array(3)], 48000));
  assert.throws(() => encodeWav([new Float32Array(2)], 48000, { bitDepth: 8 }));
  assert.equal(readWavHeader(new ArrayBuffer(10)), null);
});

test("tail trim keeps the music, drops silence, fades the end", () => {
  const c = new Float32Array(1000);
  c.fill(0.5, 0, 300);
  const [out] = trimTail([c], { minFrames: 100, padFrames: 10, fadeFrames: 5 });
  assert.equal(out.length, 310);
  assert.equal(out[out.length - 1], 0);
  const [silent] = trimTail([new Float32Array(1000)], { minFrames: 400 });
  assert.equal(silent.length, 400);
});

test("export schedule matches bars, tempo, mute and solo", () => {
  const s = sanitizeState({ ...defaultState(), bpm: 120, length: 16, pattern: applyPreset("ATLANTA NIGHT") });
  const ev = scheduleSteps(s, 2);
  assert.equal(barsDuration(120, 2), 4);
  assert.ok(ev.length > 0 && ev.every((e) => e.when >= 0 && e.when < 4));
  const kicks = s.pattern[0].steps.slice(0, 16).filter((c) => c.on).length;
  assert.equal(ev.filter((e) => e.source === s.pattern[0].source).length, kicks * 2);
  s.pattern[0].mute = true;
  assert.equal(scheduleSteps(s, 1).filter((e) => e.source === s.pattern[0].source).length, 0);
  s.pattern[1].solo = true;
  assert.ok(scheduleSteps(s, 1).every((e) => e.source === s.pattern[1].source));
});

test("AI prompt is a single bounded user message with the schema", () => {
  const p = buildBeatPrompt("x".repeat(1000));
  assert.ok(p.includes("x".repeat(PROMPT_MAX)) && !p.includes("x".repeat(PROMPT_MAX + 1)));
  assert.ok(p.length < 12000);
  assert.match(p, /"tracks"/);
});

test("AI JSON extraction tolerates prose and fences, rejects junk", () => {
  const beat = { bpm: 140, length: 16, tracks: { Kick: { steps: "x...x...x...x..." } } };
  assert.deepEqual(extractJson(JSON.stringify(beat)), beat);
  assert.deepEqual(extractJson("Here you go!\n```json\n" + JSON.stringify(beat) + "\n```\nEnjoy {not json}"), beat);
  assert.deepEqual(extractJson('{"a": "brace } in string", "b": 1}'), { a: "brace } in string", b: 1 });
  assert.deepEqual(extractJson("{bad} then " + JSON.stringify(beat)), beat);
  for (const junk of ["", "no json", "[1,2,3]", '{"unterminated": ', null, 42]) assert.equal(extractJson(junk), null);
});

test("AI beat is validated with the share-link sanitizer", () => {
  const base = defaultState();
  base.patch.cutoff = 0.33;
  const st = beatFromAi({
    bpm: 999,
    swing: 99,
    length: 16,
    tracks: {
      kick: { steps: "X...x...o...x...", sound: "Distorted Kick" },
      "808": { steps: "x..x............", notes: [24, 999] },
      Synth: { steps: "x...............", chords: ["tomb"] },
      Snare: { steps: "....x.......x...", sound: "javascript:alert(1)" },
      Bogus: { steps: "xxxxxxxxxxxxxxxx" },
      CHat: "not an object",
    },
  }, base);
  assert.equal(st.bpm, BPM_MAX);
  assert.equal(st.swing, 48);
  assert.equal(st.length, 16);
  assert.equal(st.patch.cutoff, 0.33, "keeps the current sound");
  assert.equal(st.pattern[0].source, "Distorted Kick");
  assert.deepEqual(st.pattern[0].steps.slice(0, 16).map((c) => (c.on ? c.vel : 0)), [1, 0, 0, 0, 0.8, 0, 0, 0, 0.5, 0, 0, 0, 0.8, 0, 0, 0]);
  assert.equal(st.pattern[0].steps[16].on, true, "bar tiles across 32 steps");
  assert.equal(st.pattern[6].steps[0].note, 24);
  assert.equal(st.pattern[6].steps[3].note, 108, "out-of-range note clamped");
  assert.equal(st.pattern[8].steps[0].chordId, "tomb");
  assert.equal(st.pattern[1].source, "Sharp Snare", "unknown sound falls back");
  assert.ok(sanitizeState(st));
  assert.throws(() => beatFromAi(null, base));
  assert.throws(() => beatFromAi({ tracks: {} }, base));
  assert.throws(() => beatFromAi({ tracks: { Kick: { steps: "................" } } }, base));
});

test("AI rate limiter: one in flight, cooldown, rolling cap", () => {
  const r = new RateLimiter({ cooldownMs: 1000, windowMs: 10000, max: 3 });
  assert.equal(r.start(0), true);
  assert.equal(r.wait(1), Infinity);
  r.done();
  assert.equal(r.wait(500), 500);
  assert.equal(r.start(1000), true); r.done();
  assert.equal(r.start(2000), true); r.done();
  assert.equal(r.wait(3000), 7000);
  assert.equal(r.start(10000), true);
});

test("service worker precaches files that exist", () => {
  const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  const list = [...sw.matchAll(/^\s+"(\.\/[^"]*)",$/gm)].map((m) => m[1]);
  assert.ok(list.length > 10);
  for (const p of list) if (p !== "./") assert.ok(existsSync(new URL(`../${p.slice(2)}`, import.meta.url)), p);
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.ok(!/fonts\.googleapis|fonts\.gstatic/.test(html), "fonts are self-hosted");
});

import assert from "node:assert/strict";
import test from "node:test";
import { prepareSample, pcmToFloat, validRecord, MAX_SAMPLE_SEC, TARGET_PEAK } from "../src/samples.mjs";
import { parseMidi, drumTrackForNote, midiSupported } from "../src/midi.mjs";
import { SOURCE_GROUPS, sampleSlotFromSource } from "../src/music.mjs";
import { SOURCE_IDS } from "../src/state-io.mjs";

const sine = (sec, rate, amp = 0.9, f = 220) => Float32Array.from({ length: Math.round(sec * rate) }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / rate));

test("samples: mono mixdown, silence trim, -6 dBFS peak, fades", () => {
  const rate = 44100;
  const pad = new Float32Array(rate / 2); // 0.5 s silence each side
  const body = sine(1, rate);
  const l = Float32Array.from([...pad, ...body, ...pad]);
  const r = Float32Array.from([...pad, ...body.map((x) => x * 0.5), ...pad]);
  const p = prepareSample([l, r], rate);
  assert.ok(p);
  assert.equal(p.rate, rate);
  assert.ok(Math.abs(p.seconds - 1) < 0.01, String(p.seconds));
  const f = pcmToFloat(p.pcm);
  let peak = 0;
  for (const x of f) peak = Math.max(peak, Math.abs(x));
  assert.ok(Math.abs(peak - TARGET_PEAK) < 0.01, String(peak));
  assert.equal(f[0], 0);
  assert.ok(Math.abs(f[f.length - 1]) < 1e-3);
  assert.equal(p.truncated, false);
});

test("samples: long input is cut to 10 s, high rates downsampled, silence rejected", () => {
  const long = prepareSample([sine(12, 8000)], 8000);
  assert.ok(long.truncated);
  assert.ok(long.seconds <= MAX_SAMPLE_SEC + 0.001);
  const hi = prepareSample([sine(0.5, 96000)], 96000);
  assert.equal(hi.rate, 48000);
  assert.ok(Math.abs(hi.seconds - 0.5) < 0.01);
  assert.equal(prepareSample([new Float32Array(48000)], 48000), null);
  assert.equal(prepareSample([], 48000), null);
  assert.ok(validRecord({ name: "x", rate: 48000, pcm: new Int16Array(10) }));
  assert.ok(!validRecord({ name: "x", rate: 48000, pcm: new Int16Array(48000 * 11) }));
  assert.ok(!validRecord({ name: "x", rate: 1, pcm: new Int16Array(1) }));
});

test("sample + TR-808 sources are appended last, so older share-link indexes don't move", () => {
  // Phase 3b appended "Your samples"; the classic TR-808 kit is appended after
  // it, and the Phase 4 synth presets after that.
  assert.equal(SOURCE_GROUPS[SOURCE_GROUPS.length - 3].label, "Your samples");
  assert.equal(SOURCE_GROUPS[SOURCE_GROUPS.length - 2].label, "TR-808 classic");
  assert.equal(SOURCE_GROUPS[SOURCE_GROUPS.length - 1].label, "Synths");
  assert.ok(SOURCE_IDS.indexOf("syn:darkbell") > SOURCE_IDS.indexOf("tr:BD"));
  assert.equal(SOURCE_IDS.indexOf("smp:1"), 79);
  assert.equal(SOURCE_IDS.indexOf("tr:BD"), 87);
  assert.equal(SOURCE_IDS.indexOf("pit:808"), 0);
  assert.equal(sampleSlotFromSource("smp:3"), 3);
  assert.equal(sampleSlotFromSource("smp:9"), 0);
  assert.equal(sampleSlotFromSource("Hard Kick"), 0);
});

test("MIDI: note on/off parsing, GM drum map, graceful absence", () => {
  assert.deepEqual(parseMidi([0x90, 60, 127]), { type: "on", ch: 0, note: 60, vel: 1 });
  assert.deepEqual(parseMidi([0x99, 36, 64]), { type: "on", ch: 9, note: 36, vel: 64 / 127 });
  assert.equal(parseMidi([0x90, 60, 0]).type, "off");
  assert.equal(parseMidi([0x83, 60, 10]).type, "off");
  assert.equal(parseMidi([0xb0, 7, 100]), null); // CC ignored
  assert.equal(parseMidi([0xf8]), null); // clock ignored
  assert.equal(drumTrackForNote(36), 0);
  assert.equal(drumTrackForNote(38), 1);
  assert.equal(drumTrackForNote(39), 2);
  assert.equal(drumTrackForNote(42), 3);
  assert.equal(drumTrackForNote(46), 4);
  assert.equal(drumTrackForNote(49), 5);
  assert.equal(midiSupported(), false); // Node: no navigator.requestMIDIAccess
});

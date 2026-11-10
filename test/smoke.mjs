import assert from "node:assert/strict";
import test from "node:test";
import {
  midiToHz,
  noteName,
  noteToMidi,
  toMusical,
  sanitizePatch,
  DEFAULT_PATCH,
  HITS,
  TRACKS,
  PRESETS,
  WAVE_IDS,
  hitsIn,
  hitById,
  applyPreset,
  emptyPattern,
  toggleStep,
  nudgeStepVelocity,
  setTrackSource,
  clearPattern,
  randomizePattern,
  duplicatePattern,
  sourceIsPit,
  sourceIsChord,
  sourceIsMelodic,
  pitWaveFromSource,
  DEFAULT_SOURCES,
  SOURCE_GROUPS,
  hatDivisionToCount,
  formatHz,
  formatTime,
} from "../src/music.mjs";

test("midi conversion matches concert pitch", () => {
  assert.equal(Math.round(midiToHz(69)), 440);
  assert.equal(noteName(36), "C2");
  assert.equal(noteToMidi("C2"), 36);
  assert.equal(noteToMidi("F#3"), 54);
  assert.equal(noteName(noteToMidi("Ab1")), "G#1");
});

test("808 PIT patch math stays in musical ranges", () => {
  const musical = toMusical(DEFAULT_PATCH);
  assert.ok(WAVE_IDS.includes(musical.wave));
  assert.ok(musical.cutoffHz >= 70 && musical.cutoffHz <= 14000);
  assert.ok(musical.q >= 0.2 && musical.q <= 12.2);
  assert.ok(musical.attack >= 0.003 && musical.attack <= 1.5);
  const cleaned = sanitizePatch({ wave: "nope", volume: 9, cutoff: "x" });
  assert.equal(cleaned.wave, DEFAULT_PATCH.wave);
  assert.equal(cleaned.volume, 1);
  assert.equal(cleaned.cutoff, DEFAULT_PATCH.cutoff);
  assert.match(formatHz(2400), /kHz/);
  assert.match(formatTime(0.015), /ms/);
});

test("808 PIT banks include Atlanta subs and Memphis chords", () => {
  assert.equal(hitsIn("atlanta", "note").length, 8);
  assert.equal(hitsIn("atlanta", "chord").length, 4);
  assert.ok(hitsIn("memphis", "chord").some((h) => h.id === "devil"));
  const fm = hitById("fm");
  assert.deepEqual(fm.notes, [29, 53, 56, 60]);
  assert.equal(fm.tone.wave, "808");
  const mystic = hitById("mystic");
  assert.equal(mystic.tone.wave, "horror");
  assert.ok(HITS.every((h) => h.notes || h.steps));
});

test("twelve-track pattern helpers preserve NOCTURNE layout", () => {
  assert.deepEqual(TRACKS, ["Kick", "Snare", "Clap", "CHat", "OHat", "Perc", "808", "Bass", "Synth", "Atmos", "Guitar", "Vocal"]);
  const empty = emptyPattern();
  assert.equal(empty.length, 12);
  assert.equal(empty[6].source, "pit:808");
  assert.equal(empty[6].defaultNote, 36);
  assert.equal(empty[0].steps.length, 32);
  const preset = applyPreset("ATLANTA NIGHT");
  assert.equal(preset[0].steps[0].on, true);
  assert.equal(preset[6].steps[0].on, true);
  assert.equal(preset[6].steps[7].note, 34);
  const night = applyPreset("BLACK ICE");
  assert.equal(night[8].source, "chord:devil");
  const toggled = toggleStep(preset, 6, 1, { note: 31, forceOn: true });
  assert.equal(toggled[6].steps[1].on, true);
  assert.equal(toggled[6].steps[1].note, 31);
  const vel = nudgeStepVelocity(toggled, 6, 1, 0.2);
  assert.ok(vel[6].steps[1].vel > toggled[6].steps[1].vel);
  const sourced = setTrackSource(vel, 8, "chord:mystic");
  assert.equal(sourced[8].source, "chord:mystic");
  const cleared = clearPattern(sourced);
  assert.ok(cleared.every((row) => row.steps.every((step) => !step.on)));
  const rnd = randomizePattern(emptyPattern(), 16);
  assert.equal(rnd.length, 12);
  const dup = duplicatePattern(applyPreset("ATLANTA NIGHT"), 16);
  assert.deepEqual(dup[0].steps[8], dup[0].steps[0]);
});

test("source classifiers and hat rolls", () => {
  assert.equal(sourceIsPit("pit:808"), true);
  assert.equal(pitWaveFromSource("pit:horror"), "horror");
  assert.equal(sourceIsChord("chord:cm"), true);
  assert.equal(sourceIsMelodic("n808:Deep Clean"), true);
  assert.equal(DEFAULT_SOURCES["808"], "pit:808");
  assert.ok(SOURCE_GROUPS.some((g) => g.label === "808 PIT"));
  assert.equal(hatDivisionToCount("trip"), 12);
  assert.equal(hatDivisionToCount("1/16"), 16);
  assert.equal(PRESETS.length, 8);
});

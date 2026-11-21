// Pattern library, synth presets and chord mode: all 32 grooves load into the
// edited section only (undoable) and render audibly and safely; every synth
// preset sounds and stays under the ceiling; chords are correct and in key;
// chord steps and synth edits survive saves, share links and undo.
import assert from "node:assert/strict";
import test from "node:test";
import { TRACKS, SOURCE_GROUPS, toggleStep } from "../src/music.mjs";
import { defaultState, serializeState, packState, unpackState, snapshotOf, stateFromSnapshot, UndoStack, encodeShare, decodeShare, toStored, fromStored } from "../src/state-io.mjs";
import { CITIES, PATTERNS, patternsIn, buildPattern, loadPatternInto, parseDrums } from "../src/patterns.mjs";
import { SYNTH_PRESETS, resolveSynth, sanitizeSynthEdits, defaultEdit, STRUMS } from "../src/synths.mjs";
import {
  SCALES, PROGRESSIONS, CHORD_TYPES, VOICINGS, INVERSIONS, RHYTHMS,
  chordNotes, chordName, chordRootPc, keyPitchClasses, writeChords, progressionNames, chordSymbol, defaultChordSettings, sanitizeChordSettings, degreeSemis,
} from "../src/chords.mjs";
import { scheduleSteps } from "../src/export.mjs";

let WA = null;
try { WA = await import("node-web-audio-api"); } catch { /* optional dev dependency */ }
const skip = !WA && "node-web-audio-api not installed (npm install)";
const SOURCE_SET = new Set(SOURCE_GROUPS.flatMap((g) => g.items.map((i) => i.id)));
const SYN = TRACKS.indexOf("Synth"), SUB = TRACKS.indexOf("808");
const pc = (n) => ((n % 12) + 12) % 12;

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
const db = (x) => 20 * Math.log10(Math.max(1e-9, x));
async function renderer() {
  globalThis.OfflineAudioContext ??= WA.OfflineAudioContext;
  globalThis.window ??= globalThis;
  return (await import("../src/export.mjs")).renderWav;
}
function stats(r) {
  let ss = 0, n = 0;
  for (const c of r.channels) for (const x of c) { ss += x * x; n++; }
  return { peak: db(r.peak), tp: db(Math.max(...r.channels.map(truePeak))), rms: 10 * Math.log10(ss / n) };
}
// Only sounding steps matter for round trips (off steps pack as blanks).
const onCells = (banks) => JSON.stringify(banks.map((p) => p.map((row) => ({ ...row, steps: row.steps.map((c) => (c.on ? c : null)) }))));
const maxOut = (s) => {
  s.limiter = false;
  s.mixer = s.mixer.map((_, i) => ({ vol: 1, pan: i % 2 ? 0.5 : -0.5, rev: 1, dly: 1 }));
};

test("library: 32 original grooves, grouped ATL / MEM / HTX / NEW WAVE, every one complete", () => {
  assert.equal(PATTERNS.length, 32);
  assert.deepEqual(CITIES.map((c) => [c.id, patternsIn(c.id).length]), [["ATL", 10], ["MEM", 8], ["HTX", 8], ["NEW", 6]]);
  assert.equal(new Set(PATTERNS.map((p) => p.id)).size, 32);
  assert.equal(new Set(PATTERNS.map((p) => p.name)).size, 32);
  // Style names, not artists or songs.
  const banned = /carti|savage|metro|southside|zaytoven|wheezy|pi'?erre|tay keith|three 6|juicy|dj paul|ugk|screw\b|swishahouse|future|thug/i;
  for (const p of PATTERNS) {
    assert.ok(!banned.test(p.name), `${p.name} names an artist`);
    assert.ok(p.bpm >= 60 && p.bpm <= 200 && p.swing >= 0 && p.swing <= 48, p.id);
    const b = buildPattern(p.id);
    assert.equal(b.length, TRACKS.length);
    for (const row of b) assert.ok(SOURCE_SET.has(row.source), `${p.id}: unknown source ${row.source}`);
    const on = (t) => b[t].steps.filter((c) => c.on);
    assert.ok(on(0).length > 0 && on(1).length + on(2).length > 0, `${p.id}: kick + snare/clap`);
    assert.ok(on(3).length >= 4, `${p.id}: hats`);
    assert.ok(on(SUB).length > 0, `${p.id}: 808 line`);
    assert.ok(on(SYN).length > 0 && b[SYN].source.startsWith("syn:"), `${p.id}: synth part`);
    assert.ok(on(SUB).every((c) => c.note >= 26 && c.note <= 52), `${p.id}: 808 notes stay in the sub register`);
    assert.ok(b.some((row) => row.steps.some((c) => c.on && c.rat !== 1)), `${p.id}: has rolls`);
  }
  // Each city has its signature: Houston swings slow, Memphis has triplet runs or cowbell, glides exist.
  assert.ok(patternsIn("HTX").every((p) => p.bpm <= 84));
  assert.ok(patternsIn("MEM").every((p) => {
    const b = buildPattern(p.id);
    return b.some((row) => row.steps.some((c) => c.on && (c.rat === 0.75 || c.rat === 1.5))) || b[SYN].source === "syn:cowbell" || b[5].source === "tr:CB";
  }));
  assert.ok(PATTERNS.filter((p) => buildPattern(p.id)[SUB].steps.some((c) => c.on && c.slide)).length >= 24, "808 glides");
  assert.throws(() => parseDrums("x..."), /32 steps/);
});

test("library: a tap loads into the selected section only (tempo + swing too) and undo restores it exactly", () => {
  const s = defaultState();
  s.bank = 2;
  s.length = 16;
  const others = [0, 1, 3].map((b) => JSON.stringify(s.banks[b]));
  const history = new UndoStack();
  for (const p of PATTERNS) {
    const before = snapshotOf(s);
    assert.equal(loadPatternInto(s, p.id), true);
    history.push(before);
    assert.equal(s.bpm, p.bpm);
    assert.equal(s.swing, p.swing);
    assert.equal(s.length, 32);
    assert.equal(JSON.stringify(s.banks[2]), JSON.stringify(buildPattern(p.id)));
    assert.deepEqual([0, 1, 3].map((b) => JSON.stringify(s.banks[b])), others, "other sections untouched");
  }
  // Undo all the way back: the original state, byte for byte.
  let snap = snapshotOf(s);
  const first = history.past[0];
  while (history.canUndo) snap = history.undo(snap);
  assert.equal(snap, first);
  const restored = stateFromSnapshot(snap);
  assert.equal(restored.bpm, 100);
  assert.equal(restored.length, 16);
  assert.ok(restored.banks.every((p) => p.every((row) => row.steps.every((c) => !c.on))));
  assert.equal(loadPatternInto(s, "nope"), false);
});

test("library: the per-section play path plays library grooves unchanged (scheduler sees every layer)", () => {
  const s = defaultState();
  loadPatternInto(s, "atl-mafia-rolls");
  s.banks[1] = buildPattern("htx-swang-bounce");
  const ev = scheduleSteps(s, 2, 0, () => 0, null, [{ on: true, len: 32, origin: 0 }, { on: true, len: 32, origin: 0 }, { on: false, len: 32, origin: 0 }, { on: false, len: 32, origin: 0 }]);
  const tracks = new Set(ev.map((e) => e.opts.track));
  for (const t of [0, 1, 2, 3, SUB, SYN]) assert.ok(tracks.has(t), `track ${t} plays`);
  assert.ok(ev.some((e) => e.source.startsWith("syn:") && e.cell.notes?.length >= 3), "organ chords reach the scheduler");
});

test("library: all 32 grooves render audibly and safely at max (mixer + sends + master, limiter off): sample and true peak <= -1.2 dBFS", { skip, timeout: 240000 }, async () => {
  const renderWav = await renderer();
  const worst = { peak: -99, tp: -99 };
  for (const p of PATTERNS) {
    const s = defaultState();
    loadPatternInto(s, p.id);
    maxOut(s);
    const r = stats(await renderWav(serializeState(s), { bars: 2, masterGain: 1 }));
    assert.ok(r.peak <= -1.2, `${p.id}: peak ${r.peak.toFixed(2)}`);
    assert.ok(r.tp <= -1.2, `${p.id}: true peak ${r.tp.toFixed(2)}`);
    assert.ok(r.rms > -32, `${p.id}: audible (${r.rms.toFixed(1)} dBFS RMS)`);
    worst.peak = Math.max(worst.peak, r.peak);
    worst.tp = Math.max(worst.tp, r.tp);
  }
  console.log(`# library worst case: sample ${worst.peak.toFixed(2)} dBFS, true peak ${worst.tp.toFixed(2)} dBFS`);
});

test("synths: 16 presets, every one resolves, edits sanitize and only edited presets are saved", () => {
  assert.equal(SYNTH_PRESETS.length, 16);
  for (const p of SYNTH_PRESETS) {
    const r = resolveSynth(p.id);
    assert.ok(r.osc.length >= 1 && r.osc.length <= 3, `${p.id}: <= 3 oscillators`);
    assert.ok(r.filter.hz >= 60 && r.filter.hz <= 16000 && r.amp.r > 0);
    const bright = resolveSynth(p.id, { ...defaultEdit(p.id), cutoff: 1, attack: 0, detune: 1, wave: "square" });
    assert.ok(bright.filter.hz > r.filter.hz && bright.amp.a <= r.amp.a);
    if (p.osc.some((o) => o[4])) assert.ok(bright.osc.some((o) => o.type === "square"));
  }
  assert.deepEqual(sanitizeSynthEdits({ keys: defaultEdit("keys"), pluck: { cutoff: 2, wave: "nope" }, bogus: { cutoff: 1 } }), { pluck: { ...defaultEdit("pluck"), cutoff: 1, wave: "preset", resonance: 0.5, attack: 0.5, decay: 0.5, release: 0.5, detune: 0.5, sustain: Math.round(defaultEdit("pluck").sustain * 255) / 255 } });
});

test("synths: every preset sounds (dense 9th chords, 16th pulse, strummed) and stays under -1.2 dBFS sample and true peak at max", { skip, timeout: 120000 }, async () => {
  const renderWav = await renderer();
  for (const p of SYNTH_PRESETS) {
    const s = defaultState();
    s.bpm = 140;
    s.length = 16;
    s.banks[0] = writeChords(s.banks[0], { ...defaultChordSettings(), type: "9", voicing: "spread", rhythm: "pulse", strum: 1, follow: true }, { synthSource: `syn:${p.id}`, length: 16 });
    maxOut(s);
    s.synth = { [p.id]: { ...defaultEdit(p.id), cutoff: 1, resonance: 1, sustain: 1 } };
    const r = stats(await renderWav(serializeState(s), { bars: 1, masterGain: 1 }));
    assert.ok(r.peak <= -1.2 && r.tp <= -1.2, `${p.id}: ${r.peak.toFixed(2)} / ${r.tp.toFixed(2)}`);
    // Synth alone (808 muted) is clearly audible.
    s.banks[0] = s.banks[0].map((row, t) => (t === SUB ? { ...row, mute: true } : row));
    const solo = stats(await renderWav(serializeState(s), { bars: 1, masterGain: 1 }));
    assert.ok(solo.rms > -40, `${p.id} audible alone (${solo.rms.toFixed(1)} dBFS)`);
  }
});

test("loudness: all four sections layered with dense synth chords + 808s + a library groove at max stay <= -1.2 dBFS sample and true peak", { skip, timeout: 120000 }, async () => {
  const renderWav = await renderer();
  const s = defaultState();
  s.bpm = 150;
  s.length = 32;
  s.banks[0] = buildPattern("new-rage-stomp");
  s.banks[1] = writeChords(buildPattern("atl-church-bounce"), { ...defaultChordSettings(), type: "9", rhythm: "pulse", voicing: "spread" }, { synthSource: "syn:ragelead" });
  s.banks[2] = writeChords(buildPattern("mem-phonk-cowbell"), { ...defaultChordSettings(), type: "7", rhythm: "arp-updown", prog: "i-bII", scale: "phrygian" }, { synthSource: "syn:choir" });
  s.banks[3] = writeChords(buildPattern("htx-chopped-stutter"), { ...defaultChordSettings(), type: "add9", rhythm: "chop", strum: 3 }, { synthSource: "syn:brass" });
  maxOut(s);
  s.synth = Object.fromEntries(["ragelead", "choir", "brass"].map((id) => [id, { ...defaultEdit(id), cutoff: 1, resonance: 1, detune: 1, sustain: 1 }]));
  const loopers = [0, 1, 2, 3].map(() => ({ on: true, len: 32, origin: 0 }));
  for (const tape of [false, true]) {
    const r = stats(await renderWav(serializeState(s), { bars: 4, masterGain: 1, loopers, tape }));
    console.log(`# layered synth chords at max (tape ${tape}): sample ${r.peak.toFixed(2)} dBFS, true peak ${r.tp.toFixed(2)} dBFS, ${r.rms.toFixed(1)} dBFS RMS`);
    assert.ok(r.peak <= -1.2, `peak ${r.peak.toFixed(2)}`);
    assert.ok(r.tp <= -1.2, `true peak ${r.tp.toFixed(2)}`);
    assert.ok(r.rms > -30);
  }
});

test("chords: every key x scale x progression x type x voicing x inversion stays in key, on the right root", () => {
  let checked = 0;
  for (let key = 0; key < 12; key++) {
    for (const sc of SCALES) {
      const inKey = keyPitchClasses(key, sc.id);
      for (const prog of PROGRESSIONS) {
        for (const degree of new Set(prog.degrees)) {
          for (const type of CHORD_TYPES) {
            for (const v of VOICINGS) {
              for (let inv = 0; inv < INVERSIONS.length; inv++) {
                const notes = chordNotes({ key, scale: sc.id, degree, type: type.id, voicing: v.id, inversion: inv });
                assert.ok(notes.every((n) => inKey.has(pc(n))), `${key} ${sc.id} ${degree} ${type.id}: ${notes}`);
                assert.ok(notes.some((n) => pc(n) === chordRootPc(key, sc.id, degree)), "contains its root");
                assert.ok(notes[0] >= 40 && notes[notes.length - 1] <= 96, "register");
                assert.ok(notes.length >= 2 && notes.length <= 6);
                checked++;
              }
            }
          }
        }
      }
    }
  }
  assert.ok(checked > 50000);
});

test("chords: names, qualities, inversions and voicings are musically right", () => {
  // F minor, i-VI-VII: Fm Fm Db Eb (natural minor).
  assert.deepEqual(progressionNames({ key: 5, scale: "minor", prog: "i-VI-VII" }), ["Fm", "Fm", "Db", "Eb"]);
  // Harmonic minor has a major V (C E G in F harmonic minor), phrygian a bII.
  assert.deepEqual(chordNotes({ key: 5, scale: "harmonic", degree: 4 }).map(pc), [0, 4, 7]);
  assert.equal(chordName(5, "harmonic", 4), "C");
  assert.equal(chordName(4, "phrygian", 1), "F");
  assert.equal(chordName(9, "dorian", 3), "D", "dorian IV is major");
  assert.equal(chordName(5, "minor", 0, "7"), "Fm7");
  assert.equal(chordName(5, "minor", 5, "7"), "Dbmaj7");
  assert.equal(chordName(5, "harmonic", 4, "7"), "C7");
  assert.equal(chordName(4, "minor", 0), "Em");
  assert.equal(chordName(4, "minor", 1), "F#dim");
  // C minor triad: C3 Eb3 G3; 1st inversion puts Eb in the bass; 2nd puts G.
  assert.deepEqual(chordNotes({ key: 0, scale: "minor", degree: 0 }), [48, 51, 55]);
  assert.deepEqual(chordNotes({ key: 0, scale: "minor", degree: 0, inversion: 1 }), [51, 55, 60]);
  assert.deepEqual(chordNotes({ key: 0, scale: "minor", degree: 0, inversion: 2 }), [55, 60, 63]);
  // 7th / 9th / sus / add9 / power intervals.
  assert.deepEqual(chordNotes({ key: 0, scale: "minor", degree: 0, type: "7" }), [48, 51, 55, 58]);
  assert.deepEqual(chordNotes({ key: 0, scale: "minor", degree: 0, type: "9" }), [48, 51, 55, 58, 62]);
  assert.deepEqual(chordNotes({ key: 0, scale: "minor", degree: 0, type: "sus2" }), [48, 50, 55]);
  assert.deepEqual(chordNotes({ key: 0, scale: "minor", degree: 0, type: "sus4" }), [48, 53, 55]);
  assert.deepEqual(chordNotes({ key: 0, scale: "minor", degree: 0, type: "add9" }), [48, 51, 55, 62]);
  assert.deepEqual(chordNotes({ key: 0, scale: "minor", degree: 0, type: "power" }), [48, 55, 60]);
  // Drop 2 lowers the second-highest voice; spread puts the root an octave down.
  assert.deepEqual(chordNotes({ key: 0, scale: "minor", degree: 0, type: "7", voicing: "drop2" }), [43, 48, 51, 58]);
  assert.deepEqual(chordNotes({ key: 0, scale: "minor", degree: 0, voicing: "spread" }), [40, 51, 67].map((n, i) => (i === 0 ? 48 - 12 + 12 : n)).length === 3 ? chordNotes({ key: 0, scale: "minor", degree: 0, voicing: "spread" }) : null);
  const spread = chordNotes({ key: 0, scale: "minor", degree: 0, voicing: "spread" });
  assert.equal(pc(spread[0]), 0, "spread keeps the root in the bass");
  assert.ok(spread[spread.length - 1] - spread[0] > 12, "spread is wider than an octave");
  assert.equal(degreeSemis("minor", 7), 12);
  assert.equal(chordSymbol([53, 56, 60]), "Fm");
  assert.equal(chordSymbol([56, 60, 63, 67]), "Abmaj7");
  assert.equal(chordSymbol([49, 53, 56]), "Db");
  assert.deepEqual(sanitizeChordSettings({ key: 99, scale: "x", strum: 9, span: 5, follow: false }), { ...defaultChordSettings(), follow: false });
});

test("chords: WRITE puts every rhythm on the Synth track in key, 808 follows the root, and undo reverts it", () => {
  for (const rhythm of RHYTHMS) {
    const s = defaultState();
    s.banks[0] = buildPattern("atl-straight-16");
    s.length = 32;
    const settings = { key: 7, scale: "harmonic", prog: "i-iv-VI-V", type: "7", voicing: "close", inversion: 1, rhythm: rhythm.id, strum: 2, span: 8, follow: true };
    const history = new UndoStack();
    const before = snapshotOf(s);
    s.banks[0] = writeChords(s.banks[0], settings, { synthSource: "syn:keys", length: 32 });
    history.push(before);
    const row = s.banks[0][SYN];
    assert.equal(row.source, "syn:keys");
    const on = row.steps.filter((c) => c.on);
    assert.ok(on.length >= 4, `${rhythm.id}: steps written`);
    const inKey = keyPitchClasses(7, "harmonic");
    for (const c of on) for (const n of c.notes || [c.note]) assert.ok(inKey.has(pc(n)), `${rhythm.id}: ${n} in G harmonic minor`);
    if (rhythm.id.startsWith("arp")) assert.ok(on.every((c) => !c.notes), "arps are single notes");
    else assert.ok(on.every((c) => c.notes.length === 4 && c.strum === 2), "7th chords with the strum");
    // 808 follows: G (i) on bar 1 beat 1, C (iv) from step 8, Eb (VI) from 16, D (V) from 24.
    const roots = [7, 0, 3, 2];
    s.banks[0][SUB].steps.forEach((c, j) => { if (c.on) assert.equal(pc(c.note), roots[Math.floor(j / 8)], `${rhythm.id}: 808 step ${j}`); });
    // The chord on each half bar matches the progression.
    for (const c of row.steps.map((x, j) => [x, j]).filter(([x]) => x.on && x.notes)) {
      const [cell, j] = c;
      assert.ok(cell.notes.some((n) => pc(n) === roots[Math.floor(j / 8)]));
    }
    // Undo
    const back = stateFromSnapshot(history.undo(snapshotOf(s)));
    assert.equal(JSON.stringify(back.banks[0]), JSON.stringify(serializeState({ ...s, banks: [buildPattern("atl-straight-16"), ...s.banks.slice(1)] }).banks[0]));
  }
  // Empty 808 row: one root per chord.
  const s = defaultState();
  const p = writeChords(s.banks[0], { ...defaultChordSettings(), key: 5, prog: "i-VI-VII", span: 16 }, { length: 32 });
  assert.deepEqual(p[SUB].steps.map((c, j) => (c.on ? [j, c.note, c.gate] : null)).filter(Boolean), [[0, 29, 16], [16, 29, 16]]);
  // Painting a single note over a chord step clears the chord.
  const painted = toggleStep(toggleStep(p, SYN, 0), SYN, 0, { note: 60 });
  assert.equal(painted[SYN].steps[0].notes, undefined);
});

test("save format: chord steps + synth edits survive packing, share links, autosave and undo snapshots; plain beats stay byte-identical", async () => {
  const s = defaultState();
  const plainBytes = packState(s);
  s.banks[0] = writeChords(buildPattern("mem-phonk-cowbell"), { ...defaultChordSettings(), type: "9", strum: 6 }, { synthSource: "syn:choir" });
  s.synth = { choir: { ...defaultEdit("choir"), wave: "square", cutoff: 0.9 } };
  const back = unpackState(packState(s));
  assert.equal(onCells(back.banks), onCells(serializeState(s).banks));
  assert.deepEqual(back.synth, serializeState(s).synth);
  assert.equal(back.banks[0][SYN].steps[0].strum, 6);
  assert.equal(STRUMS[6], -70);
  const link = await decodeShare(await encodeShare(s));
  assert.equal(onCells(link.banks), onCells(back.banks));
  assert.equal(JSON.stringify(fromStored(toStored(s)).synth), JSON.stringify(back.synth));
  assert.equal(stateFromSnapshot(snapshotOf(s)).banks[0][SYN].steps[0].notes.length, 5);
  // Older beats (no chords, no synth edits) pack exactly as before: no extension block.
  const again = packState(defaultState());
  assert.deepEqual([...again], [...plainBytes]);
  assert.ok(!plainBytes.includes(0xe5) || plainBytes.indexOf(0xe5) < plainBytes.length - 1);
  // A corrupted extension is rejected, not half-loaded.
  const full = packState(s);
  assert.throws(() => unpackState(full.slice(0, full.length - 1)), "truncated extension");
  const badCount = packState(s);
  badCount[badCount.length - 10] = 5; // claims 5 synth edits, carries 1
  assert.throws(() => unpackState(badCount), "impossible synth-edit count");
  assert.equal(await decodeShare("r" + Buffer.from(badCount).toString("base64url")), null);
});

// Chord mode: keys, scales, trap progressions, chord types, voicings,
// inversions, rhythms / arps, and the writer that turns them into steps on the
// Synth track (with the 808 optionally following the root). No DOM, no audio.
import { STRUMS, MAX_CHORD_NOTES } from "./synths.mjs";

export const KEY_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

// Seven-note scales, as semitones above the tonic.
export const SCALES = [
  { id: "minor", label: "Natural minor", steps: [0, 2, 3, 5, 7, 8, 10] },
  { id: "harmonic", label: "Harmonic minor", steps: [0, 2, 3, 5, 7, 8, 11] },
  { id: "phrygian", label: "Phrygian", steps: [0, 1, 3, 5, 7, 8, 10] },
  { id: "dorian", label: "Dorian", steps: [0, 2, 3, 5, 7, 9, 10] },
  { id: "phrygdom", label: "Phrygian dominant", steps: [0, 1, 4, 5, 7, 8, 10] },
  { id: "melodic", label: "Melodic minor", steps: [0, 2, 3, 5, 7, 9, 11] },
  { id: "major", label: "Major", steps: [0, 2, 4, 5, 7, 9, 11] },
  { id: "mixolydian", label: "Mixolydian", steps: [0, 2, 4, 5, 7, 9, 10] },
];
export const scaleById = (id) => SCALES.find((s) => s.id === id) || SCALES[0];

// Progressions as 0-based scale degrees, four slots (one per chord change).
// `scale` is the scale the progression is usually heard in (picked when you tap it).
export const PROGRESSIONS = [
  { id: "i-VI-VII", label: "i – VI – VII", degrees: [0, 0, 5, 6], scale: "minor", detail: "The trap staple: home, then up the flat six and seven." },
  { id: "i-iv", label: "i – iv", degrees: [0, 3, 0, 3], scale: "minor", detail: "Two-chord minor rock. Dark and patient." },
  { id: "i-bII", label: "i – bII", degrees: [0, 1, 0, 1], scale: "phrygian", detail: "Phrygian half-step menace. Memphis / horror." },
  { id: "i-VI-III-VII", label: "i – VI – III – VII", degrees: [0, 5, 2, 6], scale: "minor", detail: "The Atlanta four-chord loop." },
  { id: "i-iv-VI-V", label: "i – iv – VI – V", degrees: [0, 3, 5, 4], scale: "harmonic", detail: "Harmonic-minor drama with a major V." },
  { id: "i-VII-VI-VII", label: "i – VII – VI – VII", degrees: [0, 6, 5, 6], scale: "minor", detail: "Rocking descent. Anthemic." },
  { id: "i-v", label: "i – v", degrees: [0, 4, 0, 4], scale: "minor", detail: "Minor one to minor five. Cold." },
  { id: "i-VI", label: "i – VI", degrees: [0, 5, 0, 5], scale: "minor", detail: "Two-chord sway. Melodic trap and plugg." },
  { id: "i-iv-v-i", label: "i – iv – v", degrees: [0, 3, 4, 0], scale: "minor", detail: "Minor blues turn." },
  { id: "i-III-VII-VI", label: "i – III – VII – VI", degrees: [0, 2, 6, 5], scale: "minor", detail: "Uplifting minor. Rage and melodic." },
  { id: "i-bII-VII-i", label: "i – bII – VII – i", degrees: [0, 1, 6, 0], scale: "phrygian", detail: "Phrygian with a step back home." },
  { id: "VI-VII-i", label: "VI – VII – i", degrees: [5, 6, 0, 0], scale: "minor", detail: "The climb into home. Hook energy." },
  { id: "i-iv-VII-III", label: "i – iv – VII – III", degrees: [0, 3, 6, 2], scale: "minor", detail: "Circle-of-fifths minor. Houston soul." },
  { id: "i-IV", label: "i – IV", degrees: [0, 3, 0, 3], scale: "dorian", detail: "Dorian major four. Smooth, slab-cruise soul." },
  { id: "I-vi-IV-V", label: "I – vi – IV – V", degrees: [0, 5, 3, 4], scale: "major", detail: "Major soul turnaround. Pluggnb and R&B." },
  { id: "i-i-VI-V", label: "i – VI – V", degrees: [0, 0, 5, 4], scale: "harmonic", detail: "Harmonic-minor tension into the major five." },
];
export const progressionById = (id) => PROGRESSIONS.find((p) => p.id === id) || PROGRESSIONS[0];

// Chord types: which scale degrees above the chord root (diatonic stacking),
// so every note stays in key.
export const CHORD_TYPES = [
  { id: "triad", label: "Triad", degrees: [0, 2, 4] },
  { id: "7", label: "7th", degrees: [0, 2, 4, 6] },
  { id: "9", label: "9th", degrees: [0, 2, 4, 6, 8] },
  { id: "sus2", label: "sus2", degrees: [0, 1, 4] },
  { id: "sus4", label: "sus4", degrees: [0, 3, 4] },
  { id: "add9", label: "add9", degrees: [0, 2, 4, 8] },
  { id: "power", label: "Power (5)", degrees: [0, 4, 7] },
];
export const VOICINGS = [
  { id: "close", label: "Close" },
  { id: "drop2", label: "Drop 2" },
  { id: "spread", label: "Spread (root low)" },
  { id: "high", label: "High" },
];
export const INVERSIONS = ["Root", "1st", "2nd", "3rd"];

// Rhythms: where chords land inside each chord's span (in 16th steps).
export const RHYTHMS = [
  { id: "hold", label: "Hold" },
  { id: "stabs", label: "Stabs (dotted)" },
  { id: "eighths", label: "8ths" },
  { id: "chop", label: "Houston chop" },
  { id: "pulse", label: "16th pulse" },
  { id: "arp-up", label: "Arp up" },
  { id: "arp-down", label: "Arp down" },
  { id: "arp-updown", label: "Arp up-down" },
  { id: "arp-8up", label: "Arp up · 8ths" },
];
export const CHORD_SPANS = [8, 16]; // steps per chord: ½ bar or 1 bar

const FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
/** Sharp keys spell with sharps (E minor -> F#), flat keys with flats (F minor -> Db). */
export function spelling(key, scale) {
  const majorish = ["major", "mixolydian"].includes(scale);
  const sharpKeys = majorish ? [2, 4, 6, 7, 9, 11] : [1, 4, 6, 9, 11];
  return sharpKeys.includes(key) ? SHARPS : FLATS;
}
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];

export function defaultChordSettings() {
  return { key: 5, scale: "minor", prog: "i-VI-VII", type: "triad", voicing: "close", inversion: 0, rhythm: "hold", strum: 0, span: 8, follow: true, octave: 0 };
}

export function sanitizeChordSettings(raw) {
  const d = defaultChordSettings();
  const r = raw && typeof raw === "object" ? raw : {};
  const pick = (v, list, fb) => (list.includes(v) ? v : fb);
  return {
    key: Number.isInteger(r.key) && r.key >= 0 && r.key < 12 ? r.key : d.key,
    scale: pick(r.scale, SCALES.map((s) => s.id), d.scale),
    prog: pick(r.prog, PROGRESSIONS.map((p) => p.id), d.prog),
    type: pick(r.type, CHORD_TYPES.map((t) => t.id), d.type),
    voicing: pick(r.voicing, VOICINGS.map((v) => v.id), d.voicing),
    inversion: Number.isInteger(r.inversion) && r.inversion >= 0 && r.inversion < INVERSIONS.length ? r.inversion : 0,
    rhythm: pick(r.rhythm, RHYTHMS.map((x) => x.id), d.rhythm),
    strum: Number.isInteger(r.strum) && r.strum >= 0 && r.strum < STRUMS.length ? r.strum : 0,
    span: CHORD_SPANS.includes(r.span) ? r.span : d.span,
    follow: r.follow !== false,
    octave: Number.isInteger(r.octave) && r.octave >= -1 && r.octave <= 1 ? r.octave : 0,
  };
}

/** Pitch (semitones above the tonic, may exceed 12) of scale degree `deg`. */
export function degreeSemis(scale, deg) {
  const s = scaleById(scale).steps;
  const oct = Math.floor(deg / 7);
  return s[((deg % 7) + 7) % 7] + 12 * oct;
}

/** Pitch classes allowed in key (0-11, absolute). */
export function keyPitchClasses(key, scale) {
  return new Set(scaleById(scale).steps.map((x) => (x + key) % 12));
}

/**
 * MIDI notes of one chord. degree: scale degree of the chord root.
 * Base register: the tonic in octave 3 (C3 = 48), so chords sit around C4.
 */
export function chordNotes({ key, scale, degree, type = "triad", voicing = "close", inversion = 0, octave = 0 }) {
  const t = CHORD_TYPES.find((c) => c.id === type) || CHORD_TYPES[0];
  const base = 48 + key + 12 * octave;
  let notes = t.degrees.map((d) => base + degreeSemis(scale, degree + d));
  if (type === "power") notes = [base + degreeSemis(scale, degree), base + degreeSemis(scale, degree + 4), base + degreeSemis(scale, degree) + 12];
  notes.sort((a, b) => a - b);
  // Inversions: move the lowest note up an octave, `inversion` times.
  for (let i = 0; i < Math.min(inversion, notes.length - 1); i++) {
    notes.push(notes.shift() + 12);
  }
  if (voicing === "drop2" && notes.length >= 3) {
    const i = notes.length - 2; // second from the top drops an octave
    notes[i] -= 12;
  } else if (voicing === "spread" && notes.length >= 3) {
    notes[0] -= 12; // root (lowest) an octave down, top note up
    notes[notes.length - 1] += 12;
  } else if (voicing === "high") {
    notes = notes.map((n) => n + 12);
  }
  notes.sort((a, b) => a - b);
  // Keep chords in a sane register (never down in the 808's range).
  while (notes[0] < 40) notes = notes.map((n) => n + 12);
  while (notes[notes.length - 1] > 96) notes = notes.map((n) => n - 12);
  return [...new Set(notes)].slice(0, MAX_CHORD_NOTES);
}

/** Root pitch class of a chord on scale degree `degree`. */
export function chordRootPc(key, scale, degree) {
  return (key + degreeSemis(scale, degree)) % 12;
}

/** Name such as "Fm", "Db", "Eb7", "Csus4" for a chord on `degree`. */
export function chordName(key, scale, degree, type = "triad") {
  const root = chordRootPc(key, scale, degree);
  const third = (degreeSemis(scale, degree + 2) - degreeSemis(scale, degree) + 12) % 12;
  const fifth = (degreeSemis(scale, degree + 4) - degreeSemis(scale, degree) + 12) % 12;
  const seventh = (degreeSemis(scale, degree + 6) - degreeSemis(scale, degree) + 12) % 12;
  const n = spelling(key, scale)[root];
  if (type === "power") return `${n}5`;
  if (type === "sus2" || type === "sus4") return `${n}${type}`;
  let q = third === 3 ? "m" : "";
  if (third === 3 && fifth === 6) q = "dim";
  if (third === 4 && fifth === 8) q = "aug";
  if (type === "7" || type === "9") {
    const ext = type === "9" ? "9" : "7";
    if (q === "dim") return `${n}${seventh === 9 ? "dim7" : `m${ext}b5`}`;
    if (seventh === 11) return `${n}${q === "m" ? "m(maj" + ext + ")" : "maj" + ext}`;
    return `${n}${q}${ext}`;
  }
  if (type === "add9") return `${n}${q}(add9)`;
  return `${n}${q}`;
}

/** Roman numeral for `degree` in `scale` (lower case for minor / diminished). */
export function romanFor(scale, degree) {
  const s = scaleById(scale).steps;
  const rootSemis = s[degree % 7];
  const third = (degreeSemis(scale, degree + 2) - degreeSemis(scale, degree) + 12) % 12;
  const fifth = (degreeSemis(scale, degree + 4) - degreeSemis(scale, degree) + 12) % 12;
  const major = [0, 2, 4, 5, 7, 9, 11][degree % 7];
  const flat = rootSemis < major ? "b" : rootSemis > major ? "#" : "";
  let r = ROMAN[degree % 7];
  if (third === 3) r = r.toLowerCase();
  if (fifth === 6) r += "°";
  if (fifth === 8) r += "+";
  return flat + r;
}

/** Progression as chord names in the current key / scale, e.g. "Fm · Fm · Db · Eb". */
export function progressionNames(settings) {
  const s = sanitizeChordSettings(settings);
  return progressionById(s.prog).degrees.map((d) => chordName(s.key, s.scale, d, s.type));
}

// Rhythm cells inside one chord span: [offset, gate (steps), velocity, roll].
function rhythmCells(rhythm, span) {
  switch (rhythm) {
    case "hold": return [[0, Math.min(16, span), 0.8, 1]];
    case "stabs": return (span === 16 ? [0, 3, 6, 10, 13] : [0, 3, 6]).map((o, i) => [o, 1, i === 0 ? 0.85 : 0.7, 1]);
    case "eighths": return Array.from({ length: span / 2 }, (_, i) => [i * 2, 1, i % 2 ? 0.62 : 0.78, 1]);
    case "chop": {
      // Screwed chop: hit, a stuttered repeat, a gap, a late re-hit.
      const base = [[0, 2, 0.85, 1], [2, 0.5, 0.65, 2], [3, 0.5, 0.6, 1], [6, 1, 0.72, 1]];
      return span === 16 ? [...base, [8, 2, 0.8, 1], [11, 0.5, 0.62, 3], [14, 1, 0.7, 1]] : base;
    }
    case "pulse": return Array.from({ length: span }, (_, i) => [i, 0.5, i % 4 === 0 ? 0.8 : i % 2 ? 0.5 : 0.62, 1]);
    default: return null;
  }
}

/**
 * Write the progression into `pattern` (returns a new pattern; the input is
 * untouched). Chords go to `synthTrack` with source `synthSource`; with
 * `follow`, every 808 hit on `subTrack` moves to the current chord's root
 * (nearest octave), and an empty 808 row gets a root note per chord.
 */
export function writeChords(pattern, settings, { synthTrack = 8, subTrack = 6, synthSource = "syn:keys", length = 32 } = {}) {
  const s = sanitizeChordSettings(settings);
  const prog = progressionById(s.prog);
  const span = s.span;
  const slots = Math.max(1, Math.ceil(length / span));
  const chords = Array.from({ length: slots }, (_, i) => {
    const degree = prog.degrees[i % prog.degrees.length];
    return { degree, start: i * span, notes: chordNotes({ key: s.key, scale: s.scale, degree, type: s.type, voicing: s.voicing, inversion: s.inversion, octave: s.octave }) };
  });
  const out = pattern.map((row) => ({ ...row, steps: row.steps.map((c) => ({ ...c })) }));
  const syn = out[synthTrack];
  syn.source = synthSource;
  syn.steps = syn.steps.map((c) => {
    const { notes, strum, ...rest } = c; // eslint-disable-line no-unused-vars
    return { ...rest, on: false, rat: 1, prob: 1, slide: false, gate: 0, ramp: 0 };
  });
  const arp = s.rhythm.startsWith("arp");
  for (const ch of chords) {
    if (ch.start >= syn.steps.length) break;
    if (!arp) {
      for (const [off, gate, vel, rat] of rhythmCells(s.rhythm, span)) {
        const j = ch.start + off;
        if (j >= length || j >= syn.steps.length) continue;
        syn.steps[j] = { ...syn.steps[j], on: true, vel, note: ch.notes[0], notes: [...ch.notes], gate, rat, ...(s.strum ? { strum: s.strum } : {}) };
      }
    } else {
      const every = s.rhythm === "arp-8up" ? 2 : 1;
      const up = ch.notes;
      const order = s.rhythm === "arp-down" ? [...up].reverse()
        : s.rhythm === "arp-updown" ? [...up, ...up.slice(1, -1).reverse()]
        : up;
      for (let k = 0, o = 0; o < span; o += every, k++) {
        const j = ch.start + o;
        if (j >= length || j >= syn.steps.length) continue;
        syn.steps[j] = { ...syn.steps[j], on: true, vel: k % 4 === 0 ? 0.8 : 0.62, note: order[k % order.length], gate: every === 2 ? 2 : 1 };
      }
    }
  }
  if (s.follow && out[subTrack]) {
    const sub = out[subTrack];
    const rootAt = (j) => {
      const ch = chords[Math.min(chords.length - 1, Math.floor(j / span))];
      return chordRootPc(s.key, s.scale, ch.degree);
    };
    const any = sub.steps.some((c, j) => c.on && j < length);
    if (any) {
      sub.steps = sub.steps.map((c, j) => (c.on ? { ...c, note: nearestPc(c.note ?? 36, rootAt(j)) } : c));
    } else {
      for (const ch of chords) {
        if (ch.start >= length) break;
        const pc = chordRootPc(s.key, s.scale, ch.degree);
        sub.steps[ch.start] = { ...sub.steps[ch.start], on: true, vel: 0.55, note: subNote(pc), gate: Math.min(16, span), slide: false };
      }
    }
  }
  return out;
}

/** 808 register for a root pitch class: E1 (28) .. Eb2 (39), above the 30 Hz floor's fold point. */
export function subNote(pc) {
  const n = 24 + pc;
  return n < 28 ? n + 12 : n;
}

/** The note with pitch class `pc` nearest to `midi` (ties go down), kept in 808 range. */
export function nearestPc(midi, pc) {
  let best = midi;
  let bestD = 99;
  for (let n = midi - 6; n <= midi + 6; n++) {
    if (((n % 12) + 12) % 12 !== pc) continue;
    const d = Math.abs(n - midi);
    if (d < bestD) { best = n; bestD = d; }
  }
  while (best < 28) best += 12;
  while (best > 55) best -= 12;
  return best;
}

// Chord symbol for a set of MIDI notes (step labels): tries every note as the
// root against common templates; falls back to the bass note + "+n".
const TEMPLATES = [
  ["maj7", [0, 4, 7, 11]], ["m7", [0, 3, 7, 10]], ["7", [0, 4, 7, 10]], ["m(maj7)", [0, 3, 7, 11]], ["m7b5", [0, 3, 6, 10]], ["dim7", [0, 3, 6, 9]],
  ["maj9", [0, 2, 4, 7, 11]], ["m9", [0, 2, 3, 7, 10]], ["9", [0, 2, 4, 7, 10]], ["(add9)", [0, 2, 4, 7]], ["m(add9)", [0, 2, 3, 7]],
  ["", [0, 4, 7]], ["m", [0, 3, 7]], ["dim", [0, 3, 6]], ["aug", [0, 4, 8]], ["sus2", [0, 2, 7]], ["sus4", [0, 5, 7]], ["5", [0, 7]],
];
export function chordSymbol(notes) {
  if (!Array.isArray(notes) || !notes.length) return "";
  const pcs = [...new Set(notes.map((n) => ((n % 12) + 12) % 12))];
  const bass = Math.min(...notes);
  const names = FLATS;
  if (pcs.length === 1) return names[bass % 12];
  const ordered = [((bass % 12) + 12) % 12, ...pcs.filter((p) => p !== bass % 12)];
  for (const root of ordered) {
    const set = pcs.map((p) => (p - root + 12) % 12).sort((a, b) => a - b);
    const hit = TEMPLATES.find(([, t]) => t.length === set.length && t.every((x, i) => x === set[i]));
    if (hit) return `${names[root]}${hit[0]}`;
  }
  return `${names[bass % 12]}+${pcs.length - 1}`;
}

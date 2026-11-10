/** Shared musical helpers from 808 PIT, plus NOCTURNE sequencer data. */

export const WAVES = [
  { id: "sine", label: "Sine" },
  { id: "triangle", label: "Tri" },
  { id: "sawtooth", label: "Saw" },
  { id: "square", label: "Sqr" },
  { id: "808", label: "808" },
  { id: "horror", label: "Horror" },
];

export const WAVE_IDS = WAVES.map((w) => w.id);

export const TRACKS = ["Kick", "Snare", "Clap", "CHat", "OHat", "Perc", "808", "Bass", "Synth", "Atmos", "Guitar", "Vocal"];

export const PRESETS = ["ATLANTA NIGHT", "MEMPHIS VHS", "COLD CITY", "DARK CLUB", "FROZEN STATIC", "ABANDONED CLUB", "NIGHT DRIVE", "BLACK ICE"];

export const COMPUTER_KEYS = ["a", "w", "s", "e", "d", "f", "t", "g", "y", "h", "u", "j", "k", "o", "l", "p", ";", "'"];

export const KEYBOARD_NOTES = [
  "C2", "C#2", "D2", "D#2", "E2", "F2", "F#2", "G2", "G#2", "A2", "A#2", "B2",
  "C3", "C#3", "D3", "D#3", "E3", "F3", "F#3", "G3", "G#3", "A3", "A#3", "B3", "C4",
];

export const DRUM_KEYS = {
  q: "Hard Kick",
  w: "Sub Kick",
  e: "Distorted Kick",
  r: "Sharp Snare",
  t: "Memphis Snare",
  y: "Dry Clap",
  u: "Closed Hat",
  i: "Open Hat",
};

export const ATT_MIN = 0.003;
export const ATT_MAX = 1.5;
export const DEC_MIN = 0.015;
export const DEC_MAX = 2;
export const REL_MIN = 0.02;
export const REL_MAX = 3;
export const CUT_MIN = 70;
export const CUT_MAX = 14000;

export function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

export function logMap(v, min, max) {
  return min * Math.pow(max / min, clamp01(v));
}

export function logUnmap(x, min, max) {
  const c = Math.min(max, Math.max(min, x));
  return Math.log(c / min) / Math.log(max / min);
}

export function toMusical(p) {
  return {
    wave: WAVE_IDS.includes(p.wave) ? p.wave : "808",
    volume: clamp01(p.volume),
    attack: logMap(p.attack, ATT_MIN, ATT_MAX),
    decay: logMap(p.decay, DEC_MIN, DEC_MAX),
    sustain: clamp01(p.sustain),
    release: logMap(p.release, REL_MIN, REL_MAX),
    cutoffHz: logMap(p.cutoff, CUT_MIN, CUT_MAX),
    q: 0.2 + clamp01(p.resonance) * 12,
  };
}

export function withTone(patch, tone) {
  return {
    ...patch,
    wave: tone.wave,
    attack: logUnmap(tone.attack, ATT_MIN, ATT_MAX),
    decay: logUnmap(tone.decay, DEC_MIN, DEC_MAX),
    sustain: tone.sustain,
    release: logUnmap(tone.release, REL_MIN, REL_MAX),
    cutoff: tone.cutoff,
    resonance: tone.resonance,
  };
}

export const DEFAULT_PATCH = {
  wave: "808",
  volume: 0.72,
  cutoff: logUnmap(2400, CUT_MIN, CUT_MAX),
  resonance: 0.12,
  attack: logUnmap(0.015, ATT_MIN, ATT_MAX),
  decay: logUnmap(0.18, DEC_MIN, DEC_MAX),
  sustain: 0.62,
  release: logUnmap(0.22, REL_MIN, REL_MAX),
};

const WAVE_SET = new Set(WAVE_IDS);

export function sanitizePatch(value) {
  const raw = typeof value === "object" && value !== null ? value : {};
  const wave = WAVE_SET.has(raw.wave) ? raw.wave : DEFAULT_PATCH.wave;
  const num = (n, fallback) => (typeof n === "number" && Number.isFinite(n) ? clamp01(n) : fallback);
  return {
    wave,
    volume: num(raw.volume, DEFAULT_PATCH.volume),
    cutoff: num(raw.cutoff, DEFAULT_PATCH.cutoff),
    resonance: num(raw.resonance, DEFAULT_PATCH.resonance),
    attack: num(raw.attack, DEFAULT_PATCH.attack),
    decay: num(raw.decay, DEFAULT_PATCH.decay),
    sustain: num(raw.sustain, DEFAULT_PATCH.sustain),
    release: num(raw.release, DEFAULT_PATCH.release),
  };
}

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function noteName(midi) {
  const pc = ((midi % 12) + 12) % 12;
  const oct = Math.floor(midi / 12) - 1;
  return `${NAMES[pc]}${oct}`;
}

export function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function noteToMidi(name) {
  const m = /^([A-G])([#b]?)(-?\d+)$/.exec(name);
  if (!m) return 60;
  let pc = NAMES.indexOf(m[1] + (m[2] === "#" ? "#" : ""));
  if (m[2] === "b") pc = (pc + 11) % 12;
  if (pc < 0) return 60;
  return (Number(m[3]) + 1) * 12 + pc;
}

export function formatTime(seconds) {
  if (seconds < 0.1) return `${Math.round(seconds * 1000)} ms`;
  return `${seconds.toFixed(2)} s`;
}

export function formatHz(hz) {
  if (hz >= 1000) {
    const k = hz / 1000;
    return `${k >= 10 ? k.toFixed(0) : k.toFixed(1)} kHz`;
  }
  return `${Math.round(hz)} Hz`;
}

export function keyCap(key) {
  if (key === " ") return "Sp";
  return key.length === 1 ? key.toUpperCase() : key;
}

const sub = { wave: "808", attack: 0.005, decay: 0.35, sustain: 0.82, release: 1.2, cutoff: 0.84, resonance: 0.04 };
const stack = { wave: "808", attack: 0.01, decay: 0.22, sustain: 0.52, release: 0.42, cutoff: 0.56, resonance: 0.16 };
const walk = { wave: "808", attack: 0.004, decay: 0.1, sustain: 0.4, release: 0.12, cutoff: 0.86, resonance: 0.04 };
const stab = { wave: "horror", attack: 0.004, decay: 0.11, sustain: 0.16, release: 0.16, cutoff: 0.36, resonance: 0.58 };
const drone = { wave: "horror", attack: 0.32, decay: 0.4, sustain: 0.74, release: 1.5, cutoff: 0.22, resonance: 0.7 };
const bell = { wave: "sine", attack: 0.003, decay: 0.32, sustain: 0, release: 0.22, cutoff: 0.92, resonance: 0.1 };
const organ = { wave: "square", attack: 0.08, decay: 0.2, sustain: 0.68, release: 0.75, cutoff: 0.2, resonance: 0.34 };

export const HITS = [
  { id: "f1", bank: "atlanta", kind: "note", name: "808", symbol: "F1", detail: "F1 sub. Short pitch drop, then a long sine.", tone: sub, notes: [29] },
  { id: "g1", bank: "atlanta", kind: "note", name: "808", symbol: "G1", detail: "G1 sub. A common Atlanta root.", tone: sub, notes: [31] },
  { id: "ab1", bank: "atlanta", kind: "note", name: "808", symbol: "Ab1", detail: "Ab1 sub. Flat-side 808.", tone: sub, notes: [32] },
  { id: "bb1", bank: "atlanta", kind: "note", name: "808", symbol: "Bb1", detail: "Bb1 sub. Heavy and wide.", tone: sub, notes: [34] },
  { id: "c2", bank: "atlanta", kind: "note", name: "808", symbol: "C2", detail: "C2 sub. Center of the rack.", tone: sub, notes: [36] },
  { id: "d1", bank: "atlanta", kind: "note", name: "808", symbol: "D1", detail: "D1 sub. Sits under G minor.", tone: sub, notes: [26] },
  { id: "eb1", bank: "atlanta", kind: "note", name: "808", symbol: "Eb1", detail: "Eb1 sub. The flat third as a bass.", tone: sub, notes: [27] },
  { id: "a1", bank: "atlanta", kind: "note", name: "808", symbol: "A1", detail: "A1 sub. Open, minor-key root.", tone: sub, notes: [33] },
  { id: "fm", bank: "atlanta", kind: "chord", name: "Stack", symbol: "Fm", detail: "F minor over an F1 808. F1 · F3 · Ab3 · C4.", tone: stack, notes: [29, 53, 56, 60] },
  { id: "cm", bank: "atlanta", kind: "chord", name: "Stack", symbol: "Cm", detail: "C minor over a C2 808. C2 · C3 · Eb3 · G3.", tone: stack, notes: [36, 48, 51, 55] },
  { id: "gm", bank: "atlanta", kind: "chord", name: "Stack", symbol: "Gm", detail: "G minor over a G1 808. G1 · G3 · Bb3 · D4.", tone: stack, notes: [31, 55, 58, 62] },
  { id: "am", bank: "atlanta", kind: "chord", name: "Stack", symbol: "Am", detail: "A minor over an A1 808. A1 · A3 · C4 · E4.", tone: stack, notes: [33, 57, 60, 64] },
  { id: "cycle", bank: "atlanta", kind: "loop", name: "Cm · Ab · Eb · Bb", symbol: "Cycle", detail: "i–VI–III–VII in C minor. The Atlanta four-chord loop.", tone: stack, stepMs: 860, gate: 0.82, steps: [[36, 48, 51, 55], [32, 56, 60, 63], [39, 51, 55, 58], [34, 58, 62, 65]] },
  { id: "zone", bank: "atlanta", kind: "loop", name: "Fm · Db · Ab · Eb", symbol: "Zone", detail: "Same cycle, parked in F minor.", tone: stack, stepMs: 860, gate: 0.82, steps: [[29, 53, 56, 60], [25, 49, 53, 56], [32, 56, 60, 63], [27, 51, 55, 58]] },
  { id: "east", bank: "atlanta", kind: "loop", name: "Gm · Eb · Bb · F", symbol: "East", detail: "i–bVI–bIII–bVII in G minor.", tone: stack, stepMs: 860, gate: 0.82, steps: [[31, 55, 58, 62], [27, 51, 55, 58], [34, 58, 62, 65], [29, 53, 57, 60]] },
  { id: "slide", bank: "atlanta", kind: "loop", name: "F minor pentatonic", symbol: "Slide", detail: "F1 Ab1 Bb1 C2 Eb2. A sub walk, no chords.", tone: walk, stepMs: 300, gate: 0.7, steps: [[29], [32], [34], [36], [39], [36], [34], [32]] },
  { id: "drone", bank: "memphis", kind: "note", name: "Saw", symbol: "F#2", detail: "Low F# drone. Slow attack, dark filter.", tone: drone, notes: [42] },
  { id: "bell", bank: "memphis", kind: "note", name: "Sine", symbol: "C#5", detail: "High C# bell. Short decay, no sustain.", tone: bell, notes: [73] },
  { id: "doom", bank: "memphis", kind: "note", name: "Square", symbol: "C2", detail: "Low C, squared off and filtered.", tone: organ, notes: [36] },
  { id: "scream", bank: "memphis", kind: "note", name: "Sine", symbol: "A5", detail: "Thin A5. The music-box register.", tone: bell, notes: [81] },
  { id: "mystic", bank: "memphis", kind: "chord", name: "Triad", symbol: "C#m", detail: "C# minor. Closed stab. C#3 · E3 · G#3.", tone: stab, notes: [49, 52, 56] },
  { id: "six", bank: "memphis", kind: "chord", name: "Triad", symbol: "F#m", detail: "F# minor. The Memphis minor stab. F#3 · A3 · C#4.", tone: stab, notes: [54, 57, 61] },
  { id: "devil", bank: "memphis", kind: "chord", name: "Tritone", symbol: "C+F#", detail: "Tritone. C3 against F#3.", tone: stab, notes: [48, 54] },
  { id: "phrygian", bank: "memphis", kind: "chord", name: "Flat 2", symbol: "Dm(b2)", detail: "D minor with Eb on top. D3 · F3 · A3 · Eb4.", tone: stab, notes: [50, 53, 57, 63] },
  { id: "dim7", bank: "memphis", kind: "chord", name: "Dim 7", symbol: "Cdim7", detail: "C diminished seventh. C · Eb · Gb · A.", tone: stab, notes: [48, 51, 54, 57] },
  { id: "tomb", bank: "memphis", kind: "chord", name: "Closed", symbol: "Fm", detail: "F minor, mid register, no sub. F3 · Ab3 · C4.", tone: stab, notes: [53, 56, 60] },
  { id: "cluster", bank: "memphis", kind: "chord", name: "Minor 2nd", symbol: "C+Db", detail: "Cluster. C4 and Db4.", tone: stab, notes: [60, 61] },
  { id: "flat9", bank: "memphis", kind: "chord", name: "Add b9", symbol: "Cm(b9)", detail: "C minor, flat nine. C3 · Eb3 · G3 · Db4.", tone: stab, notes: [48, 51, 55, 61] },
  { id: "fifth", bank: "memphis", kind: "chord", name: "Organ", symbol: "F#+C#", detail: "Open fifth. F#2 and C#3, square and dull.", tone: organ, notes: [42, 49] },
  { id: "descent", bank: "memphis", kind: "loop", name: "Bm · Bbm · Am · Abm", symbol: "Descent", detail: "Chromatic minor drop. Staccato church stabs.", tone: stab, stepMs: 420, gate: 0.42, steps: [[59, 62, 66], [58, 61, 65], [57, 60, 64], [56, 59, 63]] },
  { id: "box", bank: "memphis", kind: "loop", name: "A G F E D", symbol: "Box", detail: "High A minor fragment. Sine, short, uneasy.", tone: bell, stepMs: 280, gate: 0.46, steps: [[81], [79], [77], [76], [74], [76], [77], [79]] },
];

export function hitsIn(bank, kind) {
  return HITS.filter((h) => h.bank === bank && h.kind === kind);
}

export function hitById(id) {
  if (!id) return undefined;
  return HITS.find((h) => h.id === id);
}

export const DEFAULT_SOURCES = {
  Kick: "Hard Kick",
  Snare: "Sharp Snare",
  Clap: "Dry Clap",
  CHat: "Closed Hat",
  OHat: "Open Hat",
  Perc: "Warped Perc",
  "808": "pit:808",
  Bass: "Juno Bass",
  Synth: "pit:horror",
  Atmos: "Drone Distorted",
  Guitar: "Tremolo Texture",
  Vocal: "Distant",
};

export const DEFAULT_NOTES = {
  Kick: 36,
  Snare: 38,
  Clap: 39,
  CHat: 42,
  OHat: 46,
  Perc: 43,
  "808": 36,
  Bass: 36,
  Synth: 60,
  Atmos: 48,
  Guitar: 52,
  Vocal: 50,
};

export const SOURCE_GROUPS = [
  {
    label: "808 PIT",
    items: [
      { id: "pit:808", label: "PIT 808 sub" },
      { id: "pit:horror", label: "PIT Horror" },
      { id: "pit:sine", label: "PIT Sine" },
      { id: "pit:triangle", label: "PIT Tri" },
      { id: "pit:sawtooth", label: "PIT Saw" },
      { id: "pit:square", label: "PIT Square" },
    ],
  },
  {
    label: "NOCTURNE 808",
    items: ["Deep Clean", "Distorted", "Saturated", "Overdriven Memphis", "Sub-Heavy", "Short Punchy", "House Sub", "Long Sustained", "Dark Verb", "Sliding", "Metallic"].map((name) => ({
      id: `n808:${name}`,
      label: name,
    })),
  },
  {
    label: "Trap drums",
    items: [
      "Hard Kick", "Sub Kick", "Distorted Kick", "Short Punch", "Analog Kick",
      "Sharp Snare", "Memphis Snare", "Metallic Snare", "Verb Snare", "Layered Snare",
      "Dry Clap", "Wide Clap", "Dark Clap", "Industrial Clap",
      "Closed Hat", "Open Hat", "Short Hat", "Metallic Hat", "Noisy Hat",
      "Warped Perc", "Metallic Perc", "Dirty 808",
    ].map((name) => ({ id: name, label: name })),
  },
  {
    label: "Banks",
    items: [
      "Juno Bass", "Cold Pad", "Cold Pluck",
      "Cassette Hiss", "VHS Noise",
      "Deep House Bass", "Dark Bass", "Acid Sweep", "Shaker Loop", "Dark Piano", "Minimal Stab",
      "Drone Distorted", "Tremolo Texture", "Feedback", "Wind Ambience",
      "Distant", "Telephone", "Whisper", "Choir", "Robotic", "Scream Texture", "Deep Voice",
      "Rain", "Wind", "Vinyl", "Electrical Hum", "City Night",
    ].map((name) => ({ id: name, label: name })),
  },
  {
    label: "808 PIT chords",
    items: HITS.filter((h) => h.kind === "chord").map((h) => ({
      id: `chord:${h.id}`,
      label: `${h.symbol} (${h.bank})`,
    })),
  },
];

export function sourceIsPit(source) {
  return typeof source === "string" && source.startsWith("pit:");
}

export function sourceIsN808(source) {
  return typeof source === "string" && source.startsWith("n808:");
}

export function sourceIsChord(source) {
  return typeof source === "string" && source.startsWith("chord:");
}

export function sourceIsMelodic(source) {
  return sourceIsPit(source) || sourceIsN808(source) || sourceIsChord(source);
}

export function pitWaveFromSource(source) {
  if (!sourceIsPit(source)) return null;
  const wave = source.slice(4);
  return WAVE_SET.has(wave) ? wave : "808";
}

export function emptyPattern(length = 32) {
  return TRACKS.map((name) => ({
    source: DEFAULT_SOURCES[name],
    defaultNote: DEFAULT_NOTES[name],
    defaultChord: name === "Synth" ? "mystic" : "cm",
    mute: false,
    solo: false,
    steps: Array.from({ length }, () => ({ on: false, vel: 0.85, note: DEFAULT_NOTES[name], chordId: name === "Synth" ? "mystic" : "cm" })),
  }));
}

export function applyPreset(name, length = 16) {
  const pattern = emptyPattern(32);
  const on = (track, steps, extra = {}) => {
    for (const step of steps) {
      if (step >= 0 && step < 32) {
        pattern[track].steps[step] = {
          ...pattern[track].steps[step],
          on: true,
          vel: 0.88,
          ...extra,
        };
      }
    }
  };
  if (name === "ATLANTA NIGHT") {
    on(0, [0, 4, 8, 12]);
    on(1, [4, 12]);
    on(3, [2, 6, 10, 14]);
    on(6, [0, 7], { note: 36 });
    pattern[6].steps[7].note = 34;
  } else if (name === "MEMPHIS VHS") {
    on(0, [0, 10]);
    on(1, [4]);
    on(5, [3, 7, 11]);
    on(9, [0, 8]);
    on(11, [0, 8]);
    on(8, [0, 8], { chordId: "mystic" });
    pattern[8].source = "chord:mystic";
  } else if (name === "COLD CITY") {
    on(6, [0, 8], { note: 36 });
    on(7, [0, 4, 8, 12]);
    on(8, [2, 6, 10, 14]);
    on(1, [4, 12]);
  } else if (name === "DARK CLUB") {
    on(0, [0, 4, 8, 12]);
    on(3, [2, 6, 10, 14]);
    on(7, [0, 8]);
    on(8, [4, 12]);
  } else if (name === "FROZEN STATIC") {
    on(9, [0, 4, 8, 12]);
    on(10, [0, 8]);
    on(6, [0], { note: 31 });
    on(3, [6, 14]);
  } else if (name === "ABANDONED CLUB") {
    on(0, [0, 4, 8, 12]);
    on(5, [2, 6, 10]);
    on(6, [0, 12], { note: 36 });
    on(9, [0]);
  } else if (name === "NIGHT DRIVE") {
    on(7, [0, 2, 4, 6, 8, 10, 12, 14]);
    on(0, [0, 8]);
    on(3, [2, 6, 10, 14]);
    on(6, [0], { note: 33 });
  } else if (name === "BLACK ICE") {
    on(10, [0, 4, 8, 12]);
    on(8, [0, 8], { chordId: "devil" });
    pattern[8].source = "chord:devil";
    on(6, [0, 7, 14], { note: 36 });
    pattern[6].steps[7].note = 32;
    pattern[6].steps[14].note = 34;
    on(1, [4]);
  }
  if (length !== 32) {
    /* length only affects playback window; pattern stays 32 slots */
  }
  return pattern;
}

export function toggleStep(pattern, track, step, paint = {}) {
  const next = pattern.map((row, i) => {
    if (i !== track) return row;
    const steps = row.steps.map((cell, j) => {
      if (j !== step) return cell;
      if (cell.on && paint.forceOn == null) {
        return { ...cell, on: false };
      }
      return {
        ...cell,
        on: true,
        vel: paint.vel ?? cell.vel,
        note: paint.note ?? cell.note,
        chordId: paint.chordId ?? cell.chordId,
      };
    });
    return { ...row, steps };
  });
  return next;
}

export function nudgeStepVelocity(pattern, track, step, delta = 0.12) {
  return pattern.map((row, i) => {
    if (i !== track) return row;
    const steps = row.steps.map((cell, j) => {
      if (j !== step) return cell;
      return { ...cell, on: true, vel: clamp01((cell.on ? cell.vel : 0.7) + delta) };
    });
    return { ...row, steps };
  });
}

export function setTrackSource(pattern, track, source) {
  return pattern.map((row, i) => (i === track ? { ...row, source } : row));
}

export function clearPattern(pattern) {
  return pattern.map((row) => ({
    ...row,
    steps: row.steps.map((cell) => ({ ...cell, on: false })),
  }));
}

export function randomizePattern(pattern, length = 16) {
  return pattern.map((row, track) => ({
    ...row,
    steps: row.steps.map((cell, step) => {
      if (step >= length) return { ...cell, on: false };
      const chance = track <= 1 ? 0.22 : track <= 5 ? 0.28 : 0.16;
      const on = Math.random() < chance;
      return {
        ...cell,
        on,
        vel: 0.55 + Math.random() * 0.4,
      };
    }),
  }));
}

export function duplicatePattern(pattern, length = 16) {
  const half = Math.max(1, Math.floor(length / 2));
  return pattern.map((row) => ({
    ...row,
    steps: row.steps.map((cell, step) => {
      if (step >= half && step < length) return { ...row.steps[step - half] };
      return cell;
    }),
  }));
}

export function hatDivisionToCount(div) {
  switch (div) {
    case "1/2":
      return 2;
    case "1/4":
      return 4;
    case "1/8":
      return 8;
    case "1/16":
      return 16;
    case "1/32":
      return 32;
    case "trip":
      return 12;
    default:
      return 16;
  }
}

export function majorityOctave(midis) {
  const counts = new Map();
  for (const m of midis) {
    const o = Math.floor(m / 12) - 1;
    counts.set(o, (counts.get(o) ?? 0) + 1);
  }
  let best = 3;
  let score = -1;
  for (const [o, c] of counts) {
    if (c > score || (c === score && o > best)) {
      score = c;
      best = o;
    }
  }
  return Math.min(5, Math.max(1, best));
}

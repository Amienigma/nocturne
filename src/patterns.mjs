// PATTERN LIBRARY: 32 tap-to-load trap grooves, grouped by city. Every groove
// is an original 2-bar sequence written in a regional style (see
// docs/trap-patterns.md); names describe the style, not songs or artists.
// Loading one replaces the section you're editing (undoable): drums, rolls and
// ramps, the 808 line with glides, a synth part, plus tempo and swing.
import { emptyPattern } from "./music.mjs";

export const CITIES = [
  { id: "ATL", label: "ATL", detail: "Atlanta: half-time snare on 3, rolling 16th/32nd hats, long gliding 808s" },
  { id: "MEM", label: "MEM", detail: "Memphis: 808 booms, pitched cowbells, triplet hats, phrygian menace, crunk claps" },
  { id: "HTX", label: "HTX", detail: "Houston: screwed 60-84 BPM, swung slab bounce, chopped stabs, warm organs" },
  { id: "NEW", label: "NEW WAVE", detail: "Modern: rage, drill-adjacent 3-3-2 slides, plugg and pluggnb" },
];

const K = 0, SN = 1, CP = 2, CH = 3, OH = 4, PERC = 5, SUB = 6, SYN = 8;
const SUB_LEVEL = 0.6;

const KITS = {
  ATL: { [K]: "Hard Kick", [SN]: "Sharp Snare", [CP]: "Dry Clap", [CH]: "tr:CH", [OH]: "tr:OH", [PERC]: "tr:RS" },
  DARK: { [K]: "Sub Kick", [SN]: "Layered Snare", [CP]: "Wide Clap", [CH]: "tr:CH", [OH]: "tr:OH", [PERC]: "tr:RS" },
  MEM: { [K]: "tr:BD", [SN]: "Memphis Snare", [CP]: "Dark Clap", [CH]: "tr:CH", [OH]: "tr:OH", [PERC]: "tr:CB" },
  CRUNK: { [K]: "Distorted Kick", [SN]: "Memphis Snare", [CP]: "Industrial Clap", [CH]: "tr:CH", [OH]: "tr:OH", [PERC]: "tr:CB" },
  HTX: { [K]: "Analog Kick", [SN]: "Verb Snare", [CP]: "Wide Clap", [CH]: "Short Hat", [OH]: "Open Hat", [PERC]: "tr:CL" },
  KNOCK: { [K]: "Hard Kick", [SN]: "Layered Snare", [CP]: "Wide Clap", [CH]: "Closed Hat", [OH]: "Open Hat", [PERC]: "tr:CL" },
  RAGE: { [K]: "Distorted Kick", [SN]: "Metallic Snare", [CP]: "Industrial Clap", [CH]: "Metallic Hat", [OH]: "tr:OH", [PERC]: "tr:RS" },
  PLUGG: { [K]: "Short Punch", [SN]: "Sharp Snare", [CP]: "Dry Clap", [CH]: "tr:CH", [OH]: "tr:OH", [PERC]: "tr:RS" },
};

// Drum strings: 32 chars (spaces and | ignored). . off, X 1.0, x 0.85, o 0.6, g 0.4 ghost.
// Roll chars: 2 = 1/32, r = 1/32 louder, 3 = 1/48 pitch up, 4 = 1/64 louder + up,
// 6 = 1/96 louder + up, 8 = 1/128 louder + up, f = 1/64 softer + down,
// t = 1/24 triplet run (3 over 2 steps), T = 1/12 triplet run (3 over 4 steps).
const VEL = { X: 1, x: 0.85, o: 0.6, g: 0.4 };
const ROLL = { 2: [2, 0, 0.55], r: [2, 1, 0.6], 3: [3, 3, 0.6], 4: [4, 5, 0.68], 6: [6, 5, 0.7], 8: [8, 5, 0.74], f: [4, 6, 0.6], t: [1.5, 1, 0.62], T: [0.75, 3, 0.62] };
const SPAN = { t: 2, T: 4 };

export function parseDrums(str) {
  const s = str.replace(/[\s|]/g, "");
  if (s.length !== 32) throw new Error(`drum string must be 32 steps: "${str}" (${s.length})`);
  return [...s];
}

/** Hat line: base (16 | 8 | none) with accents, `at` rolls, `rest` gaps. Triplet runs rest the steps they cover. */
function hatLine({ base = "16", at = {}, rest = [], soft = 1 }) {
  const out = Array.from({ length: 32 }, () => null);
  for (let s = 0; s < 32; s++) {
    if (base === "16") out[s] = [1, 0, (s % 4 === 0 ? 0.82 : s % 2 === 0 ? 0.62 : 0.44) * soft];
    else if (base === "8" && s % 2 === 0) out[s] = [1, 0, (s % 4 === 0 ? 0.8 : 0.58) * soft];
  }
  for (const s of rest) out[s] = null;
  for (const [k, ch] of Object.entries(at)) {
    const s = Number(k);
    out[s] = [...ROLL[ch]];
    out[s][2] *= soft;
    for (let j = 1; j < (SPAN[ch] || 1); j++) if (s + j < 32) out[s + j] = null;
  }
  return out;
}

function build(spec) {
  const p = emptyPattern(32);
  const kit = KITS[spec.kit];
  for (const [t, src] of Object.entries(kit)) p[t].source = src;
  p[SUB].source = spec.sub;
  const hit = (t, s, vel, extra = {}) => {
    p[t].steps[s] = { ...p[t].steps[s], on: true, vel: Math.round(vel * 100) / 100, ...extra };
  };
  const drums = (t, str) => {
    if (!str) return;
    parseDrums(str).forEach((ch, s) => {
      if (ch === ".") return;
      if (VEL[ch]) hit(t, s, VEL[ch]);
      else if (ROLL[ch]) { const [rat, ramp, v] = ROLL[ch]; hit(t, s, Math.min(1, v + 0.25), { rat, ramp }); }
      else throw new Error(`bad drum char ${ch}`);
    });
  };
  // 808: [step, semitones from the root, gate (steps), slide]; the kick doubles non-slide hits unless the spec has its own kick line.
  for (const [s, semi, gate, slide = false] of spec.b) {
    const v = Math.round((slide ? 0.83 : 0.9) * SUB_LEVEL * 100) / 100;
    hit(SUB, s, v, { note: spec.root + semi, gate, slide });
    if (!spec.k && !slide) hit(K, s, s % 16 === 0 ? 1 : 0.88, { gate: 1 });
  }
  drums(K, spec.k);
  drums(SN, spec.s);
  drums(CP, spec.c);
  drums(OH, spec.o);
  drums(PERC, spec.p);
  if (spec.h) {
    hatLine(spec.h).forEach((cell, s) => {
      if (!cell) return;
      const [rat, ramp, vel] = cell;
      hit(CH, s, vel, rat === 1 ? {} : { rat, ramp });
    });
  }
  if (spec.m) {
    p[SYN].source = `syn:${spec.m.preset}`;
    const base = spec.root + 36;
    for (const [s, n, gate, vel = 0.62] of spec.m.notes) {
      const notes = Array.isArray(n) ? n.map((x) => base + x) : null;
      hit(SYN, s, vel, { note: notes ? notes[0] : base + n, gate, ...(notes ? { notes } : {}) });
    }
  }
  return p;
}

const halfTime = "........X.......|........X.......";
const twoFour = "....X.......X...|....X.......X...";
const arp = (seq, every = 2, gate = 1) => Array.from({ length: 32 / every }, (_, i) => [i * every, seq[i % seq.length], gate]);

export const PATTERNS = [
  // ---- ATL ----------------------------------------------------------------
  { id: "atl-church-bounce", city: "ATL", name: "Church Keys Bounce", bpm: 142, swing: 0, root: 31, kit: "ATL", sub: "n808:Deep Clean",
    blurb: "Gospel organ stabs over a bouncy 808 that follows the kick; 16th hats with 1/64 risers into the snare.",
    b: [[0, 0, 3], [3, 0, 2], [6, 7, 2], [8, 0, 2], [11, 3, 3], [14, 5, 2, true], [16, 0, 3], [19, 0, 2], [22, 10, 2], [24, 7, 3], [27, 5, 2], [30, 3, 2, true]],
    s: halfTime, c: halfTime, o: "................|............o...",
    h: { at: { 7: "4", 15: "6", 23: "2", 30: "3", 31: "8" } },
    m: { preset: "organ", notes: [[0, [0, 3, 7], 6], [8, [0, 3, 7], 2], [12, [-4, 0, 3], 4], [16, [-7, -4, 0], 6], [24, [-5, -1, 2], 4], [28, [-4, 0, 3], 4]] } },
  { id: "atl-dark-halftime", city: "ATL", name: "Dark Orchestral Half-Time", bpm: 140, swing: 0, root: 32, kit: "DARK", sub: "n808:Long Sustained",
    blurb: "Sparse, cinematic: two long 808s a bar, 8th hats broken by triplet runs, a minor choir pad and rim ticks.",
    b: [[0, 0, 8], [10, 0, 2], [12, 3, 4, true], [16, -4, 8], [26, -2, 2], [28, 0, 4, true]],
    s: halfTime, c: "................|........x.......", p: ".............g..|.............g..",
    h: { base: "8", at: { 6: "t", 14: "4", 20: "t", 22: "2", 28: "T" } },
    m: { preset: "choir", notes: [[0, [0, 3, 7], 16, 0.55], [16, [-4, 0, 3], 16, 0.55]] } },
  { id: "atl-mafia-rolls", city: "ATL", name: "Rapid-Fire Roll Trap", bpm: 150, swing: 0, root: 29, kit: "ATL", sub: "n808:Saturated",
    blurb: "Hard and busy: 1/32 and 1/64 hat rolls almost every beat, octave-gliding saturated 808, dark bell.",
    b: [[0, 0, 6], [6, 0, 1], [7, 12, 2, true], [10, 0, 2], [12, 3, 2], [14, 5, 2, true], [16, 0, 6], [22, 0, 1], [23, 7, 3, true], [26, 0, 2], [28, 10, 2], [30, 12, 2, true]],
    s: halfTime, c: halfTime,
    h: { at: { 2: "2", 3: "2", 6: "4", 10: "2", 11: "3", 14: "6", 15: "8", 18: "2", 19: "2", 22: "4", 26: "r", 27: "3", 30: "6", 31: "8" } },
    m: { preset: "darkbell", notes: [[0, 12, 2], [3, 15, 2], [6, 19, 2], [8, 17, 2], [16, 12, 2], [19, 15, 2], [22, 20, 2], [24, 19, 4]] } },
  { id: "atl-skippy-bounce", city: "ATL", name: "Skippy Off-Kilter Bounce", bpm: 136, swing: 0, root: 34, kit: "ATL", sub: "n808:Short Punchy",
    blurb: "Off-grid kick/808 skips, hats with gaps and triplet runs, open hats on the and of 4, a plucky hook.",
    b: [[0, 0, 2], [3, 0, 1], [5, 7, 2], [9, 0, 1], [11, 3, 2, true], [14, 0, 2], [16, 0, 2], [19, 0, 1], [21, 10, 2], [25, 0, 1], [27, 7, 2, true], [30, 5, 2, true]],
    s: halfTime, c: "........X.......|........X......g", o: "............o...|............o...",
    h: { rest: [5, 13, 21, 29], at: { 6: "t", 15: "4", 22: "t", 31: "6" } },
    m: { preset: "pluck", notes: [[0, 7, 1], [2, 10, 1], [4, 12, 1], [6, 10, 1], [16, 7, 1], [18, 10, 1], [20, 15, 1], [22, 12, 1]] } },
  { id: "atl-straight-16", city: "ATL", name: "Straight 16ths Trap", bpm: 140, swing: 0, root: 33, kit: "ATL", sub: "n808:Long Sustained",
    blurb: "The textbook grid: kick/808 on 1, 2a and 3&, snare + clap on 3, steady 16ths, a 1/32-1/96 roll into bar 3.",
    b: [[0, 0, 6], [7, 0, 2], [10, 3, 5], [16, 0, 8], [26, -2, 3], [29, 0, 3, true]],
    s: halfTime, c: halfTime, o: "................|.....o..........",
    h: { at: { 15: "2", 28: "2", 29: "r", 30: "4", 31: "6" } },
    m: { preset: "keys", notes: [[0, [0, 3, 7], 8, 0.5], [8, [-2, 2, 5], 8, 0.5], [16, [-4, 0, 3], 8, 0.5], [24, [-5, -2, 2], 8, 0.5]] } },
  { id: "atl-triplet-flow", city: "ATL", name: "Triplet Flow", bpm: 144, swing: 0, root: 30, kit: "ATL", sub: "n808:Sliding",
    blurb: "Hats ride 1/24 triplet runs for whole beats; the sliding 808 lands in the gaps; airy flute line.",
    b: [[0, 0, 4], [5, 0, 1], [6, 7, 3, true], [10, 0, 2], [12, 5, 4], [16, 0, 4], [21, 0, 1], [22, 10, 3, true], [26, 7, 2], [28, 3, 4, true]],
    s: halfTime, c: halfTime, p: "...g............|...g............",
    h: { base: "8", at: { 0: "t", 2: "t", 8: "t", 10: "t", 12: "4", 16: "t", 18: "t", 24: "t", 26: "t", 28: "T" } },
    m: { preset: "flute", notes: [[0, 12, 3], [4, 10, 2], [6, 7, 2], [10, 5, 2], [16, 12, 3], [20, 15, 2], [22, 12, 2], [26, 10, 4]] } },
  { id: "atl-stutter-kick", city: "ATL", name: "Stutter Kick", bpm: 148, swing: 0, root: 29, kit: "ATL", sub: "n808:Distorted",
    blurb: "Its own kick line with a 1/32 kick stutter, a distorted 808 on a separate rhythm, snare roll into the turn.",
    k: "X..x..x...X.x...|X..x..x...x.2...",
    b: [[0, 0, 3], [3, 0, 3], [6, 3, 4], [10, 0, 2], [12, -2, 4, true], [16, 0, 3], [19, 0, 3], [22, 5, 4], [26, 3, 2], [28, 0, 4, true]],
    s: "........X.......|........X......4", c: halfTime,
    h: { at: { 7: "2", 14: "3", 15: "4", 23: "2", 30: "6" } },
    m: { preset: "darkbell", notes: [[0, 19, 2], [8, 15, 2], [16, 17, 2], [24, 12, 4]] } },
  { id: "atl-snap-bounce", city: "ATL", name: "Snap Bounce", bpm: 78, swing: 8, root: 31, kit: "ATL", sub: "n808:Deep Clean",
    blurb: "Mid-2000s snap feel at 78 BPM: finger-snap claps on 2 and 4, a roomy 808, clave ticks, sparse keys.",
    b: [[0, 0, 4], [6, 0, 2], [10, 7, 2], [16, 0, 4], [22, 0, 2], [26, 5, 2], [30, 3, 2, true]],
    c: twoFour, p: ".......g........|.......g........",
    h: { base: "8", soft: 0.8, at: { 15: "2", 31: "3" } },
    m: { preset: "keys", notes: [[0, [12, 15, 19], 2], [14, [10, 14, 17], 2], [16, [12, 15, 19], 2], [30, [8, 12, 15], 2]] } },
  { id: "atl-ambient-space", city: "ATL", name: "Ambient Space Trap", bpm: 132, swing: 0, root: 32, kit: "DARK", sub: "n808:Dark Verb",
    blurb: "Psychedelic and wide: bar-long 808s with slides, reverb snare, broken 8th hats, a 7th-chord choir.",
    b: [[0, 0, 12], [14, 3, 2, true], [16, -4, 12], [30, -2, 2, true]],
    s: halfTime, c: "................|........o.......", o: "....o...........|....o...........",
    h: { base: "8", soft: 0.85, rest: [6, 22], at: { 14: "t", 30: "4", 31: "8" } },
    m: { preset: "choir", notes: [[0, [0, 3, 7, 10], 16, 0.5], [16, [-4, 0, 3, 7], 16, 0.5]] } },
  { id: "atl-melodic-pluck", city: "ATL", name: "Melodic Pluck Bounce", bpm: 150, swing: 0, root: 32, kit: "PLUGG", sub: "n808:Saturated",
    blurb: "The 808 carries the melody with octave slides; triplet hat runs; a fast arpeggiated pluck on top.",
    b: [[0, 0, 4], [4, 12, 2, true], [6, 0, 2], [10, 7, 2], [12, 5, 2, true], [14, 3, 2, true], [16, 0, 4], [20, 12, 2, true], [22, 0, 2], [26, 10, 2], [28, 7, 4, true]],
    s: halfTime, c: halfTime,
    h: { rest: [5, 21], at: { 4: "t", 11: "2", 15: "6", 20: "t", 27: "2", 31: "8" } },
    m: { preset: "pluck", notes: [[0, 12, 1], [2, 15, 1], [3, 19, 1], [6, 17, 1], [8, 15, 1], [10, 12, 1], [16, 12, 1], [18, 15, 1], [19, 20, 1], [22, 19, 1], [24, 17, 1], [26, 15, 1]] } },
  // ---- MEM ----------------------------------------------------------------
  { id: "mem-phonk-cowbell", city: "MEM", name: "Phonk Cowbell", bpm: 130, swing: 0, root: 29, kit: "MEM", sub: "n808:Overdriven Memphis",
    blurb: "A pitched-cowbell melody with a phrygian b2, 808 boom kicks, one or two long overdriven 808s per loop, ticking hats with off-beat rolls.",
    k: "X.....x...x.....|X.....x...x..x..",
    b: [[0, 0, 16], [16, -2, 8], [24, 0, 8]],
    s: halfTime,
    h: { at: { 3: "3", 11: "T", 19: "2", 27: "T" } },
    m: { preset: "cowbell", notes: [[0, 12, 1], [2, 12, 1], [3, 15, 1], [6, 12, 1], [8, 10, 1], [10, 8, 2], [12, 7, 2], [16, 12, 1], [18, 12, 1], [19, 15, 1], [22, 17, 1], [24, 15, 1], [26, 13, 2], [28, 12, 2]] } },
  { id: "mem-triplet-gallop", city: "MEM", name: "Triplet Gallop", bpm: 136, swing: 0, root: 31, kit: "MEM", sub: "n808:Overdriven Memphis",
    blurb: "Non-stop 8th-note triplet hats, an 808 that leans on the flat second, cowbell accents and horror strings (i-bII).",
    b: [[0, 0, 3], [3, 0, 1], [6, 3, 2], [10, 0, 4], [16, 0, 3], [19, 0, 1], [22, -2, 2], [26, 1, 4]],
    s: halfTime, c: "........o.......|........o.......", p: "..............o.|..............o.",
    h: { base: "none", at: { 0: "T", 4: "T", 8: "T", 12: "T", 16: "T", 20: "T", 24: "T", 28: "T" } },
    m: { preset: "horrorstr", notes: [[0, [0, 3, 7], 16, 0.5], [16, [1, 5, 8], 16, 0.5]] } },
  { id: "mem-bounce-knock", city: "MEM", name: "Bounce Knock", bpm: 156, swing: 0, root: 34, kit: "CRUNK", sub: "n808:Short Punchy",
    blurb: "Fast and bouncy: syncopated punchy 808 under every kick, 8th hats, open hats on the e of 2, a piano-like keys hook.",
    b: [[0, 0, 2], [3, 0, 2], [6, 0, 1], [7, 7, 2], [10, 0, 2], [13, 3, 2], [16, 0, 2], [19, 0, 2], [22, 0, 1], [23, 10, 2], [26, 5, 2], [29, 3, 3, true]],
    s: halfTime, c: halfTime, o: "......o.........|......o.........",
    h: { base: "8", at: { 7: "2", 15: "4", 23: "2", 30: "3", 31: "6" } },
    m: { preset: "keys", notes: [[0, 12, 2], [2, 15, 2], [4, 17, 2], [6, 15, 2], [8, 10, 4], [16, 12, 2], [18, 15, 2], [20, 19, 2], [22, 17, 2], [24, 15, 4]] } },
  { id: "mem-horror-crawl", city: "MEM", name: "Horrorcore Crawl", bpm: 72, swing: 0, root: 31, kit: "MEM", sub: "n808:Overdriven Memphis",
    blurb: "72 BPM with the snare on 2 and 4, 16th hats that feel double-time, diminished horror strings, clave bells.",
    b: [[0, 0, 4], [7, 0, 2], [10, 1, 4], [16, 0, 4], [23, 0, 2], [26, -1, 4]],
    s: twoFour, p: "......g.........|......g.........",
    h: { soft: 0.75, at: { 3: "2", 7: "2", 11: "3", 15: "4", 19: "2", 23: "2", 27: "3", 31: "6" } },
    m: { preset: "horrorstr", notes: [[0, [0, 3, 6], 16, 0.5], [16, [-1, 3, 6], 16, 0.5]] } },
  { id: "mem-buck-crunk", city: "MEM", name: "Buck Crunk Stomp", bpm: 78, swing: 0, root: 29, kit: "CRUNK", sub: "n808:Distorted",
    blurb: "Crunk at 78 BPM: stacked claps and snare on 2 and 4, distorted 808 kicks, cowbell off-beats, detuned-saw power stabs.",
    b: [[0, 0, 2], [3, 0, 1], [6, 0, 2], [10, 0, 2], [14, 3, 2], [16, 0, 2], [19, 0, 1], [22, 0, 2], [26, 5, 2], [30, 3, 2]],
    s: "....x.......x...|....x.......x...", c: twoFour, p: "..o.......o.....|..o.......o.....",
    h: { base: "8", at: { 15: "2", 31: "4" } },
    m: { preset: "memsaw", notes: [[0, [0, 7, 12], 2], [6, [0, 7, 12], 1], [10, [1, 8, 13], 2], [16, [0, 7, 12], 2], [22, [0, 7, 12], 1], [26, [-2, 5, 10], 2]] } },
  { id: "mem-gangsta-walk", city: "MEM", name: "Gangsta Walk", bpm: 72, swing: 0, root: 31, kit: "MEM", sub: "n808:Sub-Heavy",
    blurb: "A walking 72 BPM groove: syncopated 808 boom kicks, clap + snare on 2 and 4, off-beat pitched cowbell.",
    k: "X..x..X...x..x..|X..x..X...x.x.x.",
    b: [[0, 0, 6], [6, 0, 4], [10, 3, 3], [13, 5, 3], [16, 0, 6], [22, 0, 4], [26, -2, 3], [29, 0, 3, true]],
    s: twoFour, c: twoFour,
    h: { soft: 0.8, at: { 7: "2", 15: "3", 23: "2", 31: "4" } },
    m: { preset: "cowbell", notes: [[2, 12, 1], [6, 12, 1], [10, 15, 1], [14, 12, 1], [18, 12, 1], [22, 10, 1], [26, 8, 1], [30, 7, 1]] } },
  { id: "mem-rattle-snare", city: "MEM", name: "Rattle Snare Phonk", bpm: 132, swing: 0, root: 29, kit: "MEM", sub: "n808:Overdriven Memphis",
    blurb: "Snare rattles (1/32-1/96) at the turns, triplet hat runs, overdriven 808 resolving to the b2, cowbell riff.",
    b: [[0, 0, 4], [6, 0, 2], [10, 0, 2], [12, 3, 4], [16, 0, 4], [22, 0, 2], [26, -2, 2], [28, 1, 4]],
    s: "........X.....2.|........X.....46", c: halfTime,
    h: { at: { 3: "T", 19: "T", 27: "2" } },
    m: { preset: "cowbell", notes: [[0, 12, 1], [1, 12, 1], [3, 10, 1], [6, 8, 2], [8, 7, 2], [12, 8, 2], [16, 12, 1], [17, 12, 1], [19, 13, 1], [22, 12, 2], [24, 10, 2], [28, 8, 2]] } },
  { id: "mem-pitched-kick", city: "MEM", name: "Pitched-Kick Bassline", bpm: 128, swing: 0, root: 29, kit: "MEM", sub: "n808:Short Punchy",
    blurb: "Old drum-machine trick: short 808 kicks tuned into a whole bassline, plain kick only on the 1, long clave bell.",
    k: "X...............|X...............",
    b: [[0, 0, 2], [2, 0, 1], [3, 12, 1], [6, 0, 2], [8, 3, 1], [10, 5, 2], [12, 7, 1], [14, 5, 2], [16, 0, 2], [18, 0, 1], [19, 12, 1], [22, 0, 2], [24, 10, 1], [26, 8, 2], [28, 7, 1], [30, 5, 2]],
    s: halfTime, p: "....o...........|....o...........",
    h: { base: "8", at: { 11: "3", 27: "3" } },
    m: { preset: "darkbell", notes: [[0, 12, 4], [16, 10, 4]] } },
  // ---- HTX ----------------------------------------------------------------
  { id: "htx-screwed-crawl", city: "HTX", name: "Screwed Slab Crawl", bpm: 68, swing: 12, root: 31, kit: "HTX", sub: "n808:Long Sustained",
    blurb: "Screw-tempo 68 BPM, swung: reverb snare on 2 and 4, lazy 8th hats, long 808s, warm slab-synth chords.",
    b: [[0, 0, 6], [7, 0, 2], [10, 5, 6], [16, 0, 6], [23, 0, 2], [26, 3, 4], [30, 5, 2, true]],
    s: twoFour, c: "............x...|............x...",
    h: { base: "8", soft: 0.8, at: { 14: "2", 30: "3" } },
    m: { preset: "slabsyn", notes: [[0, [0, 3, 7], 6, 0.55], [10, [5, 8, 12], 6, 0.55], [16, [0, 3, 7], 6, 0.55], [26, [3, 7, 10], 6, 0.55]] } },
  { id: "htx-chopped-stutter", city: "HTX", name: "Chopped Stutter", bpm: 70, swing: 8, root: 33, kit: "HTX", sub: "n808:Long Sustained",
    blurb: "Chop-style repeats: kick and snare stutter at the turn, chord stabs doubled like a crossfader chop.",
    k: "X......x..X.....|X......x..X.2.2.",
    b: [[0, 0, 7], [7, 0, 3], [10, 3, 6], [16, 0, 7], [23, 0, 3], [26, -2, 6]],
    s: "....X.......X...|....X.......X.4.", c: twoFour,
    h: { base: "8", at: { 15: "2", 29: "2" } },
    m: { preset: "chopstab", notes: [[0, [0, 3, 7], 2], [2, [0, 3, 7], 0.5], [3, [0, 3, 7], 0.5], [6, [0, 3, 7], 1], [16, [-4, 0, 3], 2], [18, [-4, 0, 3], 0.5], [19, [-4, 0, 3], 0.5], [22, [-2, 2, 5], 1]] } },
  { id: "htx-swang-bounce", city: "HTX", name: "Swang Bounce", bpm: 76, swing: 18, root: 33, kit: "KNOCK", sub: "n808:Deep Clean",
    blurb: "Heavily swung 76 BPM bounce: funky walking 808, clap + snare on 2 and 4, open-hat lifts, dorian organ.",
    b: [[0, 0, 3], [3, 0, 1], [6, 7, 2], [8, 10, 2], [10, 12, 2], [14, 10, 2, true], [16, 0, 3], [19, 0, 1], [22, 7, 2], [24, 5, 2], [26, 3, 2], [28, 0, 4, true]],
    s: twoFour, c: twoFour, o: "..............o.|..............o.",
    h: { soft: 0.85, at: { 15: "2", 31: "3" } },
    m: { preset: "organ", notes: [[0, [0, 3, 7], 4], [8, [5, 9, 12], 4], [16, [0, 3, 7], 4], [24, [3, 7, 10], 4]] } },
  { id: "htx-third-coast-funk", city: "HTX", name: "Third Coast Funk", bpm: 84, swing: 14, root: 29, kit: "KNOCK", sub: "n808:Saturated",
    blurb: "Funk-rooted 84 BPM: its own syncopated kick, saturated 808 walk, brass stabs, open hats on the off-beats.",
    k: "X.....x.X.x.....|X.....x...x..x..",
    b: [[0, 0, 6], [6, 0, 2], [8, 3, 2], [10, 5, 4], [16, 0, 6], [22, 7, 2], [26, 5, 2], [29, 3, 3, true]],
    s: twoFour, o: "..........o.....|..........o.....",
    h: { at: { 31: "2" } },
    m: { preset: "brass", notes: [[0, [0, 4, 7], 2], [3, [0, 4, 7], 1], [14, [-2, 2, 5], 2], [16, [0, 4, 7], 2], [19, [0, 4, 7], 1], [30, [3, 7, 10], 2]] } },
  { id: "htx-candy-cruise", city: "HTX", name: "Candy Paint Cruise", bpm: 72, swing: 10, root: 34, kit: "HTX", sub: "n808:Sliding",
    blurb: "Slow cruise: 808 glides between long notes, laid-back reverb snare, a singing slab-synth lead.",
    b: [[0, 0, 8], [8, 5, 4, true], [12, 3, 4, true], [16, 0, 8], [24, -2, 4, true], [28, 0, 4, true]],
    s: twoFour, c: "............x...|............x...", o: "................|..............o.",
    h: { base: "8", at: { 7: "3", 23: "3" } },
    m: { preset: "slabsyn", notes: [[0, 12, 3], [3, 15, 2], [6, 17, 4], [12, 15, 2], [14, 12, 2], [16, 10, 4], [20, 12, 2], [22, 15, 4], [28, 12, 4]] } },
  { id: "htx-purple-drag", city: "HTX", name: "Purple Drag", bpm: 62, swing: 6, root: 32, kit: "HTX", sub: "n808:Dark Verb",
    blurb: "The slowest groove: 62 BPM half-time, so the snare lands once a bar; 1/32 rolls crawl; a dark choir drifts.",
    b: [[0, 0, 10], [10, -2, 4, true], [16, -4, 10], [26, -2, 4], [30, 0, 2, true]],
    s: halfTime, c: "........o.......|........o.......",
    h: { soft: 0.7, at: { 7: "2", 15: "3", 23: "2", 31: "4" } },
    m: { preset: "choir", notes: [[0, [0, 3, 7], 16, 0.5], [16, [-4, 0, 3], 16, 0.5]] } },
  { id: "htx-northside-knock", city: "HTX", name: "Northside Knock", bpm: 80, swing: 6, root: 31, kit: "KNOCK", sub: "n808:Short Punchy",
    blurb: "Harder 80 BPM knock: punchy 808 on every kick, layered snare on 2 and 4, open hats on the a of 2, keys chords.",
    b: [[0, 0, 2], [2, 0, 1], [6, 0, 2], [9, 3, 2], [11, 5, 2], [16, 0, 2], [18, 0, 1], [22, 0, 2], [25, 7, 2], [27, 5, 3, true], [30, 3, 2]],
    s: twoFour, c: "............x...|............x...", o: ".......o........|.......o........",
    h: { at: { 15: "2", 31: "3" } },
    m: { preset: "keys", notes: [[0, [12, 15, 19], 2], [6, [12, 15, 19], 2], [9, [10, 15, 19], 2], [16, [8, 12, 15], 2], [22, [8, 12, 15], 2], [25, [10, 14, 17], 2]] } },
  { id: "htx-slowed-chop", city: "HTX", name: "Slowed & Throwed Chop", bpm: 66, swing: 12, root: 33, kit: "HTX", sub: "n808:Long Sustained",
    blurb: "66 BPM with chopped repeats on the hats, snare and stabs, like two copies of one record a beat apart.",
    k: "X.......X.x.....|X..x....X.....x.",
    b: [[0, 0, 8], [8, 0, 2], [10, 3, 6], [16, 0, 3], [19, 0, 5], [24, -2, 6], [30, 0, 2, true]],
    s: "....X.......X...|....X.......2...", c: twoFour,
    h: { base: "8", at: { 14: "2", 15: "2", 30: "3", 31: "3" } },
    m: { preset: "chopstab", notes: [[0, [0, 3, 7], 1], [1, [0, 3, 7], 0.5], [2, [0, 3, 7], 1], [8, [0, 3, 7], 2], [16, [3, 7, 10], 1], [17, [3, 7, 10], 0.5], [18, [3, 7, 10], 1], [24, [-2, 3, 7], 2]] } },
  // ---- NEW WAVE -------------------------------------------------------------
  { id: "new-rage-stomp", city: "NEW", name: "Rage Synth Stomp", bpm: 160, swing: 0, root: 32, kit: "RAGE", sub: "n808:Distorted",
    blurb: "160 BPM rage: distorted 808 with octave flicks, a kick on every hit, 1/64-1/128 risers, wide supersaw chords.",
    b: [[0, 0, 2], [2, 12, 1, true], [3, 0, 2], [6, 0, 1], [7, 7, 2], [10, 0, 2], [12, 10, 1, true], [13, 0, 2], [16, 0, 2], [18, 12, 1, true], [19, 0, 2], [22, 0, 1], [23, 3, 2], [26, 5, 2], [28, 7, 2, true], [30, 12, 2, true]],
    s: halfTime, c: "........X.......|........X.....g.", o: "....o...........|....o...........",
    h: { at: { 14: "4", 15: "6", 30: "4", 31: "8" } },
    m: { preset: "ragelead", notes: [[0, [12, 15, 19], 3, 0.55], [4, [12, 15, 19], 2, 0.5], [8, [10, 14, 17], 3, 0.55], [12, [8, 12, 15], 3, 0.55], [16, [12, 15, 19], 3, 0.55], [20, [12, 15, 19], 2, 0.5], [24, [15, 19, 22], 3, 0.55], [28, [14, 17, 22], 3, 0.55]] } },
  { id: "new-rage-bounce", city: "NEW", name: "Distorted Rage Bounce", bpm: 150, swing: 0, root: 30, kit: "RAGE", sub: "n808:Distorted",
    blurb: "Off-beat octave jumps in a distorted 808, stacked 1/64 + 1/96 hat risers, a constant 8th-note arp lead.",
    b: [[0, 0, 2], [3, 12, 1, true], [4, 0, 2, true], [7, 0, 1], [10, 3, 2], [11, 15, 1, true], [12, 3, 2, true], [16, 0, 2], [19, 12, 1, true], [20, 0, 2, true], [23, 0, 1], [26, 5, 2], [27, 17, 1, true], [28, 7, 4, true]],
    s: halfTime, c: halfTime,
    h: { at: { 4: "T", 13: "2", 14: "4", 15: "6", 20: "t", 22: "4", 23: "6", 30: "4", 31: "8" } },
    m: { preset: "arplead", notes: arp([12, 19, 15, 22]) } },
  { id: "new-drill-slide", city: "NEW", name: "Sliding Drill-Adjacent", bpm: 142, swing: 0, root: 31, kit: "DARK", sub: "n808:Sliding",
    blurb: "3-3-2 hat groupings, the 808 landing late and gliding into almost every note, its own sparse kick, dark bell.",
    k: "X.........x.....|X.....x....x....",
    b: [[0, 0, 3], [3, 0, 1], [6, 7, 3, true], [11, 5, 3, true], [14, 3, 2, true], [16, 0, 3], [22, 10, 3, true], [27, 7, 3, true], [30, 5, 2, true]],
    s: "........X.......|........X.....g.",
    h: { base: "none", at: {} }, hx: "x..x..x.x..x..x.|x..x..x.x..t..4.",
    m: { preset: "darkbell", notes: [[0, 15, 2], [2, 14, 2], [4, 12, 4], [16, 15, 2], [18, 17, 2], [20, 19, 4]] } },
  { id: "new-plugg-dream", city: "NEW", name: "Dreamy Plugg", bpm: 150, swing: 0, root: 33, kit: "PLUGG", sub: "n808:Deep Clean",
    blurb: "Bright, bouncy plugg: clean 808 walking a major-ish line, 16th hats with triplet runs, soft glassy bell chords.",
    b: [[0, 0, 3], [3, 0, 1], [4, 7, 2], [6, 0, 2], [10, 9, 2], [12, 7, 2], [14, 4, 2], [16, 5, 3], [19, 5, 1], [20, 12, 2], [22, 5, 2], [26, 4, 2], [28, 2, 4, true]],
    s: halfTime, c: halfTime,
    h: { at: { 6: "t", 15: "2", 22: "t", 31: "4" } },
    m: { preset: "pluggbell", notes: [[0, [12, 16, 19], 2], [3, [12, 16, 19], 1], [6, [11, 14, 19], 2], [8, [9, 12, 16], 4], [16, [9, 12, 17], 2], [19, [9, 12, 17], 1], [22, [7, 11, 14], 2], [24, [7, 12, 16], 4]] } },
  { id: "new-pluggnb-glide", city: "NEW", name: "Pluggnb Glide", bpm: 145, swing: 0, root: 32, kit: "PLUGG", sub: "n808:Sliding",
    blurb: "Soft R&B-leaning plugg: maj7 keys (I-vi-IV-V), a gliding 808 melody, hats with gaps and small rolls.",
    b: [[0, 0, 4], [4, 7, 2, true], [6, 0, 2], [10, 12, 2, true], [12, 10, 2, true], [14, 7, 2, true], [16, 5, 4], [20, 12, 2, true], [22, 5, 2], [26, 3, 2], [28, 2, 4, true]],
    s: halfTime, c: halfTime,
    h: { rest: [3, 11, 19, 27], at: { 7: "2", 15: "3", 23: "2", 31: "6" } },
    m: { preset: "keys", notes: [[0, [0, 4, 7, 11], 8, 0.5], [8, [-3, 0, 4, 7], 8, 0.5], [16, [-7, -3, 0, 4], 8, 0.5], [24, [-5, -1, 2, 5], 8, 0.5]] } },
  { id: "new-hyper-trap", city: "NEW", name: "Hyper Trap", bpm: 165, swing: 0, root: 29, kit: "RAGE", sub: "n808:Saturated",
    blurb: "165 BPM and relentless: a roll on nearly every off-beat, ghost snares, a saturated 808 and a 16th arp.",
    b: [[0, 0, 2], [3, 0, 2], [6, 12, 2, true], [8, 0, 1], [10, 3, 2], [12, 5, 2], [14, 7, 2, true], [16, 0, 2], [19, 0, 2], [22, 10, 2, true], [24, 0, 1], [26, 8, 2], [28, 7, 2], [30, 12, 2, true]],
    s: "........X......g|........X......g", c: halfTime,
    h: { at: { 2: "2", 3: "4", 6: "2", 7: "6", 10: "2", 11: "4", 14: "6", 15: "8", 18: "2", 19: "4", 22: "2", 23: "6", 26: "2", 27: "4", 30: "6", 31: "8" } },
    m: { preset: "arplead", notes: arp([12, 7, 3, 7, 12, 10, 7, 3, 12, 8, 3, 8, 15, 12, 10, 7]) } },
];

// Explicit hat strings (hx) override the generated hat line.
for (const spec of PATTERNS) {
  if (spec.hx) spec.h = null;
}

const BY_ID = new Map(PATTERNS.map((p) => [p.id, p]));
export const patternById = (id) => BY_ID.get(id) || null;
export const patternsIn = (city) => PATTERNS.filter((p) => p.city === city);

/** A fresh 32-step pattern (12 tracks) for library entry `id`. */
export function buildPattern(id) {
  const spec = patternById(id);
  if (!spec) return null;
  const p = build(spec);
  if (spec.hx) {
    parseDrums(spec.hx).forEach((ch, s) => {
      if (ch === ".") return;
      const cell = VEL[ch] ? { vel: VEL[ch] * 0.75 } : { vel: Math.min(1, ROLL[ch][2] + 0.1), rat: ROLL[ch][0], ramp: ROLL[ch][1] };
      p[CH].steps[s] = { ...p[CH].steps[s], on: true, ...cell };
    });
  }
  return p;
}

/** Everything a library tap changes: the section pattern plus tempo and swing (global). */
export function loadPatternInto(state, id) {
  const spec = patternById(id);
  const pattern = buildPattern(id);
  if (!spec || !pattern) return false;
  state.banks[state.bank] = pattern;
  state.bpm = spec.bpm;
  state.swing = spec.swing;
  if (state.length < 32) state.length = 32; // library grooves are 2 bars
  return true;
}

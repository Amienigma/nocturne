// Classic 808 default sections. A fresh session (nothing autosaved, no
// share link) loads these four original, trap-style 2-bar grooves so every
// section plays a real 808 the moment you press play. Saved beats are never
// touched; LOAD CLASSIC 808 brings them back on demand (undoable).
import { TRACKS, emptyPattern } from "./music.mjs";
import { defaultMix, defaultMetronome, withPatternAlias, STATE_VERSION } from "./state-io.mjs";
import { DEFAULT_PATCH } from "./music.mjs";

export const CLASSIC_BPM = 145; // modern trap tempo (half-time feel: snare on beat 3)
export const CLASSIC_SWING = 0; // trap is straight
export const CLASSIC_LENGTH = 32; // 2 bars, so the 808 line moves
export const CLASSIC_CHAIN = [0, 0, 1, 0, 2, 3]; // A A B A C D

// Track slots used by the classic kit (row names stay the app's 12 tracks).
const SUB_LEVEL = 0.6;
// Lines below are written in F minor and transposed up to Ab minor (root Ab1 =
// 51.9 Hz), which keeps the 808 fundamental well clear of the 30 Hz floor.
const KEY = 3;
const K = 0, SN = 1, CP = 2, CH = 3, OH = 4, PERC = 5, SUB = 6, TOM = 7, BELL = 8;
export const CLASSIC_KIT = {
  [K]: "tr:BD", [SN]: "tr:SD", [CP]: "tr:CP", [CH]: "tr:CH", [OH]: "tr:OH", [PERC]: "tr:RS",
  [SUB]: "n808:Saturated", [TOM]: "tr:TOM", [BELL]: "pit:sine",
};

export const CLASSIC_SECTIONS = [
  { name: "TRAP", blurb: "Pi'erre/Metro-era trap in Ab minor: rolling hats (1/24 triplet runs, 1/32-1/128 stutters ramping up in pitch and volume into every snare and bar end), long saturated 808 carrying the melody with octave slides, short kick on every 808 hit, snare + clap on beat 3, dark sine bell" },
  { name: "RAGE", blurb: "Harder, bouncier Carti-style rage: distorted 808 jumping octaves on the offbeats, 16th hats with 1/12 triplet runs and stacked 1/64-1/128 risers, double clap" },
  { name: "DARK", blurb: "21 Savage/Metro-style stripped breakdown: two long 1-bar 808 notes, sparse kick, rim, quiet triplet hats, bell" },
  { name: "FILL", blurb: "Transition: one trap bar, then high-mid-low 808 toms, a snare roll from 1/32 to 1/96 and an 808 slide up into A" },
];

function kitPattern() {
  const p = emptyPattern(32);
  for (const [t, src] of Object.entries(CLASSIC_KIT)) p[t].source = src;
  return p;
}

// hit(track, step, vel, extra) sets one step on.
function builder() {
  const p = kitPattern();
  const hit = (t, s, vel = 0.9, extra = {}) => {
    p[t].steps[s] = { ...p[t].steps[s], on: true, vel, ...extra };
  };
  // 808 line: [step, midi, gate (steps), slide?]; the kick doubles every non-slide hit.
  const bass = (notes, vel = 0.9, kick = true) => {
    for (const [s, note, gate, slide = false] of notes) {
      // The saturated 808 carries far more energy than the drums: sit it at ~60%
      // so the groove peaks near -6 dBFS before the safety stage.
      const v = Math.round((slide ? vel * 0.92 : vel) * SUB_LEVEL * 100) / 100;
      hit(SUB, s, v, { note: note + KEY, gate, slide });
      if (kick && !slide) hit(K, s, s % 16 === 0 ? 1 : 0.88, { gate: 1 });
    }
  };
  // Constant 16ths with accents (beat 0.82, 8th 0.62, 16th 0.44), minus `skip`.
  const hats16 = (skip = []) => {
    for (let s = 0; s < 32; s++) {
      if (skip.includes(s)) continue;
      hit(CH, s, s % 4 === 0 ? 0.82 : s % 2 === 0 ? 0.62 : 0.44);
    }
  };
  // Rolling hats: constant 16ths plus rolls. `rolls` maps step -> [rat, ramp, vel]
  // (ramp: 1 louder, 3 pitch up, 4 pitch down, 5 louder + pitch up, 6 softer +
  // pitch down); `rest` steps are left empty so triplet runs can breathe.
  const rollingHats = (rolls, rest = []) => {
    hats16(rest);
    for (const [s, [rat, ramp, vel]] of Object.entries(rolls)) hit(CH, Number(s), vel, { rat, ramp });
  };
  return { p, hit, bass, hats16, rollingHats };
}

// Written in F minor (F1 29, Ab1 32, Bb1 34, C2 36, Eb2 39, F2 41); played +KEY.
function trap() {
  const { p, hit, bass, rollingHats } = builder();
  bass([
    [0, 29, 8], [7, 29, 2], [10, 36, 4, true], [14, 39, 2, true],
    [16, 32, 8], [23, 34, 2], [26, 41, 2, true], [28, 29, 4, true],
  ]);
  for (const s of [8, 24]) { hit(SN, s, 0.95); hit(CP, s, 0.85); }
  // The signature: Pi'erre-style rolling hats. 1/24 triplet runs, 1/32 and
  // 1/64 stutters that rise in pitch and volume into each snare, and a 1/128
  // riser at the end of the 2 bars. (Rolls get softer/lower on the way out.)
  rollingHats({
    4: [1.5, 1, 0.62], // 1/24 triplet run, getting louder (step 5 rests)
    7: [4, 5, 0.7], // 1/64 into the snare, louder + pitch up
    11: [2, 0, 0.5], // 1/32 stutter
    14: [4, 3, 0.66], // 1/64, pitch up
    15: [6, 5, 0.7], // 1/96 bar-end riser
    18: [2, 0, 0.55],
    20: [1.5, 3, 0.6], // 1/24 triplet run, pitch up (21 rests)
    22: [3, 1, 0.55], // 1/48
    23: [4, 5, 0.72], // into the snare
    27: [2, 0, 0.5],
    30: [4, 4, 0.64], // 1/64 falling
    31: [8, 5, 0.74], // 1/128 riser back to the top
  }, [5, 12, 21, 28]);
  for (const s of [12, 28]) hit(OH, s, 0.6);
  for (const s of [13, 29]) hit(PERC, s, 0.42);
  // Dark sine bell motif (C5 Ab4 F4 Eb4 / C5 Ab4 F4 G4).
  for (const [s, n] of [[0, 72], [3, 68], [6, 65], [10, 63], [16, 72], [19, 68], [22, 65], [26, 67]]) hit(BELL, s, 0.5, { note: n + KEY, gate: 1 });
  return p;
}

function rage() {
  const { p, hit, bass, rollingHats } = builder();
  p[SUB].source = "n808:Distorted";
  bass([
    [0, 29, 2], [3, 41, 1, true], [4, 29, 2, true], [7, 29, 1], [10, 32, 2], [11, 44, 1, true], [12, 32, 2, true],
    [16, 29, 2], [19, 41, 1, true], [20, 29, 2, true], [23, 29, 1], [26, 36, 2], [27, 39, 1, true], [28, 34, 4, true],
  ], 0.8);
  for (const s of [8, 24]) { hit(SN, s, 0.95); hit(CP, s, 0.9); }
  hit(CP, 30, 0.6, { prob: 0.5 });
  // Harder rolls: 1/12 triplet run across beat 2, stacked 1/64 + 1/96 risers.
  rollingHats({
    2: [3, 1, 0.6],
    4: [0.75, 3, 0.66], // 1/12 triplet run over 4 steps, pitch up (5-7 rest)
    13: [2, 0, 0.52],
    14: [4, 5, 0.7],
    15: [6, 5, 0.72],
    19: [1.5, 1, 0.6], // (20 rests)
    22: [4, 3, 0.66],
    23: [6, 5, 0.72],
    29: [3, 6, 0.6], // falling, softer
    30: [4, 5, 0.7],
    31: [8, 5, 0.76],
  }, [5, 6, 7, 18, 20]);
  hit(OH, 18, 0.55);
  for (const s of [11, 27]) hit(PERC, s, 0.4);
  return p;
}

function dark() {
  const { p, hit, bass } = builder();
  bass([[0, 29, 16], [16, 32, 12], [28, 34, 4, true]], 0.88); // root for a bar, minor third for 3/4 bar, glide up a tone
  hit(CP, 24, 0.8);
  hit(PERC, 8, 0.5);
  hit(PERC, 20, 0.4);
  // Stripped, but the hats still roll: quiet 8ths with triplet and 1/64 runs.
  for (let s = 0; s < 32; s += 2) hit(CH, s, s % 8 === 0 ? 0.6 : 0.45);
  hit(CH, 6, 0.48, { rat: 1.5, ramp: 1 });
  hit(CH, 14, 0.52, { rat: 3, ramp: 3 });
  hit(CH, 15, 0.55, { rat: 4, ramp: 5 });
  hit(CH, 22, 0.48, { rat: 1.5, ramp: 4 });
  hit(CH, 30, 0.55, { rat: 4, ramp: 3 });
  hit(CH, 31, 0.58, { rat: 6, ramp: 5 });
  for (const [s, n] of [[0, 72], [6, 68], [16, 63], [22, 65]]) hit(BELL, s, 0.45, { note: n + KEY, gate: 2 });
  return p;
}

function fill() {
  const { p, hit, bass, hats16 } = builder();
  bass([[0, 29, 8], [7, 29, 2], [10, 36, 4, true], [28, 29, 2], [30, 41, 2, true]], 0.88);
  hit(OH, 0, 0.7);
  hit(SN, 8, 0.95); hit(CP, 8, 0.85);
  hats16(Array.from({ length: 16 }, (_, i) => i + 16).concat([0, 5]));
  hit(CH, 4, 0.6, { rat: 1.5, ramp: 1 });
  hit(CH, 7, 0.66, { rat: 4, ramp: 5 });
  hit(CH, 14, 0.6, { rat: 3, ramp: 3 });
  hit(CH, 15, 0.68, { rat: 6, ramp: 5 });
  // Bar 2: toms high -> low, then the snare roll gets faster and louder.
  for (const [s, n, v] of [[16, 52, 0.85], [18, 52, 0.7], [19, 47, 0.8], [20, 47, 0.7], [22, 43, 0.9], [23, 43, 0.75]]) hit(TOM, s, v, { note: n });
  for (const [s, rat, v] of [[24, 2, 0.5], [25, 2, 0.56], [26, 3, 0.62], [27, 3, 0.68], [28, 4, 0.74], [29, 4, 0.8], [30, 6, 0.86], [31, 6, 0.92]]) hit(SN, s, v, { rat });
  hit(CP, 24, 0.7);
  return p;
}

/** Four fresh classic patterns (A trap, B rage, C dark breakdown, D fill). */
export function classicBanks() {
  return [trap(), rage(), dark(), fill()];
}

/** Mixer for the classic kit: hats sit back and wide, bell gets room, clap a little. */
export function classicMixer() {
  const m = TRACKS.map(defaultMix);
  m[CH] = { ...m[CH], vol: 0.75, pan: 0.15 };
  m[OH] = { ...m[OH], vol: 0.7, pan: 0.15 };
  m[PERC] = { ...m[PERC], vol: 0.8, pan: -0.25 };
  m[CP] = { ...m[CP], rev: 0.15 };
  m[TOM] = { ...m[TOM], rev: 0.15 };
  m[BELL] = { ...m[BELL], vol: 0.55, pan: -0.1, rev: 0.35, dly: 0.2 };
  return m;
}

/** A complete fresh-session state with the classic sections. */
export function classicState() {
  return withPatternAlias({
    v: STATE_VERSION,
    bpm: CLASSIC_BPM,
    swing: CLASSIC_SWING,
    length: CLASSIC_LENGTH,
    limiter: true,
    metronome: defaultMetronome(),
    patch: { ...DEFAULT_PATCH },
    banks: classicBanks(),
    bank: 0,
    chain: [...CLASSIC_CHAIN],
    song: false,
    mixer: classicMixer(),
  });
}

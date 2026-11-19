// Classic TR-808 default sections. A fresh session (nothing autosaved, no
// share link) loads these four original, classic-style 1-bar grooves so every
// section plays a real 808 the moment you press play. Saved beats are never
// touched; LOAD CLASSIC 808 brings them back on demand (undoable).
import { TRACKS, emptyPattern } from "./music.mjs";
import { defaultMix, defaultMetronome, withPatternAlias, STATE_VERSION } from "./state-io.mjs";
import { DEFAULT_PATCH } from "./music.mjs";

export const CLASSIC_BPM = 128;
export const CLASSIC_SWING = 8;
export const CLASSIC_CHAIN = [0, 0, 1, 1, 2, 3]; // A A B B C D

// Track slots used by the classic kit (row names stay the app's 12 tracks).
const K = 0, SN = 1, CP = 2, CH = 3, OH = 4, CB = 5, SUB = 6, TOM = 7, RS = 8, CL = 9, MA = 10;
export const CLASSIC_KIT = {
  [K]: "tr:BD", [SN]: "tr:SD", [CP]: "tr:CP", [CH]: "tr:CH", [OH]: "tr:OH", [CB]: "tr:CB",
  [SUB]: "pit:808", [TOM]: "tr:TOM", [RS]: "tr:RS", [CL]: "tr:CL", [MA]: "tr:MA",
};

export const CLASSIC_SECTIONS = [
  { name: "ELECTRO", blurb: "Planet-Rock-era electro: long 808 boom, snare + clap on 2 and 4, accented 16th hats, cowbell answers" },
  { name: "TRAP", blurb: "Half-time trap: snare/clap on 3, 1/32 and 1/64 hat rolls, sliding 808 bass under a short kick" },
  { name: "MIAMI", blurb: "Miami bass: dotted 808 boom + sub notes, clap on 2 and 4, cowbell hook, maracas and an open-hat lift" },
  { name: "BREAK", blurb: "Breakdown into a fill: clave + sub drone, then high-mid-low 808 toms and a snare roll back to A" },
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
    // The PIT 808 sub carries far more energy than the drums; sit it at ~55%.
    if (t === SUB) vel = Math.round(vel * 55) / 100;
    p[t].steps[s] = { ...p[t].steps[s], on: true, vel, ...extra };
  };
  return { p, hit };
}

function electro() {
  const { p, hit } = builder();
  hit(K, 0, 1); hit(K, 6, 0.82); hit(K, 10, 0.95);
  for (const s of [4, 12]) { hit(SN, s, 0.92); hit(CP, s, 0.78); }
  hit(SN, 15, 0.42); // ghost into the next bar
  for (let s = 0; s < 16; s++) {
    if (s === 14) continue;
    hit(CH, s, s % 4 === 0 ? 0.85 : s % 2 === 0 ? 0.62 : 0.45);
  }
  hit(OH, 14, 0.6);
  hit(CB, 3, 0.5); hit(CB, 11, 0.45);
  hit(RS, 7, 0.5);
  return p;
}

function trap() {
  const { p, hit } = builder();
  hit(K, 0, 1, { gate: 1 }); hit(K, 7, 0.85, { gate: 1 }); hit(K, 10, 0.9, { gate: 1 });
  hit(SN, 8, 0.95); hit(CP, 8, 0.85);
  hit(CP, 15, 0.5, { prob: 0.25 });
  for (let s = 0; s < 16; s++) hit(CH, s, s % 2 === 0 ? 0.78 : 0.5);
  hit(CH, 6, 0.6, { rat: 2 });
  hit(CH, 11, 0.62, { rat: 3 });
  hit(CH, 13, 0.55, { prob: 0.5 });
  hit(CH, 14, 0.66, { rat: 4 });
  hit(CH, 15, 0.6, { rat: 2 });
  // 808 bass: C2 boom, a pickup, a slide up to G2 and a glide down to Bb1.
  hit(SUB, 0, 0.95, { note: 36, gate: 4 });
  hit(SUB, 7, 0.8, { note: 36, gate: 1 });
  hit(SUB, 10, 0.88, { note: 43, gate: 1, slide: true });
  hit(SUB, 11, 0.9, { note: 34, gate: 4, slide: true });
  return p;
}

function miami() {
  const { p, hit } = builder();
  for (const [s, v] of [[0, 1], [3, 0.88], [8, 0.95], [11, 0.85]]) hit(K, s, v, { gate: 1 });
  hit(SUB, 0, 0.92, { note: 36, gate: 2 });
  hit(SUB, 3, 0.85, { note: 36, gate: 2 });
  hit(SUB, 8, 0.9, { note: 31, gate: 2 });
  hit(SUB, 11, 0.88, { note: 34, gate: 4 });
  for (const s of [4, 12]) hit(CP, s, 0.9);
  hit(SN, 12, 0.7); hit(SN, 15, 0.45);
  for (const s of [0, 2, 4, 6, 8, 10, 12]) hit(CH, s, s % 4 === 0 ? 0.8 : 0.6);
  hit(OH, 14, 0.62);
  for (const [s, v] of [[2, 0.5], [6, 0.55], [9, 0.45], [13, 0.5]]) hit(CB, s, v);
  for (let s = 1; s < 16; s += 2) hit(MA, s, 0.42);
  return p;
}

function breakdown() {
  const { p, hit } = builder();
  hit(K, 0, 1);
  hit(OH, 0, 0.7);
  hit(SUB, 0, 0.85, { note: 36, gate: 8 });
  for (const s of [0, 3, 6]) hit(CL, s, 0.6);
  for (const s of [2, 4, 6]) hit(CH, s, 0.5);
  hit(CP, 4, 0.7);
  hit(CB, 4, 0.45);
  // Fill: high, high, mid, mid, low, low toms, then a crescendo snare roll.
  for (const [s, n, v] of [[8, 52, 0.85], [9, 52, 0.7], [10, 47, 0.85], [11, 47, 0.7], [12, 43, 0.9], [13, 43, 0.75]]) hit(TOM, s, v, { note: n });
  hit(SN, 12, 0.55, { rat: 2 });
  hit(SN, 13, 0.65, { rat: 2 });
  hit(SN, 14, 0.78, { rat: 3 });
  hit(SN, 15, 0.92, { rat: 4 });
  hit(CP, 15, 0.6);
  return p;
}

/** Four fresh classic patterns (A electro, B trap, C Miami bass, D breakdown/fill). */
export function classicBanks() {
  return [electro(), trap(), miami(), breakdown()];
}

/** Mixer for the classic kit: hats/maracas sit back, clap and snare get a little room. */
export function classicMixer() {
  const m = TRACKS.map(defaultMix);
  m[CH] = { ...m[CH], vol: 0.8, pan: 0.15 };
  m[OH] = { ...m[OH], vol: 0.8, pan: 0.15 };
  m[MA] = { ...m[MA], vol: 0.7, pan: -0.2 };
  m[CB] = { ...m[CB], vol: 0.85, pan: -0.15 };
  m[CP] = { ...m[CP], rev: 0.2 };
  m[SN] = { ...m[SN], rev: 0.12 };
  m[TOM] = { ...m[TOM], rev: 0.15 };
  return m;
}

/** A complete fresh-session state with the classic sections. */
export function classicState() {
  return withPatternAlias({
    v: STATE_VERSION,
    bpm: CLASSIC_BPM,
    swing: CLASSIC_SWING,
    length: 16,
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

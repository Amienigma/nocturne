// Shared step logic for the live scheduler and the offline WAV export, so the
// two always agree on ratchets, probability, slide, note length and song order.
import { rollShape, RAMPS } from "./music.mjs";

/** Which bank plays on loop number `loop` (0-based). */
export function bankForLoop(state, loop) {
  if (!state.song || !Array.isArray(state.chain) || !state.chain.length) return state.bank ?? 0;
  return state.chain[loop % state.chain.length];
}

/** Hits for one row (layer) on `step`. */
export function rowHits(row, track, step, stepSec, anySolo, rng = Math.random) {
  const hits = [];
  if (row.mute || (anySolo && !row.solo)) return hits;
  const cell = row.steps[step];
  if (!cell || !cell.on) return hits;
  const prob = cell.prob ?? 1;
  if (prob < 1 && rng() >= prob) return hits;
  const { hits: n, span } = rollShape(cell.rat);
  const sub = (stepSec * span) / n;
  const gate = cell.gate > 0 ? cell.gate * stepSec : 0;
  const ramp = RAMPS[cell.ramp] || RAMPS[0];
  for (let k = 0; k < n; k++) {
    const x = n > 1 ? k / (n - 1) : 0; // 0 -> 1 across the roll
    let vel;
    if (ramp.vel > 0) vel = cell.vel * (0.4 + 0.6 * x); // crescendo up to the step's velocity
    else if (ramp.vel < 0) vel = cell.vel * (1 - 0.6 * x);
    else vel = k === 0 ? cell.vel : cell.vel * (1 - 0.12 * (k / n)); // later hits a touch softer
    hits.push({
      track,
      source: row.source,
      cell,
      at: k * sub,
      vel: Math.max(0.05, Math.round(vel * 100) / 100),
      opts: {
        track,
        // A ratcheted note is cut to its slot so rolls stay tight.
        gate: n > 1 ? Math.min(gate || sub, sub) : gate,
        slide: k === 0 && cell.slide === true,
        slideSec: Math.min(0.16, stepSec * 0.6),
        pitch: Math.round(ramp.pitch * x * 100) / 100, // semitones
      },
    });
  }
  return hits;
}

/**
 * Everything that should sound on `step` of `pattern`.
 * @returns {{track:number, source:string, cell:object, at:number, vel:number, opts:object}[]}
 *   `at` is seconds after the step's (swung) start time.
 */
export function stepHits(pattern, step, stepSec, rng = Math.random) {
  const anySolo = pattern.some((row) => row.solo);
  const hits = [];
  pattern.forEach((row, track) => { hits.push(...rowHits(row, track, step, stepSec, anySolo, rng)); });
  return hits;
}

// ---- Tape-deck layers -------------------------------------------------------
// Every track (layer) has its own transport: "play" follows the beat (same
// step as everything else), "loop" runs its own window [start, end) on the
// global clock from `origin` (the bar it was started / rewound on), "stop" is
// silent. Windows of different lengths give polymetric loops.
export const LAYER_MODES = ["play", "loop", "stop"];
export const LAYER_STEPS = 32;

export function defaultLayer() {
  return { mode: "play", start: 0, end: 16, origin: 0 };
}

export function sanitizeLayers(raw, count) {
  return Array.from({ length: count }, (_, i) => {
    const l = raw && typeof raw[i] === "object" && raw[i] ? raw[i] : {};
    const start = Number.isInteger(l.start) ? Math.min(LAYER_STEPS - 1, Math.max(0, l.start)) : 0;
    let end = Number.isInteger(l.end) ? Math.min(LAYER_STEPS, Math.max(1, l.end)) : 16;
    if (end <= start) end = Math.min(LAYER_STEPS, start + 1);
    return { mode: LAYER_MODES.includes(l.mode) ? l.mode : "play", start, end, origin: 0 };
  });
}

/** Which step of its row a layer plays at absolute step `absStep`. */
export function layerStep(layer, absStep, globalStep) {
  if (!layer || layer.mode !== "loop") return globalStep;
  const len = Math.max(1, layer.end - layer.start);
  return layer.start + ((((absStep - (layer.origin || 0)) % len) + len) % len);
}

/** stepHits with per-layer transports (stopped layers are silent). */
export function layerHits(pattern, layers, absStep, globalStep, stepSec, rng = Math.random) {
  if (!layers) return stepHits(pattern, globalStep, stepSec, rng);
  const anySolo = pattern.some((row) => row.solo);
  const hits = [];
  pattern.forEach((row, track) => {
    const layer = layers[track];
    if (layer && layer.mode === "stop") return;
    hits.push(...rowHits(row, track, layerStep(layer, absStep, globalStep), stepSec, anySolo, rng));
  });
  return hits;
}

/** Deterministic PRNG (mulberry32) so exports and tests are reproducible. */
export function seededRng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Section loopers: every section (A–D) has its own looper with its own PLAY /
// STOP and loop length. Loopers run on the one global clock, so any number of
// sections can play at once, layered and in sync. Starting a looper while the
// beat runs waits for the next bar line; its loop restarts from that bar.
import { layerHits } from "./sequencer.mjs";

export const SECTION_LENS = [8, 16, 32]; // ½ bar, 1 bar, 2 bars
export const SECTION_LEN_LABELS = { 8: "½ bar", 16: "1 bar", 32: "2 bars" };

export function defaultLoopers(count = 4) {
  return Array.from({ length: count }, () => ({ on: false, len: 32, origin: 0 }));
}

/** Only the loop lengths persist (autosave); loopers always load stopped. */
export function sanitizeLoopers(raw, count = 4) {
  return defaultLoopers(count).map((l, i) => {
    const len = Array.isArray(raw) ? Number(raw[i]?.len ?? raw[i]) : NaN;
    return { ...l, len: SECTION_LENS.includes(len) ? len : 32 };
  });
}

/** The step a looper plays at absolute step `absStep` (pattern length caps the loop). */
export function looperStep(l, absStep, length = 32) {
  const len = Math.max(1, Math.min(l.len, length));
  return (((absStep - (l.origin || 0)) % len) + len) % len;
}

export const activeLoopers = (loopers) => loopers.map((l, b) => (l.on ? b : -1)).filter((b) => b >= 0);

/** Hits for every playing section looper, layered (tape-deck layers still apply per track). */
export function looperHits(banks, loopers, layers, absStep, stepSec, length = 32, rng = Math.random) {
  const hits = [];
  const gain = layerGain(activeLoopers(loopers).length);
  loopers.forEach((l, b) => {
    if (!l.on || !banks[b]) return;
    for (const h of layerHits(banks[b], layers, absStep, looperStep(l, absStep, length), stepSec, rng)) {
      hits.push(gain === 1 ? { ...h, bank: b } : { ...h, bank: b, vel: Math.max(0.05, Math.round(h.vel * gain * 100) / 100) });
    }
  });
  return hits;
}

/**
 * Gain staging for layered sections: each extra section playing at once
 * trims every hit a little (2 → −2.5 dB, 3 → −3.9 dB, 4 → −5 dB), so stacking
 * all four stays clean in front of the speaker-safety stage instead of
 * leaning on its clipper.
 */
export function layerGain(n) {
  return n > 1 ? Math.pow(n, -0.42) : 1;
}

/**
 * Apply queued looper changes at a bar line. `queue` maps bank -> { on, len? }.
 * A looper that starts (or restarts with a new length) begins from its step 1 at `absStep`.
 */
export function applyLooperQueue(loopers, queue, absStep) {
  for (const [b, op] of queue) {
    const l = loopers[b];
    if (!l) continue;
    if (op.len && SECTION_LENS.includes(op.len)) l.len = op.len;
    if (op.on === false) l.on = false;
    else {
      l.on = true;
      l.origin = absStep;
    }
  }
  queue.clear();
  return loopers;
}

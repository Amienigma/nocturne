// Shared step logic for the live scheduler and the offline WAV export, so the
// two always agree on ratchets, probability, slide, note length and song order.

/** Which bank plays on loop number `loop` (0-based). */
export function bankForLoop(state, loop) {
  if (!state.song || !Array.isArray(state.chain) || !state.chain.length) return state.bank ?? 0;
  return state.chain[loop % state.chain.length];
}

/**
 * Everything that should sound on `step` of `pattern`.
 * @returns {{track:number, source:string, cell:object, at:number, vel:number, opts:object}[]}
 *   `at` is seconds after the step's (swung) start time.
 */
export function stepHits(pattern, step, stepSec, rng = Math.random) {
  const hits = [];
  const anySolo = pattern.some((row) => row.solo);
  pattern.forEach((row, track) => {
    if (row.mute || (anySolo && !row.solo)) return;
    const cell = row.steps[step];
    if (!cell || !cell.on) return;
    const prob = cell.prob ?? 1;
    if (prob < 1 && rng() >= prob) return;
    const rat = cell.rat > 1 ? cell.rat : 1;
    const sub = stepSec / rat;
    const gate = cell.gate > 0 ? cell.gate * stepSec : 0;
    for (let k = 0; k < rat; k++) {
      hits.push({
        track,
        source: row.source,
        cell,
        at: k * sub,
        // Rolls: later hits a touch softer, like a real hat/snare roll.
        vel: k === 0 ? cell.vel : Math.round(cell.vel * (1 - 0.12 * (k / rat)) * 100) / 100,
        opts: {
          track,
          // A ratcheted note is cut to its slot so rolls stay tight.
          gate: rat > 1 ? Math.min(gate || sub, sub) : gate,
          slide: k === 0 && cell.slide === true,
          slideSec: Math.min(0.16, stepSec * 0.6),
        },
      });
    }
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

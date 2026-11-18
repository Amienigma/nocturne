// User samples: microphone recordings or imported audio files, stored in
// IndexedDB as 16-bit mono PCM. Limits keep memory and storage small on phones.
export const SAMPLE_SLOTS = 8;
export const MAX_SAMPLE_SEC = 10;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_RATE = 48000;
export const TARGET_PEAK = 0.5; // -6 dBFS: leaves room for velocity, stacking and the mixer
const SILENCE = 0.0032; // -50 dBFS

/**
 * Turn decoded audio into a storable sample: mono mixdown, trim leading and
 * trailing silence, cap length, normalise the peak to -6 dBFS, short fades so
 * it never clicks, 16-bit PCM.
 * @param {Float32Array[]} channels
 * @param {number} rate
 * @returns {{pcm: Int16Array, rate: number, seconds: number, truncated: boolean} | null} null if silent
 */
export function prepareSample(channels, rate) {
  if (!channels.length || !(rate > 0)) return null;
  const n = channels[0].length;
  const mono = new Float32Array(n);
  for (const c of channels) for (let i = 0; i < n; i++) mono[i] += c[i] / channels.length;
  let start = 0;
  while (start < n && Math.abs(mono[start]) < SILENCE) start++;
  let end = n;
  while (end > start && Math.abs(mono[end - 1]) < SILENCE) end--;
  if (end - start < Math.round(rate * 0.005)) return null;
  // Keep a hair of pre-roll so transients aren't shaved.
  start = Math.max(0, start - Math.round(rate * 0.002));
  const maxLen = Math.round(MAX_SAMPLE_SEC * rate);
  const truncated = end - start > maxLen;
  if (truncated) end = start + maxLen;
  // Downsample (simple averaging) above 48 kHz to bound size.
  const step = rate > MAX_RATE ? Math.ceil(rate / MAX_RATE) : 1;
  const outRate = Math.round(rate / step);
  const len = Math.floor((end - start) / step);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let acc = 0;
    for (let k = 0; k < step; k++) acc += mono[start + i * step + k];
    out[i] = acc / step;
  }
  let peak = 0;
  for (const x of out) peak = Math.max(peak, Math.abs(x));
  if (peak < SILENCE) return null;
  const gain = TARGET_PEAK / peak;
  const fadeIn = Math.min(len, Math.round(outRate * 0.002));
  const fadeOut = Math.min(len, Math.round(outRate * 0.01));
  const pcm = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    let g = gain;
    if (i < fadeIn) g *= i / fadeIn;
    if (i >= len - fadeOut) g *= (len - 1 - i) / fadeOut;
    pcm[i] = Math.max(-32767, Math.min(32767, Math.round(out[i] * g * 32767)));
  }
  return { pcm, rate: outRate, seconds: len / outRate, truncated };
}

/** Float32 data for an AudioBuffer from stored PCM. */
export function pcmToFloat(pcm) {
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 32768;
  return out;
}

export function makeBuffer(ctx, rec) {
  const buf = ctx.createBuffer(1, Math.max(1, rec.pcm.length), rec.rate);
  buf.getChannelData(0).set(pcmToFloat(rec.pcm));
  return buf;
}

/** Validate a stored record (from IndexedDB) before use. */
export function validRecord(rec) {
  return !!rec && typeof rec.name === "string" && rec.pcm instanceof Int16Array && Number.isInteger(rec.rate)
    && rec.rate >= 8000 && rec.rate <= MAX_RATE && rec.pcm.length <= MAX_SAMPLE_SEC * rec.rate + 1;
}

// ---- IndexedDB -------------------------------------------------------------
const DB = "nocturne";
const STORE = "samples";

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("no IndexedDB")); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      let result;
      Promise.resolve(fn(store)).then((r) => { result = r; });
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error("aborted"));
    });
  } finally {
    db.close();
  }
}

const reqP = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

/** All stored samples as a Map(slot 1-8 -> {name, rate, pcm}). Never throws. */
export async function loadSamples() {
  const out = new Map();
  try {
    await tx("readonly", async (store) => {
      for (let slot = 1; slot <= SAMPLE_SLOTS; slot++) {
        const rec = await reqP(store.get(slot));
        if (validRecord(rec)) out.set(slot, rec);
      }
    });
  } catch { /* private mode or blocked: samples just aren't persisted */ }
  return out;
}

export async function saveSample(slot, rec) {
  await tx("readwrite", (store) => { store.put({ name: rec.name, rate: rec.rate, pcm: rec.pcm, at: Date.now() }, slot); });
}

export async function deleteSample(slot) {
  await tx("readwrite", (store) => { store.delete(slot); });
}

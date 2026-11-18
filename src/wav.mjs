// Minimal PCM WAV (RIFF/WAVE) encoder: 16- or 24-bit, any channel count.
// Pure functions, no DOM, so it runs (and is tested) in Node too.

export const WAV_HEADER_BYTES = 44;

/**
 * Encode planar float channels (-1..1) into a WAV file.
 * @param {Float32Array[]} channels one array per channel, equal lengths
 * @param {number} sampleRate e.g. 48000
 * @param {{bitDepth?: 16|24, dither?: boolean, random?: () => number}} [opts]
 * @returns {ArrayBuffer}
 */
export function encodeWav(channels, sampleRate, { bitDepth = 16, dither = bitDepth === 16, random = Math.random } = {}) {
  if (!Array.isArray(channels) || channels.length < 1 || channels.length > 8) throw new Error("WAV: 1–8 channels required");
  if (bitDepth !== 16 && bitDepth !== 24) throw new Error("WAV: bitDepth must be 16 or 24");
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error("WAV: bad sample rate");
  const frames = channels[0].length;
  if (channels.some((c) => c.length !== frames)) throw new Error("WAV: channel lengths differ");
  const nch = channels.length;
  const bps = bitDepth / 8;
  const blockAlign = nch * bps;
  const dataBytes = frames * blockAlign;
  if (WAV_HEADER_BYTES + dataBytes > 0xffffffff) throw new Error("WAV: file too large");
  const buf = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes);
  const v = new DataView(buf);
  const ascii = (off, str) => { for (let i = 0; i < str.length; i++) v.setUint8(off + i, str.charCodeAt(i)); };
  ascii(0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true); // PCM fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, nch, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * blockAlign, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, bitDepth, true);
  ascii(36, "data");
  v.setUint32(40, dataBytes, true);

  const max = bitDepth === 16 ? 32767 : 8388607;
  const min = -max - 1;
  let off = WAV_HEADER_BYTES;
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < nch; ch++) {
      let x = channels[ch][i];
      if (!Number.isFinite(x)) x = 0;
      // TPDF dither (±1 LSB) only for 16-bit; 24-bit noise floor is already far below audibility.
      let q = x * max + (dither ? random() - random() : 0);
      q = Math.round(q);
      if (q > max) q = max;
      else if (q < min) q = min;
      if (bitDepth === 16) {
        v.setInt16(off, q, true);
      } else {
        v.setUint8(off, q & 0xff);
        v.setUint8(off + 1, (q >> 8) & 0xff);
        v.setUint8(off + 2, (q >> 16) & 0xff);
      }
      off += bps;
    }
  }
  return buf;
}

/** Parse a WAV header (used by tests and as a sanity check after encoding). */
export function readWavHeader(buffer) {
  const v = new DataView(buffer);
  const str = (off, n) => String.fromCharCode(...new Uint8Array(buffer, off, n));
  if (buffer.byteLength < WAV_HEADER_BYTES || str(0, 4) !== "RIFF" || str(8, 4) !== "WAVE") return null;
  return {
    riffSize: v.getUint32(4, true),
    format: v.getUint16(20, true),
    channels: v.getUint16(22, true),
    sampleRate: v.getUint32(24, true),
    byteRate: v.getUint32(28, true),
    blockAlign: v.getUint16(32, true),
    bitDepth: v.getUint16(34, true),
    dataTag: str(36, 4),
    dataBytes: v.getUint32(40, true),
  };
}

/**
 * Trim trailing near-silence (keeps at least `minFrames`) and fade the last
 * few ms so the file never ends on a click. Returns new channel arrays.
 */
export function trimTail(channels, { threshold = 1e-4, minFrames = 0, padFrames = 0, fadeFrames = 0 } = {}) {
  const frames = channels[0].length;
  let last = minFrames - 1;
  for (let i = frames - 1; i >= minFrames; i--) {
    if (channels.some((c) => Math.abs(c[i]) > threshold)) {
      last = i;
      break;
    }
  }
  const end = Math.min(frames, Math.max(minFrames, last + 1 + padFrames));
  const out = channels.map((c) => c.slice(0, end));
  const f = Math.min(fadeFrames, end);
  for (const c of out) for (let i = 0; i < f; i++) c[end - 1 - i] *= i / f;
  return out;
}

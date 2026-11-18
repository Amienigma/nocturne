/**
 * Project state: versioned save format, strict sanitizing, compact share
 * links, an undo/redo stack and tap-tempo math. No DOM or Web Audio here, so
 * everything is unit-testable in Node.
 */
import {
  TRACKS,
  WAVE_IDS,
  HITS,
  SOURCE_GROUPS,
  DEFAULT_SOURCES,
  DEFAULT_PATCH,
  emptyPattern,
  sanitizePatch,
} from "./music.mjs";

export const STATE_VERSION = 1;
export const BPM_MIN = 60;
export const BPM_MAX = 200;
export const SWING_MAX = 48;
export const LENGTHS = [8, 16, 32];
export const STEPS = 32;
export const NOTE_MIN = 12;
export const NOTE_MAX = 108;

// Append-only lists: share links store indexes into these, so never reorder.
export const SOURCE_IDS = SOURCE_GROUPS.flatMap((g) => g.items.map((i) => i.id));
const SOURCE_SET = new Set(SOURCE_IDS);
export const CHORD_IDS = HITS.filter((h) => h.kind === "chord").map((h) => h.id);
const CHORD_SET = new Set(CHORD_IDS);
const PATCH_KEYS = ["volume", "cutoff", "resonance", "attack", "decay", "sustain", "release"];

const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const clampInt = (v, lo, hi, fallback) => (finite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback);
export const roundVel = (v) => Math.min(1, Math.max(0.05, Math.round(v * 100) / 100));

export function defaultMetronome() {
  return { on: false, vol: 0.5 };
}

export function defaultState() {
  return {
    v: STATE_VERSION,
    bpm: 100,
    swing: 0,
    length: 16,
    limiter: true,
    metronome: defaultMetronome(),
    patch: { ...DEFAULT_PATCH },
    pattern: emptyPattern(STEPS),
  };
}

function sanitizeCell(raw, base) {
  const c = isObj(raw) ? raw : {};
  return {
    on: c.on === true,
    vel: finite(c.vel) ? roundVel(c.vel) : base.vel,
    note: clampInt(c.note, NOTE_MIN, NOTE_MAX, base.note),
    chordId: CHORD_SET.has(c.chordId) ? c.chordId : base.chordId,
  };
}

export function sanitizePattern(raw) {
  const base = emptyPattern(STEPS);
  if (!Array.isArray(raw) || raw.length !== TRACKS.length) return base;
  return base.map((def, i) => {
    const row = isObj(raw[i]) ? raw[i] : {};
    const steps = Array.isArray(row.steps) ? row.steps : [];
    return {
      ...def,
      source: SOURCE_SET.has(row.source) ? row.source : DEFAULT_SOURCES[TRACKS[i]],
      mute: row.mute === true,
      solo: row.solo === true,
      steps: def.steps.map((cell, j) => sanitizeCell(steps[j], cell)),
    };
  });
}

/** Strictly rebuild a state from untrusted data. Returns null if it is not a NOCTURNE state at all. */
export function sanitizeState(raw) {
  if (!isObj(raw) || raw.v !== STATE_VERSION) return null;
  const metro = isObj(raw.metronome) ? raw.metronome : {};
  return {
    v: STATE_VERSION,
    bpm: clampInt(raw.bpm, BPM_MIN, BPM_MAX, 100),
    swing: clampInt(raw.swing, 0, SWING_MAX, 0),
    length: LENGTHS.includes(raw.length) ? raw.length : 16,
    limiter: raw.limiter !== false,
    metronome: {
      on: metro.on === true,
      vol: finite(metro.vol) ? Math.min(1, Math.max(0, Math.round(metro.vol * 100) / 100)) : 0.5,
    },
    patch: sanitizePatch(raw.patch),
    pattern: sanitizePattern(raw.pattern),
  };
}

/** Plain, JSON-safe snapshot of the parts of app state that are saved. */
export function serializeState(s) {
  return sanitizeState({
    v: STATE_VERSION,
    bpm: s.bpm,
    swing: s.swing,
    length: s.length,
    limiter: s.limiter,
    metronome: s.metronome,
    patch: s.patch,
    pattern: s.pattern,
  });
}

// ---- Share links --------------------------------------------------------
// Binary layout (v1):
//   [1][bpm][swing][length][flags: bit0 limiter][wave]
//   7 x uint16 patch knobs
//   12 x track: uint16 source index, flags (bit0 mute, bit1 solo),
//               uint32 on-mask, then per on-step: vel(0-100), note, chord index
export function packState(state) {
  const s = sanitizeState(state);
  if (!s) throw new Error("bad state");
  const out = [STATE_VERSION, s.bpm, s.swing, s.length, s.limiter ? 1 : 0, WAVE_IDS.indexOf(s.patch.wave)];
  for (const k of PATCH_KEYS) {
    const q = Math.round(s.patch[k] * 65535);
    out.push(q >> 8, q & 255);
  }
  for (const row of s.pattern) {
    const si = SOURCE_IDS.indexOf(row.source);
    out.push(si >> 8, si & 255, (row.mute ? 1 : 0) | (row.solo ? 2 : 0));
    let mask = 0;
    row.steps.forEach((c, j) => { if (c.on) mask |= 1 << j; });
    out.push((mask >>> 24) & 255, (mask >>> 16) & 255, (mask >>> 8) & 255, mask & 255);
    for (const c of row.steps) {
      if (!c.on) continue;
      out.push(Math.round(c.vel * 100), c.note, Math.max(0, CHORD_IDS.indexOf(c.chordId)));
    }
  }
  return Uint8Array.from(out);
}

export function unpackState(bytes) {
  let i = 0;
  const need = (n) => { if (i + n > bytes.length) throw new Error("truncated"); };
  const u8 = () => { need(1); return bytes[i++]; };
  const u16 = () => (u8() << 8) | u8();
  if (u8() !== STATE_VERSION) throw new Error("version");
  const raw = { v: STATE_VERSION, bpm: u8(), swing: u8(), length: u8() };
  raw.limiter = (u8() & 1) === 1;
  const wave = WAVE_IDS[u8()];
  if (!wave) throw new Error("wave");
  raw.patch = { wave };
  for (const k of PATCH_KEYS) raw.patch[k] = u16() / 65535;
  const base = emptyPattern(STEPS);
  raw.pattern = base.map((def) => {
    const source = SOURCE_IDS[u16()];
    if (!source) throw new Error("source");
    const flags = u8();
    const mask = ((u8() << 24) | (u8() << 16) | (u8() << 8) | u8()) >>> 0;
    const steps = def.steps.map((cell, j) => {
      if (!(mask & (1 << j))) return cell;
      const vel = u8() / 100;
      const note = u8();
      const chordId = CHORD_IDS[u8()];
      if (vel <= 0 || vel > 1 || !chordId) throw new Error("cell");
      return { on: true, vel, note, chordId };
    });
    return { ...def, source, mute: (flags & 1) === 1, solo: (flags & 2) === 2, steps };
  });
  if (i !== bytes.length) throw new Error("trailing bytes");
  // Range checks (bpm, note, length...) are enforced by sanitizeState.
  return sanitizeState(raw);
}

function toB64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(str) {
  if (!/^[A-Za-z0-9_-]*$/.test(str)) throw new Error("charset");
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

const hasCompression = () => typeof CompressionStream === "function" && typeof DecompressionStream === "function";
const MAX_SHARE_CHARS = 8000;
const MAX_RAW_BYTES = 16384;

/** Encode a state as a short URL-safe string: "z" + deflate-raw, or "r" + raw bytes when unsupported. */
export async function encodeShare(state, { compress = true } = {}) {
  const bytes = packState(state);
  if (compress && hasCompression()) {
    try {
      const z = await pipe(bytes, new CompressionStream("deflate-raw"));
      if (z.length < bytes.length) return `z${toB64url(z)}`;
    } catch { /* fall through to raw */ }
  }
  return `r${toB64url(bytes)}`;
}

/** Decode a share string; returns a sanitized state or null for anything invalid. */
export async function decodeShare(code) {
  try {
    if (typeof code !== "string" || code.length < 2 || code.length > MAX_SHARE_CHARS) return null;
    const kind = code[0];
    let bytes = fromB64url(code.slice(1));
    if (kind === "z") {
      if (!hasCompression()) return null;
      bytes = await pipe(bytes, new DecompressionStream("deflate-raw"));
    } else if (kind !== "r") {
      return null;
    }
    if (bytes.length > MAX_RAW_BYTES) return null;
    return unpackState(bytes);
  } catch {
    return null;
  }
}

export function shareCodeFromHash(hash) {
  const m = /^#?(?:.*&)?s=([A-Za-z0-9_-]+)/.exec(hash || "");
  return m ? m[1] : null;
}

// ---- Undo / redo ----------------------------------------------------------
export class UndoStack {
  constructor(cap = 100) {
    this.cap = cap;
    this.past = [];
    this.future = [];
  }

  /** Record `before` (a snapshot string) as the state to return to. */
  push(before) {
    if (this.past[this.past.length - 1] === before) return;
    this.past.push(before);
    if (this.past.length > this.cap) this.past.shift();
    this.future = [];
  }

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }

  undo(current) {
    if (!this.past.length) return null;
    this.future.push(current);
    return this.past.pop();
  }

  redo(current) {
    if (!this.future.length) return null;
    this.past.push(current);
    return this.future.pop();
  }
}

// ---- Tap tempo ------------------------------------------------------------
export class TapTempo {
  constructor({ resetMs = 2000, window = 4 } = {}) {
    this.resetMs = resetMs;
    this.window = window;
    this.taps = [];
  }

  /** Register a tap at `now` (ms). Returns a BPM once two taps exist, else null. */
  tap(now) {
    const last = this.taps[this.taps.length - 1];
    if (last != null && now - last > this.resetMs) this.taps = [];
    this.taps.push(now);
    if (this.taps.length > this.window + 1) this.taps.shift();
    if (this.taps.length < 2) return null;
    const span = this.taps[this.taps.length - 1] - this.taps[0];
    const avg = span / (this.taps.length - 1);
    if (avg <= 0) return null;
    return Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(60000 / avg)));
  }
}

// ---- Recording format -----------------------------------------------------
export const RECORD_TYPES = ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];

export function pickRecordType(isSupported) {
  if (typeof isSupported !== "function") return "";
  return RECORD_TYPES.find((t) => { try { return isSupported(t); } catch { return false; } }) || "";
}

export function extensionForType(type) {
  const t = String(type || "").toLowerCase();
  if (t.includes("mp4") || t.includes("aac") || t.includes("m4a")) return "m4a";
  if (t.includes("ogg")) return "ogg";
  if (t.includes("wav")) return "wav";
  if (t.includes("mpeg")) return "mp3";
  return "webm";
}

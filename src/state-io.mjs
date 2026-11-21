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
  RATCHETS,
  PROBS,
  GATES,
  RAMPS,
} from "./music.mjs";
import { SYNTH_IDS, SYNTH_WAVES, EDIT_KEYS, STRUMS, MAX_CHORD_NOTES, sanitizeSynthEdits } from "./synths.mjs";

// v2 adds pattern banks A–D, song chain, per-track mixer and per-step
// ratchet / probability / slide / length. v1 saves and links still load.
export const STATE_VERSION = 2;
export const BANKS = 4;
export const BANK_NAMES = ["A", "B", "C", "D"];
export const CHAIN_MAX = 16;
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

export function defaultMix() {
  return { vol: 1, pan: 0, rev: 0, dly: 0 };
}

/** Attach the non-enumerable `pattern` alias (= banks[bank]); JSON never duplicates it. */
export function withPatternAlias(obj) {
  Object.defineProperty(obj, "pattern", {
    get() { return this.banks[this.bank]; },
    set(p) { this.banks[this.bank] = p; },
    enumerable: false,
    configurable: true,
  });
  return obj;
}

export function defaultState() {
  return withPatternAlias({
    v: STATE_VERSION,
    bpm: 100,
    swing: 0,
    length: 16,
    limiter: true,
    metronome: defaultMetronome(),
    patch: { ...DEFAULT_PATCH },
    banks: Array.from({ length: BANKS }, () => emptyPattern(STEPS)),
    bank: 0,
    chain: [0],
    song: false,
    mixer: TRACKS.map(defaultMix),
    synth: {},
  });
}

const round2 = (v) => Math.round(v * 100) / 100;
const clampNum = (v, lo, hi, fallback) => (finite(v) ? Math.min(hi, Math.max(lo, round2(v))) : fallback);

function sanitizeCell(raw, base) {
  const c = isObj(raw) ? raw : {};
  // Optional chord data (chord mode): explicit notes and a strum. Only present
  // when used, so plain cells (and older saves) keep their exact shape.
  const extra = {};
  if (Array.isArray(c.notes)) {
    const notes = [...new Set(c.notes.filter((n) => Number.isInteger(n) && n >= NOTE_MIN && n <= NOTE_MAX))].slice(0, MAX_CHORD_NOTES);
    if (notes.length) extra.notes = notes;
  }
  if (extra.notes && Number.isInteger(c.strum) && c.strum > 0 && c.strum < STRUMS.length) extra.strum = c.strum;
  return {
    on: c.on === true,
    vel: finite(c.vel) ? roundVel(c.vel) : base.vel,
    note: clampInt(c.note, NOTE_MIN, NOTE_MAX, base.note),
    chordId: CHORD_SET.has(c.chordId) ? c.chordId : base.chordId,
    rat: RATCHETS.includes(c.rat) ? c.rat : 1,
    prob: PROBS.includes(c.prob) ? c.prob : 1,
    slide: c.slide === true,
    gate: GATES.includes(c.gate) ? c.gate : 0,
    ramp: Number.isInteger(c.ramp) && c.ramp > 0 && c.ramp < RAMPS.length ? c.ramp : 0,
    ...extra,
  };
}

export function sanitizeMixer(raw) {
  return TRACKS.map((_, i) => {
    const m = Array.isArray(raw) && isObj(raw[i]) ? raw[i] : {};
    return {
      vol: clampNum(m.vol, 0, 1, 1),
      pan: clampNum(m.pan, -1, 1, 0),
      rev: clampNum(m.rev, 0, 1, 0),
      dly: clampNum(m.dly, 0, 1, 0),
    };
  });
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

/**
 * Strictly rebuild a state from untrusted data. Accepts v1 (single pattern)
 * and v2 (banks). Returns null if it is not a NOCTURNE state at all.
 * A `pattern` field, when present, replaces the current bank (v1 saves, AI beats).
 */
export function sanitizeState(raw) {
  if (!isObj(raw) || (raw.v !== 1 && raw.v !== STATE_VERSION)) return null;
  const metro = isObj(raw.metronome) ? raw.metronome : {};
  const bank = raw.v === STATE_VERSION ? clampInt(raw.bank, 0, BANKS - 1, 0) : 0;
  const rawBanks = raw.v === STATE_VERSION && Array.isArray(raw.banks) ? raw.banks : [];
  const banks = Array.from({ length: BANKS }, (_, i) => sanitizePattern(rawBanks[i]));
  if (Array.isArray(raw.pattern)) banks[bank] = sanitizePattern(raw.pattern);
  const chain = (Array.isArray(raw.chain) ? raw.chain : [])
    .filter((x) => Number.isInteger(x) && x >= 0 && x < BANKS)
    .slice(0, CHAIN_MAX);
  return withPatternAlias({
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
    banks,
    bank,
    chain: chain.length ? chain : [bank],
    song: raw.song === true,
    mixer: sanitizeMixer(raw.mixer),
    synth: sanitizeSynthEdits(raw.synth),
  });
}

/** Plain, JSON-safe snapshot of the parts of app state that are saved. */
export function serializeState(s) {
  const banks = Array.isArray(s.banks) ? s.banks : [s.pattern];
  return sanitizeState({
    v: STATE_VERSION,
    bpm: s.bpm,
    swing: s.swing,
    length: s.length,
    limiter: s.limiter,
    metronome: s.metronome,
    patch: s.patch,
    banks,
    bank: Array.isArray(s.banks) ? s.bank : 0,
    chain: s.chain,
    song: s.song,
    mixer: s.mixer,
    synth: s.synth,
  });
}

/** True when a bank has nothing in it worth saving in a share link. */
export function bankIsEmpty(pattern) {
  const base = emptyPattern(STEPS);
  return pattern.every((row, i) => !row.mute && !row.solo && row.source === base[i].source && row.steps.every((c) => !c.on));
}

// ---- Share links --------------------------------------------------------
// Binary layout v2:
//   [2][bpm][swing][length][flags: bit0 limiter, bit1 song][wave]
//   7 x uint16 patch knobs
//   [bank][chain length][chain bank indexes...]
//   12 x mixer: vol(0-100) pan(0-200, 100 = centre) rev(0-100) dly(0-100)
//   [bank mask: which of A-D follow]
//   per bank: 12 x track: uint16 source index, flags (bit0 mute, bit1 solo),
//     uint32 on-mask, then per on-step: vel(0-100), note, chord index,
//     ext (bits0-2 ratchet idx, bit3 slide, bits4-6 gate idx, bit7 ramp byte
//     follows), prob(0-100) [, ramp idx 1..] - bit7 was always 0 before, so
//     older v2 links decode unchanged and links without ramps are byte-identical.
// Optional extension block (only written when used, so links without chords or
// synth edits stay byte-identical): [0xE5]
//   [u16 n] n x chord cell: bank, track, step, strum idx, note count, notes...
//   [u8 m]  m x synth edit: preset idx, wave idx, 7 x 0-255 (EDIT_KEYS order)
// v1 links ([1]... one pattern, 3 bytes per step) still decode.
const EXT_TAG = 0xe5;
export function packState(state) {
  const s = sanitizeState(state);
  if (!s) throw new Error("bad state");
  const out = [STATE_VERSION, s.bpm, s.swing, s.length, (s.limiter ? 1 : 0) | (s.song ? 2 : 0), WAVE_IDS.indexOf(s.patch.wave)];
  for (const k of PATCH_KEYS) {
    const q = Math.round(s.patch[k] * 65535);
    out.push(q >> 8, q & 255);
  }
  out.push(s.bank, s.chain.length, ...s.chain);
  for (const m of s.mixer) out.push(Math.round(m.vol * 100), Math.round(m.pan * 100) + 100, Math.round(m.rev * 100), Math.round(m.dly * 100));
  let bankMask = 0;
  s.banks.forEach((p, i) => { if (i === s.bank || !bankIsEmpty(p)) bankMask |= 1 << i; });
  out.push(bankMask);
  s.banks.forEach((pattern, b) => {
    if (!(bankMask & (1 << b))) return;
    for (const row of pattern) {
      const si = SOURCE_IDS.indexOf(row.source);
      out.push(si >> 8, si & 255, (row.mute ? 1 : 0) | (row.solo ? 2 : 0));
      let mask = 0;
      row.steps.forEach((c, j) => { if (c.on) mask |= 1 << j; });
      out.push((mask >>> 24) & 255, (mask >>> 16) & 255, (mask >>> 8) & 255, mask & 255);
      for (const c of row.steps) {
        if (!c.on) continue;
        const ext = RATCHETS.indexOf(c.rat) | (c.slide ? 8 : 0) | (GATES.indexOf(c.gate) << 4) | (c.ramp ? 0x80 : 0);
        out.push(Math.round(c.vel * 100), c.note, Math.max(0, CHORD_IDS.indexOf(c.chordId)), ext, Math.round(c.prob * 100));
        if (c.ramp) out.push(c.ramp);
      }
    }
  });
  const chords = [];
  s.banks.forEach((pattern, b) => {
    if (!(bankMask & (1 << b))) return;
    pattern.forEach((row, t) => row.steps.forEach((c, j) => { if (c.on && c.notes) chords.push([b, t, j, c.strum || 0, c.notes.length, ...c.notes]); }));
  });
  const edits = Object.entries(s.synth || {});
  if (chords.length || edits.length) {
    out.push(EXT_TAG, chords.length >> 8, chords.length & 255);
    for (const c of chords) out.push(...c);
    out.push(edits.length);
    for (const [id, e] of edits) {
      out.push(SYNTH_IDS.indexOf(id), SYNTH_WAVES.indexOf(e.wave), ...EDIT_KEYS.map((k) => Math.round(e[k] * 255)));
    }
  }
  return Uint8Array.from(out);
}

function readExtension(r, raw) {
  if (r.u8() !== EXT_TAG) throw new Error("ext tag");
  const n = r.u16();
  for (let i = 0; i < n; i++) {
    const b = r.u8(), t = r.u8(), j = r.u8(), strum = r.u8(), count = r.u8();
    if (count < 1 || count > MAX_CHORD_NOTES || strum >= STRUMS.length) throw new Error("chord");
    const notes = Array.from({ length: count }, () => r.u8());
    const cell = raw.banks?.[b]?.[t]?.steps?.[j];
    if (!cell || !cell.on) throw new Error("chord cell");
    cell.notes = notes;
    if (strum) cell.strum = strum;
  }
  const m = r.u8();
  raw.synth = {};
  for (let i = 0; i < m; i++) {
    const id = SYNTH_IDS[r.u8()];
    const wave = SYNTH_WAVES[r.u8()];
    if (!id || !wave) throw new Error("synth");
    const e = { wave };
    for (const k of EDIT_KEYS) e[k] = r.u8() / 255;
    raw.synth[id] = e;
  }
}

function reader(bytes) {
  let i = 0;
  const need = (n) => { if (i + n > bytes.length) throw new Error("truncated"); };
  const u8 = () => { need(1); return bytes[i++]; };
  const u16 = () => (u8() << 8) | u8();
  const u32 = () => ((u8() << 24) | (u8() << 16) | (u8() << 8) | u8()) >>> 0;
  return { u8, u16, u32, done: () => i === bytes.length };
}

function readHeader(r, raw) {
  raw.bpm = r.u8();
  raw.swing = r.u8();
  raw.length = r.u8();
  const flags = r.u8();
  raw.limiter = (flags & 1) === 1;
  raw.song = (flags & 2) === 2;
  const wave = WAVE_IDS[r.u8()];
  if (!wave) throw new Error("wave");
  raw.patch = { wave };
  for (const k of PATCH_KEYS) raw.patch[k] = r.u16() / 65535;
}

function readPattern(r, v2) {
  return emptyPattern(STEPS).map((def) => {
    const source = SOURCE_IDS[r.u16()];
    if (!source) throw new Error("source");
    const flags = r.u8();
    const mask = r.u32();
    const steps = def.steps.map((cell, j) => {
      if (!(mask & (1 << j))) return cell;
      const vel = r.u8() / 100;
      const note = r.u8();
      const chordId = CHORD_IDS[r.u8()];
      if (vel <= 0 || vel > 1 || !chordId) throw new Error("cell");
      if (!v2) return { ...cell, on: true, vel, note, chordId };
      const ext = r.u8();
      const prob = r.u8() / 100;
      const rat = RATCHETS[ext & 7];
      const gate = GATES[(ext >> 4) & 7];
      if (rat === undefined || gate === undefined || !PROBS.includes(prob)) throw new Error("ext");
      let ramp = 0;
      if (ext & 0x80) {
        ramp = r.u8();
        if (ramp < 1 || ramp >= RAMPS.length) throw new Error("ramp");
      }
      return { ...cell, on: true, vel, note, chordId, rat, prob, slide: (ext & 8) === 8, gate, ramp };
    });
    return { ...def, source, mute: (flags & 1) === 1, solo: (flags & 2) === 2, steps };
  });
}

export function unpackState(bytes) {
  const r = reader(bytes);
  const version = r.u8();
  if (version !== 1 && version !== STATE_VERSION) throw new Error("version");
  const raw = { v: version };
  readHeader(r, raw);
  if (version === 1) {
    raw.pattern = readPattern(r, false);
  } else {
    raw.bank = r.u8();
    if (raw.bank >= BANKS) throw new Error("bank");
    const chainLen = r.u8();
    if (chainLen < 1 || chainLen > CHAIN_MAX) throw new Error("chain");
    raw.chain = Array.from({ length: chainLen }, () => r.u8());
    if (raw.chain.some((x) => x >= BANKS)) throw new Error("chain");
    raw.mixer = TRACKS.map(() => {
      const vol = r.u8(), pan = r.u8(), rev = r.u8(), dly = r.u8();
      if (vol > 100 || pan > 200 || rev > 100 || dly > 100) throw new Error("mixer");
      return { vol: vol / 100, pan: (pan - 100) / 100, rev: rev / 100, dly: dly / 100 };
    });
    const bankMask = r.u8();
    if (bankMask > 15 || !(bankMask & (1 << raw.bank))) throw new Error("banks");
    raw.banks = Array.from({ length: BANKS }, (_, b) => (bankMask & (1 << b) ? readPattern(r, true) : null));
    if (!r.done()) readExtension(r, raw);
  }
  if (!r.done()) throw new Error("trailing bytes");
  // Range checks (bpm, note, length...) are enforced by sanitizeState.
  return sanitizeState(raw);
}

/** Compact, comparable undo snapshot (binary state as a string). */
export function snapshotOf(state) {
  return String.fromCharCode(...packState(serializeState(state)));
}

export function stateFromSnapshot(snap) {
  return unpackState(Uint8Array.from(snap, (ch) => ch.charCodeAt(0)));
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

// ---- Local storage (autosave + saved slots) --------------------------------
// Four banks as JSON are ~140 KB; the packed form is well under 1 KB, so 30
// saved beats fit easily in localStorage. Older JSON saves (v1/v2) still load.
export function toStored(state) {
  const s = serializeState(state);
  return { v: STATE_VERSION, p: toB64url(packState(s)), metronome: s.metronome };
}

export function fromStored(raw) {
  if (!isObj(raw)) return null;
  if (typeof raw.p === "string" && raw.p.length <= MAX_SHARE_CHARS * 2) {
    try {
      const s = unpackState(fromB64url(raw.p));
      if (s && isObj(raw.metronome)) s.metronome = sanitizeState({ v: STATE_VERSION, metronome: raw.metronome }).metronome;
      return s;
    } catch {
      return null;
    }
  }
  return sanitizeState(raw);
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

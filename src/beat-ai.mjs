// "Describe a beat" -> Amienigma AI -> validated, sanitized NOCTURNE state.
// The model's reply is untrusted text: we only ever read one JSON object out
// of it and push it through the same strict sanitizer as share links.
import { TRACKS, SOURCE_GROUPS, HITS, emptyPattern } from "./music.mjs";
import { sanitizeState, serializeState, LENGTHS, STEPS, BPM_MIN, BPM_MAX, SWING_MAX, STATE_VERSION } from "./state-io.mjs";

export const AI_ENDPOINT = "https://amienigma-llm.vercel.app/api/chat";
export const AI_HOME = "https://amienigma-llm.vercel.app/";
export const PROMPT_MAX = 300;
export const REPLY_MAX = 20000;

const VEL = { X: 1, x: 0.8, o: 0.5 };
const CHORDS = HITS.filter((h) => h.kind === "chord");
const groupIds = (label) => SOURCE_GROUPS.find((g) => g.label === label)?.items.map((i) => i.id) ?? [];

/** Build the single user message (the API accepts no system role). */
export function buildBeatPrompt(description) {
  const desc = String(description ?? "").replace(/\s+/g, " ").trim().slice(0, PROMPT_MAX);
  return [
    "You are writing a drum-machine pattern for NOCTURNE, a 12-track step sequencer.",
    `Beat request: "${desc}"`,
    "",
    "Reply with ONLY one JSON object, no prose, no code fence. Schema:",
    '{"bpm": 60-200, "swing": 0-48, "length": 16, "tracks": {"<Track>": {"steps": "<string>", "sound": "<optional sound id>", "notes": [<optional MIDI numbers>], "chords": [<optional chord ids>]}}}',
    `- Track names (use only these): ${TRACKS.join(", ")}. Omit tracks you don't use.`,
    `- "length" is 8, 16 or 32. "steps" has exactly that many characters: "X" accent, "x" normal hit, "o" soft hit, "." rest. Example 16: "x...x...x...x..."`,
    `- "notes": for the 808 and Bass tracks only, one MIDI note per hit in order (C1=24, C2=36; keep 808s in 24-43).`,
    `- "chords": for the Synth track only, one chord id per hit in order. Chord ids: ${CHORDS.map((c) => c.id).join(", ")}.`,
    `- Optional "sound" per track. Drums: ${groupIds("Trap drums").join(", ")}. 808: ${[...groupIds("808 PIT").slice(0, 1), ...groupIds("NOCTURNE 808")].join(", ")}. Synth: ${groupIds("808 PIT").join(", ")}, ${groupIds("808 PIT chords").join(", ")}. Others: ${groupIds("Banks").join(", ")}.`,
    "- Typical trap: hats busy on CHat, kick and 808 together, snare or clap on beats 2 and 4.",
  ].join("\n");
}

/** Pull the first parseable JSON object out of a model reply. Returns null if none. */
export function extractJson(text) {
  if (typeof text !== "string") return null;
  const s = text.slice(0, REPLY_MAX);
  for (let start = s.indexOf("{"); start !== -1; start = s.indexOf("{", start + 1)) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        try {
          const obj = JSON.parse(s.slice(start, i + 1));
          if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj;
        } catch { /* try the next "{" */ }
        break;
      }
    }
  }
  return null;
}

const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Turn the AI's compact JSON into a full, sanitized NOCTURNE state.
 * Keeps the current patch, limiter and metronome from `base`.
 * Throws an Error with a user-facing message when the reply isn't usable.
 */
export function beatFromAi(obj, base) {
  if (!isObj(obj) || !isObj(obj.tracks)) throw new Error("The AI reply didn't contain a beat");
  const length = LENGTHS.includes(obj.length) ? obj.length : 16;
  const pattern = emptyPattern(STEPS);
  const lookup = new Map(TRACKS.map((t, i) => [t.toLowerCase(), i]));
  let hits = 0;
  let used = 0;
  for (const [name, spec] of Object.entries(obj.tracks)) {
    const idx = lookup.get(String(name).toLowerCase());
    if (idx === undefined || !isObj(spec) || typeof spec.steps !== "string") continue;
    used++;
    const row = pattern[idx];
    if (typeof spec.sound === "string") row.source = spec.sound; // whitelisted by sanitizeState
    const chars = [...spec.steps.replace(/\s/g, "")].slice(0, length);
    const notes = Array.isArray(spec.notes) ? spec.notes : [];
    const chords = Array.isArray(spec.chords) ? spec.chords : [];
    let n = 0;
    chars.forEach((ch, step) => {
      const vel = VEL[ch];
      if (!vel) return;
      // Tile the bar across all 32 stored steps so changing LEN later still sounds right.
      const note = Number.isFinite(notes[n]) ? notes[n] : undefined;
      const chord = typeof chords[n] === "string" ? chords[n] : undefined;
      for (let s = step; s < STEPS; s += length) {
        const cell = row.steps[s];
        cell.on = true;
        cell.vel = vel;
        if (note !== undefined) cell.note = note;
        if (chord !== undefined) cell.chordId = chord;
      }
      if (step < length) hits++;
      n++;
    });
  }
  if (!used || !hits) throw new Error("The AI reply had no playable steps");
  const merged = {
    ...serializeState(base),
    v: STATE_VERSION,
    bpm: obj.bpm,
    swing: obj.swing ?? 0,
    length,
    pattern,
  };
  if (!Number.isFinite(merged.bpm)) merged.bpm = base.bpm;
  const clean = sanitizeState(merged);
  if (!clean) throw new Error("The AI beat failed validation");
  clean.bpm = Math.min(BPM_MAX, Math.max(BPM_MIN, clean.bpm));
  clean.swing = Math.min(SWING_MAX, Math.max(0, clean.swing));
  return clean;
}

/** Client-side rate limit: one request in flight, a cooldown, and a rolling cap. */
export class RateLimiter {
  constructor({ cooldownMs = 15000, windowMs = 600000, max = 6 } = {}) {
    Object.assign(this, { cooldownMs, windowMs, max });
    this.stamps = [];
    this.busy = false;
  }
  /** Milliseconds until the next request is allowed (0 = now). */
  wait(now) {
    if (this.busy) return Infinity;
    this.stamps = this.stamps.filter((t) => now - t < this.windowMs);
    const last = this.stamps[this.stamps.length - 1];
    const cool = last === undefined ? 0 : Math.max(0, last + this.cooldownMs - now);
    const cap = this.stamps.length >= this.max ? this.stamps[0] + this.windowMs - now : 0;
    return Math.max(cool, cap);
  }
  start(now) {
    if (this.wait(now) > 0) return false;
    this.stamps.push(now);
    this.busy = true;
    return true;
  }
  done() {
    this.busy = false;
  }
}


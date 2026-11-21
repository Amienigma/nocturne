// Synth presets for the melodic tracks (source id "syn:<id>"). Pure data plus
// the maths shared by the audio engine, the UI and the tests; no Web Audio here.
//
// Cheap by design: at most three oscillators per note, one filter (or two
// formant band-passes), one envelope, and no per-voice LFO except the soft
// vibrato on the flute and lead. A 4-note chord is ~12 oscillators for its
// length, then every node is released and disconnected.

export const SYNTH_WAVES = ["preset", "sine", "triangle", "sawtooth", "square"];

/**
 * osc: [type, frequency ratio, detune cents, gain]. `w: true` oscillators take
 * the user's WAVE override; DETUNE spreads the ones with a non-zero detune.
 * filter: { type, hz, q, env (cutoff multiplier at the attack peak), envDec s }
 * amp: attack, decay, sustain (0-1), release (seconds). level: peak per note.
 */
export const SYNTH_PRESETS = [
  { id: "darkbell", label: "Dark Bell", group: "ATL", detail: "Sine + inharmonic partial, long ring. The trap bell.",
    osc: [["sine", 1, 0, 1], ["sine", 2.76, 0, 0.32], ["sine", 5.4, 0, 0.08]], filter: { type: "lowpass", hz: 5200, q: 0.4, env: 1, envDec: 0.3 },
    amp: { a: 0.002, d: 0.9, s: 0, r: 0.6 }, level: 0.3 },
  { id: "pluck", label: "Pluck", group: "ATL", detail: "Saw through a snapping filter. Pi'erre-style plucks.",
    osc: [["sawtooth", 1, -6, 0.7, true], ["sawtooth", 1, 6, 0.7, true]], filter: { type: "lowpass", hz: 700, q: 2.2, env: 6, envDec: 0.16 },
    amp: { a: 0.002, d: 0.32, s: 0, r: 0.18 }, level: 0.26 },
  { id: "flute", label: "Flute Lead", group: "ATL", detail: "Breathy triangle with vibrato. Southside-style flute.",
    osc: [["triangle", 1, 0, 1, true], ["sine", 2, 0, 0.18]], noise: { hz: 2600, q: 1.2, gain: 0.08 }, vib: { rate: 5.4, cents: 14, delay: 0.18 },
    filter: { type: "lowpass", hz: 3800, q: 0.5, env: 1, envDec: 0.2 }, amp: { a: 0.06, d: 0.3, s: 0.75, r: 0.25 }, level: 0.28 },
  { id: "choir", label: "Choir Pad", group: "ATL", detail: "Three detuned saws into an 'ah' formant. Dark orchestral pad.",
    osc: [["sawtooth", 1, -10, 0.55, true], ["sawtooth", 1, 10, 0.55, true], ["sawtooth", 0.5, 0, 0.35, true]], formant: [700, 1150],
    filter: { type: "lowpass", hz: 2400, q: 0.5, env: 1, envDec: 0.4 }, amp: { a: 0.35, d: 0.5, s: 0.8, r: 0.9 }, level: 0.4 },
  { id: "keys", label: "Keys", group: "ATL", detail: "Electric-piano tine: sine body, bright fading bark. Zaytoven-style keys.",
    osc: [["sine", 1, 0, 1], ["sine", 2, 3, 0.22], ["triangle", 4, 0, 0.1]], filter: { type: "lowpass", hz: 2600, q: 0.6, env: 2.2, envDec: 0.25 },
    amp: { a: 0.003, d: 1.1, s: 0.25, r: 0.35 }, level: 0.27 },
  { id: "organ", label: "Church Organ", group: "ATL", detail: "Drawbar-style 8' + 4' + 2⅔'. Gospel-trap organ.",
    osc: [["sine", 1, 0, 1], ["sine", 2, 0, 0.6], ["sine", 3, 0, 0.35]], filter: { type: "lowpass", hz: 4200, q: 0.4, env: 1, envDec: 0.2 },
    amp: { a: 0.012, d: 0.1, s: 0.9, r: 0.12 }, level: 0.22 },
  { id: "memsaw", label: "Memphis Saw", group: "MEM", detail: "Two saws ±18 cents, dark and dusty. Phonk-era lead.",
    osc: [["sawtooth", 1, -18, 0.6, true], ["sawtooth", 1, 18, 0.6, true]], filter: { type: "lowpass", hz: 1300, q: 1.4, env: 1.6, envDec: 0.3 },
    amp: { a: 0.004, d: 0.4, s: 0.45, r: 0.3 }, level: 0.24 },
  { id: "cowbell", label: "Pitched Cowbell", group: "MEM", detail: "Two squares at a cowbell ratio, tuned to the note. The Memphis melody bell.",
    osc: [["square", 1, 0, 0.6], ["square", 1.48, 0, 0.6]], filter: { type: "bandpass", hz: 1400, q: 0.5, env: 1, envDec: 0.1, track: true },
    amp: { a: 0.001, d: 0.28, s: 0, r: 0.12 }, level: 0.72 },
  { id: "horrorstr", label: "Horror Strings", group: "MEM", detail: "Slow, wide, slightly sour strings. Horrorcore swell.",
    osc: [["sawtooth", 1, -14, 0.5, true], ["sawtooth", 1, 9, 0.5, true], ["triangle", 2, 0, 0.2]], filter: { type: "lowpass", hz: 1800, q: 0.8, env: 1, envDec: 0.4 },
    amp: { a: 0.5, d: 0.6, s: 0.75, r: 1.2 }, level: 0.36 },
  { id: "chopstab", label: "Chopped Stab", group: "HTX", detail: "Square + saw, short and resonant, a quarter-tone flat. Houston chopped-chord stab.",
    osc: [["square", 1, -45, 0.5, true], ["sawtooth", 1, -55, 0.5, true]], filter: { type: "lowpass", hz: 1100, q: 3, env: 2.5, envDec: 0.09 },
    amp: { a: 0.002, d: 0.16, s: 0.2, r: 0.09 }, level: 0.25 },
  { id: "slabsyn", label: "Slab Synth", group: "HTX", detail: "Fat, warm square-saw lead with slow glide feel. Candy-paint cruise.",
    osc: [["square", 1, -8, 0.5, true], ["sawtooth", 1, 8, 0.45, true], ["sine", 0.5, 0, 0.3]], filter: { type: "lowpass", hz: 1600, q: 1, env: 1.4, envDec: 0.35 },
    amp: { a: 0.02, d: 0.5, s: 0.6, r: 0.4 }, level: 0.22 },
  { id: "brass", label: "Brass", group: "HTX", detail: "Saw pair with a swelling filter. Third-coast horn stab.",
    osc: [["sawtooth", 1, -7, 0.6, true], ["sawtooth", 1, 7, 0.6, true]], filter: { type: "lowpass", hz: 600, q: 1.1, env: 5, envDec: 0.22, attack: 0.06 },
    amp: { a: 0.03, d: 0.25, s: 0.7, r: 0.2 }, level: 0.23 },
  { id: "formant", label: "Vocal Formant", group: "NEW", detail: "Saw through 'oh' formants. A wordless vocal-ish chop.",
    osc: [["sawtooth", 1, -5, 0.6, true], ["sawtooth", 1, 5, 0.6, true]], formant: [450, 850], vib: { rate: 5, cents: 10, delay: 0.12 },
    filter: { type: "lowpass", hz: 3000, q: 0.5, env: 1, envDec: 0.2 }, amp: { a: 0.04, d: 0.3, s: 0.7, r: 0.3 }, level: 0.3 },
  { id: "arplead", label: "Arp Lead", group: "NEW", detail: "Bright detuned square, short. Rage and plugg arps.",
    osc: [["square", 1, -12, 0.5, true], ["square", 2, 12, 0.25, true], ["sawtooth", 1, 0, 0.3, true]], filter: { type: "lowpass", hz: 2200, q: 1.6, env: 3, envDec: 0.12 },
    amp: { a: 0.002, d: 0.2, s: 0.35, r: 0.12 }, level: 0.22 },
  { id: "ragelead", label: "Rage Lead", group: "NEW", detail: "Supersaw-style stack, wide and loud. Rage synth stomp.",
    osc: [["sawtooth", 1, -22, 0.45, true], ["sawtooth", 1, 22, 0.45, true], ["sawtooth", 2, 0, 0.25, true]], filter: { type: "lowpass", hz: 3200, q: 0.9, env: 1.6, envDec: 0.3 },
    amp: { a: 0.005, d: 0.4, s: 0.6, r: 0.25 }, level: 0.2 },
  { id: "pluggbell", label: "Plugg Bell", group: "NEW", detail: "Soft triangle bell with a glassy partial. Dreamy plugg.",
    osc: [["triangle", 1, 0, 1, true], ["sine", 3, 0, 0.2], ["sine", 4.2, 0, 0.06]], filter: { type: "lowpass", hz: 4000, q: 0.5, env: 1.4, envDec: 0.3 },
    amp: { a: 0.003, d: 0.7, s: 0.1, r: 0.5 }, level: 0.28 },
];

export const SYNTH_IDS = SYNTH_PRESETS.map((p) => p.id);
const BY_ID = new Map(SYNTH_PRESETS.map((p) => [p.id, p]));
export const synthById = (id) => BY_ID.get(id) || null;
export const sourceIsSynth = (source) => typeof source === "string" && source.startsWith("syn:") && BY_ID.has(source.slice(4));

// ---- Editable basics (per preset, all 0..1 so they pack into one byte) ------
// 0.5 = the preset's own value for cutoff / resonance / the envelope times;
// sustain is absolute; detune 0.5 = the preset's spread (0 = none, 1 = 3×).
export const EDIT_KEYS = ["cutoff", "resonance", "attack", "decay", "sustain", "release", "detune"];
export function defaultEdit(id) {
  const p = synthById(id);
  return { wave: "preset", cutoff: 0.5, resonance: 0.5, attack: 0.5, decay: 0.5, sustain: p ? p.amp.s : 0.5, release: 0.5, detune: 0.5 };
}
// Edits are stored as bytes; byte 128 is the preset's own value (exactly 0.5).
const q8 = (v) => {
  const b = Math.round(Math.min(1, Math.max(0, v)) * 255);
  return b === 128 ? 0.5 : b / 255;
};
export function sanitizeEdit(id, raw) {
  const base = defaultEdit(id);
  if (!raw || typeof raw !== "object") return base;
  const out = { wave: SYNTH_WAVES.includes(raw.wave) ? raw.wave : "preset" };
  for (const k of EDIT_KEYS) out[k] = typeof raw[k] === "number" && Number.isFinite(raw[k]) ? q8(raw[k]) : q8(base[k]);
  return out;
}
/** Only edited presets are kept (saves stay small). */
export function sanitizeSynthEdits(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const id of SYNTH_IDS) {
    if (!raw[id]) continue;
    const e = sanitizeEdit(id, raw[id]);
    if (!isDefaultEdit(id, e)) out[id] = e;
  }
  return out;
}
export function isDefaultEdit(id, e) {
  const d = defaultEdit(id);
  return e.wave === d.wave && EDIT_KEYS.every((k) => Math.abs(e[k] - q8(d[k])) < 1e-9);
}
const scale = (v, lo, hi) => lo * Math.pow(hi / lo, v); // 0.5 -> geometric centre

/** The preset with the user's edits applied, in real units, ready to play. */
export function resolveSynth(id, edit) {
  const p = synthById(id);
  if (!p) return null;
  const e = edit ? sanitizeEdit(id, edit) : defaultEdit(id);
  const spread = e.detune * 2; // 0..2 -> up to 3x via the curve below
  const det = spread <= 1 ? spread : 1 + (spread - 1) * 2;
  return {
    id: p.id,
    label: p.label,
    osc: p.osc.map(([type, ratio, cents, gain, w]) => ({
      type: w && e.wave !== "preset" ? e.wave : type,
      ratio,
      detune: cents * det,
      gain,
    })),
    noise: p.noise || null,
    vib: p.vib || null,
    formant: p.formant || null,
    filter: {
      ...p.filter,
      hz: Math.min(16000, Math.max(60, p.filter.hz * scale(e.cutoff, 1 / 6, 6))),
      q: Math.min(14, Math.max(0.1, p.filter.q * scale(e.resonance, 1 / 4, 4))),
    },
    amp: {
      a: Math.min(2, Math.max(0.001, p.amp.a * scale(e.attack, 1 / 8, 8))),
      d: Math.min(4, Math.max(0.02, p.amp.d * scale(e.decay, 1 / 5, 5))),
      s: e.sustain,
      r: Math.min(4, Math.max(0.02, p.amp.r * scale(e.release, 1 / 5, 5))),
    },
    level: p.level,
  };
}

// Strum (append-only index; share links store it): ms between chord notes,
// negative = downstroke (high to low).
export const STRUMS = [0, 15, 35, 70, -15, -35, -70];
export const STRUM_LABELS = ["off", "up · fast", "up · medium", "up · slow", "down · fast", "down · medium", "down · slow"];
export const MAX_CHORD_NOTES = 6;

/** Per-note gain for an n-note chord: equal-power-ish so dense chords don't jump in level. */
export function chordNoteGain(n) {
  return 1 / Math.sqrt(Math.max(1, n));
}

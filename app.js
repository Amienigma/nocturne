import { getStudio } from "./src/audio.mjs";
import {
  WAVES,
  TRACKS,
  PRESETS,
  COMPUTER_KEYS,
  KEYBOARD_NOTES,
  DRUM_KEYS,
  DEFAULT_PATCH,
  SOURCE_GROUPS,
  HITS,
  formatHz,
  formatTime,
  logMap,
  toMusical,
  withTone,
  noteName,
  noteToMidi,
  hitsIn,
  hatDivisionToCount,
  applyPreset,
  toggleStep,
  setTrackSource,
  clearPattern,
  randomizePattern,
  duplicatePattern,
  sourceIsMelodic,
  sourceIsChord,
  pitWaveFromSource,
  ATT_MIN,
  ATT_MAX,
  DEC_MIN,
  DEC_MAX,
  REL_MIN,
  REL_MAX,
  cycleStepVelocity,
  setStepProps,
} from "./src/music.mjs";
import {
  serializeState,
  defaultMetronome,
  encodeShare,
  decodeShare,
  shareCodeFromHash,
  UndoStack,
  TapTempo,
  BPM_MIN,
  BPM_MAX,
  BANKS as PATTERN_BANKS,
  BANK_NAMES,
  CHAIN_MAX,
  defaultMix,
  withPatternAlias,
  snapshotOf,
  stateFromSnapshot,
  pickRecordType,
  toStored,
  fromStored,
} from "./src/state-io.mjs";
import { layerHits, sanitizeLayers } from "./src/sequencer.mjs";
import { defaultLoopers, sanitizeLoopers, looperStep, looperHits, activeLoopers, applyLooperQueue, SECTION_LENS, SECTION_LEN_LABELS } from "./src/loopers.mjs";
import { classicBanks, classicMixer, classicState, isLegacyStarter, CLASSIC_BPM, CLASSIC_SWING, CLASSIC_LENGTH, CLASSIC_CHAIN, CLASSIC_SECTIONS } from "./src/classics.mjs";
import { SAMPLE_SLOTS, MAX_FILE_BYTES, MAX_SAMPLE_SEC, prepareSample, loadSamples, saveSample, deleteSample } from "./src/samples.mjs";
import { midiSupported, connectMidi, drumTrackForNote } from "./src/midi.mjs";
import { renderWav, EXPORT_BARS } from "./src/export.mjs";
import { AI_ENDPOINT, buildBeatPrompt, extractJson, beatFromAi, RateLimiter } from "./src/beat-ai.mjs";

const studio = getStudio();
const state = withPatternAlias({
  patch: { ...DEFAULT_PATCH },
  octave: 3,
  hitBank: "atlanta",
  armed: false,
  playing: false,
  bpm: CLASSIC_BPM,
  swing: CLASSIC_SWING,
  length: CLASSIC_LENGTH,
  // Pattern banks A–D; `state.pattern` is an alias for banks[bank]. A fresh
  // session (no autosave, no share link) starts with four classic TR-808
  // sections; saved beats replace them in loadAutosave() / share links.
  banks: classicBanks(),
  bank: 0,
  chain: [...CLASSIC_CHAIN],
  song: false,
  mixer: classicMixer(),
  focusStep: { t: 0, s: 0 },
  preset: null,
  selectedTrack: 0,
  paintNote: 36,
  paintChord: "cm",
  hatDiv: "1/16",
  limiter: true,
  crt: false,
  recording: false,
  currentStep: -1,
  held: new Set(),
  padHeld: null,
  loopId: null,
  soundBank: "Memphis",
  active: [],
  metronome: defaultMetronome(),
  tape: false,
});
// Tape-deck layer transports (one per track); see the "Tape deck" section.
let layers = sanitizeLayers(null, TRACKS.length);

const $ = (id) => document.getElementById(id);
window.__nocturneState = state; // for tests/debugging

// ---- Save, autosave, undo/redo -------------------------------------------
const AUTOSAVE_KEY = "nocturne.autosave.v1";
const SLOTS_KEY = "nocturne.slots.v1";
const MAX_SLOTS = 30;
const history = new UndoStack(100);
let pendingEdit = null;
let autosaveTimer = 0;

// Undo snapshots are the compact binary state (a few hundred bytes for four
// banks) instead of JSON (tens of KB each), so 100 undo steps stay small.
const snapshot = () => snapshotOf(state);
// Undo covers the beat (pattern, tempo, swing, length, limiter). The synth
// patch (also changed by pads) and metronome prefs are autosaved but are left
// alone by undo/redo so undoing a step never silently changes your sound.
const UNDO_KEEP = { keepMetronome: true, keepPatch: true };

function store() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Apply a sanitized saved state to the app. `keepMetronome` leaves the user's metronome prefs alone. */
function applyState(raw, { keepMetronome = false, keepPatch = false } = {}) {
  let s = null;
  if (typeof raw === "string") s = raw.startsWith("{") ? fromStored(safeParse(raw)) : safeSnapshot(raw);
  else s = fromStored(raw);
  if (!s) return false;
  state.bpm = s.bpm;
  state.swing = s.swing;
  state.length = s.length;
  state.limiter = s.limiter;
  if (!keepPatch) state.patch = s.patch;
  state.banks = s.banks;
  state.bank = s.bank;
  state.chain = s.chain;
  state.song = s.song;
  state.mixer = s.mixer;
  looperQueue.clear();
  for (const l of loopers) l.on = false;
  queuedMode = null;
  if (!keepMetronome) state.metronome = s.metronome;
  studio.setPatch(state.patch);
  studio.setLimiter(state.limiter);
  studio.setMixer(state.mixer);
  studio.setSendTempo(state.bpm);
  renderBanks();
  renderMixer();
  syncControls();
  renderWaves();
  renderKnobs();
  renderSeq();
  renderPaint();
  renderLcd();
  return true;
}

function safeSnapshot(snap) {
  try {
    return stateFromSnapshot(snap);
  } catch {
    return null;
  }
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function syncControls() {
  $("bpm").value = String(state.bpm);
  $("bpm-num").value = String(state.bpm);
  $("swing").value = String(state.swing);
  $("swing-val").textContent = String(state.swing);
  $("limiter").classList.toggle("on", state.limiter);
  $("metro").classList.toggle("on", state.metronome.on);
  $("metro").setAttribute("aria-pressed", String(state.metronome.on));
  $("metro-vol").value = String(state.metronome.vol);
  studio.setMetronomeVolume(state.metronome.vol);
}

function renderUndo() {
  $("undo").disabled = !history.canUndo;
  $("redo").disabled = !history.canRedo;
}

/** Run a change as one undoable step. */
function commit(mutate, toastMsg) {
  const before = snapshot();
  mutate();
  if (before !== snapshot()) {
    history.push(before);
    renderUndo();
    scheduleAutosave();
    if (toastMsg) showSnack(toastMsg, true);
  }
}

// Continuous controls (sliders): one undo step per gesture.
function beginEdit() {
  if (pendingEdit === null) pendingEdit = snapshot();
}

function endEdit() {
  if (pendingEdit === null) return;
  const before = pendingEdit;
  pendingEdit = null;
  if (before !== snapshot()) {
    history.push(before);
    renderUndo();
  }
  scheduleAutosave();
}

function undo() {
  endEdit();
  const prev = history.undo(snapshot());
  if (prev === null) return;
  applyState(prev, UNDO_KEEP);
  renderUndo();
  scheduleAutosave();
  showSnack("Undone");
}

function redo() {
  endEdit();
  const next = history.redo(snapshot());
  if (next === null) return;
  applyState(next, UNDO_KEEP);
  renderUndo();
  scheduleAutosave();
  showSnack("Redone");
}

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(saveNow, 400);
}

function saveNow() {
  clearTimeout(autosaveTimer);
  autosaveTimer = 0;
  try {
    // Optional extras next to the packed beat (older builds ignore them):
    // TAPE on/off, each layer's loop window and each section looper's length.
    const extra = { tape: state.tape, layers: layers.map(({ start, end }) => ({ start, end })), secLens: loopers.map((l) => l.len) };
    store()?.setItem(AUTOSAVE_KEY, JSON.stringify({ ...toStored(state), ...extra }));
  } catch { /* storage full or blocked: keep playing */ }
}

let legacyReplaced = false;
function loadAutosave() {
  const raw = store()?.getItem(AUTOSAVE_KEY);
  if (!raw) return false;
  const ok = applyState(raw);
  // The old build opened on the ATLANTA NIGHT preset. A save that is still
  // exactly that untouched starter (nothing edited) isn't the user's beat, so
  // the trap sections replace it instead of PLAY bringing the old preset back.
  if (ok && isLegacyStarter(state)) {
    applyState(classicState(), { keepMetronome: true, keepPatch: true });
    legacyReplaced = true;
    saveNow();
    return false;
  }
  const extra = ok ? safeParse(raw) : null;
  if (extra && typeof extra === "object") {
    if (Array.isArray(extra.secLens)) loopers = sanitizeLoopers(extra.secLens, PATTERN_BANKS);
    if (Array.isArray(extra.layers)) layers = sanitizeLayers(extra.layers.map((l) => ({ ...l, mode: "play" })), TRACKS.length);
    state.tape = extra.tape === true;
    studio.setTape(state.tape);
    renderDeck();
  }
  return ok;
}

function readSlots() {
  const list = safeParse(store()?.getItem(SLOTS_KEY) || "[]");
  if (!Array.isArray(list)) return [];
  return list
    .filter((x) => x && typeof x.name === "string" && fromStored(x.state))
    .slice(0, MAX_SLOTS)
    .map((x) => ({ name: x.name.slice(0, 40), at: Number(x.at) || 0, state: x.state }));
}

function writeSlots(list) {
  try {
    store()?.setItem(SLOTS_KEY, JSON.stringify(list.slice(0, MAX_SLOTS)));
    return true;
  } catch {
    showSnack("Couldn't save: browser storage is full or blocked");
    return false;
  }
}

function renderSlots(selected) {
  const sel = $("slot-list");
  const slots = readSlots();
  sel.innerHTML = "";
  if (!slots.length) {
    const opt = document.createElement("option");
    opt.textContent = "No saved beats";
    opt.value = "";
    sel.appendChild(opt);
  }
  for (const slot of slots) {
    const opt = document.createElement("option");
    opt.value = slot.name;
    opt.textContent = slot.name;
    sel.appendChild(opt);
  }
  if (selected) sel.value = selected;
  $("slot-load").disabled = !slots.length;
  $("slot-del").disabled = !slots.length;
}

function saveSlot() {
  const name = $("slot-name").value.trim().slice(0, 40) || `Beat ${new Date().toLocaleString()}`;
  const slots = readSlots().filter((x) => x.name !== name);
  slots.unshift({ name, at: Date.now(), state: toStored(state) });
  if (writeSlots(slots)) {
    renderSlots(name);
    showSnack(`Saved "${name}"`);
  }
}

function loadSlot() {
  const name = $("slot-list").value;
  const slot = readSlots().find((x) => x.name === name);
  if (!slot) return;
  commit(() => applyState(slot.state, { keepMetronome: true }), `Loaded "${name}"`);
}

function deleteSlot() {
  const name = $("slot-list").value;
  const slots = readSlots();
  const victim = slots.find((x) => x.name === name);
  if (!victim) return;
  writeSlots(slots.filter((x) => x !== victim));
  renderSlots();
  showSnack(`Deleted "${name}"`, false, () => {
    writeSlots([victim, ...readSlots().filter((x) => x.name !== victim.name)]);
    renderSlots(victim.name);
  });
}

// ---- Snackbar (with optional Undo) ----
let snackTimer = 0;
let snackAction = null;

function showSnack(msg, withUndo = false, customUndo = null, actionLabel = "UNDO") {
  const el = $("snack");
  $("snack-msg").textContent = msg;
  snackAction = customUndo || (withUndo ? undo : null);
  $("snack-undo").hidden = !snackAction;
  $("snack-undo").textContent = actionLabel;
  el.hidden = false;
  clearTimeout(snackTimer);
  snackTimer = window.setTimeout(() => { el.hidden = true; }, 5000);
}

// ---- Share links ----
async function shareBeat() {
  const code = await encodeShare(serializeState(state));
  const url = `${location.origin}${location.pathname}#s=${code}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: "NOCTURNE beat", text: "A beat I made in NOCTURNE × 808 PIT", url });
      return;
    } catch (e) {
      if (e && e.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    showSnack("Link copied");
  } catch {
    window.prompt("Copy this link to share your beat:", url);
  }
}

async function loadShareFromHash() {
  const code = shareCodeFromHash(location.hash);
  if (!code) return;
  const shared = await decodeShare(code);
  // Drop the hash either way so a refresh uses the autosave from here on.
  window.history.replaceState(null, "", `${location.pathname}${location.search}`);
  if (!shared) {
    showSnack("That share link is invalid or damaged");
    return;
  }
  commit(() => applyState(shared, { keepMetronome: true }), "Loaded shared beat");
  saveNow();
}

// ---- WAV export ----
let exporting = false;

function wavName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `nocturne-${state.bpm}bpm-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.wav`;
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function deliverFile(blob, name) {
  const file = typeof File === "function" ? new File([blob], name, { type: blob.type }) : null;
  const canShareFile = file && navigator.canShare && navigator.share && navigator.canShare({ files: [file] });
  if (canShareFile) {
    try {
      await navigator.share({ files: [file], title: name, text: "Made with NOCTURNE" });
      return "shared";
    } catch (e) {
      if (e && e.name === "AbortError") return "cancelled";
      // Safari needs a fresh tap if rendering took too long: offer one.
      if (e && e.name === "NotAllowedError") {
        showSnack("WAV ready", false, () => { void deliverFile(blob, name); }, "SAVE");
        return "pending";
      }
    }
  }
  downloadBlob(blob, name);
  return "downloaded";
}

async function exportWav() {
  if (exporting) return;
  exporting = true;
  const btn = $("export");
  const prog = $("exp-prog");
  const status = $("exp-status");
  const bars = EXPORT_BARS.includes(Number($("exp-bars").value)) ? Number($("exp-bars").value) : 4;
  const bitDepth = $("exp-bits").value === "24" ? 24 : 16;
  btn.disabled = true;
  prog.hidden = false;
  prog.value = 0;
  status.textContent = "Rendering…";
  try {
    const snap = serializeState(state);
    const res = await renderWav(snap, {
      bars,
      samples: sampleRecs,
      bitDepth,
      masterGain: Number($("vol").value),
      tape: state.tape,
      layers: exportLayers(),
      loopers: exportLoopers(),
      onProgress: (p) => { prog.value = p; status.textContent = `Rendering… ${Math.round(p * 100)}%`; },
    });
    window.__lastExport = res; // for tests/debugging
    const name = wavName();
    const sizeMb = (res.blob.size / 1048576).toFixed(1);
    const how = await deliverFile(res.blob, name);
    status.textContent = how === "cancelled" ? "Export cancelled" : `${name} · ${res.seconds.toFixed(1)} s · ${sizeMb} MB`;
  } catch (e) {
    status.textContent = `Export failed: ${e?.message || e}`;
  } finally {
    prog.hidden = true;
    btn.disabled = false;
    exporting = false;
  }
}

// ---- Amienigma AI beat writer ----
const aiLimiter = new RateLimiter({ cooldownMs: 15000, windowMs: 600000, max: 6 });
const AI_TIMEOUT_MS = 60000;

async function askAi(prompt) {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
  try {
    // text/plain keeps this a CORS "simple request" (no preflight); the API parses the JSON body.
    const res = await fetch(AI_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }),
      signal: ctrl.signal,
      credentials: "omit",
      mode: "cors",
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
}

async function writeBeat(e) {
  e?.preventDefault();
  const input = $("ai-prompt");
  const status = $("ai-status");
  const go = $("ai-go");
  const desc = input.value.trim();
  if (!desc) {
    status.textContent = "Describe the beat first, e.g. “dark Memphis trap, 140”.";
    input.focus();
    return;
  }
  const wait = aiLimiter.wait(Date.now());
  if (wait > 0) {
    status.textContent = Number.isFinite(wait) ? `Give it ${Math.ceil(wait / 1000)} s before the next beat.` : "Still writing the last one…";
    return;
  }
  if (navigator.onLine === false) {
    status.textContent = "You're offline. The beat writer needs a connection; everything else works offline.";
    return;
  }
  aiLimiter.start(Date.now());
  go.disabled = true;
  status.textContent = "Amienigma AI is writing your beat…";
  try {
    const prompt = buildBeatPrompt(desc);
    let beat = null;
    let lastErr = "";
    // The model occasionally returns an empty or cut-off reply: one retry.
    for (let attempt = 0; attempt < 2 && !beat; attempt++) {
      const res = await askAi(prompt);
      if (!res.ok) {
        lastErr = res.status === 429 ? "Amienigma AI is busy. Try again in a minute." : "Amienigma AI didn't answer this time.";
        if (res.status === 429 || res.status === 400) break;
        continue;
      }
      try {
        beat = beatFromAi(extractJson(res.text), state);
      } catch (err) {
        lastErr = err.message;
      }
    }
    if (!beat) {
      status.textContent = `${lastErr || "No beat came back."} Try again or rephrase.`;
      return;
    }
    commit(() => applyState(beat, UNDO_KEEP), "Loaded AI beat");
    state.preset = null;
    renderPresets();
    status.textContent = `Loaded: ${beat.bpm} BPM, ${beat.length} steps. Press PLAY, or UNDO to go back.`;
  } catch (err) {
    // A TypeError here means the browser blocked the response (CORS) or the network failed.
    status.innerHTML = "";
    status.append(
      err?.name === "AbortError" ? "Amienigma AI took too long. " : "Couldn't reach Amienigma AI from this page. ",
      Object.assign(document.createElement("a"), { href: AI_ENDPOINT.replace(/api\/chat$/, ""), target: "_blank", rel: "noopener", textContent: "Open Amienigma AI" }),
      " instead; everything else keeps working.",
    );
  } finally {
    aiLimiter.done();
    go.disabled = false;
  }
}

function arm() {
  if (!studio.arm()) return false;
  studio.setPatch(state.patch);
  studio.setLimiter(state.limiter);
  studio.setMasterGain(Number($("vol").value));
  studio.setMetronomeVolume(state.metronome.vol);
  state.armed = true;
  document.body.classList.remove("waiting");
  renderLcd();
  return true;
}

function firstGesture() {
  arm();
}
window.addEventListener("pointerdown", firstGesture, { capture: true });
window.addEventListener("keydown", firstGesture, { capture: true });

studio.onNotes = (notes) => {
  state.active = notes;
  renderLcd();
  renderKeyboard();
};

function renderLcd() {
  const hit = HITS.find((h) => h.id === state.padHeld || h.id === state.loopId);
  const title = $("lcd-title");
  const sub = $("lcd-sub");
  if (hit) {
    title.textContent = hit.symbol;
    sub.textContent = hit.detail;
    return;
  }
  if (!state.armed) {
    title.textContent = "Idle";
    sub.textContent = "Audio stays off until you touch a key, pad, or Play. Sound design from 808 PIT.";
    return;
  }
  if (state.active.length) {
    title.textContent = state.active.map(noteName).slice(0, 4).join("  ");
    sub.textContent = state.active.map(noteName).join(" · ");
    return;
  }
  title.textContent = state.playing ? "Live" : "Open";
  sub.textContent = `${state.patch.wave.toUpperCase()} · ${formatHz(toMusical(state.patch).cutoffHz)} · pit rack on the sequencer 808 / chord tracks`;
}

function setPatch(partial) {
  state.patch = { ...state.patch, ...partial };
  scheduleAutosave();
  studio.setPatch(state.patch);
  renderWaves();
  renderKnobs();
  renderLcd();
}

function renderWaves() {
  const root = $("waves");
  root.innerHTML = "";
  for (const wave of WAVES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `wave${state.patch.wave === wave.id ? " on" : ""}`;
    btn.textContent = wave.label;
    btn.addEventListener("click", () => {
      arm();
      setPatch({ wave: wave.id });
    });
    root.appendChild(btn);
  }
}

function renderKnobs() {
  const musical = toMusical(state.patch);
  const knobs = [
    { key: "cutoff", label: "Cut", display: formatHz(musical.cutoffHz) },
    { key: "resonance", label: "Res", display: `Q ${musical.q.toFixed(1)}` },
    { key: "attack", label: "Atk", display: formatTime(logMap(state.patch.attack, ATT_MIN, ATT_MAX)) },
    { key: "decay", label: "Dec", display: formatTime(logMap(state.patch.decay, DEC_MIN, DEC_MAX)) },
    { key: "sustain", label: "Sus", display: `${Math.round(state.patch.sustain * 100)}%` },
    { key: "release", label: "Rel", display: formatTime(logMap(state.patch.release, REL_MIN, REL_MAX)) },
  ];
  const root = $("knobs");
  root.innerHTML = "";
  for (const knob of knobs) {
    const wrap = document.createElement("label");
    wrap.className = "knob";
    wrap.innerHTML = `<span>${knob.label} <span class="val">${knob.display}</span></span>`;
    const input = document.createElement("input");
    input.type = "range";
    input.min = 0;
    input.max = 1;
    input.step = 0.01;
    input.value = state.patch[knob.key];
    input.setAttribute("aria-label", knob.label);
    input.addEventListener("input", () => setPatch({ [knob.key]: Number(input.value) }));
    wrap.appendChild(input);
    root.appendChild(wrap);
  }
}

function renderBank() {
  const hint = state.hitBank === "atlanta"
    ? "Sine subs with a pitch-drop punch. Chords keep the 808 under a soft stack."
    : "Minor stabs, the tritone, and a chromatic church descent.";
  $("bank-hint").textContent = hint;
  $("notes-label").textContent = state.hitBank === "atlanta" ? "Subs" : "Notes";
  document.querySelectorAll("[data-bank]").forEach((el) => {
    el.classList.toggle("on", el.dataset.bank === state.hitBank);
  });
  fillHits($("pit-notes"), hitsIn(state.hitBank, "note"));
  fillHits($("pit-chords"), hitsIn(state.hitBank, "chord"));
  fillHits($("pit-loops"), hitsIn(state.hitBank, "loop"));
}

function fillHits(root, hits) {
  root.innerHTML = "";
  for (const hit of hits) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `pad${state.padHeld === hit.id || state.loopId === hit.id ? " on" : ""}`;
    btn.innerHTML = `<b>${hit.symbol}</b><small>${hit.name}</small>`;
    btn.title = hit.detail;
    const press = (e) => {
      e.preventDefault();
      playHit(hit);
    };
    const release = () => releaseHit(hit);
    btn.addEventListener("pointerdown", (e) => {
      btn.setPointerCapture(e.pointerId);
      press(e);
    });
    btn.addEventListener("pointerup", release);
    btn.addEventListener("pointercancel", release);
    root.appendChild(btn);
  }
}

function playHit(hit) {
  if (!arm()) return;
  const next = withTone(state.patch, hit.tone);
  state.patch = next;
  studio.setPatch(next);
  renderWaves();
  renderKnobs();
  if (hit.kind === "loop" && hit.steps) {
    if (state.loopId === hit.id) {
      studio.stopLoop();
      state.loopId = null;
      renderBank();
      renderLcd();
      return;
    }
    studio.stopLoop();
    studio.releaseOwnerPrefix("pad:");
    state.padHeld = null;
    studio.startLoop(hit.steps, hit.stepMs ?? 480, hit.gate ?? 0.8);
    state.loopId = hit.id;
    renderBank();
    renderLcd();
    return;
  }
  studio.stopLoop();
  state.loopId = null;
  for (const n of hit.notes ?? []) studio.down(n, `pad:${hit.id}`, 0.9, hit.tone.wave);
  state.padHeld = hit.id;
  if (sourceIsMelodic(state.pattern[state.selectedTrack]?.source)) {
    if (hit.kind === "note" && hit.notes?.[0] != null) state.paintNote = hit.notes[0];
    if (hit.kind === "chord") state.paintChord = hit.id;
    renderPaint();
  }
  renderBank();
  renderLcd();
}

function releaseHit(hit) {
  if (hit.kind === "loop") return;
  for (const n of hit.notes ?? []) studio.up(n, `pad:${hit.id}`);
  if (state.padHeld === hit.id) state.padHeld = null;
  renderBank();
  renderLcd();
}

function renderKeyboard() {
  const root = $("keyboard");
  const shift = (state.octave - 3) * 12;
  if (!root.childElementCount) {
    for (const name of KEYBOARD_NOTES) {
      const midi = noteToMidi(name);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `key${name.includes("#") ? " black" : ""}`;
      btn.dataset.base = String(midi);
      btn.innerHTML = `<span>${name}</span>`;
      const down = (e) => {
        e.preventDefault();
        if (!arm()) return;
        const note = Number(btn.dataset.base) + (state.octave - 3) * 12;
        studio.down(note, "key", 0.9);
        state.held.add(note);
      };
      const up = () => {
        const note = Number(btn.dataset.base) + (state.octave - 3) * 12;
        studio.up(note, "key");
        state.held.delete(note);
      };
      btn.addEventListener("pointerdown", (e) => {
        btn.setPointerCapture(e.pointerId);
        down(e);
      });
      btn.addEventListener("pointerup", up);
      btn.addEventListener("pointercancel", up);
      root.appendChild(btn);
    }
  }
  $("oct-val").textContent = String(state.octave);
  root.querySelectorAll(".key").forEach((btn) => {
    const note = Number(btn.dataset.base) + shift;
    btn.classList.toggle("on", state.active.includes(note));
  });
}

function padButton(name, parent) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pad";
  btn.innerHTML = `<b>${name}</b><small>tap</small>`;
  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (!arm()) return;
    studio.playNamed(name, studio.ctx.currentTime, 0.9);
    btn.classList.add("on");
    setTimeout(() => btn.classList.remove("on"), 140);
  });
  parent.appendChild(btn);
}

function renderDrums() {
  for (const name of ["Hard Kick", "Sub Kick", "Distorted Kick", "Short Punch", "Analog Kick"]) padButton(name, $("kicks"));
  for (const name of ["Sharp Snare", "Memphis Snare", "Metallic Snare", "Verb Snare", "Layered Snare", "Dry Clap", "Wide Clap", "Dark Clap", "Industrial Clap"]) padButton(name, $("snares"));
  for (const name of ["Closed Hat", "Open Hat", "Short Hat", "Metallic Hat", "Noisy Hat"]) padButton(name, $("hats"));
  for (const name of ["Warped Perc", "Metallic Perc", "Dirty 808"]) padButton(name, $("perc"));
  const divs = $("hat-divs");
  for (const d of ["1/2", "1/4", "1/8", "1/16", "1/32", "trip"]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `chip${state.hatDiv === d ? " on" : ""}`;
    btn.textContent = d;
    btn.addEventListener("click", () => {
      state.hatDiv = d;
      divs.querySelectorAll(".chip").forEach((el) => el.classList.toggle("on", el.textContent === d));
    });
    divs.appendChild(btn);
  }
}

const BANKS = {
  Memphis: ["Cassette Hiss", "VHS Noise", "Warped Perc", "Dirty 808"],
  Coldwave: ["Juno Bass", "Cold Pad", "Cold Pluck"],
  House: ["Deep House Bass", "Dark Bass", "Acid Sweep", "Shaker Loop", "Dark Piano", "Minimal Stab"],
  DSBM: ["Drone Distorted", "Tremolo Texture", "Feedback", "Wind Ambience"],
  Vocals: ["Distant", "Telephone", "Whisper", "Choir", "Robotic", "Scream Texture", "Deep Voice"],
  Ambience: ["Rain", "Wind", "Vinyl", "Electrical Hum", "City Night"],
};

function renderSoundBanks() {
  const tabs = $("bank-tabs");
  tabs.innerHTML = "";
  for (const name of Object.keys(BANKS)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `tab${state.soundBank === name ? " on" : ""}`;
    btn.textContent = name;
    btn.addEventListener("click", () => {
      state.soundBank = name;
      renderSoundBanks();
    });
    tabs.appendChild(btn);
  }
  const pads = $("bank-pads");
  pads.innerHTML = "";
  for (const name of BANKS[state.soundBank]) padButton(name, pads);
}

function renderPresets() {
  const root = $("presets");
  root.innerHTML = "";
  for (const name of PRESETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `chip${state.preset === name ? " on" : ""}`;
    btn.textContent = name;
    btn.addEventListener("click", () => {
      state.preset = name;
      commit(() => { state.pattern = applyPreset(name, state.length); }, `Loaded preset ${name}`);
      renderPresets();
      renderSeq();
      renderPaint();
    });
    root.appendChild(btn);
  }
}

function renderPaint() {
  const root = $("paint-notes");
  root.innerHTML = "";
  const source = state.pattern[state.selectedTrack]?.source || "";
  if (sourceIsChord(source) || source.startsWith("chord:")) {
    for (const hit of HITS.filter((h) => h.kind === "chord")) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `chip${state.paintChord === hit.id ? " on" : ""}`;
      btn.textContent = `${hit.symbol}`;
      btn.addEventListener("click", () => {
        state.paintChord = hit.id;
        renderPaint();
      });
      root.appendChild(btn);
    }
    return;
  }
  if (sourceIsMelodic(source)) {
    const bases = [24, 26, 27, 29, 31, 32, 33, 34, 36, 38, 39, 41, 43, 46, 48, 51, 53, 55, 58, 60];
    for (const midi of bases) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `chip${state.paintNote === midi ? " on" : ""}`;
      btn.textContent = noteName(midi);
      btn.addEventListener("click", () => {
        state.paintNote = midi;
        if (arm()) {
          if (source === "tr:TOM") studio.play808("TOM", studio.ctx.currentTime, 0.8, midi);
          else studio.firePit(midi, studio.ctx.currentTime, 0.8, pitWaveFromSource(source) || state.patch.wave, 0.25);
        }
        renderPaint();
      });
      root.appendChild(btn);
    }
  }
}

let suppressStepClickUntil = 0;
let seqBuiltFor = -1; // pattern length the grid DOM was built for
let seqCells = []; // seqCells[track][step] -> button
let seqMeta = []; // seqMeta[track] -> { row, mute, solo, name }
let holdTimer = 0;
let holdStart = null;

const focusQuery = window.matchMedia("(max-width: 600px)");
const isFocusView = () => focusQuery.matches;

function sourceLabel(id) {
  if (/^smp:\d$/.test(id)) return sampleLabel(Number(id.slice(4)));
  for (const group of SOURCE_GROUPS) {
    const item = group.items.find((x) => x.id === id);
    if (item) return item.label;
  }
  return id;
}

function cellText(row, cell) {
  if (!cell.on || !sourceIsMelodic(row.source)) return "";
  if (sourceIsChord(row.source)) return HITS.find((h) => h.id === cell.chordId)?.symbol || "•";
  return `${cell.slide ? "↗" : ""}${noteName(cell.note)}`;
}

// Update one step button in place (no grid rebuild on a tap).
function updateCell(track, step) {
  const btn = seqCells[track]?.[step];
  if (!btn) return;
  const row = state.pattern[track];
  const cell = row.steps[step];
  btn.classList.toggle("on", cell.on);
  const text = cellText(row, cell);
  if (btn.textContent !== text) btn.textContent = text;
  btn.style.setProperty("--vel", String(cell.vel));
  btn.setAttribute("aria-pressed", String(cell.on));
  const extras = cellExtras(cell);
  if (cell.on && cell.rat !== 1) btn.dataset.rat = String(cell.rat);
  else delete btn.dataset.rat;
  btn.classList.toggle("prob", cell.on && cell.prob < 1);
  btn.classList.toggle("slide", cell.on && cell.slide);
  btn.classList.toggle("sel-step", state.focusStep.t === track && state.focusStep.s === step);
  btn.tabIndex = state.focusStep.t === track && state.focusStep.s === step ? 0 : -1;
  btn.setAttribute("aria-label", `${TRACKS[track]} step ${step + 1}${cell.on ? `, velocity ${Math.round(cell.vel * 100)}%${extras}` : ""}`);
  btn.title = cell.on ? `Velocity ${Math.round(cell.vel * 100)}%${extras} · hold, right-click or shift-click to change` : "";
}

function cellExtras(cell) {
  let out = "";
  if (cell.rat !== 1) out += `, roll ${cell.rat >= 2 ? `×${cell.rat}` : cell.rat === 1.5 ? "1/24 triplet" : "1/12 triplet"}`;
  if (cell.ramp) out += `, ramp ${["", "louder", "softer", "pitch up", "pitch down", "louder + pitch up", "softer + pitch down"][cell.ramp] || ""}`;
  if (cell.prob < 1) out += `, ${Math.round(cell.prob * 100)}% chance`;
  if (cell.slide) out += ", slide";
  if (cell.gate > 0) out += `, length ${cell.gate} step${cell.gate === 1 ? "" : "s"}`;
  return out;
}

function updateRow(track) {
  const meta = seqMeta[track];
  const row = state.pattern[track];
  if (meta) {
    meta.mute.classList.toggle("on", row.mute);
    meta.mute.setAttribute("aria-pressed", String(row.mute));
    meta.solo.classList.toggle("on", row.solo);
    meta.solo.setAttribute("aria-pressed", String(row.solo));
    meta.name.textContent = `${TRACKS[track]} · ${sourceLabel(row.source)}`;
    meta.row.classList.toggle("sel", track === state.selectedTrack);
  }
  for (let step = 0; step < state.length; step++) updateCell(track, step);
}

function buildSeq() {
  const root = $("seq");
  root.style.setProperty("--steps", String(state.length));
  root.innerHTML = "";
  seqCells = [];
  seqMeta = [];
  state.pattern.forEach((row, track) => {
    const line = document.createElement("div");
    line.className = "seq-row";
    line.dataset.t = String(track);
    const meta = document.createElement("div");
    meta.className = "track-meta";
    const mk = (cls, text, act, label) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = cls;
      b.textContent = text;
      b.dataset.act = act;
      b.dataset.t = String(track);
      if (label) b.setAttribute("aria-label", label);
      return b;
    };
    const mute = mk("ms", "M", "mute", `Mute ${TRACKS[track]}`);
    const solo = mk("ms", "S", "solo", `Solo ${TRACKS[track]}`);
    const name = mk("trk", "", "sel", null);
    meta.append(mute, solo, name);
    line.appendChild(meta);
    const cells = [];
    for (let step = 0; step < state.length; step++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `step${step % 4 === 0 ? " beat" : ""}`;
      btn.dataset.t = String(track);
      btn.dataset.s = String(step);
      cells.push(btn);
      line.appendChild(btn);
    }
    seqCells.push(cells);
    seqMeta.push({ row: line, mute, solo, name });
    root.appendChild(line);
  });
  seqBuiltFor = state.length;
  cacheStepColumns();
}

/** Bring the grid in line with state: rebuild only when the length changed. */
function renderSeq() {
  if (state.focusStep.s >= state.length) state.focusStep = { t: state.focusStep.t, s: 0 };
  if (seqBuiltFor !== state.length || seqCells.length !== state.pattern.length) buildSeq();
  $("seq-title").textContent = `12 TRACKS × ${state.length}`;
  document.querySelectorAll("[data-len]").forEach((el) => {
    el.classList.toggle("on", Number(el.dataset.len) === state.length);
  });
  for (let t = 0; t < state.pattern.length; t++) updateRow(t);
  renderTrackBar();
}

function renderTrackBar() {
  const t = state.selectedTrack;
  const row = state.pattern[t];
  if (!row) return;
  $("trk-pick").value = String(t);
  $("trk-src").value = row.source;
  $("trk-mute").classList.toggle("on", row.mute);
  $("trk-mute").setAttribute("aria-pressed", String(row.mute));
  $("trk-solo").classList.toggle("on", row.solo);
  $("trk-solo").setAttribute("aria-pressed", String(row.solo));
  seqMeta.forEach((m, i) => m.row.classList.toggle("sel", i === t));
}

function selectTrack(t) {
  const n = state.pattern.length;
  state.selectedTrack = ((t % n) + n) % n;
  if (state.focusStep.t !== state.selectedTrack) setFocusStep(state.selectedTrack, state.focusStep.s, false);
  renderTrackBar();
  renderPaint();
}

function initTrackBar() {
  const pick = $("trk-pick");
  TRACKS.forEach((name, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = `${i + 1}. ${name}`;
    pick.appendChild(opt);
  });
  // One shared sound picker for the selected track instead of 12 big selects.
  const src = $("trk-src");
  for (const group of SOURCE_GROUPS) {
    const og = document.createElement("optgroup");
    og.label = group.label;
    for (const item of group.items) {
      const opt = document.createElement("option");
      opt.value = item.id;
      opt.textContent = item.label;
      og.appendChild(opt);
    }
    src.appendChild(og);
  }
  pick.addEventListener("change", () => selectTrack(Number(pick.value)));
  src.addEventListener("change", () => {
    const t = state.selectedTrack;
    commit(() => { state.pattern = setTrackSource(state.pattern, t, src.value); });
    updateRow(t);
    renderTrackBar();
    renderPaint();
  });
  $("trk-prev").addEventListener("click", () => selectTrack(state.selectedTrack - 1));
  $("trk-next").addEventListener("click", () => selectTrack(state.selectedTrack + 1));
  $("trk-mute").addEventListener("click", () => toggleFlag(state.selectedTrack, "mute"));
  $("trk-solo").addEventListener("click", () => toggleFlag(state.selectedTrack, "solo"));
}

function toggleFlag(track, flag) {
  commit(() => {
    const row = state.pattern[track];
    state.pattern = state.pattern.map((r, i) => (i === track ? { ...row, [flag]: !row[flag] } : r));
  });
  updateRow(track);
  renderTrackBar();
}

function previewStep(track, step) {
  const c = state.pattern[track].steps[step];
  if (c.on && arm()) studio.triggerSource(state.pattern[track].source, c, studio.ctx.currentTime, c.vel, { track });
}

function paintStep(track, step) {
  const cell = state.pattern[track].steps[step];
  if (state.selectedTrack !== track) selectTrack(track);
  setFocusStep(track, step, false);
  commit(() => {
    state.pattern = toggleStep(state.pattern, track, step, {
      note: state.paintNote,
      chordId: state.paintChord,
      vel: cell.vel,
      forceOn: cell.on ? null : true,
    });
  });
  updateCell(track, step);
  renderInspector();
  previewStep(track, step);
}

function cycleVelAt(track, step) {
  if (state.selectedTrack !== track) selectTrack(track);
  setFocusStep(track, step, false);
  commit(() => { state.pattern = cycleStepVelocity(state.pattern, track, step); });
  updateCell(track, step);
  renderInspector();
  previewStep(track, step);
}

function cancelHold() {
  if (holdTimer) clearTimeout(holdTimer);
  holdTimer = 0;
  holdStart = null;
}

// One set of delegated listeners for the whole grid (no per-button closures).
function initSeqEvents() {
  const root = $("seq");
  const target = (e) => e.target.closest?.("button[data-t]");
  root.addEventListener("pointerdown", (e) => {
    const btn = target(e);
    if (!btn || btn.dataset.s == null || e.button !== 0) return;
    // Mouse/touch taps don't move keyboard focus, so Space keeps meaning PLAY.
    if (e.pointerType === "mouse") e.preventDefault();
    cancelHold();
    const t = Number(btn.dataset.t);
    const s = Number(btn.dataset.s);
    holdStart = { x: e.clientX, y: e.clientY };
    // A hold cycles velocity and must not also toggle the step on release,
    // and the touch long-press "contextmenu" that may follow must not cycle again.
    holdTimer = window.setTimeout(() => {
      holdTimer = 0;
      suppressStepClickUntil = performance.now() + 700;
      cycleVelAt(t, s);
    }, 420);
  });
  root.addEventListener("pointermove", (e) => {
    if (holdStart && Math.hypot(e.clientX - holdStart.x, e.clientY - holdStart.y) > 12) cancelHold();
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave"]) root.addEventListener(type, cancelHold);
  root.addEventListener("click", (e) => {
    const btn = target(e);
    if (!btn) return;
    const t = Number(btn.dataset.t);
    const act = btn.dataset.act;
    if (act === "mute" || act === "solo") return toggleFlag(t, act);
    if (act === "sel") return selectTrack(t);
    if (performance.now() < suppressStepClickUntil || swipeConsumed) return;
    const s = Number(btn.dataset.s);
    if (e.shiftKey) return cycleVelAt(t, s);
    paintStep(t, s);
  });
  root.addEventListener("contextmenu", (e) => {
    const btn = target(e);
    if (!btn || btn.dataset.s == null) return;
    e.preventDefault();
    if (performance.now() < suppressStepClickUntil) return;
    cycleVelAt(Number(btn.dataset.t), Number(btn.dataset.s));
  });
  // Keyboard: roving tabindex across the grid. Arrows move, Home/End jump,
  // Enter/Space toggle (native button), Shift+Enter cycles velocity.
  root.addEventListener("keydown", (e) => {
    const btn = target(e);
    if (!btn || btn.dataset.s == null || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = Number(btn.dataset.t);
    const s = Number(btn.dataset.s);
    const n = state.pattern.length;
    let nt = t;
    let ns = s;
    if (e.key === "ArrowRight") ns = (s + 1) % state.length;
    else if (e.key === "ArrowLeft") ns = (s - 1 + state.length) % state.length;
    else if (e.key === "ArrowDown") nt = (t + 1) % n;
    else if (e.key === "ArrowUp") nt = (t - 1 + n) % n;
    else if (e.key === "Home") ns = 0;
    else if (e.key === "End") ns = state.length - 1;
    else if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      cycleVelAt(t, s);
      return;
    } else {
      if (e.key === " " || e.key === "Enter") e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (nt !== t) selectTrack(nt);
    setFocusStep(nt, ns, true);
  });
  // Focus view: swipe left/right across the steps to change track.
  let touch = null;
  const wrap = $("seq-wrap");
  wrap.addEventListener("touchstart", (e) => {
    swipeConsumed = false;
    touch = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  }, { passive: true });
  wrap.addEventListener("touchend", (e) => {
    if (!touch || !isFocusView()) return;
    const p = e.changedTouches[0];
    const dx = p.clientX - touch.x;
    const dy = p.clientY - touch.y;
    touch = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      swipeConsumed = true;
      cancelHold();
      selectTrack(state.selectedTrack + (dx < 0 ? 1 : -1));
      window.setTimeout(() => { swipeConsumed = false; }, 350);
    }
  }, { passive: true });
}
let swipeConsumed = false;

// Step buttons grouped by column, rebuilt only when the grid is re-rendered,
// so the playhead never has to query the DOM while the sequencer runs.
let stepColumns = [];
let litStep = -1;

function cacheStepColumns() {
  stepColumns = Array.from({ length: state.length }, () => []);
  $("seq").querySelectorAll(".seq-row").forEach((row) => {
    row.querySelectorAll(".step").forEach((btn, i) => {
      if (stepColumns[i]) stepColumns[i].push(btn);
    });
  });
  litStep = state.currentStep;
}

function lightStep(step) {
  if (step === litStep) return;
  if (stepColumns[litStep]) for (const btn of stepColumns[litStep]) btn.classList.remove("now");
  if (stepColumns[step]) for (const btn of stepColumns[step]) btn.classList.add("now");
  litStep = step;
  state.currentStep = step;
}

let timer = 0;
let nextTime = 0;
let stepIndex = 0;
let absStep = 0; // steps since PLAY, for bar-accurate metronome accents
let songPos = 0; // index into state.chain while the song plays
// Section loopers: one per section (A–D), each with its own PLAY / STOP and
// loop length. Several can play at once, layered on the one clock.
let loopers = defaultLoopers(PATTERN_BANKS);
const looperQueue = new Map(); // bank -> { on, len? }: applied at the next bar line
let queuedMode = null; // "song" | "loop": mode switch waiting for the next bar
const BAR_STEPS = 16;
// Last few section switches ({ step, bank, song, why }), for tests/debugging.
const transportLog = [];
function logSwitch(bank, why) {
  transportLog.push({ step: absStep, bank, song: state.song, why });
  if (transportLog.length > 64) transportLog.shift();
}
window.__nocturneTransport = () => ({ layers: layers.map((l) => ({ ...l })), layerQueue: [...layerQueue.keys()], syncQueued, playing: state.playing, absStep, stepIndex, songPos, loopers: loopers.map((l) => ({ ...l })), looperQueue: [...looperQueue].map(([bank, op]) => ({ bank, ...op })), queuedMode, bank: state.bank, song: state.song, log: transportLog.slice() });
const lightTimers = new Set();

function outputDelay() {
  const c = studio.ctx;
  return c ? (c.outputLatency || 0) + (c.baseLatency || 0) : 0;
}

// Light the step when it is actually heard, not when it is queued (up to
// 120 ms early). One cheap timeout per step instead of a DOM sweep per tick.
function queueLight(step, when) {
  const ms = Math.max(0, (when + outputDelay() - studio.ctx.currentTime) * 1000);
  const id = window.setTimeout(() => {
    lightTimers.delete(id);
    if (state.playing) lightStep(step);
  }, ms);
  lightTimers.add(id);
}

function clearLights() {
  for (const id of lightTimers) clearTimeout(id);
  lightTimers.clear();
  lightStep(-1);
}

// BPM pill pulses with each click, timed to when the click is heard.
function queuePulse(when, accent) {
  const ms = Math.max(0, (when + outputDelay() - studio.ctx.currentTime) * 1000);
  const id = window.setTimeout(() => {
    lightTimers.delete(id);
    const pill = $("bpm-pill");
    const cls = accent ? "pulse-accent" : "pulse";
    pill.classList.add(cls);
    window.setTimeout(() => pill.classList.remove(cls), 110);
  }, ms);
  lightTimers.add(id);
}

function scheduler() {
  if (!state.playing || !studio.ctx) return;
  const stepSec = 60 / state.bpm / 4;
  while (nextTime < studio.ctx.currentTime + 0.12) {
    if (absStep > 0) {
      const bar = absStep % BAR_STEPS === 0;
      // Section / mode changes land on the next bar line (every 16 steps), so
      // everything stays in time; the new section starts from its step 1.
      if (bar && (looperQueue.size || queuedMode)) {
        applyQueued(nextTime);
        stepIndex = 0;
        if (!state.song && !activeLoopers(loopers).length) {
          setPlaying(false);
          return;
        }
      } else if (stepIndex === 0 && state.song) {
        advanceSong(nextTime);
      }
      // Tape-deck layer changes (play / loop / stop / rewind / sync) also wait for the bar line.
      if (bar && (layerQueue.size || syncQueued)) {
        if (syncQueued) stepIndex = 0;
        applyLayerQueue(nextTime);
      }
      if (bar && deckOpen()) queueUi(nextTime, renderCounters);
      if (bar && !state.song) queueUi(nextTime, renderLooperLive);
    }
    // Song: the chain's current section. Otherwise every playing section looper,
    // layered; the grid's playhead follows the section you're editing.
    const sel = loopers[state.bank];
    const step = state.song ? stepIndex % state.length : sel?.on ? looperStep(sel, absStep, state.length) : -1;
    const swing = absStep % 2 === 1 ? (state.swing / 100) * stepSec * 0.5 : 0;
    const when = nextTime + swing;
    const hits = state.song ? layerHits(state.pattern, layers, absStep, step, stepSec) : looperHits(state.banks, loopers, layers, absStep, stepSec, state.length);
    for (const h of hits) {
      studio.triggerSource(h.source, h.cell, when + h.at, h.vel, h.opts);
    }
    queueLight(step, when);
    // Metronome: quarter notes on the same AudioContext clock as the drums.
    // Beats land on even steps, which swing never moves.
    if (state.metronome.on && absStep % 4 === 0) {
      const accent = absStep % 16 === 0;
      studio.click(nextTime, accent);
      queuePulse(nextTime, accent);
    }
    absStep += 1;
    nextTime += stepSec;
    stepIndex = (stepIndex + 1) % state.length;
  }
}

function setPlaying(on, startAt = null) {
  if (on && !arm()) return;
  state.playing = on;
  // The top-bar button only stops: sound starts from a section's own ▶ PLAY (or SONG).
  $("play").disabled = !on;
  $("play").classList.toggle("on", on);
  if (timer) {
    clearInterval(timer);
    timer = 0;
  }
  studio.keepAwake = on;
  if (on) {
    nextTime = Math.max(startAt ?? 0, studio.ctx.currentTime + 0.02);
    if (startAt == null) nextTime = studio.ctx.currentTime + 0.05;
    stepIndex = 0;
    absStep = 0;
    songPos = 0;
    transportLog.length = 0;
    for (const l of layers) l.origin = 0;
    for (const [t, q] of layerQueue) applyLayerOp(t, q, 0);
    layerQueue.clear();
    syncQueued = false;
    if (state.song && state.chain.length) {
      for (const l of loopers) l.on = false;
      switchBank(state.chain[0]);
    } else {
      state.song = false;
      for (const [b, op] of looperQueue) if (op.on !== false && loopers[b]) loopers[b].on = true;
      // Started by REC's count-in, Space or the tape deck: the section you're on.
      if (!activeLoopers(loopers).length) loopers[state.bank].on = true;
      for (const l of loopers) l.origin = 0;
    }
    looperQueue.clear();
    queuedMode = null;
    renderBanks();
    timer = window.setInterval(scheduler, 25);
    kickScope();
  } else {
    // Just move the playhead off; no need to rebuild the whole grid.
    clearLights();
    state.currentStep = -1;
    looperQueue.clear();
    for (const l of loopers) l.on = false;
    queuedMode = null;
    renderBanks();
    renderDeck();
    // The AudioContext suspends itself once tails have rung out (studio idle check).
    studio.lastUse = performance.now();
  }
  renderLcd();
  if (on) renderDeck();
}

// ---- Step focus + inspector (velocity, roll, chance, length, slide) ----
function setFocusStep(t, s, moveFocus) {
  const prev = state.focusStep;
  state.focusStep = { t, s };
  if (prev.t !== t || prev.s !== s) updateCell(prev.t, prev.s);
  updateCell(t, s);
  if (moveFocus) seqCells[t]?.[s]?.focus();
  renderInspector();
}

function renderInspector() {
  const { t, s } = state.focusStep;
  const row = state.pattern[t];
  const cell = row?.steps[s];
  if (!cell) return;
  const melodic = sourceIsMelodic(row.source) && !sourceIsChord(row.source) && !row.source.startsWith("tr:");
  $("insp-title").textContent = `${TRACKS[t].toUpperCase()} · STEP ${s + 1}${cell.on ? "" : " (off)"}`;
  $("insp").classList.toggle("off", !cell.on);
  $("insp-vel").value = String(cell.vel);
  $("insp-vel-val").textContent = `${Math.round(cell.vel * 100)}%`;
  $("insp-rat").value = String(cell.rat);
  $("insp-prob").value = String(cell.prob);
  $("insp-ramp").value = String(cell.ramp || 0);
  $("insp-gate").value = String(cell.gate);
  const slide = $("insp-slide");
  slide.classList.toggle("on", cell.slide);
  slide.setAttribute("aria-pressed", String(cell.slide));
  slide.disabled = !melodic;
  slide.title = melodic ? "Glide from the previous note on this track" : "Slide works on 808 / synth tracks";
  for (const id of ["insp-vel", "insp-rat", "insp-prob", "insp-gate", "insp-ramp"]) $(id).disabled = !cell.on;
  if (!cell.on) slide.disabled = true;
}

function editFocused(props, { live = false } = {}) {
  const { t, s } = state.focusStep;
  const apply = () => { state.pattern = setStepProps(state.pattern, t, s, props); };
  if (live) apply();
  else commit(apply);
  updateCell(t, s);
  renderInspector();
}

function initInspector() {
  const vel = $("insp-vel");
  vel.addEventListener("input", () => {
    beginEdit();
    editFocused({ vel: Math.round(Number(vel.value) * 100) / 100 }, { live: true });
  });
  vel.addEventListener("change", endEdit);
  $("insp-rat").addEventListener("change", (e) => editFocused({ rat: Number(e.target.value) }));
  $("insp-prob").addEventListener("change", (e) => editFocused({ prob: Number(e.target.value) }));
  $("insp-ramp").addEventListener("change", (e) => editFocused({ ramp: Number(e.target.value) }));
  $("insp-gate").addEventListener("change", (e) => editFocused({ gate: Number(e.target.value) }));
  $("insp-slide").addEventListener("click", () => {
    const { t, s } = state.focusStep;
    editFocused({ slide: !state.pattern[t].steps[s].slide });
  });
}

// ---- Sections (pattern banks A–D), solo loops and the song chain ----
// Each section has its own looper (▶ PLAY; several can layer) or the chain plays them in order
// (▶ SONG). While playing, any switch (section → section, loop ↔ song) is
// queued to the next bar line so the groove never drops a beat.
let bankClipboard = null;

function switchBank(b) {
  if (b === state.bank || b < 0 || b >= PATTERN_BANKS) return;
  state.bank = b;
  renderSeq();
  renderInspector();
  renderBanks();
  scheduleAutosave();
}

/** Point playback at bank `next` from audio time `when`; the grid follows when it's heard. */
function setAudioBank(next, when) {
  if (next == null || next === state.bank) {
    queueUi(when, renderBanks);
    return;
  }
  state.bank = next;
  queueUi(when, () => {
    renderSeq();
    renderInspector();
    renderBanks();
  });
}

// Called by the scheduler on a bar line with something queued.
function applyQueued(when) {
  if (queuedMode === "song") {
    state.song = true;
    songPos = 0;
    for (const l of loopers) l.on = false;
    looperQueue.clear();
    queuedMode = null;
    const next = state.chain.length ? state.chain[0] : state.bank;
    logSwitch(next, "bar");
    setAudioBank(next, when);
  } else {
    if (queuedMode === "loop") {
      state.song = false;
      for (const l of loopers) l.on = false;
    }
    queuedMode = null;
    const changes = [...looperQueue];
    applyLooperQueue(loopers, looperQueue, absStep);
    for (const [b, op] of changes) logSwitch(b, op.on === false ? "looper-off" : "looper");
    queueUi(when, renderBanks);
  }
  scheduleAutosave();
}

// Called by the scheduler when the pattern wraps in song mode.
function advanceSong(when) {
  if (!state.chain.length) return;
  songPos = (songPos + 1) % state.chain.length;
  logSwitch(state.chain[songPos], "song");
  setAudioBank(state.chain[songPos], when);
}

/**
 * A section's own ▶ PLAY. Stopped: start just that section's looper.
 * Playing: a stopped section joins in sync at the next bar (layered on top),
 * a playing one stops right away (the last one stops the beat), and a section
 * that's waiting for the bar line is cancelled by a second tap.
 */
function sectionPlay(b) {
  if (b < 0 || b >= PATTERN_BANKS) return;
  if (!state.playing) {
    cancelCountIn();
    if (state.song) commit(() => { state.song = false; });
    looperQueue.clear();
    for (const l of loopers) l.on = false;
    loopers[b].on = true;
    switchBank(b);
    setPlaying(true);
    return;
  }
  if (state.song) {
    if (looperQueue.has(b)) looperQueue.delete(b);
    else looperQueue.set(b, { on: true });
    queuedMode = looperQueue.size ? "loop" : null;
    renderBanks();
    return;
  }
  if (loopers[b].on) {
    loopers[b].on = false;
    looperQueue.delete(b);
    logSwitch(b, "looper-off");
    if (!activeLoopers(loopers).length) {
      setPlaying(false);
      return;
    }
  } else if (looperQueue.has(b)) {
    looperQueue.delete(b);
  } else {
    looperQueue.set(b, { on: true });
  }
  renderBanks();
}

/** A section looper's length (½, 1 or 2 bars). A playing looper restarts with it at the next bar. */
function setLooperLen(b, len) {
  if (!SECTION_LENS.includes(len) || !loopers[b]) return;
  if (state.playing && !state.song && loopers[b].on) looperQueue.set(b, { on: true, len });
  else loopers[b].len = len;
  scheduleAutosave();
  renderBanks();
}

/** ▶ SONG: play the chain, switch to it at the next bar, or stop it. */
function songButton() {
  if (!state.chain.length) {
    showSnack("The song is empty: tap +A, +B, +C or +D to add sections");
    return;
  }
  if (!state.playing) {
    cancelCountIn();
    if (!state.song) commit(() => { state.song = true; });
    setPlaying(true);
    return;
  }
  if (queuedMode === "song") {
    queuedMode = null; // tapped again before the bar: cancel
  } else if (state.song) {
    if (queuedMode === "loop") {
      queuedMode = null;
      looperQueue.clear();
    } else {
      setPlaying(false);
      return;
    }
  } else {
    queuedMode = "song";
    looperQueue.clear();
  }
  renderBanks();
}

/** The section letter only picks which section you edit; sound comes from ▶ PLAY. */
function pickBank(b) {
  if (state.playing && state.song) {
    showSnack("The song is playing: it moves through the chain. Tap ▶ PLAY on a section to loop it instead");
    return;
  }
  switchBank(b);
}

function queueUi(when, fn) {
  const ms = Math.max(0, (when + outputDelay() - studio.ctx.currentTime) * 1000);
  const id = window.setTimeout(() => {
    lightTimers.delete(id);
    fn();
  }, ms);
  lightTimers.add(id);
}

// Section labels: the classic name while a bank still holds its classic
// groove. Cached per pattern object (patterns are replaced on every edit).
const sectionLabels = new WeakMap();
let classicSigs = null;
function sectionLabel(b) {
  const p = state.banks[b];
  if (!p) return "";
  let label = sectionLabels.get(p);
  if (label == null) {
    classicSigs ??= classicBanks().map((x) => JSON.stringify(x));
    const empty = p.every((row) => row.steps.every((c) => !c.on));
    label = empty ? "empty" : JSON.stringify(p) === classicSigs[b] ? CLASSIC_SECTIONS[b].name : "edited";
    sectionLabels.set(p, label);
  }
  return label;
}

function renderBanks() {
  const playing = state.playing;
  document.querySelectorAll("[data-pbank]").forEach((el) => {
    const b = Number(el.dataset.pbank);
    el.classList.toggle("on", b === state.bank);
    el.setAttribute("aria-pressed", String(b === state.bank));
  });
  const songPlaying = playing && state.song;
  document.querySelectorAll("[data-loop]").forEach((el) => {
    const b = Number(el.dataset.loop);
    const l = loopers[b];
    const on = playing && !state.song && l.on;
    const q = looperQueue.get(b);
    const queued = Boolean(q) && !on;
    const N = BANK_NAMES[b];
    el.classList.toggle("on", on);
    el.classList.toggle("queued", queued);
    el.setAttribute("aria-pressed", String(on));
    el.textContent = on ? "■ STOP" : queued ? "◷ NEXT BAR" : "▶ PLAY";
    el.setAttribute("aria-label", on ? `Stop section ${N}` : queued ? `Section ${N} starts at the next bar; tap to cancel` : `Play section ${N}${playing ? " in sync from the next bar" : ""}`);
    const card = el.closest(".sec");
    if (!card) return;
    card.classList.toggle("playing", on || (songPlaying && b === state.bank));
    card.classList.toggle("editing", b === state.bank);
    const name = card.querySelector(".sec-name");
    if (name) name.textContent = sectionLabel(b);
    const len = card.querySelector("[data-seclen]");
    if (len) len.value = String(q?.len ?? l.len);
  });
  renderLooperLive();
  const songBtn = $("song");
  songBtn.classList.toggle("on", state.song);
  songBtn.classList.toggle("queued", queuedMode === "song");
  songBtn.setAttribute("aria-pressed", String(state.song));
  songBtn.textContent = songPlaying && queuedMode !== "loop" ? "■ SONG" : queuedMode === "song" ? "◷ SONG" : "▶ SONG";
  songBtn.setAttribute("aria-label", songPlaying ? "Stop the song" : playing ? "Play the song from the next bar" : "Play the song (sections in chain order, looping)");
  songBtn.disabled = !state.chain.length;
  $("bank-paste").disabled = !bankClipboard;
  const chain = $("chain");
  chain.innerHTML = "";
  const pos = songPlaying && state.chain.length ? songPos % state.chain.length : -1;
  state.chain.forEach((b, i) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `mini${i === pos ? " now" : ""}`;
    chip.textContent = BANK_NAMES[b];
    chip.dataset.ci = String(i);
    chip.setAttribute("aria-label", `Song part ${i + 1} of ${state.chain.length}: section ${BANK_NAMES[b]}${i === pos ? ", playing" : ""}. Activate to change`);
    chain.appendChild(chip);
  });
  if (!state.chain.length) {
    const empty = document.createElement("span");
    empty.className = "hint";
    empty.textContent = "empty: tap +A–D";
    chain.appendChild(empty);
  }
  document.querySelectorAll("[data-append]").forEach((el) => { el.disabled = state.chain.length >= CHAIN_MAX; });
  $("chain-del").disabled = state.chain.length === 0;
  $("chain-clear").disabled = state.chain.length === 0;
  let status = "";
  const act = activeLoopers(loopers).map((b) => BANK_NAMES[b]);
  const joining = [...looperQueue].filter(([b, op]) => op.on !== false && !loopers[b].on).map(([b]) => BANK_NAMES[b]);
  if (queuedMode === "song") status = "Song starts at the next bar";
  else if (queuedMode === "loop") status = `Section ${joining.join(" + ")} loops from the next bar`;
  else if (songPlaying) status = `Song: part ${pos + 1} of ${state.chain.length} (loops)`;
  else if (playing) status = `Playing section ${act.join(" + ")}${act.length > 1 ? " (layered, in sync)" : ""}${joining.length ? `; ${joining.join(" + ")} joins at the next bar` : ""}`;
  else if (state.song) status = `Song: ${state.chain.length} part${state.chain.length === 1 ? "" : "s"}`;
  $("bank-status").textContent = status;
  const bars = $("exp-bars");
  if (bars) {
    bars.disabled = state.song;
    bars.title = state.song ? "Song mode exports the whole chain once" : "";
  }
}

// Live indicator on each section card: which bar of its loop it's on. Updated
// once per bar (scheduler) and on changes; no animation loop.
function renderLooperLive() {
  const playing = state.playing;
  document.querySelectorAll(".sec .sec-live").forEach((el) => {
    const b = Number(el.dataset.live);
    const l = loopers[b];
    const on = playing && !state.song && l.on;
    let text = "stopped";
    if (on) {
      const len = Math.min(l.len, state.length);
      text = len < 16 ? "● ½-bar loop" : `● bar ${Math.floor(looperStep(l, Math.max(0, absStep - 1), state.length) / 16) + 1}/${len / 16}`;
    } else if (looperQueue.has(b)) text = "◷ joining";
    else if (playing && state.song && b === state.bank) text = "● in song";
    el.textContent = text;
  });
}

/** What EXPORT WAV renders outside song mode: the playing section loopers (else the section you're on). */
function exportLoopers() {
  if (state.song || !state.playing || !activeLoopers(loopers).length) return null;
  return loopers.map((l) => ({ ...l, origin: 0 }));
}

function setChain(next) {
  commit(() => { state.chain = next; });
  if (songPos >= next.length) songPos = 0;
  renderBanks();
}

function loadClassics() {
  commit(() => applyState(classicState(), { keepMetronome: true, keepPatch: true }), "Loaded the classic 808 sections");
  saveNow();
}

function initBanks() {
  document.querySelectorAll("[data-pbank]").forEach((el) => {
    el.addEventListener("click", () => pickBank(Number(el.dataset.pbank)));
  });
  document.querySelectorAll("[data-loop]").forEach((el) => {
    el.addEventListener("click", () => sectionPlay(Number(el.dataset.loop)));
  });
  document.querySelectorAll("[data-seclen]").forEach((el) => {
    el.addEventListener("change", () => setLooperLen(Number(el.dataset.seclen), Number(el.value)));
  });
  $("bank-copy").addEventListener("click", () => {
    bankClipboard = JSON.parse(JSON.stringify(state.pattern));
    renderBanks();
    showSnack(`Section ${BANK_NAMES[state.bank]} copied`);
  });
  $("bank-paste").addEventListener("click", () => {
    if (!bankClipboard) return;
    const copy = JSON.parse(JSON.stringify(bankClipboard));
    commit(() => { state.pattern = copy; }, `Pasted into section ${BANK_NAMES[state.bank]}`);
    renderSeq();
    renderInspector();
    renderBanks();
  });
  $("song").addEventListener("click", songButton);
  $("chain").addEventListener("click", (e) => {
    const chip = e.target.closest?.("[data-ci]");
    if (!chip) return;
    const i = Number(chip.dataset.ci);
    setChain(state.chain.map((b, j) => (j === i ? (b + 1) % PATTERN_BANKS : b)));
  });
  document.querySelectorAll("[data-append]").forEach((el) => {
    el.addEventListener("click", () => {
      if (state.chain.length >= CHAIN_MAX) return;
      setChain([...state.chain, Number(el.dataset.append)]);
    });
  });
  $("chain-del").addEventListener("click", () => {
    if (!state.chain.length) return;
    setChain(state.chain.slice(0, -1));
  });
  $("chain-clear").addEventListener("click", () => {
    setChain([]);
    showSnack("Song cleared: tap +A, +B, +C, +D to build it", true);
  });
  $("classic-load").addEventListener("click", loadClassics);
}

// ---- Tape deck: a cassette transport per layer (track) ----
// ▶ PLAY: the layer plays in sync with the beat. ⟲ LOOP: it loops its own
// window (¼ bar … 2 bars, or custom steps) on the global clock, so layers of
// different lengths run polymetrically. ■ STOP: silent. ◀◀ REW: back to the
// top of its loop. While the beat plays, every change lands on the next bar
// line (like section switches). ▶ ALL puts every layer back in sync at the
// next bar. Reels spin with CSS (no rAF) and only while a layer rolls; the tape
// counters update once per bar, and only while the deck panel is open.
const layerQueue = new Map(); // track -> { mode?, rew? }
let syncQueued = false;
const LOOP_WINDOWS = [
  { id: "4", label: "¼ bar", start: 0, end: 4 },
  { id: "8", label: "½ bar", start: 0, end: 8 },
  { id: "16", label: "1 bar", start: 0, end: 16 },
  { id: "32", label: "2 bars", start: 0, end: 32 },
];
let deckRows = [];
const deckOpen = () => Boolean($("deck-panel")?.open);

function applyLayerOp(t, q, at) {
  const l = layers[t];
  if (q.mode === "play" || q.mode === "stop") l.mode = q.mode;
  if (q.mode === "loop" && l.mode !== "loop") {
    l.mode = "loop";
    l.origin = at;
  }
  if (q.rew) {
    if (l.mode === "play") l.mode = "loop";
    l.origin = at;
  }
}

function applyLayerQueue(when) {
  if (syncQueued) {
    for (const l of layers) {
      l.mode = "play";
      l.origin = absStep;
    }
    logSwitch(state.bank, "sync");
  }
  for (const [t, q] of layerQueue) applyLayerOp(t, q, absStep);
  if (layerQueue.size) logSwitch(state.bank, "layers");
  layerQueue.clear();
  syncQueued = false;
  queueUi(when, renderDeck);
}

/** A deck button on layer `t`: "play" | "loop" | "stop" | "rew". */
function layerAction(t, action) {
  const q = action === "rew" ? { rew: true } : { mode: action };
  if (!state.playing) {
    applyLayerOp(t, q, 0);
    if (action === "play" || action === "loop") {
      cancelCountIn();
      setPlaying(true);
    }
    renderDeck();
    return;
  }
  const prev = layerQueue.get(t) || {};
  layerQueue.set(t, action === "rew" ? { ...prev, rew: true } : { ...prev, mode: action });
  renderDeckRow(t);
}

function syncAll() {
  if (!state.playing) {
    for (const l of layers) { l.mode = "play"; l.origin = 0; }
    layerQueue.clear();
    cancelCountIn();
    setPlaying(true);
    renderDeck();
    return;
  }
  syncQueued = true;
  layerQueue.clear();
  renderDeck();
}

function windowId(l) {
  const w = LOOP_WINDOWS.find((x) => x.start === l.start && x.end === l.end);
  return w ? w.id : "custom";
}

function setLayerWindow(t, start, end) {
  const l = layers[t];
  const s0 = Math.max(0, Math.min(31, start));
  l.start = s0;
  l.end = Math.max(s0 + 1, Math.min(32, end));
  // A looping layer picks the new window up from its top at the next bar.
  if (l.mode === "loop") {
    if (state.playing) layerQueue.set(t, { ...(layerQueue.get(t) || {}), rew: true });
    else l.origin = 0;
  }
  scheduleAutosave();
  renderDeckRow(t);
}

function initDeck() {
  const root = $("deck");
  root.innerHTML = "";
  deckRows = TRACKS.map((name, t) => {
    const row = document.createElement("div");
    row.className = "deck";
    row.dataset.layer = String(t);
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", `${name} layer transport`);
    const reel = document.createElement("span");
    reel.className = "reel";
    reel.setAttribute("aria-hidden", "true");
    const label = document.createElement("b");
    label.textContent = name;
    const count = document.createElement("span");
    count.className = "tcount";
    count.setAttribute("aria-hidden", "true");
    count.textContent = "000";
    const btn = (act, text, aria) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "mini";
      b.dataset.la = act;
      b.textContent = text;
      b.setAttribute("aria-label", `${aria} ${name}`);
      return b;
    };
    const play = btn("play", "▶", "Play in sync:");
    const loop = btn("loop", "⟲", "Loop on its own:");
    const stop = btn("stop", "■", "Stop:");
    const rew = btn("rew", "◀◀", "Rewind to the top of the loop:");
    const win = document.createElement("select");
    win.setAttribute("aria-label", `${name} loop length`);
    for (const w of LOOP_WINDOWS) win.add(new Option(w.label, w.id));
    win.add(new Option("custom", "custom"));
    const custom = document.createElement("span");
    custom.className = "lcustom";
    const num = (aria) => {
      const i = document.createElement("input");
      i.type = "number";
      i.min = "1";
      i.max = "32";
      i.setAttribute("aria-label", `${name} loop ${aria} step`);
      return i;
    };
    const ls = num("start");
    const le = num("end");
    custom.append(ls, "–", le);
    const status = document.createElement("span");
    status.className = "lstat hint";
    row.append(reel, label, count, play, loop, stop, rew, win, custom, status);
    play.addEventListener("click", () => layerAction(t, "play"));
    loop.addEventListener("click", () => layerAction(t, "loop"));
    stop.addEventListener("click", () => layerAction(t, "stop"));
    rew.addEventListener("click", () => layerAction(t, "rew"));
    win.addEventListener("change", () => {
      const w = LOOP_WINDOWS.find((x) => x.id === win.value);
      if (w) setLayerWindow(t, w.start, w.end);
      else renderDeckRow(t, true);
    });
    const onCustom = () => setLayerWindow(t, (Number(ls.value) || 1) - 1, Number(le.value) || 16);
    ls.addEventListener("change", onCustom);
    le.addEventListener("change", onCustom);
    root.appendChild(row);
    return { row, count, play, loop, stop, win, custom, ls, le, status };
  });
  $("deck-all").addEventListener("click", syncAll);
  $("deck-panel").addEventListener("toggle", () => { renderDeck(); renderCounters(); });
  renderDeck();
}

function renderDeckRow(t, forceCustom = false) {
  const r = deckRows[t];
  if (!r) return;
  const l = layers[t];
  const q = layerQueue.get(t);
  const pending = q?.mode || (q?.rew ? "rew" : syncQueued ? "play" : null);
  const rolling = state.playing && l.mode !== "stop";
  r.row.classList.toggle("rolling", rolling);
  r.row.classList.toggle("stopped", l.mode === "stop");
  for (const [b, m] of [[r.play, "play"], [r.loop, "loop"], [r.stop, "stop"]]) {
    b.classList.toggle("on", l.mode === m);
    b.classList.toggle("queued", pending === m);
    b.setAttribute("aria-pressed", String(l.mode === m));
  }
  const id = forceCustom ? "custom" : windowId(l);
  r.win.value = id;
  r.custom.hidden = id !== "custom";
  r.ls.value = String(l.start + 1);
  r.le.value = String(l.end);
  r.status.textContent = pending ? `${pending === "rew" ? "rewind" : pending} at next bar` : l.mode === "loop" ? `loop ${l.start + 1}–${l.end}` : "";
}

function renderDeck() {
  for (let t = 0; t < deckRows.length; t++) renderDeckRow(t);
  const all = $("deck-all");
  if (all) all.classList.toggle("queued", syncQueued);
  const tape = $("tape");
  if (tape) {
    tape.classList.toggle("on", state.tape);
    tape.setAttribute("aria-pressed", String(state.tape));
  }
}

// Tape counters: the layer's pass through its loop (or bars since PLAY).
function renderCounters() {
  if (!deckOpen()) return;
  layers.forEach((l, t) => {
    const r = deckRows[t];
    if (!r) return;
    let n = 0;
    if (state.playing) {
      const len = l.mode === "loop" ? Math.max(1, l.end - l.start) : BAR_STEPS;
      n = Math.floor(Math.max(0, absStep - (l.mode === "loop" ? l.origin : 0)) / len) + 1;
    }
    r.count.textContent = String(n % 1000).padStart(3, "0");
  });
}

/** Layers for an export: as they are now, with every loop starting at the top. */
function exportLayers() {
  return layers.map((l) => ({ ...l, origin: 0 }));
}

// ---- Mixer ----
const MIX_PARAMS = [
  { key: "vol", label: "VOL", min: 0, max: 1, fmt: (v) => `${Math.round(v * 100)}` },
  { key: "pan", label: "PAN", min: -1, max: 1, fmt: (v) => (Math.abs(v) < 0.005 ? "C" : `${v < 0 ? "L" : "R"}${Math.round(Math.abs(v) * 100)}`) },
  { key: "rev", label: "REV", min: 0, max: 1, fmt: (v) => `${Math.round(v * 100)}` },
  { key: "dly", label: "DLY", min: 0, max: 1, fmt: (v) => `${Math.round(v * 100)}` },
];
let mixInputs = [];

function initMixer() {
  const root = $("mixer");
  root.innerHTML = "";
  mixInputs = TRACKS.map((name, t) => {
    const row = document.createElement("div");
    row.className = "mix-row";
    const b = document.createElement("b");
    b.textContent = `${t + 1}. ${name}`;
    row.appendChild(b);
    const inputs = {};
    for (const p of MIX_PARAMS) {
      const label = document.createElement("label");
      const cap = document.createElement("span");
      const input = document.createElement("input");
      input.type = "range";
      input.min = String(p.min);
      input.max = String(p.max);
      input.step = "0.01";
      input.dataset.t = String(t);
      input.dataset.k = p.key;
      input.setAttribute("aria-label", `${name} ${p.key === "vol" ? "volume" : p.key === "pan" ? "pan" : p.key === "rev" ? "reverb send" : "delay send"}`);
      label.append(cap, input);
      row.appendChild(label);
      inputs[p.key] = { input, cap, p };
    }
    root.appendChild(row);
    return inputs;
  });
  root.addEventListener("input", (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || el.dataset.k == null) return;
    beginEdit();
    const t = Number(el.dataset.t);
    const v = Math.round(Number(el.value) * 100) / 100;
    state.mixer = state.mixer.map((m, i) => (i === t ? { ...m, [el.dataset.k]: v } : m));
    studio.setTrackMix(t, state.mixer[t]);
    renderMixerRow(t);
  });
  root.addEventListener("change", endEdit);
  // Double-click a fader to reset it.
  root.addEventListener("dblclick", (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || el.dataset.k == null) return;
    const t = Number(el.dataset.t);
    commit(() => {
      state.mixer = state.mixer.map((m, i) => (i === t ? { ...m, [el.dataset.k]: defaultMix()[el.dataset.k] } : m));
    });
    studio.setTrackMix(t, state.mixer[t]);
    renderMixerRow(t);
  });
}

function renderMixerRow(t) {
  const inputs = mixInputs[t];
  if (!inputs) return;
  for (const { input, cap, p } of Object.values(inputs)) {
    const v = state.mixer[t][p.key];
    if (document.activeElement !== input) input.value = String(v);
    cap.textContent = `${p.label} ${p.fmt(v)}`;
  }
}

function renderMixer() {
  for (let t = 0; t < mixInputs.length; t++) renderMixerRow(t);
}

// ---- Samples (mic / file -> IndexedDB -> pads and track sources) ----
const sampleRecs = new Map(); // slot -> { name, rate, pcm }
let micRec = null; // { slot, recorder, stream, timer }

function sampleLabel(slot) {
  const rec = sampleRecs.get(slot);
  return rec ? `${slot}. ${rec.name}` : `Sample ${slot} (empty)`;
}

function renderSamples() {
  const grid = $("smp-grid");
  const canRec = !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  if (!grid.childElementCount) {
    for (let slot = 1; slot <= SAMPLE_SLOTS; slot++) {
      const box = document.createElement("div");
      box.className = "smp";
      box.dataset.slot = String(slot);
      box.innerHTML = `<button class="pad" type="button" data-sact="play"><b>${slot}</b><small></small></button>
        <div class="acts"><button class="mini rec" type="button" data-sact="rec">REC</button><button class="mini" type="button" data-sact="load">LOAD</button><button class="mini" type="button" data-sact="del">CLEAR</button></div>`;
      grid.appendChild(box);
    }
  }
  for (const box of grid.children) {
    const slot = Number(box.dataset.slot);
    const rec = sampleRecs.get(slot);
    const recording = micRec?.slot === slot;
    box.querySelector("small").textContent = recording ? "recording…" : rec ? `${rec.name} · ${(rec.pcm.length / rec.rate).toFixed(1)} s` : "empty";
    const play = box.querySelector('[data-sact="play"]');
    play.disabled = !rec;
    play.setAttribute("aria-label", `Play ${sampleLabel(slot)}`);
    const recBtn = box.querySelector('[data-sact="rec"]');
    recBtn.hidden = !canRec;
    recBtn.textContent = recording ? "STOP" : "REC";
    recBtn.classList.toggle("on", recording);
    recBtn.setAttribute("aria-label", recording ? `Stop recording sample ${slot}` : `Record sample ${slot} from the microphone`);
    recBtn.disabled = !!micRec && !recording;
    box.querySelector('[data-sact="load"]').setAttribute("aria-label", `Load an audio file into sample ${slot}`);
    const del = box.querySelector('[data-sact="del"]');
    del.disabled = !rec;
    del.setAttribute("aria-label", `Clear sample ${slot}`);
  }
  // Show sample names in the track sound picker.
  for (const opt of $("trk-src").querySelectorAll('option[value^="smp:"]')) {
    opt.textContent = sampleLabel(Number(opt.value.slice(4)));
  }
  updateRows();
}

function updateRows() {
  for (let t = 0; t < seqMeta.length; t++) {
    if (seqMeta[t]) seqMeta[t].name.textContent = `${TRACKS[t]} · ${sourceLabel(state.pattern[t].source)}`;
  }
}

async function storeSample(slot, channels, rate, name) {
  const prep = prepareSample(channels, rate);
  if (!prep) {
    $("smp-status").textContent = "That was silent, nothing saved.";
    return;
  }
  const rec = { name: name.slice(0, 32) || `Sample ${slot}`, rate: prep.rate, pcm: prep.pcm };
  sampleRecs.set(slot, rec);
  studio.setSample(slot, rec);
  renderSamples();
  let saved = true;
  try {
    await saveSample(slot, rec);
  } catch {
    saved = false;
  }
  $("smp-status").textContent = `Sample ${slot}: ${rec.name}, ${prep.seconds.toFixed(1)} s${prep.truncated ? ` (cut to ${MAX_SAMPLE_SEC} s)` : ""}.`
    + (saved ? "" : " This browser won't store it, so it's gone after a reload.");
  if (arm()) studio.playSample(slot, studio.ctx.currentTime + 0.02, 0.9);
}

async function decodeInto(slot, arrayBuffer, name) {
  if (!arm()) return;
  let buf;
  try {
    buf = await studio.ctx.decodeAudioData(arrayBuffer);
  } catch {
    $("smp-status").textContent = "Couldn't read that audio. Try WAV, MP3, M4A/AAC or OGG.";
    return;
  }
  const channels = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  await storeSample(slot, channels, buf.sampleRate, name);
}

function pickFile(slot) {
  const input = $("smp-file");
  input.value = "";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      $("smp-status").textContent = `That file is ${(file.size / 1048576).toFixed(1)} MB; the limit is ${MAX_FILE_BYTES / 1048576} MB.`;
      return;
    }
    $("smp-status").textContent = "Loading…";
    await decodeInto(slot, await file.arrayBuffer(), file.name.replace(/\.[^.]+$/, ""));
  };
  input.click();
}

function stopMic() {
  if (!micRec) return;
  clearTimeout(micRec.timer);
  try { micRec.recorder.stop(); } catch { /* already stopped */ }
}

async function startMic(slot) {
  if (micRec) return;
  if (!arm()) return;
  let stream;
  try {
    // Raw mic: no echo cancellation / noise suppression / AGC on a sample.
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  } catch (e) {
    $("smp-status").textContent = e?.name === "NotAllowedError" ? "Microphone access was blocked. Allow it in the browser's site settings to record." : "No microphone available.";
    return;
  }
  const type = pickRecordType((t) => MediaRecorder.isTypeSupported(t));
  let recorder;
  try {
    recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  } catch {
    stream.getTracks().forEach((t) => t.stop());
    $("smp-status").textContent = "This browser can't record audio.";
    return;
  }
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  recorder.onstop = async () => {
    // Release the mic right away (iPhone shows the orange dot until we do).
    stream.getTracks().forEach((t) => t.stop());
    micRec = null;
    renderSamples();
    const blob = new Blob(chunks, { type: recorder.mimeType || type || "audio/mp4" });
    if (!blob.size) {
      $("smp-status").textContent = "Nothing was recorded.";
      return;
    }
    await decodeInto(slot, await blob.arrayBuffer(), `Mic ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
  };
  micRec = { slot, recorder, stream, timer: window.setTimeout(stopMic, MAX_SAMPLE_SEC * 1000) };
  recorder.start();
  $("smp-status").textContent = `Recording sample ${slot}… tap STOP (stops by itself at ${MAX_SAMPLE_SEC} s).`;
  renderSamples();
}

async function clearSample(slot) {
  const rec = sampleRecs.get(slot);
  if (!rec) return;
  sampleRecs.delete(slot);
  studio.setSample(slot, null);
  try { await deleteSample(slot); } catch { /* not stored */ }
  renderSamples();
  showSnack(`Cleared sample ${slot}`, false, async () => {
    sampleRecs.set(slot, rec);
    studio.setSample(slot, rec);
    try { await saveSample(slot, rec); } catch { /* keep in memory */ }
    renderSamples();
  });
}

async function initSamples() {
  $("smp-grid").addEventListener("click", (e) => {
    const btn = e.target.closest?.("[data-sact]");
    if (!btn) return;
    const slot = Number(btn.closest(".smp").dataset.slot);
    const act = btn.dataset.sact;
    if (act === "play" && arm()) studio.playSample(slot, studio.ctx.currentTime, 0.9);
    else if (act === "rec") (micRec ? stopMic() : void startMic(slot));
    else if (act === "load") pickFile(slot);
    else if (act === "del") void clearSample(slot);
  });
  renderSamples();
  const stored = await loadSamples();
  for (const [slot, rec] of stored) {
    sampleRecs.set(slot, rec);
    studio.setSample(slot, rec);
  }
  renderSamples();
}

// ---- MIDI input (Web MIDI; not available on iPhone/iPad Safari) ----
let midiOn = false;

function midiNote(msg) {
  if (!arm()) return;
  if (msg.ch === 9) {
    // GM drums on channel 10 play the matching sequencer track's sound.
    if (msg.type !== "on") return;
    const track = drumTrackForNote(msg.note);
    const row = state.pattern[track];
    studio.triggerSource(row.source, row.steps[0], studio.ctx.currentTime, msg.vel, { track });
    return;
  }
  if (msg.type === "on") studio.down(msg.note, `midi:${msg.note}`, Math.max(0.2, msg.vel));
  else studio.up(msg.note, `midi:${msg.note}`);
}

function initMidi() {
  const btn = $("midi");
  const status = $("midi-status");
  if (!midiSupported()) {
    btn.disabled = true;
    btn.title = "Web MIDI isn't available in this browser";
    status.textContent = "MIDI input works in Chrome, Edge and Firefox on desktop and Android. iPhone and iPad Safari don't support Web MIDI.";
    return;
  }
  status.textContent = "Connect a MIDI keyboard or pad controller, then press MIDI. Channel 10 plays the drum tracks (GM map); other channels play the synth.";
  const show = (names) => {
    status.textContent = names.length ? `MIDI: ${names.join(", ")}` : "MIDI is on. No devices connected yet.";
  };
  btn.addEventListener("click", async () => {
    if (midiOn) return;
    btn.disabled = true;
    const res = await connectMidi(midiNote, show);
    btn.disabled = false;
    if (!res.ok) {
      status.textContent = res.reason === "denied" ? "MIDI access was blocked for this site." : "Couldn't start MIDI.";
      return;
    }
    midiOn = true;
    btn.classList.add("on");
    btn.setAttribute("aria-pressed", "true");
    show(res.inputs);
  });
}

// ---- Recording with optional one-bar count-in ----
let countIn = null;

async function toggleRec() {
  state.recording = await studio.toggleRecord();
  $("rec").textContent = state.recording ? "● REC" : "○ REC";
  $("rec").classList.toggle("on", state.recording);
}

function startCountIn() {
  const c = studio.ctx;
  const beat = 60 / state.bpm;
  const t0 = c.currentTime + 0.1;
  const downbeat = t0 + 4 * beat;
  studio.keepAwake = true;
  const timers = [];
  for (let i = 0; i < 4; i++) {
    studio.click(t0 + i * beat, i === 0);
    queuePulse(t0 + i * beat, i === 0);
    timers.push(window.setTimeout(() => {
      $("rec").textContent = `COUNT ${4 - i}`;
    }, Math.max(0, (t0 + i * beat + outputDelay() - c.currentTime) * 1000)));
  }
  $("rec").classList.add("on");
  // Start the recorder just before the downbeat so nothing is cut off; the
  // count-in clicks are on the speaker-only metronome bus, so they're never recorded.
  timers.push(window.setTimeout(async () => {
    countIn = null;
    await toggleRec();
    setPlaying(true, downbeat);
  }, Math.max(0, (downbeat - c.currentTime) * 1000 - 80)));
  countIn = { timers };
}

function cancelCountIn() {
  if (!countIn) return;
  for (const id of countIn.timers) clearTimeout(id);
  countIn = null;
  studio.keepAwake = state.playing;
  $("rec").textContent = "○ REC";
  $("rec").classList.remove("on");
}

// Scope rendering only runs while there is something to show (playing, or a
// sound was triggered in the last ~1.5 s), the page is visible and the scope is
// on screen. It is capped at ~30 fps and draws a decimated waveform.
const SCOPE_FRAME_MS = 1000 / 30;
const SCOPE_POINTS = 256;
const SCOPE_LINGER_MS = 1500;
let scopeRaf = 0;
let lastScopeDraw = 0;
let scopeOnScreen = true;
let scopeDirty = true;

function scopeWanted() {
  if (document.hidden || !scopeOnScreen || !studio.ctx) return false;
  return state.playing || performance.now() - studio.lastUse < SCOPE_LINGER_MS;
}

function kickScope() {
  if (scopeRaf || !scopeWanted()) return;
  studio.setScopeTap(true);
  scopeRaf = requestAnimationFrame(scopeTick);
}

function scopeTick(now) {
  scopeRaf = 0;
  if (!scopeWanted()) {
    studio.setScopeTap(false);
    drawScopes(true);
    return;
  }
  if (now - lastScopeDraw >= SCOPE_FRAME_MS - 2) {
    lastScopeDraw = now;
    drawScopes(false);
  }
  scopeRaf = requestAnimationFrame(scopeTick);
}

function stopScope() {
  if (scopeRaf) cancelAnimationFrame(scopeRaf);
  scopeRaf = 0;
  studio.setScopeTap(false);
}

const visible = (el) => el.offsetParent !== null;

function drawScopes(idle) {
  if (idle && !scopeDirty) return;
  scopeDirty = !idle;
  const scope = $("scope");
  const minis = [$("mini-wave"), $("mini-freq")].filter(visible);
  const live = idle ? { time: null, freq: null, level: 0 } : studio.readFrame(minis.length === 2);
  if (visible(scope)) drawMainScope(scope, live);
  for (const c of minis) drawMini(c, c.id === "mini-freq", live);
}

function drawMainScope(scope, frame) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.floor(scope.clientWidth * dpr));
  const h = Math.max(1, Math.floor(scope.clientHeight * dpr));
  if (scope.width !== w || scope.height !== h) {
    scope.width = w;
    scope.height = h;
  }
  const ctx = scope.getContext("2d");
  ctx.fillStyle = "#100c0b";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#3d312b";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < 4; i++) {
    ctx.moveTo(0, (h / 4) * i);
    ctx.lineTo(w * 0.94, (h / 4) * i);
  }
  ctx.stroke();
  ctx.beginPath();
  ctx.strokeStyle = "#e25c4a";
  ctx.lineWidth = Math.max(1.5, dpr);
  const time = frame.time;
  if (time) {
    const stride = Math.max(1, Math.floor(time.length / SCOPE_POINTS));
    const n = Math.floor(time.length / stride);
    for (let k = 0; k < n; k++) {
      const v = (time[k * stride] - 128) / 128;
      const x = (k / Math.max(1, n - 1)) * w * 0.94;
      const y = h / 2 - v * h * 0.46;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  } else {
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w * 0.94, h / 2);
  }
  ctx.stroke();
  const meterW = Math.max(8, Math.floor(w * 0.04));
  ctx.fillStyle = "#3d312b";
  ctx.fillRect(w - meterW, 0, meterW, h);
  ctx.fillStyle = "#e25c4a";
  ctx.fillRect(w - meterW, h - frame.level * h, meterW, frame.level * h);
}

function drawMini(c, isFreq, frame) {
  const g = c.getContext("2d");
  g.clearRect(0, 0, c.width, c.height);
  if (isFreq) {
    if (!frame.freq) return;
    g.fillStyle = "rgba(190,249,255,0.9)";
    const len = frame.freq.length;
    for (let i = 0; i < len; i += 2) {
      const v = frame.freq[i] / 255;
      if (v <= 0) continue;
      g.fillRect((i / len) * c.width, c.height - v * c.height, (c.width / len) * 1.6, v * c.height);
    }
  } else {
    g.strokeStyle = "#7df9ff";
    g.beginPath();
    const time = frame.time;
    if (!time) {
      g.moveTo(0, c.height / 2);
      g.lineTo(c.width, c.height / 2);
    } else {
      const stride = Math.max(1, Math.floor(time.length / 128));
      const n = Math.floor(time.length / stride);
      for (let k = 0; k < n; k++) {
        const x = (k / n) * c.width;
        const y = ((time[k * stride] / 128 - 1) * c.height * 0.5) + c.height / 2;
        if (k === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
    }
    g.stroke();
  }
}

function initScopeWatchers() {
  studio.onActivity = kickScope;
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => {
      scopeOnScreen = entries.some((e) => e.isIntersecting);
      if (scopeOnScreen) kickScope();
    }).observe($("scope"));
  }
  document.addEventListener("visibilitychange", () => {
    studio.setHidden(document.hidden);
    if (document.hidden) stopScope();
    else kickScope();
  });
  scopeDirty = true;
  drawScopes(true);
}

function bind() {
  const setBpm = (v) => {
    state.bpm = Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(Number(v) || state.bpm)));
    $("bpm").value = String(state.bpm);
    $("bpm-num").value = String(state.bpm);
    studio.setSendTempo(state.bpm);
  };
  $("bpm").addEventListener("input", () => {
    beginEdit();
    setBpm($("bpm").value);
  });
  $("bpm").addEventListener("change", endEdit);
  $("bpm-num").addEventListener("change", () => {
    beginEdit();
    setBpm($("bpm-num").value);
    endEdit();
  });
  const tapper = new TapTempo();
  $("tap").addEventListener("click", () => {
    const bpm = tapper.tap(performance.now());
    if (bpm == null) {
      showSnack("Keep tapping…");
      return;
    }
    beginEdit();
    setBpm(bpm);
    endEdit();
  });
  $("swing").addEventListener("input", () => {
    beginEdit();
    state.swing = Number($("swing").value);
    $("swing-val").textContent = String(state.swing);
  });
  $("swing").addEventListener("change", endEdit);
  $("metro").addEventListener("click", () => {
    state.metronome = { ...state.metronome, on: !state.metronome.on };
    if (state.metronome.on) arm();
    syncControls();
    scheduleAutosave();
  });
  $("metro-vol").addEventListener("input", () => {
    state.metronome = { ...state.metronome, vol: Number($("metro-vol").value) };
    studio.setMetronomeVolume(state.metronome.vol);
    scheduleAutosave();
  });
  $("undo").addEventListener("click", undo);
  $("redo").addEventListener("click", redo);
  $("share").addEventListener("click", () => { void shareBeat(); });
  $("snack-undo").addEventListener("click", () => {
    const act = snackAction;
    $("snack").hidden = true;
    snackAction = null;
    if (act) act();
  });
  $("slot-save").addEventListener("click", saveSlot);
  $("slot-load").addEventListener("click", loadSlot);
  $("slot-del").addEventListener("click", deleteSlot);
  $("vol").addEventListener("input", () => {
    if (studio.armed) studio.setMasterGain(Number($("vol").value));
  });
  // STOP ALL: stops every section looper (and the song). Starting sound is
  // always a section's own ▶ PLAY, SONG, or the tape deck.
  $("play").addEventListener("click", () => {
    cancelCountIn();
    if (state.playing) setPlaying(false);
  });
  $("limiter").addEventListener("click", () => {
    commit(() => { state.limiter = !state.limiter; });
    studio.setLimiter(state.limiter);
    $("limiter").classList.toggle("on", state.limiter);
  });
  $("tape").addEventListener("click", () => {
    state.tape = !state.tape;
    if (studio.armed) studio.setTape(state.tape);
    else studio.tapeOn = state.tape;
    renderDeck();
    scheduleAutosave();
    showSnack(state.tape ? "TAPE on: wow, flutter, warm saturation and hiss (still speaker-safe)" : "TAPE off");
  });
  $("crt").addEventListener("click", () => {
    state.crt = !state.crt;
    document.body.classList.toggle("crt", state.crt);
    $("crt").classList.toggle("on", state.crt);
  });
  $("rec").addEventListener("click", async () => {
    if (!arm()) return;
    if (countIn) {
      cancelCountIn();
      return;
    }
    // With the metronome on and the beat stopped, count in one bar, then start
    // recording and playback together on the downbeat.
    if (!state.recording && state.metronome.on && !state.playing) {
      startCountIn();
      return;
    }
    await toggleRec();
  });
  $("cut").addEventListener("click", () => {
    studio.allOff();
    state.padHeld = null;
    state.loopId = null;
    renderBank();
    renderLcd();
  });
  $("oct-down").addEventListener("click", () => {
    state.octave = Math.max(1, state.octave - 1);
    renderKeyboard();
  });
  $("oct-up").addEventListener("click", () => {
    state.octave = Math.min(5, state.octave + 1);
    renderKeyboard();
  });
  $("hat-roll").addEventListener("click", () => {
    if (!arm()) return;
    studio.hatRoll(hatDivisionToCount(state.hatDiv), 0.9);
  });
  $("clear").addEventListener("click", () => {
    commit(() => { state.pattern = clearPattern(state.pattern); }, "Pattern cleared");
    renderSeq();
  });
  $("randomize").addEventListener("click", () => {
    commit(() => { state.pattern = randomizePattern(state.pattern, state.length); }, "Pattern randomized");
    renderSeq();
  });
  $("dup").addEventListener("click", () => {
    commit(() => { state.pattern = duplicatePattern(state.pattern, state.length); }, "First half duplicated");
    renderSeq();
  });
  document.querySelectorAll("[data-len]").forEach((el) => {
    el.addEventListener("click", () => {
      commit(() => { state.length = Number(el.dataset.len); });
      renderSeq();
    });
  });
  document.querySelectorAll("[data-bank]").forEach((el) => {
    el.addEventListener("click", () => {
      state.hitBank = el.dataset.bank;
      renderBank();
    });
  });
  window.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
    // Keys typed on a focused step belong to the grid (handled there), except undo/redo.
    if (e.target instanceof Element && e.target.closest("#seq") && !(e.metaKey || e.ctrlKey)) return;
    const key = e.key.toLowerCase();
    if ((e.metaKey || e.ctrlKey) && (key === "z" || key === "y")) {
      e.preventDefault();
      if (key === "y" || e.shiftKey) redo();
      else undo();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (key === " ") {
      // Space = the selected section's own ▶ PLAY; while playing it stops everything.
      e.preventDefault();
      cancelCountIn();
      if (state.playing) setPlaying(false);
      else sectionPlay(state.bank);
      return;
    }
    if (key === "escape") {
      studio.allOff();
      return;
    }
    if (key === "[" || key === "]") {
      selectTrack(state.selectedTrack + (key === "]" ? 1 : -1));
      return;
    }
    if ((key === "z" || key === "arrowleft") && !e.repeat) {
      state.octave = Math.max(1, state.octave - 1);
      renderKeyboard();
      return;
    }
    if ((key === "x" || key === "arrowright") && !e.repeat) {
      state.octave = Math.min(5, state.octave + 1);
      renderKeyboard();
      return;
    }
    const drum = DRUM_KEYS[key];
    if (drum) {
      if (!arm()) return;
      studio.playNamed(drum, studio.ctx.currentTime, 0.9);
      return;
    }
    const idx = COMPUTER_KEYS.indexOf(key);
    if (idx >= 0) {
      e.preventDefault();
      if (e.repeat) return;
      if (!arm()) return;
      const midi = noteToMidi(KEYBOARD_NOTES[idx]) + (state.octave - 3) * 12;
      studio.down(midi, `comp:${key}`, 0.9);
    }
  });
  window.addEventListener("keyup", (e) => {
    const key = e.key.toLowerCase();
    const idx = COMPUTER_KEYS.indexOf(key);
    if (idx >= 0) {
      const midi = noteToMidi(KEYBOARD_NOTES[idx]) + (state.octave - 3) * 12;
      studio.up(midi, `comp:${key}`);
    }
  });
}

renderWaves();
renderKnobs();
renderBank();
renderKeyboard();
renderDrums();
renderSoundBanks();
renderPresets();
initTrackBar();
initSeqEvents();
initBanks();
initInspector();
initMixer();
initDeck();
void initSamples();
initMidi();
renderPaint();
renderSeq();
bind();
studio.setMixer(state.mixer);
renderBanks();
renderMixer();
renderInspector();
const restored = loadAutosave();
const fromLink = Boolean(shareCodeFromHash(location.hash));
syncControls();
renderSlots();
renderUndo();
initScopeWatchers();
window.addEventListener("pagehide", saveNow);
document.addEventListener("visibilitychange", () => { if (document.hidden && autosaveTimer) saveNow(); });
window.addEventListener("hashchange", () => { void loadShareFromHash(); });
$("export").addEventListener("click", () => { void exportWav(); });
$("ai-form").addEventListener("submit", (e) => { void writeBeat(e); });
// Offline support (PWA). Skipped on file:// and when service workers are unavailable.
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => { /* offline mode just isn't available */ });
  });
}
void loadShareFromHash();
if (!restored && !fromLink) {
  showSnack(legacyReplaced
    ? "The old ATLANTA NIGHT starter (never edited) was replaced by trap sections A–D. Tap ▶ PLAY on any section; tap another to layer it in"
    : "Four 808 trap sections are loaded: tap ▶ PLAY on A (or any section). Tap another ▶ PLAY to layer it in at the next bar; ▶ SONG plays A A B A C D");
}
$("toast").textContent = "Your beat autosaves in this browser and the app works offline once loaded. SHARE makes a link that opens this exact beat; EXPORT WAV renders a clean file. Keys: A–' synth (W E T Y U O P are the black keys), 1–8 drums, Space plays the selected section / stops all, Ctrl/Cmd+Z undo, Shift+Ctrl/Cmd+Z redo.";

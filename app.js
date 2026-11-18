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
} from "./src/music.mjs";
import {
  serializeState,
  sanitizeState,
  defaultMetronome,
  encodeShare,
  decodeShare,
  shareCodeFromHash,
  UndoStack,
  TapTempo,
  BPM_MIN,
  BPM_MAX,
} from "./src/state-io.mjs";

const studio = getStudio();
const state = {
  patch: { ...DEFAULT_PATCH },
  octave: 3,
  bank: "atlanta",
  armed: false,
  playing: false,
  bpm: 100,
  swing: 0,
  length: 16,
  pattern: applyPreset("ATLANTA NIGHT"),
  preset: "ATLANTA NIGHT",
  selectedTrack: 6,
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
};

const $ = (id) => document.getElementById(id);

// ---- Save, autosave, undo/redo -------------------------------------------
const AUTOSAVE_KEY = "nocturne.autosave.v1";
const SLOTS_KEY = "nocturne.slots.v1";
const MAX_SLOTS = 30;
const history = new UndoStack(100);
let pendingEdit = null;
let autosaveTimer = 0;

const snapshot = () => JSON.stringify(serializeState(state));
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
  const s = sanitizeState(typeof raw === "string" ? safeParse(raw) : raw);
  if (!s) return false;
  state.bpm = s.bpm;
  state.swing = s.swing;
  state.length = s.length;
  state.limiter = s.limiter;
  if (!keepPatch) state.patch = s.patch;
  state.pattern = s.pattern;
  if (!keepMetronome) state.metronome = s.metronome;
  studio.setPatch(state.patch);
  studio.setLimiter(state.limiter);
  syncControls();
  renderWaves();
  renderKnobs();
  renderSeq();
  renderPaint();
  renderLcd();
  return true;
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
    store()?.setItem(AUTOSAVE_KEY, snapshot());
  } catch { /* storage full or blocked: keep playing */ }
}

function loadAutosave() {
  const raw = store()?.getItem(AUTOSAVE_KEY);
  return raw ? applyState(raw) : false;
}

function readSlots() {
  const list = safeParse(store()?.getItem(SLOTS_KEY) || "[]");
  if (!Array.isArray(list)) return [];
  return list
    .filter((x) => x && typeof x.name === "string" && sanitizeState(x.state))
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
  slots.unshift({ name, at: Date.now(), state: serializeState(state) });
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

function showSnack(msg, withUndo = false, customUndo = null) {
  const el = $("snack");
  $("snack-msg").textContent = msg;
  snackAction = customUndo || (withUndo ? undo : null);
  $("snack-undo").hidden = !snackAction;
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
  const hint = state.bank === "atlanta"
    ? "Sine subs with a pitch-drop punch. Chords keep the 808 under a soft stack."
    : "Minor stabs, the tritone, and a chromatic church descent.";
  $("bank-hint").textContent = hint;
  $("notes-label").textContent = state.bank === "atlanta" ? "Subs" : "Notes";
  document.querySelectorAll("[data-bank]").forEach((el) => {
    el.classList.toggle("on", el.dataset.bank === state.bank);
  });
  fillHits($("pit-notes"), hitsIn(state.bank, "note"));
  fillHits($("pit-chords"), hitsIn(state.bank, "chord"));
  fillHits($("pit-loops"), hitsIn(state.bank, "loop"));
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
        if (arm()) studio.firePit(midi, studio.ctx.currentTime, 0.8, pitWaveFromSource(source) || state.patch.wave, 0.25);
        renderPaint();
      });
      root.appendChild(btn);
    }
  }
}

let suppressStepClickUntil = 0;

function renderSeq() {
  const root = $("seq");
  root.style.setProperty("--steps", String(state.length));
  $("seq-title").textContent = `12 TRACKS × ${state.length}`;
  document.querySelectorAll("[data-len]").forEach((el) => {
    el.classList.toggle("on", Number(el.dataset.len) === state.length);
  });
  root.innerHTML = "";
  state.pattern.forEach((row, track) => {
    const line = document.createElement("div");
    line.className = "seq-row";
    const meta = document.createElement("div");
    meta.className = "track-meta";
    const mute = document.createElement("button");
    mute.type = "button";
    mute.className = `ms${row.mute ? " on" : ""}`;
    mute.textContent = "M";
    mute.addEventListener("click", () => {
      commit(() => { row.mute = !row.mute; });
      renderSeq();
    });
    const solo = document.createElement("button");
    solo.type = "button";
    solo.className = `ms${row.solo ? " on" : ""}`;
    solo.textContent = "S";
    solo.addEventListener("click", () => {
      commit(() => { row.solo = !row.solo; });
      renderSeq();
    });
    const select = document.createElement("select");
    select.className = "src";
    select.title = TRACKS[track];
    for (const group of SOURCE_GROUPS) {
      const og = document.createElement("optgroup");
      og.label = `${TRACKS[track]} · ${group.label}`;
      for (const item of group.items) {
        const opt = document.createElement("option");
        opt.value = item.id;
        opt.textContent = `${TRACKS[track]} · ${item.label}`;
        og.appendChild(opt);
      }
      select.appendChild(og);
    }
    select.value = row.source;
    select.addEventListener("change", () => {
      commit(() => { state.pattern = setTrackSource(state.pattern, track, select.value); });
      state.selectedTrack = track;
      renderSeq();
      renderPaint();
    });
    select.addEventListener("focus", () => {
      state.selectedTrack = track;
      renderPaint();
    });
    meta.append(mute, solo, select);
    line.appendChild(meta);
    for (let step = 0; step < state.length; step++) {
      const cell = row.steps[step];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `step${cell.on ? " on" : ""}${step % 4 === 0 ? " beat" : ""}${state.currentStep === step ? " now" : ""}`;
      if (cell.on && sourceIsMelodic(row.source)) {
        btn.textContent = sourceIsChord(row.source) ? (HITS.find((h) => h.id === cell.chordId)?.symbol || "•") : noteName(cell.note);
      }
      btn.style.setProperty("--vel", String(cell.vel));
      btn.setAttribute("aria-pressed", String(cell.on));
      btn.setAttribute("aria-label", `${TRACKS[track]} step ${step + 1}${cell.on ? `, velocity ${Math.round(cell.vel * 100)}%` : ""}`);
      if (cell.on) btn.title = `Velocity ${Math.round(cell.vel * 100)}% · hold, right-click or shift-click to change`;
      const preview = () => {
        const c = state.pattern[track].steps[step];
        if (c.on && arm()) studio.triggerSource(state.pattern[track].source, c, studio.ctx.currentTime, c.vel);
      };
      const paint = () => {
        state.selectedTrack = track;
        commit(() => {
          state.pattern = toggleStep(state.pattern, track, step, {
            note: state.paintNote,
            chordId: state.paintChord,
            vel: cell.vel,
            forceOn: cell.on ? null : true,
          });
        });
        renderSeq();
        renderPaint();
        preview();
      };
      const cycleVel = () => {
        state.selectedTrack = track;
        commit(() => { state.pattern = cycleStepVelocity(state.pattern, track, step); });
        renderSeq();
        preview();
      };
      // A hold cycles velocity and must not also toggle the step on release,
      // and the touch long-press "contextmenu" that some browsers fire after it
      // must not cycle a second time.
      let holdTimer = 0;
      const cancelHold = () => {
        if (holdTimer) clearTimeout(holdTimer);
        holdTimer = 0;
      };
      btn.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        cancelHold();
        holdTimer = window.setTimeout(() => {
          holdTimer = 0;
          suppressStepClickUntil = performance.now() + 700;
          cycleVel();
        }, 420);
      });
      btn.addEventListener("pointerup", cancelHold);
      btn.addEventListener("pointercancel", cancelHold);
      btn.addEventListener("pointerleave", cancelHold);
      btn.addEventListener("click", (e) => {
        if (performance.now() < suppressStepClickUntil) return;
        if (e.shiftKey) {
          cycleVel();
          return;
        }
        paint();
      });
      btn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        if (performance.now() < suppressStepClickUntil) return;
        cycleVel();
      });
      line.appendChild(btn);
    }
    root.appendChild(line);
  });
  cacheStepColumns();
}

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
    const step = stepIndex % state.length;
    const swing = step % 2 === 1 ? (state.swing / 100) * stepSec * 0.5 : 0;
    const when = nextTime + swing;
    const anySolo = state.pattern.some((row) => row.solo);
    state.pattern.forEach((row, track) => {
      if (row.mute) return;
      if (anySolo && !row.solo) return;
      const cell = row.steps[step];
      if (!cell.on) return;
      studio.triggerSource(row.source, cell, when, cell.vel);
    });
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
  $("play").textContent = on ? "STOP" : "PLAY";
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
    timer = window.setInterval(scheduler, 25);
    kickScope();
  } else {
    // Just move the playhead off; no need to rebuild the whole grid.
    clearLights();
    state.currentStep = -1;
    // The AudioContext suspends itself once tails have rung out (studio idle check).
    studio.lastUse = performance.now();
  }
  renderLcd();
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
  $("play").addEventListener("click", () => {
    cancelCountIn();
    setPlaying(!state.playing);
  });
  $("limiter").addEventListener("click", () => {
    commit(() => { state.limiter = !state.limiter; });
    studio.setLimiter(state.limiter);
    $("limiter").classList.toggle("on", state.limiter);
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
      state.bank = el.dataset.bank;
      renderBank();
    });
  });
  window.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
    const key = e.key.toLowerCase();
    if ((e.metaKey || e.ctrlKey) && (key === "z" || key === "y")) {
      e.preventDefault();
      if (key === "y" || e.shiftKey) redo();
      else undo();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (key === " ") {
      e.preventDefault();
      cancelCountIn();
      setPlaying(!state.playing);
      return;
    }
    if (key === "escape") {
      studio.allOff();
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
renderPaint();
renderSeq();
bind();
loadAutosave();
syncControls();
renderSlots();
renderUndo();
initScopeWatchers();
window.addEventListener("pagehide", saveNow);
document.addEventListener("visibilitychange", () => { if (document.hidden && autosaveTimer) saveNow(); });
window.addEventListener("hashchange", () => { void loadShareFromHash(); });
void loadShareFromHash();
$("toast").textContent = "Your beat autosaves in this browser. SHARE makes a link that opens this exact beat. Keys: A–' synth (W E T Y U O P are the black keys), 1–8 drums, Space play/stop, Ctrl/Cmd+Z undo, Shift+Ctrl/Cmd+Z redo.";

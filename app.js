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
  nudgeStepVelocity,
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
} from "./src/music.mjs";

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
  crt: true,
  recording: false,
  currentStep: -1,
  held: new Set(),
  padHeld: null,
  loopId: null,
  soundBank: "Memphis",
  active: [],
};

const $ = (id) => document.getElementById(id);

function arm() {
  if (!studio.arm()) return false;
  studio.setPatch(state.patch);
  studio.setLimiter(state.limiter);
  studio.setMasterGain(Number($("vol").value));
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
      state.pattern = applyPreset(name, state.length);
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

function renderSeq() {
  const root = $("seq");
  root.style.setProperty("--steps", String(state.length));
  $("seq-title").textContent = `12 TRACKS × ${state.length} — LOOKAHEAD 25ms`;
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
      row.mute = !row.mute;
      renderSeq();
    });
    const solo = document.createElement("button");
    solo.type = "button";
    solo.className = `ms${row.solo ? " on" : ""}`;
    solo.textContent = "S";
    solo.addEventListener("click", () => {
      row.solo = !row.solo;
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
      state.pattern = setTrackSource(state.pattern, track, select.value);
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
      const paint = () => {
        state.selectedTrack = track;
        state.pattern = toggleStep(state.pattern, track, step, {
          note: state.paintNote,
          chordId: state.paintChord,
          vel: cell.vel,
          forceOn: cell.on ? null : true,
        });
        renderSeq();
        renderPaint();
        if (state.pattern[track].steps[step].on && arm()) {
          studio.triggerSource(state.pattern[track].source, state.pattern[track].steps[step], studio.ctx.currentTime, state.pattern[track].steps[step].vel);
        }
      };
      btn.addEventListener("click", (e) => {
        if (e.shiftKey) {
          state.pattern = nudgeStepVelocity(state.pattern, track, step, 0.12);
          renderSeq();
          return;
        }
        paint();
      });
      btn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        state.pattern = nudgeStepVelocity(state.pattern, track, step, 0.12);
        renderSeq();
      });
      let holdTimer = 0;
      btn.addEventListener("pointerdown", () => {
        holdTimer = window.setTimeout(() => {
          state.pattern = nudgeStepVelocity(state.pattern, track, step, 0.12);
          renderSeq();
        }, 420);
      });
      btn.addEventListener("pointerup", () => clearTimeout(holdTimer));
      btn.addEventListener("pointercancel", () => clearTimeout(holdTimer));
      line.appendChild(btn);
    }
    root.appendChild(line);
  });
}

let timer = 0;
let nextTime = 0;
let stepIndex = 0;

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
    state.currentStep = step;
    nextTime += stepSec;
    stepIndex = (stepIndex + 1) % state.length;
  }
  const lights = document.querySelectorAll(".seq-row");
  lights.forEach((row) => {
    row.querySelectorAll(".step").forEach((btn, i) => btn.classList.toggle("now", i === state.currentStep));
  });
}

function setPlaying(on) {
  if (on && !arm()) return;
  state.playing = on;
  $("play").textContent = on ? "STOP" : "PLAY";
  $("play").classList.toggle("on", on);
  if (timer) {
    clearInterval(timer);
    timer = 0;
  }
  if (on) {
    nextTime = studio.ctx.currentTime + 0.05;
    stepIndex = 0;
    timer = window.setInterval(scheduler, 25);
  } else {
    state.currentStep = -1;
    renderSeq();
  }
  renderLcd();
}

function drawScopes() {
  const frame = studio.readFrame();
  const scope = $("scope");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const rect = scope.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width * dpr));
  const h = Math.max(1, Math.floor(rect.height * dpr));
  if (scope.width !== w || scope.height !== h) {
    scope.width = w;
    scope.height = h;
  }
  const ctx = scope.getContext("2d");
  ctx.fillStyle = "#100c0b";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#3d312b";
  ctx.beginPath();
  for (let i = 1; i < 4; i++) {
    ctx.moveTo(0, (h / 4) * i);
    ctx.lineTo(w * 0.94, (h / 4) * i);
  }
  ctx.stroke();
  const time = frame.time;
  ctx.beginPath();
  ctx.strokeStyle = "#e25c4a";
  ctx.lineWidth = Math.max(1.5, dpr);
  for (let i = 0; i < time.length; i++) {
    const v = (time[i] - 128) / 128;
    const x = (i / Math.max(1, time.length - 1)) * w * 0.94;
    const y = h / 2 - v * h * 0.46;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  const meterW = Math.max(8, Math.floor(w * 0.04));
  ctx.fillStyle = "#3d312b";
  ctx.fillRect(w - meterW, 0, meterW, h);
  ctx.fillStyle = "#e25c4a";
  ctx.fillRect(w - meterW, h - frame.level * h, meterW, frame.level * h);

  const drawMini = (id, freq) => {
    const c = $(id);
    const g = c.getContext("2d");
    g.clearRect(0, 0, c.width, c.height);
    if (freq) {
      for (let i = 0; i < frame.freq.length; i += 2) {
        const v = frame.freq[i] / 255;
        g.fillStyle = `rgba(${Math.floor(125 + v * 130)},249,255,0.9)`;
        g.fillRect((i / frame.freq.length) * c.width, c.height - v * c.height, (c.width / frame.freq.length) * 1.6, v * c.height);
      }
    } else {
      g.strokeStyle = "#7df9ff";
      g.beginPath();
      for (let i = 0; i < time.length; i++) {
        const x = (i / time.length) * c.width;
        const y = ((time[i] / 128 - 1) * c.height * 0.5) + c.height / 2;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
  };
  drawMini("mini-wave", false);
  drawMini("mini-freq", true);
  requestAnimationFrame(drawScopes);
}

function bind() {
  $("bpm").addEventListener("input", () => {
    state.bpm = Number($("bpm").value);
    $("bpm-val").textContent = String(state.bpm);
  });
  $("swing").addEventListener("input", () => {
    state.swing = Number($("swing").value);
    $("swing-val").textContent = String(state.swing);
  });
  $("vol").addEventListener("input", () => {
    if (studio.armed) studio.setMasterGain(Number($("vol").value));
  });
  $("play").addEventListener("click", () => setPlaying(!state.playing));
  $("limiter").addEventListener("click", () => {
    state.limiter = !state.limiter;
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
    state.recording = await studio.toggleRecord();
    $("rec").textContent = state.recording ? "● REC" : "○ REC";
    $("rec").classList.toggle("on", state.recording);
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
    state.pattern = clearPattern(state.pattern);
    renderSeq();
  });
  $("randomize").addEventListener("click", () => {
    state.pattern = randomizePattern(state.pattern, state.length);
    renderSeq();
  });
  $("dup").addEventListener("click", () => {
    state.pattern = duplicatePattern(state.pattern, state.length);
    renderSeq();
  });
  document.querySelectorAll("[data-len]").forEach((el) => {
    el.addEventListener("click", () => {
      state.length = Number(el.dataset.len);
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
    if (key === " ") {
      e.preventDefault();
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
requestAnimationFrame(drawScopes);
$("toast").textContent = "NOCTURNE keep: synth keyboard, trap drums, banks, 12-track sequencer, swing, mute/solo, presets, limiter, CRT, REC. 808 PIT: Atlanta/Memphis pads, waveform, filter, ADSR, scope, sequenceable notes and chords.";

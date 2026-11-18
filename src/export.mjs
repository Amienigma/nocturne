// Offline WAV export: renders the beat through the exact same Studio graph
// (voices -> master -> LIMITER -> always-on safety stage), with no metronome,
// on an OfflineAudioContext — glitch-free regardless of device load.
import { Studio } from "./audio.mjs";
import { encodeWav, trimTail } from "./wav.mjs";
import { bankForLoop, stepHits, seededRng } from "./sequencer.mjs";

export const EXPORT_BARS = [1, 2, 4, 8];
export const EXPORT_RATE = 48000;
export const TAIL_SEC = 5; // longest one-shot ~2.6 s + 4.2 s reverb, trimmed after render

/** Seconds of music (without tail) for `bars` bars of 16 sixteenth steps. */
export function barsDuration(bpm, bars) {
  return (60 / bpm / 4) * 16 * bars;
}

/** Steps to render: `bars` bars normally; the whole chain once in song mode. */
export function exportSteps(state, bars) {
  if (state.song && Array.isArray(state.chain) && state.chain.length) return state.chain.length * state.length;
  return 16 * bars;
}

/** Same timing, mute/solo, ratchet, probability and song rules as the live scheduler. */
export function scheduleSteps(state, bars, startAt = 0, rng = seededRng(1)) {
  const stepSec = 60 / state.bpm / 4;
  const total = exportSteps(state, bars);
  const banks = Array.isArray(state.banks) ? state.banks : [state.pattern];
  const events = [];
  for (let i = 0; i < total; i++) {
    const step = i % state.length;
    const loop = Math.floor(i / state.length);
    const pattern = Array.isArray(state.banks) ? banks[bankForLoop(state, loop)] : state.pattern;
    const swing = step % 2 === 1 ? (state.swing / 100) * stepSec * 0.5 : 0;
    const when = startAt + i * stepSec + swing;
    for (const h of stepHits(pattern, step, stepSec, rng)) {
      events.push({ source: h.source, cell: h.cell, when: when + h.at, vel: h.vel, opts: h.opts });
    }
  }
  events.sort((x, y) => x.when - y.when);
  return events;
}

/**
 * Render `bars` bars to WAV.
 * @returns {Promise<{blob: Blob, seconds: number, peak: number, channels: Float32Array[]}>}
 */
export async function renderWav(state, { bars = 4, bitDepth = 16, masterGain = 0.85, onProgress = () => {} } = {}) {
  const Ctor = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Ctor) throw new Error("This browser can't render audio offline");
  const music = (60 / state.bpm / 4) * exportSteps(state, bars);
  const seconds = music + TAIL_SEC;
  const ctx = new Ctor(2, Math.ceil(seconds * EXPORT_RATE), EXPORT_RATE);
  const s = new Studio();
  s.offline = true;
  s.ctx = ctx;
  s.keepAwake = true;
  s.masterGain = masterGain;
  s.limiterOn = !!state.limiter;
  s.patch = { ...s.patch, ...state.patch };
  s.build();
  s.applyPatch();
  s.setMixer(state.mixer);
  s.setSendTempo(state.bpm);
  // Metronome stays silent: metroBus gain is 0 and no clicks are scheduled.
  const start = 0.02;
  const events = scheduleSteps(state, bars, start);
  let next = 0;
  const scheduleUntil = (t) => {
    while (next < events.length && events[next].when < t) {
      const ev = events[next++];
      s.triggerSource(ev.source, ev.cell, ev.when, ev.vel, ev.opts);
    }
  };
  // Schedule voices just ahead of the render position (like the live
  // sequencer) instead of all up front: an offline graph with every voice
  // of 8 bars alive at once renders several times slower. The same suspend
  // points drive the progress bar. Without offline suspend(), fall back to
  // scheduling everything first.
  const CHUNK = 0.5;
  let chunked = typeof ctx.suspend === "function";
  if (chunked) {
    try {
      for (let t = CHUNK; t < seconds; t += CHUNK) {
        const at = t;
        ctx.suspend(at).then(() => {
          scheduleUntil(at + CHUNK * 2);
          onProgress(Math.min(0.99, at / seconds));
          return ctx.resume();
        }).catch(() => { /* render ended */ });
      }
    } catch {
      chunked = false;
    }
  }
  scheduleUntil(chunked ? CHUNK * 2 : Infinity);
  onProgress(0);
  const rendered = await ctx.startRendering();
  onProgress(1);
  for (const conv of s.reverbSends.values()) for (const node of conv.values()) try { node.disconnect(); } catch { /* done */ }
  if (s.sends) for (const node of Object.values(s.sends)) try { node.disconnect(); } catch { /* done */ }

  const raw = [rendered.getChannelData(0), rendered.getChannelData(1)];
  const channels = trimTail(raw, {
    minFrames: Math.ceil((start + music) * EXPORT_RATE),
    padFrames: Math.round(0.05 * EXPORT_RATE),
    fadeFrames: Math.round(0.01 * EXPORT_RATE),
  });
  let peak = 0;
  for (const c of channels) for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > peak) peak = a; }
  const wav = encodeWav(channels, EXPORT_RATE, { bitDepth });
  return { blob: new Blob([wav], { type: "audio/wav" }), seconds: channels[0].length / EXPORT_RATE, peak, channels };
}

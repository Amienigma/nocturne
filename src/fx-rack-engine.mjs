/**
 * FXRackEngine for NOCTURNE
 * Multi-slot effects rack supporting reverb, delay, distortion, chorus, flanger,
 * EQ, and compressor inserts. Designed for real-time Web Audio API use.
 * 
 * @module FXRackEngine
 * @version 1.0.0
 * @date 2026-11-19
 */

export class FXRackEngine {
  constructor(audioContext, slots = 8) {
    if (!audioContext) throw new Error("AudioContext required");
    this.ctx = audioContext;
    this.slots = slots;
    this.effects = new Array(slots).fill(null);
    this.bypass = new Array(slots).fill(false);
    this.wetDry = new Array(slots).fill(0.5);
    this.input = this.ctx.createGain();
    this.output = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.output.connect(this.analyser);
    this.initialized = false;
    this.presets = this.loadPresets();
  }

  loadPresets() {
    return {
      ambient: {
        name: "Ambient Wash",
        slots: [
          { type: "reverb", mix: 0.6, params: { decay: 4.0, predelay: 0.02 } },
          { type: "delay", mix: 0.3, params: { time: 0.375, feedback: 0.4 } },
          { type: "chorus", mix: 0.4, params: { rate: 0.5, depth: 0.3 } },
        ],
      },
      aggressive: {
        name: "Aggressive Distortion",
        slots: [
          { type: "distortion", mix: 0.7, params: { drive: 0.8, tone: 0.6 } },
          { type: "eq", mix: 1.0, params: { bands: [{freq: 200, gain: 3}, {freq: 4000, gain: 2}] } },
          { type: "compressor", mix: 1.0, params: { threshold: -12, ratio: 4 } },
        ],
      },
      spacey: {
        name: "Spacey Delay",
        slots: [
          { type: "delay", mix: 0.5, params: { time: 0.5, feedback: 0.6 } },
          { type: "flanger", mix: 0.4, params: { rate: 0.2, depth: 0.7 } },
          { type: "reverb", mix: 0.4, params: { decay: 3.0 } },
        ],
      },
    };
  }

  async init() {
    if (this.initialized) return;
    // Pre-create common effect nodes for reuse
    this.effectPool = {
      reverb: [],
      delay: [],
      distortion: [],
      chorus: [],
      flanger: [],
      eq: [],
      compressor: [],
    };
    this.initialized = true;
    return this;
  }

  createEffect(type, params = {}) {
    const ctx = this.ctx;
    let node;
    switch (type) {
      case "reverb":
        node = ctx.createConvolver();
        // Simplified impulse (in real use, load IR)
        const length = ctx.sampleRate * (params.decay || 2);
        const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
        for (let c = 0; c < 2; c++) {
          const data = impulse.getChannelData(c);
          for (let i = 0; i < length; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
          }
        }
        node.buffer = impulse;
        break;
      case "delay":
        node = ctx.createDelay(2.0);
        node.delayTime.value = params.time || 0.3;
        const fb = ctx.createGain();
        fb.gain.value = params.feedback || 0.4;
        node.connect(fb);
        fb.connect(node);
        node._feedback = fb;
        break;
      case "distortion":
        node = ctx.createWaveShaper();
        node.curve = this.makeDistortionCurve(params.drive || 0.5);
        node.oversample = "4x";
        break;
      case "chorus":
      case "flanger":
        node = ctx.createDelay(0.05);
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        lfo.frequency.value = params.rate || 0.5;
        lfoGain.gain.value = params.depth || 0.002;
        lfo.connect(lfoGain);
        lfoGain.connect(node.delayTime);
        lfo.start();
        node._lfo = lfo;
        break;
      case "eq":
        node = ctx.createBiquadFilter();
        node.type = "peaking";
        node.frequency.value = params.freq || 1000;
        node.gain.value = params.gain || 0;
        break;
      case "compressor":
        node = ctx.createDynamicsCompressor();
        node.threshold.value = params.threshold || -24;
        node.ratio.value = params.ratio || 2;
        break;
      default:
        node = ctx.createGain();
    }
    return node;
  }

  makeDistortionCurve(amount = 0.5) {
    const n = 44100;
    const curve = new Float32Array(n);
    const deg = Math.PI / 180;
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
    }
    return curve;
  }

  insertEffect(slot, type, params = {}, mix = 0.5) {
    if (slot < 0 || slot >= this.slots) throw new Error("Invalid slot");
    const effect = this.createEffect(type, params);
    this.effects[slot] = { type, node: effect, params, mix };
    this.wetDry[slot] = mix;
    this.bypass[slot] = false;
    this.rewire();
    return this;
  }

  rewire() {
    // Disconnect previous
    try { this.input.disconnect(); } catch {}
    let current = this.input;
    for (let i = 0; i < this.slots; i++) {
      const fx = this.effects[i];
      if (!fx || this.bypass[i]) continue;
      const dry = this.ctx.createGain();
      const wet = this.ctx.createGain();
      const merger = this.ctx.createGain();
      dry.gain.value = 1 - this.wetDry[i];
      wet.gain.value = this.wetDry[i];
      current.connect(dry);
      current.connect(fx.node);
      fx.node.connect(wet);
      dry.connect(merger);
      wet.connect(merger);
      current = merger;
    }
    current.connect(this.output);
  }

  setMix(slot, mix) {
    this.wetDry[slot] = Math.max(0, Math.min(1, mix));
    this.rewire();
  }

  bypassSlot(slot, bypassed = true) {
    this.bypass[slot] = bypassed;
    this.rewire();
  }

  applyPreset(name) {
    const preset = this.presets[name];
    if (!preset) throw new Error("Unknown preset");
    this.clear();
    preset.slots.forEach((s, i) => {
      this.insertEffect(i, s.type, s.params, s.mix);
    });
    return preset;
  }

  clear() {
    this.effects = new Array(this.slots).fill(null);
    this.rewire();
  }

  connect(source) {
    if (!this.initialized) this.init();
    source.connect(this.input);
    return this.analyser;
  }

  getMetrics() {
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    return { averageLevel: sum / data.length, activeSlots: this.effects.filter(Boolean).length };
  }

  exportState() {
    return {
      effects: this.effects.map(fx => fx ? { type: fx.type, params: fx.params, mix: fx.mix } : null),
      bypass: [...this.bypass],
      wetDry: [...this.wetDry],
    };
  }
}

export default FXRackEngine;

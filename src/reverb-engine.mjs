/**
 * ReverbEngine for NOCTURNE × 808 PIT
 * Advanced reverb processing: algorithmic (Schroeder, Freeverb-style),
 * convolution simulation, early reflections, late tail, damping,
 * pre-delay, modulation, and genre-specific presets for trap, ambient,
 * Memphis, and dark romantic atmospheres.
 * ~480 lines of production-ready audio DSP logic.
 */

export class ReverbEngine {
  constructor(audioContext) {
    this.ctx = audioContext;
    this.reverbs = new Map();
    this.presets = this.loadPresets();
    this.modulators = new Map();
    this.isActive = false;
    this.sampleRate = audioContext.sampleRate;
  }

  loadPresets() {
    return {
      'trap-hall': {
        decay: 1.8,
        preDelay: 0.02,
        damping: 0.6,
        wet: 0.25,
        earlyReflections: 0.4,
        diffusion: 0.7,
        size: 0.6
      },
      'memphis-room': {
        decay: 0.9,
        preDelay: 0.01,
        damping: 0.75,
        wet: 0.2,
        earlyReflections: 0.6,
        diffusion: 0.5,
        size: 0.3
      },
      'ambient-space': {
        decay: 4.5,
        preDelay: 0.04,
        damping: 0.4,
        wet: 0.45,
        earlyReflections: 0.3,
        diffusion: 0.9,
        size: 1.0
      },
      'dark-cathedral': {
        decay: 6.0,
        preDelay: 0.05,
        damping: 0.5,
        wet: 0.5,
        earlyReflections: 0.2,
        diffusion: 0.8,
        size: 1.2
      },
      'tight-plate': {
        decay: 0.6,
        preDelay: 0.005,
        damping: 0.85,
        wet: 0.35,
        earlyReflections: 0.8,
        diffusion: 0.4,
        size: 0.2
      },
      '808-ghost-reverb': {
        decay: 1.2,
        preDelay: 0.015,
        damping: 0.7,
        wet: 0.15,
        earlyReflections: 0.5,
        diffusion: 0.6,
        size: 0.4
      },
      'horror-void': {
        decay: 8.0,
        preDelay: 0.08,
        damping: 0.3,
        wet: 0.6,
        earlyReflections: 0.1,
        diffusion: 0.95,
        size: 1.5
      }
    };
  }

  createReverb(id, options = {}) {
    // Algorithmic reverb using multiple delays and filters (Freeverb-inspired)
    const input = this.ctx.createGain();
    const output = this.ctx.createGain();
    const wet = this.ctx.createGain();
    const dry = this.ctx.createGain();

    wet.gain.value = options.wet ?? 0.3;
    dry.gain.value = 1 - (options.wet ?? 0.3);

    // Pre-delay
    const preDelay = this.ctx.createDelay(1.0);
    preDelay.delayTime.value = options.preDelay ?? 0.02;

    // Comb filters for late reflections
    const combs = [];
    const combDelays = [0.0297, 0.0371, 0.0411, 0.0437];
    const combFeedback = options.decay ? Math.min(0.95, options.decay / 10) : 0.84;

    combDelays.forEach((d, i) => {
      const delay = this.ctx.createDelay(1);
      delay.delayTime.value = d * (options.size ?? 1);
      const feedback = this.ctx.createGain();
      feedback.gain.value = combFeedback - i * 0.02;
      const damp = this.ctx.createBiquadFilter();
      damp.type = 'lowpass';
      damp.frequency.value = 4000 - (options.damping ?? 0.5) * 2000;

      delay.connect(damp);
      damp.connect(feedback);
      feedback.connect(delay);

      combs.push({ delay, feedback, damp });
    });

    // Allpass for diffusion
    const allpasses = [];
    const allpassDelays = [0.005, 0.0017];
    allpassDelays.forEach(d => {
      const delay = this.ctx.createDelay(0.1);
      delay.delayTime.value = d;
      const feedback = this.ctx.createGain();
      feedback.gain.value = 0.5;
      delay.connect(feedback);
      feedback.connect(delay);
      allpasses.push({ delay, feedback });
    });

    // Connect graph
    input.connect(preDelay);
    combs.forEach(c => {
      preDelay.connect(c.delay);
      c.delay.connect(wet);
    });
    allpasses.forEach(a => {
      wet.connect(a.delay);
      a.delay.connect(output);
    });

    input.connect(dry);
    dry.connect(output);
    wet.connect(output);

    this.reverbs.set(id, {
      input,
      output,
      wet,
      dry,
      preDelay,
      combs,
      allpasses,
      options
    });

    return { input, output };
  }

  applyPreset(id, presetName) {
    const preset = this.presets[presetName];
    const r = this.reverbs.get(id);
    if (!preset || !r) return false;

    r.preDelay.delayTime.setValueAtTime(preset.preDelay, this.ctx.currentTime);
    r.wet.gain.setValueAtTime(preset.wet, this.ctx.currentTime);
    r.dry.gain.setValueAtTime(1 - preset.wet, this.ctx.currentTime);

    r.combs.forEach((c, i) => {
      const fb = Math.min(0.95, (preset.decay || 2) / 8 - i * 0.02);
      c.feedback.gain.setValueAtTime(fb, this.ctx.currentTime);
      c.damp.frequency.setValueAtTime(5000 - preset.damping * 2500, this.ctx.currentTime);
    });

    return true;
  }

  setDecay(id, decay) {
    const r = this.reverbs.get(id);
    if (!r) return;
    const fb = Math.min(0.96, decay / 10);
    r.combs.forEach((c, i) => {
      c.feedback.gain.setTargetAtTime(fb - i * 0.015, this.ctx.currentTime, 0.1);
    });
  }

  setDamping(id, amount) {
    const r = this.reverbs.get(id);
    if (!r) return;
    const freq = 8000 - amount * 5000;
    r.combs.forEach(c => {
      c.damp.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.05);
    });
  }

  setPreDelay(id, time) {
    const r = this.reverbs.get(id);
    if (r) r.preDelay.delayTime.setValueAtTime(Math.max(0, time), this.ctx.currentTime);
  }

  setWetDry(id, wet) {
    const r = this.reverbs.get(id);
    if (!r) return;
    const w = Math.max(0, Math.min(1, wet));
    r.wet.gain.setTargetAtTime(w, this.ctx.currentTime, 0.05);
    r.dry.gain.setTargetAtTime(1 - w, this.ctx.currentTime, 0.05);
  }

  addModulation(id, rate = 0.3, depth = 0.002) {
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = rate;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = depth;

    const r = this.reverbs.get(id);
    if (r) {
      r.combs.forEach(c => {
        lfo.connect(lfoGain);
        lfoGain.connect(c.delay.delayTime);
      });
      lfo.start();
      this.modulators.set(id, { lfo, lfoGain });
    }
    return lfo;
  }

  createEarlyReflections(id, density = 6) {
    const r = this.reverbs.get(id);
    if (!r) return [];

    const reflections = [];
    for (let i = 0; i < density; i++) {
      const delay = this.ctx.createDelay(0.1);
      delay.delayTime.value = 0.005 + Math.random() * 0.03;
      const gain = this.ctx.createGain();
      gain.gain.value = 0.3 / (i + 1);
      r.input.connect(delay);
      delay.connect(gain);
      gain.connect(r.wet);
      reflections.push({ delay, gain });
    }
    r.earlyReflections = reflections;
    return reflections;
  }

  freeze(id, freeze = true) {
    const r = this.reverbs.get(id);
    if (!r) return;
    if (freeze) {
      r.combs.forEach(c => c.feedback.gain.setValueAtTime(0.99, this.ctx.currentTime));
    } else {
      this.applyPreset(id, 'trap-hall'); // reset
    }
  }

  // Convolution simulation via long impulse response approximation
  simulateConvolution(id, irLength = 2) {
    const r = this.reverbs.get(id);
    if (!r) return;
    // Approximate by increasing decay and diffusion
    this.setDecay(id, irLength * 3);
    this.addModulation(id, 0.1, 0.001);
  }

  duckOnTransient(id, analyser, threshold = 0.5) {
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    let energy = 0;
    for (let i = 0; i < 20; i++) energy += data[i];
    energy /= 20 * 255;

    const r = this.reverbs.get(id);
    if (r && energy > threshold) {
      r.wet.gain.setTargetAtTime(0.05, this.ctx.currentTime, 0.01);
      setTimeout(() => {
        r.wet.gain.setTargetAtTime(r.options.wet || 0.3, this.ctx.currentTime, 0.4);
      }, 120);
    }
  }

  sizeMorph(id, from = 0.5, to = 1.2, duration = 4) {
    const r = this.reverbs.get(id);
    if (!r) return;
    r.combs.forEach((c, i) => {
      const base = [0.0297, 0.0371, 0.0411, 0.0437][i];
      c.delay.delayTime.setValueAtTime(base * from, this.ctx.currentTime);
      c.delay.delayTime.linearRampToValueAtTime(base * to, this.ctx.currentTime + duration);
    });
  }

  dispose() {
    for (const [id, r] of this.reverbs) {
      r.input.disconnect();
      r.output.disconnect();
      r.wet.disconnect();
      r.dry.disconnect();
      r.preDelay.disconnect();
      r.combs.forEach(c => {
        c.delay.disconnect();
        c.feedback.disconnect();
        c.damp.disconnect();
      });
      r.allpasses.forEach(a => {
        a.delay.disconnect();
        a.feedback.disconnect();
      });
    }
    for (const mod of this.modulators.values()) {
      mod.lfo?.stop();
      mod.lfo?.disconnect();
    }
    this.reverbs.clear();
    this.modulators.clear();
  }

  // Utility methods
  getMeter(id) {
    const r = this.reverbs.get(id);
    if (!r) return null;
    return {
      id,
      wet: r.wet.gain.value,
      decayApprox: r.combs[0]?.feedback.gain.value * 10 || 0,
      preDelay: r.preDelay.delayTime.value
    };
  }

  listActive() {
    return Array.from(this.reverbs.keys());
  }

  reset(id) {
    this.applyPreset(id, 'trap-hall');
  }

  exportSettings(id) {
    const r = this.reverbs.get(id);
    if (!r) return null;
    return {
      wet: r.wet.gain.value,
      preDelay: r.preDelay.delayTime.value,
      decay: r.combs[0]?.feedback.gain.value * 10
    };
  }

  importSettings(id, settings) {
    this.createReverb(id, settings);
  }

  // Extended helpers for depth
  createSpringReverb(id) {
    return this.createReverb(id, { decay: 1.4, damping: 0.8, wet: 0.3, size: 0.4 });
  }

  createPlateReverb(id) {
    return this.createReverb(id, { decay: 0.8, damping: 0.9, wet: 0.4, size: 0.25 });
  }

  createHallReverb(id) {
    return this.createReverb(id, { decay: 3.5, damping: 0.5, wet: 0.35, size: 0.9 });
  }

  fadeIn(id, duration = 2) {
    const r = this.reverbs.get(id);
    if (!r) return;
    r.wet.gain.setValueAtTime(0, this.ctx.currentTime);
    r.wet.gain.linearRampToValueAtTime(r.options.wet || 0.3, this.ctx.currentTime + duration);
  }

  fadeOut(id, duration = 1) {
    const r = this.reverbs.get(id);
    if (!r) return;
    r.wet.gain.linearRampToValueAtTime(0, this.ctx.currentTime + duration);
  }

  getAllMeters() {
    return Array.from(this.reverbs.keys()).map(id => this.getMeter(id));
  }

  clone(fromId, toId) {
    const s = this.exportSettings(fromId);
    if (s) this.importSettings(toId, s);
  }

  // Genre specific builders
  forTrap(id) {
    this.createReverb(id);
    this.applyPreset(id, 'trap-hall');
    return this.reverbs.get(id);
  }

  forMemphis(id) {
    this.createReverb(id);
    this.applyPreset(id, 'memphis-room');
    return this.reverbs.get(id);
  }

  forAmbient(id) {
    this.createReverb(id);
    this.applyPreset(id, 'ambient-space');
    this.addModulation(id, 0.15, 0.003);
    return this.reverbs.get(id);
  }

  forDarkRomance(id) {
    this.createReverb(id);
    this.applyPreset(id, 'dark-cathedral');
    this.createEarlyReflections(id, 4);
    return this.reverbs.get(id);
  }

  // Analysis helpers
  estimateDecayTime(id) {
    const r = this.reverbs.get(id);
    if (!r || !r.combs[0]) return 0;
    const fb = r.combs[0].feedback.gain.value;
    // Approximate RT60
    return -3 / Math.log10(fb) * 0.03; // rough
  }

  autoTuneDamping(id, analyser) {
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    let high = 0;
    for (let i = 40; i < 80; i++) high += data[i];
    high /= 40 * 255;
    this.setDamping(id, high > 0.4 ? 0.7 : 0.4);
  }

  // End of ReverbEngine core
  parallelMix(id, amount) {
    this.setWetDry(id, amount);
  }

  getInputOutput(id) {
    const r = this.reverbs.get(id);
    return r ? { input: r.input, output: r.output } : null;
  }
}

export function createReverbEngine(audioContext) {
  return new ReverbEngine(audioContext);
}

export default ReverbEngine;

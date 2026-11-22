/**
 * ModulationEngine for NOCTURNE × 808 PIT
 * Handles LFO, envelope modulation, parameter automation, and rhythmic modulation.
 * Added 2026-11-21 as daily code addition.
 */

export class ModulationEngine {
  constructor(audioContext) {
    this.ctx = audioContext;
    this.lfos = new Map();
    this.envelopes = new Map();
    this.modulators = new Map();
    this.automations = [];
    this.isRunning = false;
    this.clock = 0;
    this.bpm = 120;
    this.swing = 0.0;
    this.groove = 0.5;
    this.quantization = 16;
    this.modDepth = 1.0;
    this.syncEnabled = true;
    this.phaseOffset = 0;
    this.waveformCache = new Map();
    this.eventListeners = new Map();
    this.debugMode = false;
    this.performanceStats = {
      updates: 0,
      cpuLoad: 0,
      activeModulators: 0
    };
  }

  init() {
    this.startClock();
    this.setupDefaultLFOs();
    this.setupDefaultEnvelopes();
    console.log('ModulationEngine initialized');
  }

  startClock() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.tick();
  }

  stopClock() {
    this.isRunning = false;
  }

  tick() {
    if (!this.isRunning) return;
    const now = this.ctx.currentTime;
    this.clock += (this.bpm / 60) * 0.016;
    this.updateAllModulators(now);
    this.processAutomations(now);
    this.performanceStats.updates++;
    requestAnimationFrame(() => this.tick());
  }

  setupDefaultLFOs() {
    this.addLFO('lfo1', { rate: 1.0, shape: 'sine', depth: 0.5, sync: true });
    this.addLFO('lfo2', { rate: 0.25, shape: 'square', depth: 0.3, sync: false });
    this.addLFO('lfo3', { rate: 4.0, shape: 'saw', depth: 0.2, sync: true });
  }

  setupDefaultEnvelopes() {
    this.addEnvelope('env1', { attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.3 });
    this.addEnvelope('env2', { attack: 0.05, decay: 0.1, sustain: 0.5, release: 0.5 });
  }

  addLFO(id, params = {}) {
    const lfo = {
      id,
      rate: params.rate || 1.0,
      shape: params.shape || 'sine',
      depth: params.depth || 0.5,
      phase: params.phase || 0,
      sync: params.sync || false,
      offset: params.offset || 0,
      value: 0,
      lastUpdate: 0,
      active: true
    };
    this.lfos.set(id, lfo);
    this.modulators.set(id, lfo);
    return lfo;
  }

  addEnvelope(id, params = {}) {
    const env = {
      id,
      attack: params.attack || 0.01,
      decay: params.decay || 0.1,
      sustain: params.sustain || 0.5,
      release: params.release || 0.3,
      stage: 'idle',
      value: 0,
      startTime: 0,
      active: true
    };
    this.envelopes.set(id, env);
    this.modulators.set(id, env);
    return env;
  }

  triggerEnvelope(id) {
    const env = this.envelopes.get(id);
    if (env) {
      env.stage = 'attack';
      env.startTime = this.ctx.currentTime;
      env.value = 0;
    }
  }

  releaseEnvelope(id) {
    const env = this.envelopes.get(id);
    if (env && env.stage !== 'idle') {
      env.stage = 'release';
      env.startTime = this.ctx.currentTime;
    }
  }

  updateAllModulators(time) {
    for (const [id, mod] of this.modulators) {
      if (!mod.active) continue;
      if (this.lfos.has(id)) {
        this.updateLFO(mod, time);
      } else if (this.envelopes.has(id)) {
        this.updateEnvelope(mod, time);
      }
    }
    this.performanceStats.activeModulators = this.modulators.size;
  }

  updateLFO(lfo, time) {
    const dt = time - lfo.lastUpdate;
    lfo.lastUpdate = time;
    let phaseAdvance = lfo.rate * dt;
    if (lfo.sync && this.syncEnabled) {
      phaseAdvance = (this.bpm / 60) * lfo.rate * dt;
    }
    lfo.phase = (lfo.phase + phaseAdvance) % (Math.PI * 2);
    lfo.value = this.getWaveformValue(lfo.shape, lfo.phase) * lfo.depth + lfo.offset;
    this.emit('lfoUpdate', { id: lfo.id, value: lfo.value });
  }

  updateEnvelope(env, time) {
    const elapsed = time - env.startTime;
    switch (env.stage) {
      case 'attack':
        if (elapsed < env.attack) {
          env.value = elapsed / env.attack;
        } else {
          env.stage = 'decay';
          env.startTime = time;
        }
        break;
      case 'decay':
        if (elapsed < env.decay) {
          env.value = 1 - (1 - env.sustain) * (elapsed / env.decay);
        } else {
          env.stage = 'sustain';
          env.value = env.sustain;
        }
        break;
      case 'sustain':
        env.value = env.sustain;
        break;
      case 'release':
        if (elapsed < env.release) {
          env.value = env.sustain * (1 - elapsed / env.release);
        } else {
          env.stage = 'idle';
          env.value = 0;
        }
        break;
      default:
        env.value = 0;
    }
    this.emit('envelopeUpdate', { id: env.id, value: env.value, stage: env.stage });
  }

  getWaveformValue(shape, phase) {
    const key = `${shape}-${phase.toFixed(4)}`;
    if (this.waveformCache.has(key)) return this.waveformCache.get(key);
    let value = 0;
    switch (shape) {
      case 'sine':
        value = Math.sin(phase);
        break;
      case 'square':
        value = Math.sin(phase) > 0 ? 1 : -1;
        break;
      case 'saw':
        value = 2 * (phase / (Math.PI * 2) - Math.floor(phase / (Math.PI * 2) + 0.5));
        break;
      case 'triangle':
        value = Math.abs(2 * (phase / (Math.PI * 2) - Math.floor(phase / (Math.PI * 2) + 0.5))) * 2 - 1;
        break;
      case 'noise':
        value = Math.random() * 2 - 1;
        break;
      default:
        value = Math.sin(phase);
    }
    this.waveformCache.set(key, value);
    if (this.waveformCache.size > 1000) this.waveformCache.clear();
    return value;
  }

  modulateParameter(target, paramName, modulatorId, amount = 1.0) {
    const mod = this.modulators.get(modulatorId);
    if (!mod) return;
    const baseValue = target[paramName] || 0;
    const modValue = mod.value * amount * this.modDepth;
    target[paramName] = baseValue + modValue;
    this.emit('parameterModulated', { target: target.id || 'unknown', param: paramName, value: target[paramName] });
  }

  addAutomation(param, startValue, endValue, duration, curve = 'linear') {
    this.automations.push({
      param,
      startValue,
      endValue,
      duration,
      curve,
      startTime: this.ctx.currentTime,
      active: true
    });
  }

  processAutomations(time) {
    this.automations = this.automations.filter(auto => {
      if (!auto.active) return false;
      const elapsed = time - auto.startTime;
      if (elapsed >= auto.duration) {
        auto.active = false;
        return false;
      }
      const progress = elapsed / auto.duration;
      let value;
      switch (auto.curve) {
        case 'exponential':
          value = auto.startValue * Math.pow(auto.endValue / auto.startValue, progress);
          break;
        case 'logarithmic':
          value = auto.startValue + (auto.endValue - auto.startValue) * Math.log(1 + progress * (Math.E - 1));
          break;
        default:
          value = auto.startValue + (auto.endValue - auto.startValue) * progress;
      }
      if (auto.param && typeof auto.param.setValueAtTime === 'function') {
        auto.param.setValueAtTime(value, time);
      }
      return true;
    });
  }

  setBPM(bpm) {
    this.bpm = Math.max(40, Math.min(240, bpm));
    this.emit('bpmChanged', this.bpm);
  }

  setSwing(amount) {
    this.swing = Math.max(0, Math.min(1, amount));
  }

  setGroove(amount) {
    this.groove = Math.max(0, Math.min(1, amount));
  }

  quantize(time) {
    const beat = 60 / this.bpm;
    const grid = beat / this.quantization;
    return Math.round(time / grid) * grid;
  }

  applySwing(step) {
    if (step % 2 === 1) {
      return this.swing * (60 / this.bpm) / this.quantization;
    }
    return 0;
  }

  on(event, callback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push(callback);
  }

  emit(event, data) {
    const listeners = this.eventListeners.get(event) || [];
    listeners.forEach(cb => cb(data));
  }

  getStats() {
    return {
      ...this.performanceStats,
      lfoCount: this.lfos.size,
      envelopeCount: this.envelopes.size,
      automationCount: this.automations.length,
      bpm: this.bpm,
      clock: this.clock
    };
  }

  reset() {
    this.lfos.clear();
    this.envelopes.clear();
    this.modulators.clear();
    this.automations = [];
    this.clock = 0;
    this.setupDefaultLFOs();
    this.setupDefaultEnvelopes();
  }

  destroy() {
    this.stopClock();
    this.reset();
    this.eventListeners.clear();
    this.waveformCache.clear();
  }

  createComplexModulation(baseId, layers = 3) {
    for (let i = 0; i < layers; i++) {
      this.addLFO(`${baseId}-layer${i}`, {
        rate: 0.5 * Math.pow(2, i),
        shape: ['sine', 'triangle', 'saw'][i % 3],
        depth: 0.3 / (i + 1),
        sync: true
      });
    }
  }

  crossfadeModulators(id1, id2, mix) {
    const m1 = this.modulators.get(id1);
    const m2 = this.modulators.get(id2);
    if (m1 && m2) {
      return m1.value * (1 - mix) + m2.value * mix;
    }
    return 0;
  }

  randomizeRates(min = 0.1, max = 8.0) {
    for (const lfo of this.lfos.values()) {
      lfo.rate = min + Math.random() * (max - min);
    }
  }

  syncAllToBPM() {
    for (const lfo of this.lfos.values()) {
      lfo.sync = true;
    }
    this.syncEnabled = true;
  }

  exportState() {
    return {
      bpm: this.bpm,
      swing: this.swing,
      groove: this.groove,
      lfos: Array.from(this.lfos.entries()),
      envelopes: Array.from(this.envelopes.entries())
    };
  }

  importState(state) {
    if (state.bpm) this.setBPM(state.bpm);
    if (state.swing) this.setSwing(state.swing);
    if (state.groove) this.setGroove(state.groove);
  }

  logDebug(message) {
    if (this.debugMode) {
      console.log(`[ModulationEngine] ${message}`);
    }
  }

  setDebug(enabled) {
    this.debugMode = enabled;
  }

  getActiveModulatorValues() {
    const values = {};
    for (const [id, mod] of this.modulators) {
      if (mod.active) {
        values[id] = mod.value;
      }
    }
    return values;
  }

  applyPatternModulation(pattern, modulatorId) {
    const mod = this.modulators.get(modulatorId);
    if (!mod) return pattern;
    return pattern.map((step, i) => {
      const modInfluence = Math.abs(mod.value) * this.groove;
      return step * (1 + modInfluence * (i % 4 === 0 ? 0.2 : -0.1));
    });
  }

  version = '1.0.0';
  description = 'Advanced modulation system for NOCTURNE beat-making studio';
}

export default ModulationEngine;

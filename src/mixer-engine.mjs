/**
 * MixerEngine - Advanced mixing console for NOCTURNE beat studio
 * Handles multi-channel mixing, EQ, dynamics, sends, and automation
 * @module MixerEngine
 */

export class MixerEngine {
  constructor(audioContext, options = {}) {
    this.ctx = audioContext;
    this.channels = new Map();
    this.master = null;
    this.buses = new Map();
    this.automation = new Map();
    this.presets = new Map();
    this.metering = true;
    this.sampleRate = audioContext.sampleRate;
    this.initializeMaster();
    this.loadDefaultPresets();
    console.log('[MixerEngine] Initialized with', this.sampleRate, 'Hz');
  }

  initializeMaster() {
    this.master = {
      gain: this.ctx.createGain(),
      compressor: this.ctx.createDynamicsCompressor(),
      analyser: this.ctx.createAnalyser(),
      limiter: this.ctx.createDynamicsCompressor()
    };
    this.master.gain.gain.value = 0.8;
    this.master.compressor.threshold.value = -12;
    this.master.compressor.ratio.value = 4;
    this.master.compressor.attack.value = 0.003;
    this.master.compressor.release.value = 0.25;
    this.master.analyser.fftSize = 2048;
    this.master.limiter.threshold.value = -1;
    this.master.limiter.ratio.value = 20;
    this.master.gain.connect(this.master.compressor);
    this.master.compressor.connect(this.master.analyser);
    this.master.analyser.connect(this.master.limiter);
    this.master.limiter.connect(this.ctx.destination);
  }

  createChannel(id, options = {}) {
    const channel = {
      id,
      gain: this.ctx.createGain(),
      pan: this.ctx.createStereoPanner(),
      eq: {
        low: this.ctx.createBiquadFilter(),
        mid: this.ctx.createBiquadFilter(),
        high: this.ctx.createBiquadFilter()
      },
      compressor: this.ctx.createDynamicsCompressor(),
      sends: new Map(),
      mute: false,
      solo: false,
      input: null,
      analyser: this.ctx.createAnalyser()
    };

    channel.eq.low.type = 'lowshelf';
    channel.eq.low.frequency.value = 120;
    channel.eq.mid.type = 'peaking';
    channel.eq.mid.frequency.value = 1000;
    channel.eq.mid.Q.value = 1;
    channel.eq.high.type = 'highshelf';
    channel.eq.high.frequency.value = 8000;

    channel.gain.gain.value = options.volume || 0.7;
    channel.pan.pan.value = options.pan || 0;

    channel.gain.connect(channel.eq.low);
    channel.eq.low.connect(channel.eq.mid);
    channel.eq.mid.connect(channel.eq.high);
    channel.eq.high.connect(channel.compressor);
    channel.compressor.connect(channel.analyser);
    channel.analyser.connect(channel.pan);
    channel.pan.connect(this.master.gain);

    this.channels.set(id, channel);
    return channel;
  }

  setVolume(channelId, value) {
    const ch = this.channels.get(channelId);
    if (ch) ch.gain.gain.setTargetAtTime(value, this.ctx.currentTime, 0.05);
  }

  setPan(channelId, value) {
    const ch = this.channels.get(channelId);
    if (ch) ch.pan.pan.setTargetAtTime(value, this.ctx.currentTime, 0.05);
  }

  setEQ(channelId, band, frequency, gain, q = 1) {
    const ch = this.channels.get(channelId);
    if (!ch || !ch.eq[band]) return;
    const filter = ch.eq[band];
    filter.frequency.setTargetAtTime(frequency, this.ctx.currentTime, 0.1);
    filter.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.1);
    if (filter.Q) filter.Q.setTargetAtTime(q, this.ctx.currentTime, 0.1);
  }

  addSend(channelId, busId, amount = 0.3) {
    const ch = this.channels.get(channelId);
    const bus = this.buses.get(busId);
    if (!ch || !bus) return;
    const sendGain = this.ctx.createGain();
    sendGain.gain.value = amount;
    ch.analyser.connect(sendGain);
    sendGain.connect(bus.input);
    ch.sends.set(busId, sendGain);
  }

  createBus(id, type = 'reverb') {
    const bus = {
      id,
      type,
      input: this.ctx.createGain(),
      output: this.ctx.createGain(),
      effect: null
    };
    if (type === 'reverb') {
      bus.effect = this.createReverb();
      bus.input.connect(bus.effect);
      bus.effect.connect(bus.output);
    } else if (type === 'delay') {
      bus.effect = this.createDelay();
      bus.input.connect(bus.effect);
      bus.effect.connect(bus.output);
    }
    bus.output.connect(this.master.gain);
    this.buses.set(id, bus);
    return bus;
  }

  createReverb() {
    const convolver = this.ctx.createConvolver();
    const length = this.sampleRate * 2;
    const impulse = this.ctx.createBuffer(2, length, this.sampleRate);
    for (let c = 0; c < 2; c++) {
      const channelData = impulse.getChannelData(c);
      for (let i = 0; i < length; i++) {
        channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
      }
    }
    convolver.buffer = impulse;
    return convolver;
  }

  createDelay() {
    const delay = this.ctx.createDelay(1.0);
    const feedback = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    delay.delayTime.value = 0.375;
    feedback.gain.value = 0.4;
    filter.type = 'lowpass';
    filter.frequency.value = 2000;
    delay.connect(feedback);
    feedback.connect(filter);
    filter.connect(delay);
    return delay;
  }

  mute(channelId, mute = true) {
    const ch = this.channels.get(channelId);
    if (ch) {
      ch.mute = mute;
      ch.gain.gain.setTargetAtTime(mute ? 0 : 0.7, this.ctx.currentTime, 0.05);
    }
  }

  solo(channelId, solo = true) {
    this.channels.forEach((ch, id) => {
      if (id !== channelId) {
        ch.gain.gain.setTargetAtTime(solo ? 0 : 0.7, this.ctx.currentTime, 0.05);
      }
    });
    const ch = this.channels.get(channelId);
    if (ch) ch.solo = solo;
  }

  getMeter(channelId) {
    const ch = this.channels.get(channelId) || this.master;
    if (!ch || !ch.analyser) return 0;
    const data = new Uint8Array(ch.analyser.frequencyBinCount);
    ch.analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    return sum / data.length / 255;
  }

  applyPreset(channelId, presetName) {
    const preset = this.presets.get(presetName);
    if (!preset) return;
    const ch = this.channels.get(channelId);
    if (!ch) return;
    this.setVolume(channelId, preset.volume);
    this.setPan(channelId, preset.pan);
    if (preset.eq) {
      Object.entries(preset.eq).forEach(([band, params]) => {
        this.setEQ(channelId, band, params.freq, params.gain, params.q);
      });
    }
  }

  loadDefaultPresets() {
    this.presets.set('kick', {
      volume: 0.85,
      pan: 0,
      eq: {
        low: { freq: 60, gain: 6, q: 1 },
        mid: { freq: 200, gain: -3, q: 1.2 },
        high: { freq: 5000, gain: 2, q: 0.7 }
      }
    });
    this.presets.set('snare', {
      volume: 0.75,
      pan: 0.1,
      eq: {
        low: { freq: 150, gain: 3, q: 1 },
        mid: { freq: 800, gain: 4, q: 1.5 },
        high: { freq: 6000, gain: 3, q: 0.8 }
      }
    });
    this.presets.set('hat', {
      volume: 0.6,
      pan: -0.2,
      eq: {
        low: { freq: 200, gain: -6, q: 1 },
        mid: { freq: 2000, gain: 2, q: 1 },
        high: { freq: 10000, gain: 5, q: 0.5 }
      }
    });
    this.presets.set('bass', {
      volume: 0.9,
      pan: 0,
      eq: {
        low: { freq: 80, gain: 8, q: 1 },
        mid: { freq: 400, gain: -2, q: 1.2 },
        high: { freq: 3000, gain: -4, q: 0.7 }
      }
    });
    this.presets.set('lead', {
      volume: 0.65,
      pan: 0.3,
      eq: {
        low: { freq: 300, gain: -4, q: 1 },
        mid: { freq: 1500, gain: 3, q: 1.5 },
        high: { freq: 7000, gain: 4, q: 0.6 }
      }
    });
  }

  automate(channelId, param, curve) {
    const ch = this.channels.get(channelId);
    if (!ch) return;
    const paramNode = this.getParamNode(ch, param);
    if (!paramNode) return;
    const now = this.ctx.currentTime;
    curve.forEach(point => {
      paramNode.setValueAtTime(point.value, now + point.time);
    });
    this.automation.set(`${channelId}:${param}`, curve);
  }

  getParamNode(channel, param) {
    if (param === 'volume') return channel.gain.gain;
    if (param === 'pan') return channel.pan.pan;
    if (param.startsWith('eq.')) {
      const band = param.split('.')[1];
      return channel.eq[band]?.gain;
    }
    return null;
  }

  exportState() {
    const state = {
      channels: {},
      buses: {},
      master: { volume: this.master.gain.gain.value }
    };
    this.channels.forEach((ch, id) => {
      state.channels[id] = {
        volume: ch.gain.gain.value,
        pan: ch.pan.pan.value,
        mute: ch.mute,
        solo: ch.solo
      };
    });
    return state;
  }

  importState(state) {
    if (state.channels) {
      Object.entries(state.channels).forEach(([id, data]) => {
        if (!this.channels.has(id)) this.createChannel(id);
        this.setVolume(id, data.volume);
        this.setPan(id, data.pan);
        if (data.mute) this.mute(id, true);
      });
    }
  }

  destroy() {
    this.channels.forEach(ch => {
      ch.gain.disconnect();
      ch.pan.disconnect();
    });
    this.channels.clear();
    this.buses.clear();
    console.log('[MixerEngine] Destroyed');
  }
}

export default MixerEngine;

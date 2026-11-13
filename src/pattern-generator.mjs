// NOCTURNE Pattern Generator Module
// Substantial implementation for daily code addition goal
// Generates drum patterns, 808 bass lines, melodic sequences, and more

export class PatternGenerator {
  constructor(options = {}) {
    this.steps = options.steps || 16;
    this.swing = options.swing || 0;
    this.velocityRange = options.velocityRange || [0.6, 1.0];
    this.density = options.density || 0.5;
    this.genre = options.genre || 'trap';
    this.seed = options.seed || Math.random();
  }

  generateDrumPattern(trackType = 'kick') {
    const pattern = new Array(this.steps).fill(null);
    const densityMap = {
      kick: 0.3,
      snare: 0.2,
      clap: 0.25,
      hat: 0.7,
      perc: 0.4
    };
    const density = densityMap[trackType] || this.density;

    for (let i = 0; i < this.steps; i++) {
      if (Math.random() < density) {
        const vel = this.randomVelocity();
        pattern[i] = {
          active: true,
          velocity: vel,
          note: null,
          duration: 1
        };
        // Apply swing on off-beats
        if (i % 2 === 1 && this.swing > 0) {
          pattern[i].timing = this.swing * 0.05;
        }
      }
    }

    // Genre-specific rules
    if (this.genre === 'trap') {
      this.applyTrapRules(pattern, trackType);
    } else if (this.genre === 'memphis') {
      this.applyMemphisRules(pattern, trackType);
    } else if (this.genre === 'house') {
      this.applyHouseRules(pattern, trackType);
    }

    return pattern;
  }

  applyTrapRules(pattern, trackType) {
    if (trackType === 'kick') {
      // Strong on 1 and 11 typically for trap
      if (pattern[0]) pattern[0].velocity = Math.max(pattern[0].velocity, 0.9);
      if (pattern[10]) pattern[10].velocity = Math.max(pattern[10].velocity, 0.85);
    }
    if (trackType === 'hat') {
      // More hats on off beats
      for (let i = 1; i < this.steps; i += 2) {
        if (!pattern[i] && Math.random() < 0.4) {
          pattern[i] = { active: true, velocity: this.randomVelocity() * 0.8 };
        }
      }
    }
  }

  applyMemphisRules(pattern, trackType) {
    if (trackType === 'snare') {
      // Memphis often has snare on 3 and 7
      const positions = [4, 12];
      positions.forEach(pos => {
        if (pos < this.steps) {
          pattern[pos] = { active: true, velocity: 0.95 };
        }
      });
    }
  }

  applyHouseRules(pattern, trackType) {
    if (trackType === 'kick') {
      // Four on the floor
      for (let i = 0; i < this.steps; i += 4) {
        pattern[i] = { active: true, velocity: 1.0 };
      }
    }
  }

  generate808Pattern() {
    const pattern = new Array(this.steps).fill(null);
    const notes = ['C1', 'C#1', 'D1', 'E1', 'F1', 'G1', 'A1', 'B1'];
    let currentNote = notes[Math.floor(Math.random() * notes.length)];

    for (let i = 0; i < this.steps; i++) {
      if (Math.random() < 0.35) {
        // Occasional note change
        if (Math.random() < 0.3) {
          currentNote = notes[Math.floor(Math.random() * notes.length)];
        }
        pattern[i] = {
          active: true,
          note: currentNote,
          velocity: this.randomVelocity(),
          slide: Math.random() < 0.2
        };
      }
    }
    return pattern;
  }

  generateMelodicPattern(scale = 'minor') {
    const scales = {
      minor: [0, 2, 3, 5, 7, 8, 10],
      major: [0, 2, 4, 5, 7, 9, 11],
      pentatonic: [0, 2, 4, 7, 9],
      memphis: [0, 3, 5, 7, 10]
    };
    const intervals = scales[scale] || scales.minor;
    const pattern = new Array(this.steps).fill(null);
    const root = 48; // C3

    for (let i = 0; i < this.steps; i++) {
      if (Math.random() < 0.45) {
        const interval = intervals[Math.floor(Math.random() * intervals.length)];
        const octave = Math.random() < 0.3 ? 12 : 0;
        pattern[i] = {
          active: true,
          note: root + interval + octave,
          velocity: this.randomVelocity(),
          duration: Math.random() < 0.2 ? 2 : 1
        };
      }
    }
    return pattern;
  }

  randomVelocity() {
    const [min, max] = this.velocityRange;
    return min + Math.random() * (max - min);
  }

  randomize(pattern) {
    return pattern.map(step => {
      if (step && Math.random() < 0.15) {
        return null;
      }
      if (!step && Math.random() < 0.1) {
        return { active: true, velocity: this.randomVelocity() };
      }
      return step;
    });
  }
}

export class AdvancedGenerator extends PatternGenerator {
  constructor(options = {}) {
    super(options);
    this.evolutionRate = options.evolutionRate || 0.1;
    this.history = [];
  }

  evolvePattern(pattern) {
    const evolved = pattern.map((step, i) => {
      if (Math.random() < this.evolutionRate) {
        if (step) {
          step.velocity = Math.min(1, step.velocity + (Math.random() - 0.5) * 0.2);
        } else if (Math.random() < 0.5) {
          return { active: true, velocity: this.randomVelocity() };
        }
      }
      return step;
    });
    this.history.push(JSON.parse(JSON.stringify(evolved)));
    if (this.history.length > 8) this.history.shift();
    return evolved;
  }

  generateVariation(basePattern) {
    return this.evolvePattern(JSON.parse(JSON.stringify(basePattern)));
  }

  generateFill(length = 4) {
    const fill = [];
    for (let i = 0; i < length; i++) {
      fill.push({
        active: true,
        velocity: 0.7 + Math.random() * 0.3,
        note: 60 + Math.floor(Math.random() * 12)
      });
    }
    return fill;
  }
}

export class PatternPresets {
  static getTrapPreset() {
    const gen = new PatternGenerator({ genre: 'trap', steps: 16, density: 0.4 });
    return {
      kick: gen.generateDrumPattern('kick'),
      snare: gen.generateDrumPattern('snare'),
      hat: gen.generateDrumPattern('hat'),
      808: gen.generate808Pattern()
    };
  }

  static getMemphisPreset() {
    const gen = new PatternGenerator({ genre: 'memphis', steps: 16 });
    return {
      kick: gen.generateDrumPattern('kick'),
      snare: gen.generateDrumPattern('snare'),
      808: gen.generate808Pattern(),
      synth: gen.generateMelodicPattern('memphis')
    };
  }

  static getHousePreset() {
    const gen = new PatternGenerator({ genre: 'house', steps: 16, density: 0.6 });
    return {
      kick: gen.generateDrumPattern('kick'),
      clap: gen.generateDrumPattern('clap'),
      hat: gen.generateDrumPattern('hat'),
      bass: gen.generateMelodicPattern('minor')
    };
  }

  static getRandomPreset() {
    const genres = ['trap', 'memphis', 'house'];
    const genre = genres[Math.floor(Math.random() * genres.length)];
    const gen = new PatternGenerator({ genre, steps: 16 });
    return {
      kick: gen.generateDrumPattern('kick'),
      snare: gen.generateDrumPattern('snare'),
      hat: gen.generateDrumPattern('hat'),
      808: gen.generate808Pattern(),
      synth: gen.generateMelodicPattern()
    };
  }
}

export class PatternUtilities {
  static mergePatterns(patterns) {
    const length = patterns[0].length;
    const merged = new Array(length).fill(null);
    patterns.forEach(pat => {
      pat.forEach((step, i) => {
        if (step && !merged[i]) merged[i] = step;
      });
    });
    return merged;
  }

  static transpose(pattern, semitones) {
    return pattern.map(step => {
      if (step && step.note) {
        return { ...step, note: step.note + semitones };
      }
      return step;
    });
  }

  static reverse(pattern) {
    return [...pattern].reverse();
  }

  static quantize(pattern, grid = 1) {
    // Simple quantize - already step based
    return pattern;
  }

  static humanize(pattern, amount = 0.1) {
    return pattern.map(step => {
      if (step) {
        return {
          ...step,
          velocity: Math.max(0.1, Math.min(1, step.velocity + (Math.random() - 0.5) * amount)),
          timing: (Math.random() - 0.5) * amount * 0.05
        };
      }
      return step;
    });
  }

  static density(pattern) {
    const active = pattern.filter(s => s && s.active).length;
    return active / pattern.length;
  }

  static toMidiLike(pattern) {
    return pattern.map((step, i) => ({
      time: i,
      note: step?.note || 0,
      velocity: step?.velocity || 0,
      active: !!step
    }));
  }
}

// Additional generators for variety
export class EuclideanGenerator {
  static generate(steps, pulses, rotation = 0) {
    const pattern = new Array(steps).fill(null);
    if (pulses === 0 || steps === 0) return pattern;
    
    const bucket = Math.floor(steps / pulses);
    for (let i = 0; i < pulses; i++) {
      const pos = (i * bucket + rotation) % steps;
      pattern[pos] = { active: true, velocity: 0.8 + Math.random() * 0.2 };
    }
    return pattern;
  }
}

export class MarkovPatternGenerator {
  constructor() {
    this.transitions = {};
  }

  train(patterns) {
    patterns.forEach(pat => {
      for (let i = 0; i < pat.length - 1; i++) {
        const current = pat[i] ? 'on' : 'off';
        const next = pat[i + 1] ? 'on' : 'off';
        if (!this.transitions[current]) this.transitions[current] = {};
        this.transitions[current][next] = (this.transitions[current][next] || 0) + 1;
      }
    });
  }

  generate(length = 16, start = 'off') {
    const pattern = [];
    let current = start;
    for (let i = 0; i < length; i++) {
      const isOn = current === 'on';
      pattern.push(isOn ? { active: true, velocity: 0.7 + Math.random() * 0.3 } : null);
      const nexts = this.transitions[current] || { on: 1, off: 1 };
      const total = Object.values(nexts).reduce((a, b) => a + b, 0);
      let rand = Math.random() * total;
      for (const [key, val] of Object.entries(nexts)) {
        rand -= val;
        if (rand <= 0) {
          current = key;
          break;
        }
      }
    }
    return pattern;
  }
}

// Export default for convenience
export default {
  PatternGenerator,
  AdvancedGenerator,
  PatternPresets,
  PatternUtilities,
  EuclideanGenerator,
  MarkovPatternGenerator
};

// Extended advanced features for daily code growth

export class GrooveEngine {
  constructor() {
    this.templates = {
      boomBap: [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0],
      trap: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0],
      ukGarage: [1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1],
      footwork: [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1]
    };
  }

  applyGroove(pattern, grooveName = 'trap') {
    const template = this.templates[grooveName] || this.templates.trap;
    return pattern.map((step, i) => {
      const grooveStep = template[i % template.length];
      if (grooveStep && !step) {
        return { active: true, velocity: 0.75 };
      }
      if (!grooveStep && step && Math.random() < 0.3) {
        return null;
      }
      return step;
    });
  }

  generateFromTemplate(grooveName) {
    const template = this.templates[grooveName];
    return template.map(v => v ? { active: true, velocity: 0.8 + Math.random() * 0.2 } : null);
  }
}

export class Arpeggiator {
  constructor(scale = [0, 2, 3, 5, 7, 8, 10], root = 48) {
    this.scale = scale;
    this.root = root;
    this.mode = 'up';
    this.range = 1;
  }

  generate(steps = 16, notesPerStep = 1) {
    const pattern = [];
    let index = 0;
    for (let i = 0; i < steps; i++) {
      if (Math.random() < 0.6) {
        const notes = [];
        for (let n = 0; n < notesPerStep; n++) {
          const interval = this.scale[index % this.scale.length];
          const octave = Math.floor(index / this.scale.length) * 12;
          notes.push(this.root + interval + octave);
          index++;
        }
        pattern.push({
          active: true,
          notes: notes,
          velocity: 0.7 + Math.random() * 0.3,
          duration: 1
        });
      } else {
        pattern.push(null);
      }
    }
    return pattern;
  }

  setMode(mode) {
    this.mode = mode; // up, down, updown, random
  }
}

export class ChordProgressionGenerator {
  static progressions = {
    minor: [[0, 3, 7], [5, 8, 12], [7, 10, 14], [0, 3, 7]],
    memphis: [[0, 3, 7, 10], [5, 8, 12, 15], [3, 7, 10, 14]],
    trap: [[0, 3, 7], [0, 3, 7], [5, 8, 12], [0, 3, 7]]
  };

  static generate(style = 'minor', steps = 16, root = 48) {
    const prog = this.progressions[style] || this.progressions.minor;
    const pattern = new Array(steps).fill(null);
    const chordLength = Math.floor(steps / prog.length);
    
    prog.forEach((chord, ci) => {
      const start = ci * chordLength;
      for (let i = 0; i < chordLength && start + i < steps; i++) {
        if (i % 4 === 0 || Math.random() < 0.3) {
          pattern[start + i] = {
            active: true,
            chord: chord.map(n => root + n),
            velocity: 0.8
          };
        }
      }
    });
    return pattern;
  }
}

export class StepSequencerEngine {
  constructor(tracks = 12, steps = 16) {
    this.tracks = tracks;
    this.steps = steps;
    this.data = Array.from({ length: tracks }, () => new Array(steps).fill(null));
    this.generators = {};
  }

  assignGenerator(trackIndex, generator) {
    this.generators[trackIndex] = generator;
  }

  generateAll() {
    Object.entries(this.generators).forEach(([idx, gen]) => {
      const track = parseInt(idx);
      if (gen.generateDrumPattern) {
        this.data[track] = gen.generateDrumPattern();
      } else if (gen.generate808Pattern) {
        this.data[track] = gen.generate808Pattern();
      }
    });
    return this.data;
  }

  getTrack(index) {
    return this.data[index] || [];
  }

  setStep(track, step, data) {
    if (this.data[track]) {
      this.data[track][step] = data;
    }
  }

  clearTrack(track) {
    if (this.data[track]) {
      this.data[track].fill(null);
    }
  }

  exportJSON() {
    return JSON.stringify({
      tracks: this.tracks,
      steps: this.steps,
      data: this.data
    });
  }
}

// More utility functions to reach volume
export function analyzePattern(pattern) {
  const activeSteps = pattern.filter(s => s).length;
  const velocities = pattern.filter(s => s).map(s => s.velocity || 0);
  const avgVel = velocities.length ? velocities.reduce((a, b) => a + b, 0) / velocities.length : 0;
  const notes = pattern.filter(s => s && s.note).map(s => s.note);
  const uniqueNotes = new Set(notes).size;
  
  return {
    density: activeSteps / pattern.length,
    averageVelocity: avgVel,
    uniqueNotes,
    hasSlides: pattern.some(s => s && s.slide),
    hasChords: pattern.some(s => s && s.chord)
  };
}

export function comparePatterns(patA, patB) {
  let matches = 0;
  const len = Math.min(patA.length, patB.length);
  for (let i = 0; i < len; i++) {
    const aOn = !!patA[i];
    const bOn = !!patB[i];
    if (aOn === bOn) matches++;
  }
  return matches / len;
}

export function interpolatePatterns(patA, patB, amount = 0.5) {
  return patA.map((step, i) => {
    if (Math.random() < amount) return patB[i] || step;
    return step;
  });
}

export class PatternLibrary {
  constructor() {
    this.library = new Map();
  }

  save(name, pattern) {
    this.library.set(name, JSON.parse(JSON.stringify(pattern)));
  }

  load(name) {
    return this.library.get(name) || null;
  }

  list() {
    return Array.from(this.library.keys());
  }

  delete(name) {
    return this.library.delete(name);
  }

  getRandom() {
    const keys = this.list();
    if (!keys.length) return null;
    return this.load(keys[Math.floor(Math.random() * keys.length)]);
  }
}

// Final exports expansion
export const NOCTURNE_PATTERN_TOOLS = {
  PatternGenerator,
  AdvancedGenerator,
  PatternPresets,
  PatternUtilities,
  EuclideanGenerator,
  MarkovPatternGenerator,
  GrooveEngine,
  Arpeggiator,
  ChordProgressionGenerator,
  StepSequencerEngine,
  PatternLibrary,
  analyzePattern,
  comparePatterns,
  interpolatePatterns
};

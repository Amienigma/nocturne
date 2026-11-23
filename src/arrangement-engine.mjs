/**
 * ArrangementEngine for NOCTURNE × 808 PIT
 * Manages song structure, sections, timeline, transitions, and multi-section arrangement.
 * Supports intro, verse, chorus, bridge, outro with automatic transitions and pattern linking.
 * Added 2026-11-22 as daily code addition.
 */

export class ArrangementEngine {
  constructor() {
    this.sections = new Map();
    this.timeline = [];
    this.currentSection = null;
    this.currentPosition = 0;
    this.totalBars = 0;
    this.bpm = 120;
    this.timeSignature = [4, 4];
    this.transitions = new Map();
    this.markers = [];
    this.loopPoints = [];
    this.isPlaying = false;
    this.playbackPosition = 0;
    this.sectionTemplates = this.getDefaultTemplates();
    this.eventListeners = new Map();
    this.history = [];
    this.undoStack = [];
    this.redoStack = [];
    this.debugMode = false;
    this.stats = {
      sectionsCreated: 0,
      transitionsTriggered: 0,
      totalPlaytime: 0
    };
  }

  init() {
    this.createDefaultArrangement();
    console.log('ArrangementEngine initialized with default structure');
  }

  getDefaultTemplates() {
    return {
      intro: { bars: 8, energy: 0.3, density: 0.4, type: 'intro' },
      verse: { bars: 16, energy: 0.6, density: 0.7, type: 'verse' },
      preChorus: { bars: 8, energy: 0.75, density: 0.8, type: 'pre-chorus' },
      chorus: { bars: 16, energy: 1.0, density: 1.0, type: 'chorus' },
      bridge: { bars: 8, energy: 0.5, density: 0.6, type: 'bridge' },
      breakdown: { bars: 8, energy: 0.2, density: 0.3, type: 'breakdown' },
      outro: { bars: 8, energy: 0.4, density: 0.5, type: 'outro' },
      drop: { bars: 16, energy: 1.0, density: 1.0, type: 'drop' }
    };
  }

  createDefaultArrangement() {
    this.addSection('intro', { ...this.sectionTemplates.intro, name: 'Intro' });
    this.addSection('verse1', { ...this.sectionTemplates.verse, name: 'Verse 1' });
    this.addSection('chorus1', { ...this.sectionTemplates.chorus, name: 'Chorus 1' });
    this.addSection('verse2', { ...this.sectionTemplates.verse, name: 'Verse 2' });
    this.addSection('chorus2', { ...this.sectionTemplates.chorus, name: 'Chorus 2' });
    this.addSection('bridge', { ...this.sectionTemplates.bridge, name: 'Bridge' });
    this.addSection('outro', { ...this.sectionTemplates.outro, name: 'Outro' });
    this.rebuildTimeline();
  }

  addSection(id, config = {}) {
    const section = {
      id,
      name: config.name || id,
      bars: config.bars || 16,
      energy: config.energy || 0.7,
      density: config.density || 0.7,
      type: config.type || 'verse',
      patternId: config.patternId || null,
      startBar: 0,
      endBar: 0,
      color: config.color || this.getColorForType(config.type),
      locked: false,
      muted: false,
      solo: false,
      createdAt: Date.now()
    };
    this.sections.set(id, section);
    this.stats.sectionsCreated++;
    this.rebuildTimeline();
    this.emit('sectionAdded', section);
    this.saveHistory('addSection', { id });
    return section;
  }

  removeSection(id) {
    if (this.sections.has(id)) {
      const removed = this.sections.get(id);
      this.sections.delete(id);
      this.rebuildTimeline();
      this.emit('sectionRemoved', removed);
      this.saveHistory('removeSection', { id, data: removed });
      return true;
    }
    return false;
  }

  updateSection(id, updates) {
    const section = this.sections.get(id);
    if (!section) return null;
    Object.assign(section, updates);
    this.rebuildTimeline();
    this.emit('sectionUpdated', section);
    return section;
  }

  rebuildTimeline() {
    this.timeline = [];
    let currentBar = 0;
    const ordered = Array.from(this.sections.values());
    ordered.forEach(section => {
      section.startBar = currentBar;
      section.endBar = currentBar + section.bars;
      this.timeline.push({
        sectionId: section.id,
        startBar: currentBar,
        endBar: section.endBar,
        durationBars: section.bars
      });
      currentBar = section.endBar;
    });
    this.totalBars = currentBar;
    this.emit('timelineUpdated', this.timeline);
  }

  getSectionAtBar(bar) {
    for (const entry of this.timeline) {
      if (bar >= entry.startBar && bar < entry.endBar) {
        return this.sections.get(entry.sectionId);
      }
    }
    return null;
  }

  getCurrentSection(bar = this.currentPosition) {
    return this.getSectionAtBar(bar);
  }

  moveSection(id, newIndex) {
    const sectionsArray = Array.from(this.sections.entries());
    const index = sectionsArray.findIndex(([sid]) => sid === id);
    if (index === -1 || newIndex < 0 || newIndex >= sectionsArray.length) return false;
    const [item] = sectionsArray.splice(index, 1);
    sectionsArray.splice(newIndex, 0, item);
    this.sections = new Map(sectionsArray);
    this.rebuildTimeline();
    this.emit('sectionMoved', { id, newIndex });
    return true;
  }

  duplicateSection(id, newId) {
    const original = this.sections.get(id);
    if (!original) return null;
    const copy = { ...original, id: newId, name: original.name + ' (Copy)' };
    return this.addSection(newId, copy);
  }

  setTransition(fromId, toId, type = 'crossfade', duration = 4) {
    const key = `${fromId}->${toId}`;
    this.transitions.set(key, { type, duration, fromId, toId });
    this.emit('transitionSet', { fromId, toId, type, duration });
  }

  triggerTransition(fromId, toId) {
    const key = `${fromId}->${toId}`;
    const transition = this.transitions.get(key);
    if (transition) {
      this.stats.transitionsTriggered++;
      this.emit('transitionTriggered', transition);
      return transition;
    }
    return null;
  }

  addMarker(bar, label, color = '#ff00ff') {
    this.markers.push({ bar, label, color, id: `marker-${Date.now()}` });
    this.emit('markerAdded', { bar, label });
  }

  setLoop(startBar, endBar) {
    this.loopPoints = [{ start: startBar, end: endBar }];
    this.emit('loopSet', { startBar, endBar });
  }

  clearLoop() {
    this.loopPoints = [];
    this.emit('loopCleared');
  }

  play() {
    this.isPlaying = true;
    this.emit('playbackStarted');
  }

  pause() {
    this.isPlaying = false;
    this.emit('playbackPaused');
  }

  stop() {
    this.isPlaying = false;
    this.playbackPosition = 0;
    this.emit('playbackStopped');
  }

  seekToBar(bar) {
    this.playbackPosition = Math.max(0, Math.min(bar, this.totalBars));
    this.currentPosition = this.playbackPosition;
    this.currentSection = this.getSectionAtBar(this.playbackPosition);
    this.emit('seeked', { bar: this.playbackPosition, section: this.currentSection });
  }

  getArrangementSummary() {
    return {
      totalBars: this.totalBars,
      totalSections: this.sections.size,
      estimatedDuration: (this.totalBars * (60 / this.bpm) * 4),
      sections: Array.from(this.sections.values()).map(s => ({
        id: s.id,
        name: s.name,
        bars: s.bars,
        type: s.type,
        energy: s.energy
      }))
    };
  }

  optimizeEnergyCurve() {
    const sections = Array.from(this.sections.values());
    sections.forEach((s, i) => {
      const progress = i / (sections.length - 1);
      s.energy = 0.3 + progress * 0.7 * Math.sin(progress * Math.PI);
    });
    this.emit('energyOptimized');
  }

  generateVariation(baseId, variationName) {
    const base = this.sections.get(baseId);
    if (!base) return null;
    const varId = `${baseId}-var-${Date.now()}`;
    return this.addSection(varId, {
      ...base,
      name: variationName || `${base.name} Variation`,
      energy: base.energy * (0.8 + Math.random() * 0.4),
      density: base.density * (0.7 + Math.random() * 0.6)
    });
  }

  exportArrangement() {
    return {
      bpm: this.bpm,
      timeSignature: this.timeSignature,
      sections: Array.from(this.sections.entries()),
      transitions: Array.from(this.transitions.entries()),
      markers: this.markers,
      totalBars: this.totalBars
    };
  }

  importArrangement(data) {
    if (data.sections) {
      this.sections = new Map(data.sections);
    }
    if (data.transitions) {
      this.transitions = new Map(data.transitions);
    }
    if (data.markers) this.markers = data.markers;
    if (data.bpm) this.bpm = data.bpm;
    this.rebuildTimeline();
    this.emit('arrangementImported');
  }

  saveHistory(action, data) {
    this.history.push({ action, data, timestamp: Date.now() });
    if (this.history.length > 50) this.history.shift();
    this.undoStack.push({ action, data });
    this.redoStack = [];
  }

  undo() {
    if (this.undoStack.length === 0) return false;
    const action = this.undoStack.pop();
    this.redoStack.push(action);
    this.emit('undo', action);
    return true;
  }

  redo() {
    if (this.redoStack.length === 0) return false;
    const action = this.redoStack.pop();
    this.undoStack.push(action);
    this.emit('redo', action);
    return true;
  }

  getColorForType(type) {
    const colors = {
      intro: '#4a90d9',
      verse: '#5cb85c',
      'pre-chorus': '#f0ad4e',
      chorus: '#d9534f',
      bridge: '#9b59b6',
      breakdown: '#34495e',
      outro: '#7f8c8d',
      drop: '#e74c3c'
    };
    return colors[type] || '#95a5a6';
  }

  on(event, callback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push(callback);
  }

  emit(event, data) {
    const listeners = this.eventListeners.get(event) || [];
    listeners.forEach(cb => {
      try { cb(data); } catch (e) { console.error('Arrangement event error', e); }
    });
  }

  setBPM(bpm) {
    this.bpm = Math.max(40, Math.min(300, bpm));
    this.emit('bpmChanged', this.bpm);
  }

  getDurationSeconds() {
    return this.totalBars * (60 / this.bpm) * (this.timeSignature[0] / 4);
  }

  analyzeStructure() {
    const types = {};
    for (const s of this.sections.values()) {
      types[s.type] = (types[s.type] || 0) + 1;
    }
    return {
      sectionCount: this.sections.size,
      typeDistribution: types,
      averageEnergy: Array.from(this.sections.values()).reduce((sum, s) => sum + s.energy, 0) / this.sections.size,
      hasDrop: Array.from(this.sections.values()).some(s => s.type === 'drop' || s.energy > 0.9),
      complexity: this.sections.size * this.transitions.size
    };
  }

  suggestNextSection(currentId) {
    const current = this.sections.get(currentId);
    if (!current) return 'chorus';
    const suggestions = {
      intro: 'verse',
      verse: 'chorus',
      chorus: 'verse',
      bridge: 'chorus',
      breakdown: 'drop',
      drop: 'chorus',
      outro: null
    };
    return suggestions[current.type] || 'verse';
  }

  autoArrange(style = 'trap') {
    this.sections.clear();
    if (style === 'trap') {
      this.addSection('intro', { bars: 4, type: 'intro', energy: 0.4 });
      this.addSection('verse', { bars: 16, type: 'verse', energy: 0.7 });
      this.addSection('hook', { bars: 8, type: 'chorus', energy: 1.0 });
      this.addSection('verse2', { bars: 16, type: 'verse', energy: 0.75 });
      this.addSection('hook2', { bars: 8, type: 'chorus', energy: 1.0 });
      this.addSection('outro', { bars: 4, type: 'outro', energy: 0.5 });
    } else if (style === 'edm') {
      this.addSection('intro', { bars: 8, type: 'intro', energy: 0.3 });
      this.addSection('build', { bars: 8, type: 'pre-chorus', energy: 0.6 });
      this.addSection('drop', { bars: 16, type: 'drop', energy: 1.0 });
      this.addSection('breakdown', { bars: 8, type: 'breakdown', energy: 0.2 });
      this.addSection('drop2', { bars: 16, type: 'drop', energy: 1.0 });
      this.addSection('outro', { bars: 8, type: 'outro', energy: 0.4 });
    }
    this.rebuildTimeline();
    this.emit('autoArranged', style);
  }

  reset() {
    this.sections.clear();
    this.timeline = [];
    this.transitions.clear();
    this.markers = [];
    this.createDefaultArrangement();
  }

  destroy() {
    this.stop();
    this.sections.clear();
    this.eventListeners.clear();
    this.history = [];
  }

  getStats() {
    return {
      ...this.stats,
      totalBars: this.totalBars,
      sectionCount: this.sections.size,
      transitionCount: this.transitions.size,
      markerCount: this.markers.length,
      durationSeconds: this.getDurationSeconds()
    };
  }

  version = '1.0.0';
  description = 'Song arrangement and timeline system for NOCTURNE';
}

export default ArrangementEngine;

# NOCTURNE × 808 PIT

A browser beat lab that puts **NOCTURNE**’s sequencing next to **808 PIT**’s sound design.

NOCTURNE brings the synth keyboard, trap drum pad, genre banks and 12-track step sequencer. 808 PIT brings Atlanta 808 subs (pitch-drop sine, click and harmonic), Memphis horror chords, waveform selection, a low-pass filter with resonance, an ADSR envelope and a waveform scope. Every sound is synthesized live with the Web Audio API. There are no new samples.

**Live:** https://amienigma.github.io/nocturne/

## Features

### From NOCTURNE
- Playable keyboard (C2–C4, Z/X octave shift). White keys are A S D F G H J K L ; ' and black keys are W E T Y U O P
- Trap drums (kicks, snares, claps, hats) on number keys **1–8**, with hat rolls and velocity
- Sound banks: Memphis, coldwave, house, DSBM, abstract vocal textures, and looping ambience
- A 12-track step sequencer with 8, 16 or 32 steps, swing, mute/solo, randomize, duplicate, presets
- Long-press, right-click or Shift-click a step to cycle its velocity through 40 → 60 → 80 → 100%. A long-press never toggles the step. Brighter steps are louder
- Shared master gain plus a limiter/compressor, speaker protection, a CRT look, and **REC**. The recording format is whatever the browser supports: `.m4a` on Safari/iPhone, otherwise `.webm` or `.ogg`

### Save, undo and share
- **Autosave:** your beat (pattern, BPM, swing, length, sound patch, limiter and metronome settings) is saved in this browser as you work and comes back after a reload
- **Save slots:** name a beat, save it, then load or delete it later. Up to 30 slots, stored locally in your browser
- **Undo / redo:** use the UNDO and REDO buttons or Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z, up to about 100 steps. CLEAR, RANDOMIZE, DUP, presets and loads also show an **UNDO** toast. Undo covers the beat (steps, sources, mute/solo, BPM, swing, length, limiter). It does not change the synth patch or metronome
- **Share:** SHARE copies a link, or opens the share sheet on phones, that holds the whole beat in its URL. The beat is compressed and nothing is uploaded. Opening the link loads the beat, and you can undo that load. Malformed links are rejected

### Metronome and tempo
- **Metronome** with its own volume and an accent on beat 1, scheduled on the audio clock so it stays in time. It plays through the speakers only and is **never recorded**
- **Count-in:** with the metronome on, REC counts one bar before recording and playback start together on the downbeat. Press REC again to cancel the count-in
- **TAP tempo** averages your last 4 taps and resets after a 2-second pause. BPM ranges from 60 to 200, with a slider and a number box. The BPM pill pulses on the beat

### From 808 PIT
- Atlanta 808 subs and stacks, Memphis notes, chords and loops
- Waveforms: sine, triangle, saw, square, 808 and horror
- Filter cutoff and resonance, ADSR envelope
- Waveform visualizer with a level meter
- Those voices are playable from the keyboard and pads **and** sequenceable: each track has an assignable sound source, and 808 / chord tracks store a note or chord per step

## Tracks

Kick, Snare, Clap, CHat, OHat, Perc, **808** (defaults to the 808 PIT sub), Bass, Synth (defaults to PIT horror, so Memphis chords can be painted per step), Atmos, Guitar, Vocal.

Pick a track, choose a note or chord chip, then tap steps. The 808 PIT rack always colors PIT-sourced voices through one shared filter and envelope.

## Run

This is still a static, client-only app. Serve the folder (needed for the JavaScript modules) and open it in a modern browser:

```bash
python3 -m http.server 4173
```

Then visit `http://localhost:4173`. Tap or click once to start audio — phones, especially iPhone, will stay silent until that first gesture.

```bash
npm test
```

`npm test` covers the music engine plus share-link roundtrips, input sanitizing, the undo stack, tap tempo and recording-format selection.

It needs no API key and works offline apart from Google Fonts.

## Credit

Sequencing, drum pads, banks, transport and the original browser instrument are **NOCTURNE**. The 808 / horror voice architecture, Atlanta and Memphis pad set, filter, envelope, waveforms and scope come from **808 PIT** (`Amienigma/demo-soundboard`).

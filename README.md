# NOCTURNE × 808 PIT

A browser beat lab that puts **NOCTURNE**’s sequencing next to **808 PIT**’s sound design.

NOCTURNE brings the synth keyboard, trap drum pad, genre banks and 12-track step sequencer. 808 PIT brings Atlanta 808 subs (pitch-drop sine, click and harmonic), Memphis horror chords, waveform selection, a low-pass filter with resonance, an ADSR envelope and a waveform scope. Every sound is synthesized live with the Web Audio API. There are no new samples.

**Live:** see the repo homepage for the original NOCTURNE page. This combined app lives on the `feat/808-pit-merge` branch until it is merged.

## Features

### From NOCTURNE
- Playable keyboard (C2–C4, octave shift, computer keys A–')
- Trap drums (kicks, snares, claps, hats) with Q–I shortcuts, hat rolls and velocity
- Sound banks: Memphis, coldwave, house, DSBM, abstract vocal textures, and looping ambience
- A 12-track step sequencer with 8, 16 or 32 steps, swing, mute/solo, randomize, duplicate, presets
- Right-click or long-press a step to raise its velocity
- Shared master gain plus a limiter/compressor, CRT look, and **REC** (exports a `.webm`)

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

It needs no API key and works offline apart from Google Fonts.

## Credit

Sequencing, drum pads, banks, transport and the original browser instrument are **NOCTURNE**. The 808 / horror voice architecture, Atlanta and Memphis pad set, filter, envelope, waveforms and scope come from **808 PIT** (`Amienigma/demo-soundboard`).

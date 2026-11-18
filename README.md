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

### Banks, song mode and trap steps
- **Pattern banks A–D:** four patterns per beat. Bank buttons switch instantly when stopped. While playing, the new bank starts at the next loop. COPY / PASTE copies a bank (paste is undoable)
- **Song mode:** build a chain of up to 16 banks (+ adds the current bank, − removes the last, tap a chip to change it). With SONG on, playback walks the chain and loops it. EXPORT WAV then renders the whole chain once
- **Step settings** (tap a step, then use the step bar under the grid):
  - **Roll:** 1/2, 1/3, 1/4 or 1/6 ratchets inside one step. Later hits are slightly softer
  - **Chance:** 100, 75, 50 or 25%, rolled each time the step comes round
  - **Length:** auto, or ½ to 8 steps for 808, synth and chord notes
  - **Slide:** 808 and synth notes glide from the previous note on that track instead of retriggering the punch
- Steps show these with a ×N badge (roll), a dashed/striped pad (chance), ↗ (slide), and a bar along the bottom for velocity, so nothing is shown by colour alone

### Mixer
Each of the 12 tracks has volume, pan, reverb send and delay send (the MIXER panel, collapsed by default). There is one shared reverb and one tempo-synced dotted-⅛ delay, built only when a send is first turned up. At default settings the mix sounds exactly as before. The mixer applies to the sequencer and to exports. Pads and keys you play live skip it. Double-click a fader to reset it.

### Keyboard and screen readers
Steps are toggle buttons with `aria-pressed` and labels such as "Kick step 5, velocity 80%, roll ×3, 50% chance". The grid uses a single tab stop: arrow keys move, Home/End jump, Enter or Space toggles, and Shift+Enter cycles velocity. Mouse and touch taps don't take keyboard focus, so Space still means PLAY.

### Save, undo and share
- **Autosave:** your beat (all four banks, song chain, mixer, BPM, swing, length, sound patch, limiter and metronome settings) is saved in this browser as you work and comes back after a reload. It is stored packed (under 1 KB), so 30 slots fit easily
- **Save slots:** name a beat, save it, then load or delete it later. Up to 30 slots, stored locally in your browser
- **Undo / redo:** use the UNDO and REDO buttons or Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z, up to about 100 steps. CLEAR, RANDOMIZE, DUP, presets and loads also show an **UNDO** toast. Undo covers the beat (steps, sources, mute/solo, BPM, swing, length, limiter). It does not change the synth patch or metronome
- **Share:** SHARE copies a link, or opens the share sheet on phones, that holds the whole beat in its URL. The beat is compressed and nothing is uploaded. Opening the link loads the beat, and you can undo that load. Malformed links are rejected. Links and saves are format **v2** (banks, chain, mixer, step settings). **v1 links and saves from earlier versions still open**, into bank A with a flat mixer

### Export, AI beats and offline
- **EXPORT WAV:** renders 1, 2, 4 or 8 bars offline as a clean 48 kHz stereo WAV, 16-bit (dithered) or 24-bit. It goes through the same limiter and speaker-safety chain as playback. Reverb and 808 tails are included, and the metronome is never in it. On iPhone it opens the share sheet (Save to Files, AirDrop and so on). Elsewhere it downloads. Live **REC** still works as before
- **Describe a beat:** type something like "dark Memphis trap, 140" and **Amienigma AI** writes a pattern. The reply is checked by the same strict validator as share links and loads as one undoable step. Your sound settings and metronome are kept. Requests are rate-limited (one at a time, 15 s apart, 6 per 10 minutes). If the AI can't be reached, everything else keeps working
- **Works offline / installable:** add it to your home screen. A service worker caches the app and the self-hosted fonts, so after the first visit it loads with no connection. Only the AI beat writer needs the network

### On a phone
Screens under 600 px show one track at a time as big pads, four per row (16 steps = 4×4). Swipe left or right, or use ◀ ▶ or the track menu, to switch tracks. Mute, solo, the track's sound and its note or chord picker sit above the pads. Desktop keeps the full 12-track grid. Press `[` and `]` to change the selected track.

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

`npm test` covers the music engine, share-link roundtrips (v2, plus real v1 links from the previous release), input sanitizing, the undo stack, tap tempo, recording-format selection, the WAV encoder (header, length, sample values), the export schedule (ratchets, chance, song chain), AI reply extraction and validation, the AI rate limiter, and the service worker's file list. It also runs an **offline-render loudness regression** (`test/loudness.test.mjs`): worst-case beats (every track on every step, ×6 rolls, all sends maxed, hard pans, 808 slides, volume 1, limiter off) are rendered through the real export graph with `node-web-audio-api` and must stay below −1 dBFS. Run `npm install` first to get it. Without it those tests are skipped.

```bash
npm run test:e2e
```

This runs a browser end-to-end test with `puppeteer-core` against a local server. It checks iPhone layout, banks and song mode, step settings, the mixer, keyboard grid navigation, and v1 + v2 share links. It needs Chrome or Chromium; set `CHROME_PATH` if it isn't in a standard place. Without a browser it skips.

It needs no API key. Fonts are self-hosted (SIL OFL, see `fonts/`), so it works fully offline. The optional AI beat writer calls `https://amienigma-llm.vercel.app/api/chat`.

## Credit

Sequencing, drum pads, banks, transport and the original browser instrument are **NOCTURNE**. The 808 / horror voice architecture, Atlanta and Memphis pad set, filter, envelope, waveforms and scope come from **808 PIT** (`Amienigma/demo-soundboard`).

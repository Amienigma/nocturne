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
- **Classic 808 trap sections:** a fresh session (nothing autosaved, no share link) opens with four original 2-bar trap grooves at **145 BPM, no swing**, in Ab minor, so the first thing you hear is a real 808 trap beat. Section A is selected and starts the chain. **A TRAP** (Pi'erre / Metro-era: long, saturated 808 carrying the melody with octave slides, a short kick on every 808 hit, snare + clap on beat 3, rolling hats, open hats, a dark sine bell), **B RAGE** (Carti-style: distorted 808 bouncing between octaves, stacked 1/64–1/128 hat risers, 1/12 triplet runs, a double clap), **C DARK** (stripped breakdown: long 808 notes, rim/perc, quiet rolling hats, bell) and **D FILL** (trap bar, then high-to-low toms and a snare roll that speeds up into the loop). **Rolling hats are the signature:** constant 16ths with 1/32, 1/48, 1/64, 1/96 and 1/128 stutters, 1/24 and 1/12 triplet runs, and rolls that get louder and rise in pitch into every snare and at every bar end. They use a circuit-modelled **TR-808 kit** (bass drum, snare, clap, closed/open hats with choke, cowbell, tuned toms, rimshot, clave, maracas), available on any track as "TR-808 classic" sounds. Saved beats are never replaced; **LOAD CLASSIC 808** brings the four sections back at any time (undoable)
- **A looper per section (no hidden preset):** each section card has its own big **▶ PLAY**, a loop length (**½ bar, 1 bar or 2 bars**) and a live indicator (● bar 1/2, ◷ next bar, stopped). Tap a section's ▶ PLAY to start just that section. Tap another section's ▶ PLAY while it runs and it **joins in sync at the next bar**, layered on top, so A + C (or all four) can play together. Tap a playing section's ■ STOP to stop just that one (the last one stops the beat). Changing a playing looper's length restarts it at the next bar. The top-bar button is **■ STOP ALL**: it only stops; sound always starts from a section's ▶ PLAY, ▶ SONG, or the tape deck. Space plays the section you're editing (and stops all while playing). The letter (A–D) only picks which section you edit. Presets only load into a section when you tap one. An old autosave that is still the untouched ATLANTA NIGHT starter from the previous build is swapped for the trap sections. COPY / PASTE copies a section (paste is undoable)
- **Song mode (bring it together):** the chain (default A A B A C D, up to 16 parts) plays the sections in order and loops. Build it with **+A +B +C +D**, **⌫** removes the last part, **CLEAR** empties it, tapping a chip changes that part. **▶ SONG** starts the song, or, while a section is looping, switches to the song at the next bar; ▶ PLAY on any section leaves the song for that section's looper at the next bar. The transport never stops. EXPORT WAV in song mode renders the whole chain once
- **Step settings** (tap a step, then use the step bar under the grid):
  - **Roll:** 1/32 ×2, 1/48 ×3, 1/64 ×4, 1/96 ×6 or 1/128 ×8 inside one step, or a 1/24 (over 2 steps) or 1/12 (over 4 steps) triplet run. Leave the steps a triplet run covers empty
  - **Ramp:** shapes a roll: louder (crescendo), softer, pitch up, pitch down, louder + up (the classic trap riser) or softer + down. With no ramp, later hits are just slightly softer, as before. Old share links open unchanged
  - **Chance:** 100, 75, 50 or 25%, rolled each time the step comes round
  - **Length:** auto, or ½ to 16 steps for 808, synth and chord notes
  - **Slide:** 808 and synth notes glide from the previous note on that track instead of retriggering the punch
- Steps show these with a ×N badge (roll), a dashed/striped pad (chance), ↗ (slide), and a bar along the bottom for velocity, so nothing is shown by colour alone

### Tape deck (loop each layer)

Open **TAPE DECK** (collapsible, under the sections). Every track is a cassette layer with its own transport:

- **▶ PLAY**: the layer plays in sync with the beat (the default)
- **⟲ LOOP**: the layer loops on its own over the length you pick: ¼ bar, ½ bar, 1 bar, 2 bars, or custom start/end steps. Layers with different lengths run against each other (polymetric), all locked to the same clock
- **■ STOP**: silences that layer; **◀◀ REWIND** restarts it from the top of its loop
- While the beat plays, every change waits for the **next bar line**, so nothing falls out of time (the row says "… at next bar"). Pressing ▶ or ⟲ while stopped starts the transport
- **▶ ALL IN SYNC** puts every layer back to PLAY together at the next bar
- Each row has a reel that turns only while that layer is rolling (CSS, no animation loop when idle) and a tape counter that counts passes, updated once per bar while the deck is open
- Mute, solo, sections and song mode still apply. Loop lengths and TAPE are kept in the autosave; share links are unchanged. EXPORT WAV renders what the deck is doing (loops start at the top of the file)
- Loops max out at 2 bars, because a section is 32 steps long
- **TAPE** (top bar, off by default) adds gentle wow and flutter, warm saturation, a soft top end and faint hiss. It sits before the speaker-safety stage, so peaks stay under −1.2 dBFS

### Mixer
Each of the 12 tracks has volume, pan, reverb send and delay send (the MIXER panel, collapsed by default). There is one shared reverb and one tempo-synced dotted-⅛ delay, built only when a send is first turned up. At default settings the mix sounds exactly as before. The mixer applies to the sequencer and to exports. Pads and keys you play live skip it. Double-click a fader to reset it.

### Samples and MIDI
- **SAMPLES:** 8 pads. **REC** records from the microphone (stops by itself at 10 s). **LOAD** imports an audio file (WAV, MP3, M4A/AAC, OGG…, up to 10 MB).
  - Each sample is trimmed of silence, mixed to mono, cut to 10 s, normalised to −6 dBFS and faded so it never clicks. It is kept in this browser (IndexedDB, 16-bit, about 1 MB per 10 s).
  - Tap a pad to play it. Pick it as a track sound ("Your samples") to sequence it. Rolls, chance, length, the mixer and EXPORT WAV all work with it. A new hit chokes the previous one on the same pad.
  - Share links point to sample slots but don't carry the audio; the receiver hears their own samples or nothing. CLEAR has an undo toast.
  - **iPhone:** recording works in Safari (iOS 14.5+) after you allow the microphone. The mic is released as soon as you stop. If a browser can't record, REC is hidden and LOAD still works.
- **MIDI input:** press **MIDI** to connect keyboards and pad controllers (Web MIDI). Channel 10 plays the drum tracks using the General MIDI map (36 kick, 38 snare, 39 clap, 42 closed hat, 46 open hat, everything else Perc). Other channels play the synth with velocity. Devices can be plugged in later. iPhone and iPad Safari don't support Web MIDI, so the button is disabled there with an explanation.

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

`npm test` covers the music engine, share-link roundtrips (v2, plus real v1 links from the previous release), input sanitizing, the undo stack, tap tempo, recording-format selection, the WAV encoder (header, length, sample values), the export schedule (ratchets, chance, song chain), AI reply extraction and validation, the AI rate limiter, and the service worker's file list. It also runs an **offline-render loudness regression** (`test/loudness.test.mjs`): worst-case beats (every track on every step, ×6 rolls, all sends maxed, hard pans, 808 slides, volume 1, limiter off) are rendered through the real export graph with `node-web-audio-api` and must stay below −1 dBFS. Run `npm install` first to get it. Without it those tests are skipped. `test/classics.test.mjs` checks the trap sections (145 BPM, chain, gliding 808, half-time snare, rolls into every snare and bar end), renders every section at default and maxed mixer levels, with TAPE and polymetric layer loops, below −1.2 dBFS, and counts one audible onset per roll hit in a render. `test/loopers.test.mjs` covers the section loopers (layering in sync, bar-line starts, ½/1/2-bar lengths, export of exactly the playing sections, the retired ATLANTA NIGHT starter, and all four sections layered at max levels, with and without TAPE, below −1.2 dBFS). `test/rolls-deck.test.mjs` covers roll shapes, velocity/pitch ramps, old links staying byte-identical, ramp round trips and bad-byte rejection, and the per-layer loop maths.

```bash
npm run test:e2e
```

This runs a browser end-to-end test with `puppeteer-core` against a local server. It checks iPhone layout, the classic 808 trap sections (defaults only on an empty session, each section's own ▶ PLAY playing only that section, STOP ALL never starting sound, Space playing the selected section, layering a second section at the next bar, per-section loop length, the old ATLANTA NIGHT save being replaced, bar-line queueing, song chain order, loop ↔ song without stopping), the tape deck (a ½-bar hat loop under the full beat, STOP / REWIND landing on bar lines, ALL IN SYNC, reels only turning while playing, TAPE on, 390 px fit), banks and song mode, step settings, the mixer, keyboard grid navigation, and v1 + v2 share links. It needs Chrome or Chromium; set `CHROME_PATH` if it isn't in a standard place. Without a browser it skips.

It needs no API key. Fonts are self-hosted (SIL OFL, see `fonts/`), so it works fully offline. The optional AI beat writer calls `https://amienigma-llm.vercel.app/api/chat`.

## Credit

Sequencing, drum pads, banks, transport and the original browser instrument are **NOCTURNE**. The 808 / horror voice architecture, Atlanta and Memphis pad set, filter, envelope, waveforms and scope come from **808 PIT** (`Amienigma/demo-soundboard`).

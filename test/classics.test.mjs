// Classic TR-808 default sections: content, save-format round trip, and the
// speaker-safety loudness check for every section (defaults and worst-case
// mixer), rendered offline through the real Studio graph.
import assert from "node:assert/strict";
import test from "node:test";
import { classicBanks, classicState, classicMixer, CLASSIC_CHAIN, CLASSIC_BPM, CLASSIC_SECTIONS, CLASSIC_KIT } from "../src/classics.mjs";
import { packState, unpackState, serializeState, sanitizeState, bankIsEmpty, toStored, fromStored, SOURCE_IDS } from "../src/state-io.mjs";
import { TR808_VOICES, sourceIsMelodic } from "../src/music.mjs";
import { stepHits } from "../src/sequencer.mjs";

let WA = null;
try { WA = await import("node-web-audio-api"); } catch { /* optional dev dependency */ }

const on = (p, t) => p[t].steps.slice(0, 16).filter((c) => c.on);

test("classic sections: four distinct, non-empty 808 grooves on the TR-808 kit", () => {
  const banks = classicBanks();
  assert.equal(banks.length, 4);
  const sigs = new Set(banks.map((b) => JSON.stringify(b)));
  assert.equal(sigs.size, 4, "every section is different");
  for (const [i, b] of banks.entries()) {
    assert.ok(!bankIsEmpty(b), `section ${i} has steps`);
    assert.equal(b[0].source, "tr:BD", "808 bass drum on the kick row");
    assert.ok(on(b, 0).length >= 1, "kick plays");
    assert.ok(on(b, 1).length + on(b, 2).length >= 1, "snare or clap plays");
    assert.ok(b.every((row) => row.steps.slice(16).every((c) => !c.on)), "1-bar patterns (steps 17-32 empty)");
  }
  // Every source the kit uses is a real, share-link-encodable source.
  for (const src of Object.values(CLASSIC_KIT)) assert.ok(SOURCE_IDS.includes(src), src);
  assert.equal(TR808_VOICES.length, 10);
  assert.ok(sourceIsMelodic("tr:TOM") && !sourceIsMelodic("tr:BD"));
  assert.equal(CLASSIC_SECTIONS.map((s) => s.name).join(" "), "ELECTRO TRAP MIAMI BREAK");
});

test("classic sections: the style details are there", () => {
  const [a, b, c, d] = classicBanks();
  // A: electro backbeat (snare + clap on 2 and 4), 16th hats with accents.
  assert.deepEqual(on(a, 1).length >= 2 && [a[1].steps[4].on, a[1].steps[12].on], [true, true]);
  assert.ok(on(a, 3).length >= 15 && new Set(on(a, 3).map((x) => x.vel)).size >= 3, "accented 16th hats");
  // B: trap = half-time snare on 3, hat rolls, sliding 808 bass.
  assert.ok(b[1].steps[8].on && !b[1].steps[4].on && !b[1].steps[12].on, "half-time snare");
  assert.ok(on(b, 3).some((x) => x.rat >= 3), "hat rolls");
  assert.ok(on(b, 6).some((x) => x.slide) && b[6].source === "pit:808", "808 slide");
  // C: Miami bass = cowbell hook, maracas, 808 sub notes.
  assert.ok(on(c, 5).length >= 3 && c[5].source === "tr:CB");
  assert.ok(on(c, 10).length >= 6 && c[10].source === "tr:MA");
  assert.ok(new Set(on(c, 6).map((x) => x.note)).size >= 3, "sub melody");
  // D: fill = descending toms and a snare roll.
  const toms = on(d, 7).map((x) => x.note);
  assert.ok(toms.length >= 4 && toms[0] > toms[toms.length - 1], "toms go high -> low");
  assert.ok(on(d, 1).some((x) => x.rat >= 3), "snare roll");
  // 808 bass notes stay in a sane sub range and hats sit back in the mix.
  for (const p of [b, c, d]) for (const x of on(p, 6)) assert.ok(x.note >= 24 && x.note <= 48, `note ${x.note}`);
  assert.ok(classicMixer()[3].vol < 1);
});

test("classic state: tempo, chain A A B B C D, lossless save + share round trip", () => {
  const s = classicState();
  assert.equal(s.bpm, CLASSIC_BPM);
  assert.deepEqual(s.chain, CLASSIC_CHAIN);
  assert.deepEqual(CLASSIC_CHAIN, [0, 0, 1, 1, 2, 3]);
  const ser = serializeState(s);
  // (the synth patch is quantised to 16 bits in links, so compare the beat itself)
  const beat = (x) => JSON.parse(JSON.stringify({ banks: x.banks, chain: x.chain, mixer: x.mixer, bpm: x.bpm, swing: x.swing, length: x.length }));
  assert.deepEqual(beat(unpackState(packState(ser))), beat(ser));
  assert.deepEqual(beat(fromStored(toStored(s))), beat(ser));
  assert.deepEqual(beat(ser), beat(s), "classic state needs no sanitizing");
  // sanitize is idempotent on it (nothing gets dropped or clamped)
  assert.deepEqual(JSON.parse(JSON.stringify(sanitizeState(ser))), JSON.parse(JSON.stringify(ser)));
  // Share link stays small.
  assert.ok(packState(ser).length < 1500, `packed ${packState(ser).length} bytes`);
});

test("classic sections schedule real hits on every step grid", () => {
  for (const p of classicBanks()) {
    let hits = 0;
    for (let step = 0; step < 16; step++) hits += stepHits(p, step, 60 / CLASSIC_BPM / 4, () => 0).length;
    assert.ok(hits >= 12, `hits ${hits}`);
  }
});

// ---- Loudness / speaker safety ------------------------------------------------
const CEILING = -1.2; // dBFS, the always-on safety ceiling
const dbfs = (x) => 20 * Math.log10(Math.max(1e-9, x));

async function renderSection(bank, { worst = false, song = false } = {}) {
  globalThis.OfflineAudioContext ??= WA.OfflineAudioContext;
  globalThis.window ??= globalThis;
  const { renderWav } = await import("../src/export.mjs");
  const s = classicState();
  s.bank = bank;
  s.song = song;
  if (worst) {
    s.limiter = false;
    s.mixer = s.mixer.map((_, i) => ({ vol: 1, pan: i % 2 ? 0.5 : -0.5, rev: 1, dly: 1 }));
  }
  const r = await renderWav(serializeState(s), { bars: 2, masterGain: worst ? 1 : 0.85 });
  let ss = 0, n = 0;
  for (const c of r.channels) for (let i = 0; i < c.length; i++) { ss += c[i] * c[i]; n++; }
  return { peak: dbfs(r.peak), rms: dbfs(Math.sqrt(ss / n)) };
}

for (const [b, name] of ["A", "B", "C", "D"].entries()) {
  for (const worst of [false, true]) {
    const label = worst ? "mixer + sends + master at max, limiter off" : "default mix";
    test(`loudness: classic section ${name} (${label}) peaks below ${CEILING} dBFS and is audible`, { skip: !WA && "node-web-audio-api not installed (npm install)" }, async () => {
      const r = await renderSection(b, { worst });
      assert.ok(r.peak <= CEILING, `peak ${r.peak.toFixed(2)} dBFS`);
      assert.ok(r.rms > -30, `audible (rms ${r.rms.toFixed(1)} dBFS)`);
    });
  }
}

test("loudness: classic song chain at max levels stays below the ceiling", { skip: !WA && "node-web-audio-api not installed (npm install)" }, async () => {
  const r = await renderSection(0, { worst: true, song: true });
  assert.ok(r.peak <= CEILING, `peak ${r.peak.toFixed(2)} dBFS`);
});

test("every TR-808 voice makes sound and stays under the ceiling at full velocity", { skip: !WA && "node-web-audio-api not installed (npm install)" }, async () => {
  globalThis.OfflineAudioContext ??= WA.OfflineAudioContext;
  globalThis.window ??= globalThis;
  const { Studio } = await import("../src/audio.mjs");
  for (const v of TR808_VOICES) {
    const ctx = new WA.OfflineAudioContext(2, 48000, 48000);
    const s = new Studio();
    s.offline = true;
    s.ctx = ctx;
    s.keepAwake = true;
    s.masterGain = 1;
    s.build();
    // 4 rapid hits: chokes and overlaps must not click or stack past the ceiling.
    for (let k = 0; k < 4; k++) s.play808(v.id, 0.05 + k * 0.06, 1, 43);
    const buf = await ctx.startRendering();
    let pk = 0;
    for (let c = 0; c < 2; c++) for (const x of buf.getChannelData(c)) pk = Math.max(pk, Math.abs(x));
    assert.ok(dbfs(pk) > -40, `${v.id} audible (${dbfs(pk).toFixed(1)} dBFS)`);
    assert.ok(dbfs(pk) <= CEILING, `${v.id} peak ${dbfs(pk).toFixed(2)} dBFS`);
  }
});

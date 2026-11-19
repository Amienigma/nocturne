// Classic TR-808 default sections: content, save-format round trip, and the
// speaker-safety loudness check for every section (defaults and worst-case
// mixer), rendered offline through the real Studio graph.
import assert from "node:assert/strict";
import test from "node:test";
import { classicBanks, classicState, classicMixer, CLASSIC_CHAIN, CLASSIC_BPM, CLASSIC_SECTIONS, CLASSIC_KIT } from "../src/classics.mjs";
import { packState, unpackState, serializeState, sanitizeState, bankIsEmpty, toStored, fromStored, SOURCE_IDS } from "../src/state-io.mjs";
import { TR808_VOICES, sourceIsMelodic, RAMPS, rollShape } from "../src/music.mjs";
import { stepHits } from "../src/sequencer.mjs";

let WA = null;
try { WA = await import("node-web-audio-api"); } catch { /* optional dev dependency */ }

const on = (p, t) => p[t].steps.filter((c) => c.on);
const at = (p, t, j) => p[t].steps[j];

test("classic sections: four distinct, non-empty 2-bar trap grooves on the TR-808 kit", () => {
  const banks = classicBanks();
  assert.equal(banks.length, 4);
  const sigs = new Set(banks.map((b) => JSON.stringify(b)));
  assert.equal(sigs.size, 4, "every section is different");
  for (const [i, b] of banks.entries()) {
    assert.ok(!bankIsEmpty(b), `section ${i} has steps`);
    assert.equal(b[0].source, "tr:BD", "808 bass drum on the kick row");
    assert.ok(on(b, 0).length >= 1, "kick plays");
    assert.ok(on(b, 1).length + on(b, 2).length >= 1, "snare or clap plays");
    assert.ok(b.some((row) => row.steps.slice(16).some((c) => c.on)), "2-bar patterns use bar 2");
  }
  for (const src of Object.values(CLASSIC_KIT)) assert.ok(SOURCE_IDS.includes(src), src);
  assert.equal(TR808_VOICES.length, 10);
  assert.ok(sourceIsMelodic("tr:TOM") && !sourceIsMelodic("tr:BD"));
  assert.equal(CLASSIC_SECTIONS.map((s) => s.name).join(" "), "TRAP RAGE DARK FILL");
});

test("section A is unmistakable trap: gliding 808 melody, kick doubles it, snare on 3, rolling hats", () => {
  const [a] = classicBanks();
  // 808: long, saturated, sliding, carries the melody.
  assert.equal(a[6].source, "n808:Saturated");
  const sub = on(a, 6);
  assert.ok(sub.some((x) => x.slide), "808 slides");
  assert.ok(sub.some((x) => x.gate >= 8), "long 808 (>= half a bar)");
  assert.ok(new Set(sub.map((x) => x.note)).size >= 4, "808 melody");
  for (const x of sub) assert.ok(x.note >= 24 && x.note <= 60, `note ${x.note}`);
  // Short kick doubles every non-slide 808 note.
  a[6].steps.forEach((c, j) => { if (c.on && !c.slide) assert.ok(a[0].steps[j].on, `kick under 808 at ${j}`); });
  // Half-time: snare + clap on beat 3 of each bar, never on 2 or 4.
  for (const j of [8, 24]) assert.ok(at(a, 1, j).on && at(a, 2, j).on, `snare+clap ${j}`);
  for (const j of [4, 12, 20, 28]) assert.ok(!at(a, 1, j).on, `no backbeat at ${j}`);
  // Open hat and a dark bell.
  assert.ok(on(a, 4).length >= 1 && on(a, 8).length >= 4);
});

test("rolling hats are the signature: 1/32, 1/64, 1/128 stutters, triplet runs, ramps into snares and bar ends", () => {
  const banks = classicBanks();
  const [a, b, c, d] = banks;
  const rolls = (p) => on(p, 3).filter((x) => x.rat !== 1);
  // Constant hats: A has a hat (or a rest inside a triplet run / open hat) on nearly every 16th.
  assert.ok(on(a, 3).length >= 26, `A hats ${on(a, 3).length}`);
  assert.ok(rolls(a).length >= 10 && rolls(b).length >= 10, "frequent rolls in A and B");
  assert.ok(rolls(c).length >= 4 && rolls(d).length >= 4, "rolls in C and D too");
  const rates = new Set(banks.flatMap((p) => rolls(p).map((x) => x.rat)));
  for (const r of [2, 3, 4, 6, 8, 1.5, 0.75]) assert.ok(rates.has(r), `uses roll ${r}`);
  // Rolls right before every snare (steps 7 and 23) and at both bar ends (15, 31), ramping up.
  for (const j of [7, 15, 23, 31]) {
    const x = at(a, 3, j);
    assert.ok(x.on && x.rat >= 4, `A roll at ${j}`);
    assert.ok(RAMPS[x.ramp].vel > 0 || RAMPS[x.ramp].pitch > 0, `A ramp up at ${j}`);
  }
  assert.ok(banks.flatMap((p) => on(p, 3)).some((x) => RAMPS[x.ramp].pitch < 0), "some falling rolls");
  // A triplet run never overlaps the next hat: the steps it spans are left empty.
  for (const p of banks) p[3].steps.forEach((x, j) => {
    if (!x.on) return;
    const { span } = rollShape(x.rat);
    for (let k = 1; k < span; k++) assert.ok(!p[3].steps[j + k]?.on, `run at ${j} overlaps ${j + k}`);
  });
});

test("other sections: B rage, C stripped, D fill", () => {
  const [, b, c, d] = classicBanks();
  assert.equal(b[6].source, "n808:Distorted");
  assert.ok(new Set(on(b, 6).map((x) => x.note)).size >= 4, "bouncy 808 line");
  assert.ok(at(b, 1, 8).on && at(b, 1, 24).on, "half-time snare");
  assert.ok(on(c, 6).length <= 4 && on(c, 6).some((x) => x.gate >= 12), "stripped, long 808");
  assert.ok(on(c, 1).length === 0, "no snare in the breakdown");
  const toms = on(d, 7).map((x) => x.note);
  assert.ok(toms.length >= 4 && toms[0] > toms[toms.length - 1], "toms go high -> low");
  assert.ok(on(d, 1).some((x) => x.rat >= 3), "snare roll");
  assert.ok(classicMixer()[3].vol < 1);
});

test("classic state: 145 BPM, no swing, length 32, chain A A B A C D, lossless save + share round trip", () => {
  const s = classicState();
  assert.equal(s.bpm, CLASSIC_BPM);
  assert.equal(CLASSIC_BPM, 145);
  assert.equal(s.swing, 0);
  assert.equal(s.length, 32);
  assert.deepEqual(s.chain, CLASSIC_CHAIN);
  assert.deepEqual(CLASSIC_CHAIN, [0, 0, 1, 0, 2, 3]);
  assert.equal(s.bank, 0, "section A selected by default");
  const ser = serializeState(s);
  const beat = (x) => JSON.parse(JSON.stringify({ banks: x.banks, chain: x.chain, mixer: x.mixer, bpm: x.bpm, swing: x.swing, length: x.length }));
  assert.deepEqual(beat(unpackState(packState(ser))), beat(ser), "rolls and ramps survive share links");
  assert.deepEqual(beat(fromStored(toStored(s))), beat(ser));
  assert.deepEqual(beat(ser), beat(s), "classic state needs no sanitizing");
  assert.deepEqual(JSON.parse(JSON.stringify(sanitizeState(ser))), JSON.parse(JSON.stringify(ser)));
  assert.ok(packState(ser).length < 2500, `packed ${packState(ser).length} bytes`);
});

test("classic sections schedule real hits on every step grid", () => {
  for (const p of classicBanks()) {
    let hits = 0;
    for (let step = 0; step < 32; step++) hits += stepHits(p, step, 60 / CLASSIC_BPM / 4, () => 0).length;
    assert.ok(hits >= 30, `hits ${hits}`);
  }
});

// ---- Loudness / speaker safety ------------------------------------------------
const CEILING = -1.2; // dBFS, the always-on safety ceiling
const dbfs = (x) => 20 * Math.log10(Math.max(1e-9, x));

async function renderSection(bank, { worst = false, song = false, tape = false, layers = null } = {}) {
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
  const r = await renderWav(serializeState(s), { bars: 2, masterGain: worst ? 1 : 0.85, tape, layers });
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

test("loudness: TAPE on (+ polymetric layer loops) at max levels stays below the ceiling", { skip: !WA && "node-web-audio-api not installed (npm install)" }, async () => {
  const { sanitizeLayers } = await import("../src/sequencer.mjs");
  const layers = sanitizeLayers([null, null, null, { mode: "loop", start: 24, end: 32 }, null, null, { mode: "loop", start: 0, end: 12 }], 12);
  for (const b of [0, 1]) {
    const r = await renderSection(b, { worst: true, tape: true, layers });
    assert.ok(r.peak <= CEILING, `tape ${b} peak ${r.peak.toFixed(2)} dBFS`);
    assert.ok(r.rms > -30, `tape audible (rms ${r.rms.toFixed(1)} dBFS)`);
  }
});

test("hat rolls are audible in a render: one onset per roll hit (1/32, 1/64, 1/128, triplet runs)", { skip: !WA && "node-web-audio-api not installed (npm install)" }, async () => {
  globalThis.OfflineAudioContext ??= WA.OfflineAudioContext;
  globalThis.window ??= globalThis;
  const { renderWav } = await import("../src/export.mjs");
  for (const [rat, ramp, want] of [[1, 0, 1], [2, 0, 2], [4, 5, 4], [8, 5, 8], [1.5, 1, 3], [0.75, 3, 3]]) {
    const s = classicState();
    s.banks = s.banks.map((p, b) => p.map((row, t) => ({ ...row, steps: row.steps.map((c, j) => ({ ...c, on: b === 0 && t === 3 && j === 4, vel: 0.8, rat, ramp })) })));
    const r = await renderWav(serializeState(s), { bars: 1 });
    const x = r.channels[0], sr = 48000, fr = 96; // 2 ms frames of the first difference (hat transients)
    const t0 = Math.round((0.02 + (4 * 60) / CLASSIC_BPM / 4) * sr);
    const env = [];
    for (let f = 0; f < 220; f++) { let m = 0; for (let i = 0; i < fr; i++) { const k = t0 + f * fr + i; m = Math.max(m, Math.abs(x[k] - x[k - 1])); } env.push(m); }
    let onsets = 0;
    for (let f = 2; f < env.length; f++) if (env[f] > 0.01 && env[f] > 2.5 * Math.min(env[f - 1], env[f - 2])) { onsets++; f += 3; }
    assert.equal(onsets, want, `roll ${rat}: ${onsets} onsets`);
  }
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

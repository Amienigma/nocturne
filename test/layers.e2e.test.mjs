// Browser e2e for layering over uploads (npm run test:e2e): a loaded file
// loops as a bed that keeps playing while you tap sample pads (polyphonic),
// the soundboard, play sections, load a library pattern, hit CUT and overdub
// taps into the playing section. Only ■ STOP ALL stops it.
import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => p && fs.existsSync(p));
let puppeteer = null;
try { puppeteer = (await import("puppeteer-core")).default; } catch { /* optional */ }
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2" };

function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    let file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end(); return; }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" }).end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/** A mono 16-bit sine WAV (a stand-in for an uploaded loop). */
function toneWav(sec, hz) {
  const rate = 44100;
  const n = Math.round(rate * sec);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 20000), 44 + i * 2);
  return buf;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("e2e: uploads loop as beds and keep playing under pads, sections, pattern loads and overdub", { skip: (!CHROME || !puppeteer) && "Chrome or puppeteer-core not available", timeout: 180000 }, async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error" && !/amienigma-llm/.test(m.text())) errors.push(m.text()); });
    await page.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1" });
    await page.goto(base, { waitUntil: "networkidle0" });
    const click = (sel) => page.$eval(sel, (e) => e.click());
    const tap = (sel) => page.$eval(sel, (e) => {
      e.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }));
      e.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
    });
    const tr = () => page.evaluate(() => window.__nocturneTransport());
    const lay = () => page.evaluate(() => window.__nocturneLayers());
    const waitFor = (fn, arg, timeout = 15000) => page.waitForFunction(fn, { timeout, polling: 20 }, arg);
    assert.match(await page.$eval("#build-tag", (e) => e.textContent), /^build \d{4}\.\d{2}\.\d{2}/);

    // Load two files: a 2 s "loop" into pad 1 and a 0.6 s one-shot into pad 2.
    const dir = fs.mkdtempSync("/tmp/noct-layers-");
    const load = async (slot, file, re) => {
      const [chooser] = await Promise.all([page.waitForFileChooser(), click(`.smp[data-slot="${slot}"] [data-sact="load"]`)]);
      await chooser.accept([file]);
      await waitFor((r) => new RegExp(r).test(document.getElementById("smp-status").textContent), re, 10000);
    };
    fs.writeFileSync(path.join(dir, "bedloop.wav"), toneWav(2, 110));
    fs.writeFileSync(path.join(dir, "shot.wav"), toneWav(0.6, 440));
    await load(1, path.join(dir, "bedloop.wav"), "Sample 1: bedloop");
    await load(2, path.join(dir, "shot.wav"), "Sample 2: shot");

    // ⟳ LOOP on pad 1 with the beat stopped: starts now and loops.
    assert.equal(await page.$eval('.smp[data-slot="1"] [data-sact="loop"]', (e) => e.textContent), "⟳ LOOP");
    await click('.smp[data-slot="1"] [data-sact="loop"]');
    assert.deepEqual((await lay()).beds, [1]);
    // Watch the bed's own source node: it must never end until STOP ALL.
    await page.evaluate(() => {
      const bed = window.__nocturne808.beds.get(1);
      window.__bedEnded = false;
      window.__bedSrc = bed.src;
      bed.src.addEventListener("ended", () => { window.__bedEnded = true; });
    });
    assert.equal(await page.$eval('.smp[data-slot="1"] [data-sact="loop"]', (e) => [e.textContent, e.getAttribute("aria-pressed")].join("|")), "■ LOOP|true");
    assert.equal(await page.$eval("#play", (e) => e.disabled), false, "STOP ALL is live while a bed loops");
    await sleep(2300); // past the file's own length: it's looping, not a one-shot

    // Tap pad 1 itself three times and pad 2 five times: taps overlap (no choke), bed untouched.
    for (let i = 0; i < 3; i++) await click('.smp[data-slot="1"] [data-sact="play"]');
    for (let i = 0; i < 5; i++) await click('.smp[data-slot="2"] [data-sact="play"]');
    let L = await lay();
    // (>= because a file's preview tap right after LOAD may still be ringing.)
    const pv = Object.fromEntries(L.padVoices);
    assert.ok(pv[1] >= 3 && pv[2] >= 5, `pad taps are polyphonic by default ${JSON.stringify(pv)}`);
    // The soundboard: drum pads, chord pads, a chord-loop pad, then a note while it loops.
    await tap("#kicks .pad");
    await tap("#snares .pad");
    await tap("#pit-chords .pad");
    const loopPad = await page.$("#pit-loops .pad");
    if (loopPad) {
      await tap("#pit-loops .pad");
      await tap("#pit-notes .pad");
      assert.ok(await page.evaluate(() => window.__nocturneState.loopId != null), "a note tap doesn't stop the chord loop");
    }

    // Section A plays on top; then a library pattern loads into A while it all runs; B layers in.
    await click('[data-loop="0"]');
    await waitFor(() => window.__nocturneTransport().absStep > 20);
    await page.$eval("[data-lib]", (e) => e.click());
    await click('[data-loop="1"]');
    await waitFor(() => window.__nocturneTransport().loopers[1].on, null, 20000);

    // ⟳ LOOP on pad 2 while the beat runs: it waits for the next bar line.
    await click('.smp[data-slot="2"] [data-sact="loop"]');
    const bar = await page.evaluate(() => {
      const t = window.__nocturneTransport();
      const start = window.__nocturne808.beds.get(2).start;
      const stepSec = 60 / t.bpm / 4;
      return { pos: t.absStep + (start - t.nextTime) / stepSec, now: window.__nocturne808.ctx.currentTime, start };
    });
    assert.ok(Math.abs(bar.pos - Math.round(bar.pos)) < 1e-3 && Math.round(bar.pos) % 16 === 0, `bed 2 starts on a bar line (step ${bar.pos})`);
    assert.ok(bar.start >= bar.now, "bed 2 is scheduled, not cut in mid-bar");

    // CUT (held notes / chord loop) leaves beds and sections alone.
    await click("#cut");
    L = await lay();
    assert.deepEqual(L.beds.sort(), [1, 2]);
    assert.equal((await tr()).playing, true);

    // OVERDUB: armed now, live from the next bar; a pad-2 tap lands in the playing section.
    await click("#overdub");
    L = await lay();
    assert.equal(L.overdub.on, true);
    const from = L.overdub.from;
    assert.equal(from % 16, 0, "overdub starts on a bar line");
    await waitFor((f) => window.__nocturneTransport().absStep > f + 3, from, 20000);
    const before = await page.evaluate(() => JSON.stringify(window.__nocturneState.banks));
    await click('.smp[data-slot="2"] [data-sact="play"]');
    const dub = await page.evaluate((b) => {
      const s = window.__nocturneState;
      const now = JSON.stringify(s.banks);
      const hits = [];
      s.banks.forEach((p, bank) => p.forEach((r, t) => { if (r.source === "smp:2") r.steps.forEach((c, i) => { if (c.on) hits.push({ bank, t, i }); }); }));
      return { changed: now !== b, hits };
    }, before);
    assert.ok(dub.changed && dub.hits.length >= 1, `overdub wrote the tap into a section: ${JSON.stringify(dub.hits)}`);
    const t1 = await tr();
    await sleep(400);
    assert.ok((await tr()).absStep > t1.absStep, "the transport kept running through the overdub");
    assert.equal(await page.$eval("#overdub", (e) => e.getAttribute("aria-pressed")), "true");

    // Stop both sections with their own ▶ PLAY: the beat stops, beds keep looping.
    await click('[data-loop="0"]');
    await click('[data-loop="1"]');
    await waitFor(() => !window.__nocturneTransport().playing);
    await sleep(300);
    L = await lay();
    assert.deepEqual(L.beds.sort(), [1, 2], "beds outlive the sections");
    assert.equal(L.ctx, "running");
    assert.equal(await page.evaluate(() => window.__bedEnded), false, "the upload never stopped");
    assert.equal(await page.evaluate(() => window.__nocturne808.beds.get(1).src === window.__bedSrc), true, "same source node the whole time (never restarted)");
    assert.equal(await page.$eval("#play", (e) => e.disabled), false);

    // CHOKE on pad 2: now its taps cut each other.
    await click('.smp[data-slot="2"] [data-sact="choke"]');
    for (let i = 0; i < 3; i++) await click('.smp[data-slot="2"] [data-sact="play"]');
    await sleep(80);
    L = await lay();
    assert.ok(Object.fromEntries(L.padVoices)[2] <= 1, `choked pad keeps one voice (${JSON.stringify(L.padVoices)})`);

    // ■ STOP ALL stops everything.
    await click("#play");
    await sleep(200);
    L = await lay();
    assert.deepEqual(L.beds, []);
    assert.equal(L.overdub.on, false);
    assert.equal(await page.evaluate(() => window.__bedEnded), true);
    assert.equal(await page.$eval("#play", (e) => e.disabled), true, "nothing left to stop");
    assert.equal(await page.$eval('.smp[data-slot="1"] [data-sact="loop"]', (e) => e.textContent), "⟳ LOOP");
    // Controls stay at least 44 px tall on a 390 px phone and nothing overflows.
    const sizes = await page.$$eval('.smp [data-sact="loop"], .smp [data-sact="choke"], #overdub', (els) => els.map((e) => e.getBoundingClientRect().height));
    assert.ok(sizes.every((h) => h >= 44), JSON.stringify(sizes));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});

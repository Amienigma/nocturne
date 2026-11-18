// Browser end-to-end test (npm run test:e2e). Needs Chrome/Chromium; set
// CHROME_PATH if it isn't in a standard place. Skips when none is found.
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

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".woff2": "font/woff2" };

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

// A v1 share link made by the previous release (BLACK ICE, 142 BPM, 32 steps).
const V1 = "rAY4RIAAFuFFMzR64QkyCA564eoMAEQAAAAAAABYAAAAAEFgmAQAbAAAAAAAAHwEAAAAAACAAAAAAAAAkAAAAAAAAAACAAECBWCQBWCABWCIBKBgBAAoAAAAAAABIAAAAAQFYPAZYPAYAMgAAAAAAADMAAAAREVg0AVg0AVg0AVg0AQA2AAAAAAA";

// 1 s full-scale 100 Hz square wave, 16-bit mono 44.1 kHz.
function squareWav() {
  const rate = 44100;
  const n = rate;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE((Math.floor(i / 220.5) % 2 ? -1 : 1) * 32767, 44 + i * 2);
  return buf;
}

test("e2e: iPhone layout, banks + song, step features, mixer, keyboard grid, share links", { skip: (!CHROME || !puppeteer) && "Chrome or puppeteer-core not available", timeout: 120000 }, async () => {
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
    const $ = (sel) => page.$eval(sel, (e) => e.click());

    // No horizontal overflow on a phone, with the mixer open.
    await page.$eval("#mixer-panel", (d) => { d.open = true; });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.equal(overflow, 0, "no horizontal scroll at 390 px");

    // Bank B: starts empty, a step tap lands in B only.
    await $('[data-pbank="1"]');
    assert.equal(await page.$eval('[data-pbank="1"]', (e) => e.getAttribute("aria-pressed")), "true");
    assert.equal(await page.$$eval(".seq-row .step.on", (e) => e.length), 0);
    await page.$eval('.seq-row.sel .step[data-s="0"]', (e) => e.click());
    assert.equal(await page.$eval('.seq-row.sel .step[data-s="0"]', (e) => e.getAttribute("aria-pressed")), "true");

    // Step inspector: roll ×3, 50% chance → indicators + label (not colour alone).
    await page.select("#insp-rat", "3");
    await page.select("#insp-prob", "0.5");
    const cell = await page.$eval('.seq-row.sel .step[data-s="0"]', (e) => ({ rat: e.dataset.rat, prob: e.classList.contains("prob"), label: e.getAttribute("aria-label") }));
    assert.equal(cell.rat, "3");
    assert.ok(cell.prob);
    assert.match(cell.label, /velocity \d+%, roll ×3, 50% chance/);

    // Song chain A → B, then play: it runs without errors.
    await $("#chain-add");
    await $("#song");
    assert.deepEqual(await page.$$eval("#chain .mini", (e) => e.map((x) => x.textContent)), ["A", "B"]);
    await $("#play");
    await new Promise((r) => setTimeout(r, 1500));
    await $("#play");

    // Mixer: a fader updates state and its label.
    await page.$eval('#mixer input[data-t="0"][data-k="pan"]', (e) => { e.value = "-0.5"; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); });
    assert.match(await page.$eval('#mixer .mix-row label:nth-of-type(2) span', (e) => e.textContent), /PAN L50/);

    // Keyboard: arrows move a roving tabindex, Enter toggles, Space does not start playback.
    await page.setViewport({ width: 1280, height: 900 });
    await page.$eval('.seq-row[data-t="0"] .step[data-s="0"]', (e) => e.focus());
    await page.keyboard.press("ArrowRight");
    const focused = await page.evaluate(() => ({ t: document.activeElement.dataset.t, s: document.activeElement.dataset.s, tab: document.activeElement.tabIndex }));
    assert.deepEqual(focused, { t: "0", s: "1", tab: 0 });
    await page.keyboard.press("Enter");
    assert.equal(await page.$eval('.seq-row[data-t="0"] .step[data-s="1"]', (e) => e.getAttribute("aria-pressed")), "true");
    await page.keyboard.press(" ");
    assert.equal(await page.$eval("#play", (e) => e.textContent), "PLAY");
    assert.equal(await page.$eval('.seq-row[data-t="0"] .step[data-s="1"]', (e) => e.getAttribute("aria-pressed")), "false");

    // Share link v2 round trip in a fresh tab keeps bank B, chain, mixer and the roll.
    const code = await page.evaluate(async () => (await import("./src/state-io.mjs")).encodeShare((await import("./src/state-io.mjs")).serializeState(window.__nocturneState)));
    const p2 = await browser.newPage();
    p2.on("pageerror", (e) => errors.push(String(e)));
    await p2.goto(`${base}#s=${code}`, { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 300));
    const loaded = await p2.evaluate(() => ({ bank: window.__nocturneState.bank, chain: window.__nocturneState.chain, song: window.__nocturneState.song,
      pan: window.__nocturneState.mixer[0].pan, rat: window.__nocturneState.banks[1][6].steps[0].rat }));
    // (PLAY in song mode moved the edit bank to the chain's first part, A.)
    assert.deepEqual(loaded, { bank: 0, chain: [0, 1], song: true, pan: -0.5, rat: 3 });

    // A v1 link from the previous release still opens.
    await p2.goto(`${base}#s=${V1}`, { waitUntil: "networkidle0" });
    await p2.reload({ waitUntil: "networkidle0" }); // hashchange-free path: load from autosave after import
    const v1 = await p2.evaluate(() => ({ bpm: document.getElementById("bpm-num").value, len: window.__nocturneState.length }));
    assert.ok(["142"].includes(v1.bpm) && v1.len === 32, JSON.stringify(v1));

    // Sampling: import a loud WAV into slot 1, use it as the Kick track's sound,
    // export: still below -1 dBFS; the sample survives a reload (IndexedDB).
    const wav = path.join(fs.mkdtempSync("/tmp/noct-e2e-"), "square.wav");
    fs.writeFileSync(wav, squareWav());
    await p2.evaluate(() => { localStorage.clear(); });
    await p2.reload({ waitUntil: "networkidle0" });
    const [chooser] = await Promise.all([p2.waitForFileChooser(), p2.$eval('.smp[data-slot="1"] [data-sact="load"]', (e) => e.click())]);
    await chooser.accept([wav]);
    await p2.waitForFunction(() => /Sample 1: square/.test(document.getElementById("smp-status").textContent), { timeout: 10000 });
    await p2.evaluate(() => {
      const pick = document.getElementById("trk-pick"); pick.value = "0"; pick.dispatchEvent(new Event("change"));
      const src = document.getElementById("trk-src"); src.value = "smp:1"; src.dispatchEvent(new Event("change"));
      document.getElementById("exp-bars").value = "1";
      document.getElementById("vol").value = "1";
    });
    assert.match(await p2.$eval('#trk-src option[value="smp:1"]', (e) => e.textContent), /1\. square/);
    await p2.$eval("#export", (e) => e.click());
    await p2.waitForFunction(() => window.__lastExport && !document.getElementById("export").disabled, { timeout: 60000 });
    const peak = await p2.evaluate(() => 20 * Math.log10(window.__lastExport.peak));
    assert.ok(peak < -1 && peak > -30, `sample export peak ${peak}`);
    await p2.reload({ waitUntil: "networkidle0" });
    await p2.waitForFunction(() => /square/.test(document.querySelector('.smp[data-slot="1"] small').textContent), { timeout: 5000 });
    assert.match(await p2.$eval("#midi-status", (e) => e.textContent), /MIDI/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});

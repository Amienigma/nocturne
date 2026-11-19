// Browser e2e for the classic 808 sections (npm run test:e2e): defaults load
// only on an empty session, each section solo-loops, switches land on bar
// lines, the song chain plays in order, and loop <-> song never stops the
// transport. Skips when Chrome / puppeteer-core aren't available.
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("e2e: classic 808 sections, solo loops, bar-line queueing, song chain", { skip: (!CHROME || !puppeteer) && "Chrome or puppeteer-core not available", timeout: 180000 }, async () => {
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
    const tr = () => page.evaluate(() => window.__nocturneTransport());
    const waitFor = (fn, arg, timeout = 15000) => page.waitForFunction(fn, { timeout, polling: 20 }, arg);

    // 1. Fresh session: four classic sections, chain A A B B C D, nothing overflows at 390 px.
    const fresh = await page.evaluate(async () => {
      const { classicBanks } = await import("./src/classics.mjs");
      const s = window.__nocturneState;
      const want = classicBanks().map((b) => JSON.stringify(b));
      return {
        same: s.banks.map((b, i) => JSON.stringify(b) === want[i]),
        names: [...document.querySelectorAll(".sec-name")].map((e) => e.textContent),
        chain: s.chain, bpm: s.bpm, saved: localStorage.getItem("nocturne.autosave.v1"),
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        loopLabels: [...document.querySelectorAll("[data-loop]")].map((e) => e.getAttribute("aria-label")),
      };
    });
    assert.deepEqual(fresh.same, [true, true, true, true]);
    assert.deepEqual(fresh.names, ["ELECTRO", "TRAP", "MIAMI", "BREAK"]);
    assert.deepEqual(fresh.chain, [0, 0, 1, 1, 2, 3]);
    assert.equal(fresh.bpm, 128);
    assert.equal(fresh.saved, null, "defaults alone don't write an autosave");
    assert.equal(fresh.overflow, 0);
    assert.deepEqual(fresh.loopLabels, ["Loop section A", "Loop section B", "Loop section C", "Loop section D"]);

    // 2. Solo-loop each section: it plays on its own, keeps looping (no switches), and stops on a 2nd tap.
    for (const b of [0, 1, 2, 3]) {
      await click(`[data-loop="${b}"]`);
      await waitFor((bb) => { const t = window.__nocturneTransport(); return t.playing && t.bank === bb && t.absStep > 20; }, b);
      const t = await tr();
      assert.equal(t.song, false);
      assert.deepEqual(t.log, [], `section ${b} loops without switching`);
      assert.equal(await page.$eval(`[data-loop="${b}"]`, (e) => e.getAttribute("aria-pressed")), "true");
      assert.match(await page.$eval("#bank-status", (e) => e.textContent), new RegExp(`Looping section ${"ABCD"[b]}`));
      await click(`[data-loop="${b}"]`);
      assert.equal((await tr()).playing, false);
    }

    // 3. Bar-line queueing: while A loops, tap C mid-bar -> C starts exactly on the next bar.
    await click('[data-loop="0"]');
    await waitFor(() => { const t = window.__nocturneTransport(); return t.playing && t.absStep % 16 >= 3 && t.absStep % 16 <= 9; });
    await click('[data-loop="2"]');
    let t = await tr();
    assert.equal(t.queuedBank, 2);
    assert.equal(t.bank, 0, "still playing A until the bar line");
    assert.match(await page.$eval('[data-loop="2"]', (e) => e.textContent), /NEXT BAR/);
    await waitFor(() => window.__nocturneTransport().log.length >= 1);
    t = await tr();
    assert.equal(t.log[0].bank, 2);
    assert.equal(t.log[0].step % 16, 0, `switched on a bar line (step ${t.log[0].step})`);
    assert.equal(t.playing, true);

    // 4. Loop -> song without stopping: ▶ SONG queues the chain for the next bar, then A A B B C D in order.
    await click("#song");
    assert.equal((await tr()).queuedMode, "song");
    await waitFor(() => window.__nocturneTransport().log.filter((x) => x.song).length >= 6, null, 30000);
    t = await tr();
    const songLog = t.log.filter((x) => x.song);
    assert.deepEqual(songLog.slice(0, 6).map((x) => x.bank), [0, 0, 1, 1, 2, 3], JSON.stringify(songLog));
    assert.ok(songLog.every((x) => x.step % 16 === 0), "song parts change on bar lines");
    assert.equal(songLog[0].why, "bar");
    for (let i = 1; i < 6; i++) assert.equal(songLog[i].step - songLog[i - 1].step, 16, "one bar per part");
    assert.equal(t.playing, true, "transport never stopped");
    // ...and it loops back to the top.
    await waitFor(() => window.__nocturneTransport().log.filter((x) => x.song).length >= 7, null, 15000);
    assert.equal((await tr()).log.filter((x) => x.song)[6].bank, 0);

    // 5. Song -> one section, still without stopping: tap ▶ LOOP on B.
    await click('[data-loop="1"]');
    assert.equal((await tr()).queuedMode, "loop");
    const before = (await tr()).log.length;
    await waitFor((n) => window.__nocturneTransport().log.length > n && !window.__nocturneTransport().song, before);
    t = await tr();
    const last = t.log[t.log.length - 1];
    assert.deepEqual([last.bank, last.song, last.step % 16], [1, false, 0]);
    assert.equal(t.playing, true);
    await click('[data-loop="1"]'); // stop
    assert.equal((await tr()).playing, false);

    // 6. Chain building: CLEAR, tap +D +A, ⌫ removes the last part.
    await click("#chain-clear");
    assert.equal(await page.$eval("#song", (e) => e.disabled), true, "empty song can't play");
    await click('[data-append="3"]');
    await click('[data-append="0"]');
    await click('[data-append="0"]');
    await click("#chain-del");
    assert.deepEqual(await page.$$eval("#chain .mini", (e) => e.map((x) => x.textContent)), ["D", "A"]);

    // 7. Audio actually renders for every classic section (offline, same graph as playback).
    const levels = await page.evaluate(async () => {
      const { renderWav } = await import("./src/export.mjs");
      const { classicState } = await import("./src/classics.mjs");
      const out = [];
      for (let b = 0; b < 4; b++) {
        const s = classicState();
        s.bank = b;
        const r = await renderWav(s, { bars: 1 });
        let ss = 0, n = 0;
        for (const c of r.channels) for (const x of c) { ss += x * x; n++; }
        out.push({ peak: 20 * Math.log10(r.peak), rms: 10 * Math.log10(ss / n) });
      }
      return out;
    });
    for (const [b, l] of levels.entries()) {
      assert.ok(l.rms > -30, `section ${"ABCD"[b]} renders audio (rms ${l.rms.toFixed(1)})`);
      assert.ok(l.peak <= -1.2, `section ${"ABCD"[b]} peak ${l.peak.toFixed(2)}`);
    }

    // 8. Saved work is never overwritten by the defaults; LOAD CLASSIC 808 brings them back (undoable).
    await page.evaluate(async () => {
      const io = await import("./src/state-io.mjs");
      const s = io.defaultState();
      s.bpm = 93;
      s.banks[0][0].steps[0] = { ...s.banks[0][0].steps[0], on: true };
      localStorage.setItem("nocturne.autosave.v1", JSON.stringify(io.toStored(s)));
      // (this page would autosave its own state on pagehide; keep the seeded save)
      Storage.prototype.setItem = () => {};
    });
    await page.reload({ waitUntil: "networkidle0" });
    const restored = await page.evaluate(() => {
      const s = window.__nocturneState;
      return { bpm: s.bpm, onA: s.banks[0].flatMap((r) => r.steps).filter((c) => c.on).length, emptyB: s.banks[1].every((r) => r.steps.every((c) => !c.on)), names: [...document.querySelectorAll(".sec-name")].map((e) => e.textContent) };
    });
    assert.deepEqual(restored, { bpm: 93, onA: 1, emptyB: true, names: ["edited", "empty", "empty", "empty"] });
    await click("#classic-load");
    assert.deepEqual(await page.$$eval(".sec-name", (e) => e.map((x) => x.textContent)), ["ELECTRO", "TRAP", "MIAMI", "BREAK"]);
    assert.equal(await page.$eval("#bpm-num", (e) => e.value), "128");
    await click("#undo");
    assert.equal(await page.evaluate(() => window.__nocturneState.bpm), 93);

    // 9. Idle: nothing runs once stopped (no rAF loop, no scheduler, context suspends).
    const idle = await page.evaluate(async () => {
      let raf = 0;
      const orig = window.requestAnimationFrame;
      window.requestAnimationFrame = (f) => { raf++; return orig(f); };
      await new Promise((r) => setTimeout(r, 1500));
      window.requestAnimationFrame = orig;
      return { raf, playing: window.__nocturneState.playing };
    });
    assert.deepEqual(idle, { raf: 0, playing: false });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});

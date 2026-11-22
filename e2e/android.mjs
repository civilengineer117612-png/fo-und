// Serve the repo on port 8124, then node e2e/android.mjs. Every name and figure here is invented.
// ANDROID READY (owner, Nov 21: friends install from Chrome on Android, no APK). On an Android-size phone in Chromium (Chrome's own engine):
//   1. the app is no longer switched off: in a Chrome tab and as an installed app it opens the ledger and logs an entry;
//   2. what Chrome needs to offer "Install app" / "Add to Home screen" is there (manifest, icons, a service worker that answers fetches);
//   3. L13: Back closes the open window, the menu or a warning, never the app; typed text asks first; Back with nothing open is left alone.
// What only a real Android phone can show is listed at the end of the run (and in the PR).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launchBrowser } from "./engine.mjs";
import { emptyLedger, CHANGES, SCREEN_NAMES, validateState } from "../src/model/index.js";
const browser = await launchBrowser();
const base = process.env.BASE ?? "http://127.0.0.1:8124/app/index.html";
const errors = [], TS = "2026-11-21T03:00:00Z";
let passed = 0;
const ok = (cond, label) => { assert.ok(cond, label); passed++; console.log("ok: " + label); };
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

const seeded = () => {
  const l = emptyLedger(), s = l.state; l.rev = 1; l.saved_at = "2026-11-20T08:00:00.000+08:00";
  s.accounts.push({ id: "wal", name: "Sample Wallet", class: "asset", role: "", opening_balance: 50000, opening_date: "2026-01-01", hidden_by_default: false, archived: false });
  s.categories = [{ id: "food", name: "Food", kind: "expense", role: "food" }, ...s.categories.filter((c) => c.kind === "income")];
  assert.deepEqual(validateState(s), []);
  l.settings = { notice_seen_at: TS, whatsnew_seen: CHANGES[0].id, version_seen: "999.0.0", welcome_off: true, start_rule_seen: TS, cat_card_seen: TS, firstrun_done: TS, bankLogosTried: {}, intro_off: Object.fromEntries(Object.keys(SCREEN_NAMES).map((k) => [k, true])) };
  return l;
};
// A Pixel-size phone. `installed`: the app runs as an installed app (Chrome reports display-mode standalone; a test browser cannot install, so
// that one answer is given here, the way the iPhone scripts give navigator.standalone).
const phone = async ({ installed, sw = false }) => {
  const ctx = await browser.newContext({ ...(sw ? {} : { serviceWorkers: "block" }), viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, userAgent: ANDROID });
  await ctx.route("**/*", (route) => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
  await ctx.addInitScript((inst) => {
    try { sessionStorage.setItem("logOpen", "1"); } catch {}   // about:blank (the page before the app in the Back test) has no storage
    if (inst) { const real = window.matchMedia.bind(window); window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : real(q)); }
  }, installed);
  await ctx.clock.setFixedTime(new Date(TS));
  return ctx;
};
const open = async (ctx, url = base) => { const page = await ctx.newPage(); page.on("pageerror", (e) => errors.push(e.message)); await page.goto(url); await page.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 }); return page; };
const seed = async (page) => {
  await page.evaluate(async (text) => { localStorage.setItem("financialTracker.ledger", text);
    await new Promise((res) => { const r = indexedDB.open("financialTracker", 3); r.onsuccess = () => { const tx = r.result.transaction("kv", "readwrite"); tx.objectStore("kv").put(text, "ledger"); tx.oncomplete = () => { r.result.close(); res(); }; }; }); }, JSON.stringify(seeded()));
  await page.reload(); await page.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 });
};
const stored = (page) => page.evaluate(async () => {
  for (let i = 0; i < 100 && document.documentElement.dataset.saving; i++) await new Promise((r) => setTimeout(r, 30));
  return JSON.parse(localStorage.getItem("financialTracker.ledger"));
});
const text = (page, sel) => page.locator(sel).innerText().catch(() => "");
const own = (page) => page.evaluate(() => history.state?.foLayer === 1);
const back = async (page) => { await page.goBack({ waitUntil: "commit" }).catch(() => {}); await page.waitForTimeout(250); };

// ---- 1. a Chrome tab on an Android phone opens the ledger (before Nov 21: "This is not the finance phone", entry off)
{ const ctx = await phone({ installed: false });
  const page = await open(ctx);
  ok(!(await text(page, "#banner")).includes("finance phone") && !(await text(page, "#screen")).includes("Entry is switched off"), "a Chrome tab on Android is not switched off any more");
  ok(await page.locator("#sheet .frstep, #sheet [data-action='fr-start']").count() > 0 || (await text(page, "#sheet")).includes("Start fresh"), "a brand-new Android phone starts with the setup steps, like a new iPhone");
  await seed(page);
  ok(await page.locator('#nav [data-action="open-scan-pick"]').count() === 1 && await page.locator('[data-action="open-other"]').count() === 1, "with a ledger, logging is on: Scan and Add expense are there");
  ok(!(await page.evaluate(() => navigator.storage.persisted())) && (await text(page, "#install-note")) === "Install this app so your phone keeps your data: open your browser's menu, then Add to Home screen or Install app.", "in a Chrome tab whose storage is not protected, Log has the one line: install the app, and how");
  await page.click('[data-action="open-other"]'); await page.waitForSelector("#sheet #f-amount");
  await page.fill("#f-amount", "120");
  await page.evaluate(() => document.querySelector('#sheet [data-action="pick-cat"][data-id="food"]').click());
  await page.evaluate(() => document.querySelector('#sheet [data-action="pick-acct"][data-id="wal"]').click());
  await page.click("#f-save");
  await page.waitForFunction(() => !document.querySelector("#sheet .sheet"));
  const l = await stored(page);
  ok(l.state.transactions.length === 1 && l.state.transactions[0].status === "draft", "an expense typed on Android is saved, a draft waiting in Verify, like on an iPhone");
  ok(!(await text(page, "body")).match(/iPhone|Face ID|Safari/), "nothing on the screen names an iPhone");
  await ctx.close(); }

// ---- 2. installed (Chrome's Add to Home screen): the same ledger rules; a trial is never switched on inside the installed app
{ const ctx = await phone({ installed: true });
  const page = await open(ctx); await seed(page);
  ok(!(await text(page, "#banner")).includes("finance phone") && await page.locator('[data-action="open-other"]').count() === 1, "the installed app on Android holds the ledger and logs");
  ok(await page.locator("#install-note").count() === 0, "the installed app has no install line");
  const t = await open(ctx, base + "?trial");
  ok(!(await text(t, "#banner")).includes("Trial copy") && await t.locator('[data-action="open-other"]').count() === 1, "?trial is ignored inside the installed app (it holds the real ledger), as on an iPhone's Home Screen app");
  await ctx.close(); }
{ const ctx = await phone({ installed: false });
  const t = await open(ctx, base + "?trial");
  ok((await text(t, "#banner")).includes("Trial copy"), "in a Chrome tab ?trial still opens the separate trial copy");
  ok(await t.locator("#install-note").count() === 0, "a trial copy has no install line");
  await ctx.close(); }

// ---- 3. what Chrome needs before it offers to install the app
{ const m = JSON.parse(readFileSync(new URL("../app/manifest.json", import.meta.url), "utf8"));
  const sizes = m.icons.map((i) => i.sizes);
  ok(m.name && m.short_name && m.display === "standalone" && m.start_url && m.scope, "the manifest has a name, a short name, a start address, a scope and opens as an app (standalone)");
  ok(sizes.includes("192x192") && sizes.includes("512x512") && m.icons.some((i) => i.purpose === "maskable"), "icons of 192 and 512 pixels, and a maskable one for Android's round icon");
  ok(/addEventListener\("fetch"/.test(readFileSync(new URL("../app/sw.js", import.meta.url), "utf8")), "the service worker answers fetches (Chrome asks for that before offering Install)");
  const ctx = await phone({ installed: false, sw: true });
  const page = await open(ctx);
  ok(await page.evaluate(() => document.querySelector('link[rel="manifest"]')?.getAttribute("href") === "manifest.json"), "the page names its manifest");
  ok(await page.evaluate(async () => { for (let i = 0; i < 60; i++) { if ((await navigator.serviceWorker.getRegistration())?.active) return true; await new Promise((r) => setTimeout(r, 250)); } return false; }), "the service worker is running in Chrome");
  await ctx.close(); }

// ---- 4. L13: Back closes the open window, not the app
{ const ctx = await phone({ installed: true });
  const page = await ctx.newPage(); page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("about:blank");   // something before the app in history: a Back that is not stopped leaves the app and lands here
  await page.goto(base); await page.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 });
  await seed(page);
  const inApp = () => page.url().startsWith(new URL(base).origin) && page.locator("#nav button").first().isVisible();
  const steps0 = await page.evaluate(() => history.length);

  await page.click('[data-action="open-other"]'); await page.waitForSelector("#sheet #f-amount");
  ok(await own(page), "an open window keeps one step of its own in the history");
  await back(page);
  ok(await inApp() && await page.locator("#sheet .sheet").count() === 0, "Back closes Add expense and stays in the app");
  ok(!(await own(page)), "and the window's step is gone with it");

  await page.click('[data-action="open-other"]'); await page.waitForSelector("#sheet #f-amount"); await page.fill("#f-amount", "75");
  await back(page);
  ok(await inApp() && (await text(page, "#warn")).includes("Discard what you typed?") && await page.locator("#sheet .sheet").count() === 1, "with something typed, Back asks \"Discard what you typed?\" and the window stays");
  await back(page);
  ok(await page.locator("#warn").innerHTML() === "" && await page.inputValue("#sheet #f-amount") === "75", "Back again answers Keep editing: the question goes, what was typed is still there");
  await back(page);
  await page.click('#warn [data-action="warn-save"]');
  await page.waitForFunction(() => !document.querySelector("#sheet .sheet"));
  await page.waitForTimeout(250);
  ok(await inApp() && !(await own(page)) && (await stored(page)).state.transactions.length === 0, "Discard closes it, nothing is saved, and no step is left behind");

  await page.click('[data-action="open-other"]'); await page.waitForSelector("#sheet #f-amount");
  await page.fill("#f-amount", "900");   // more than the wallet holds: the below-zero warning
  await page.evaluate(() => document.querySelector('#sheet [data-action="pick-cat"][data-id="food"]').click());
  await page.evaluate(() => document.querySelector('#sheet [data-action="pick-acct"][data-id="wal"]').click());
  await page.click("#f-save");
  await page.waitForFunction(() => document.querySelector("#warn")?.innerText.includes("below zero"));
  await back(page);
  await page.waitForTimeout(250);
  ok(await inApp() && await page.locator("#warn").innerHTML() === "" && (await stored(page)).state.transactions.length === 0 && !(await own(page)), "Back on the below-zero question answers Cancel: nothing is saved, the app stays open and no step is left");
  await page.click('[data-action="open-other"]'); await page.waitForSelector("#sheet #f-amount");
  await page.click('#sheet [data-action="close-sheet"]:has-text("Cancel")');
  await page.waitForFunction(() => !document.querySelector("#sheet .sheet")); await page.waitForTimeout(250);
  ok(!(await own(page)), "a window closed by its own Cancel takes its step away quietly");

  await page.click("#menuBtn"); await page.waitForSelector("#menu .drawer");
  await back(page);
  await page.waitForTimeout(300);
  ok(await inApp() && await page.locator("#menu .drawer").count() === 0 && await page.getAttribute("#menuBtn", "aria-expanded") === "false", "Back closes the menu and stays in the app");
  for (let i = 0; i < 5; i++) { await page.click('[data-action="open-other"]'); await page.waitForSelector("#sheet #f-amount"); await page.click('#sheet [data-action="close-sheet"]:has-text("Cancel")'); await page.waitForFunction(() => !document.querySelector("#sheet .sheet")); await page.waitForTimeout(150); }
  ok(await page.evaluate(() => history.length) <= steps0 + 1, "opening and closing windows does not pile up history steps (" + steps0 + " to " + await page.evaluate(() => history.length) + ")");

  await back(page);
  ok(page.url() === "about:blank", "with nothing open, Back is the phone's own Back (it leaves the app; nothing is trapped)");
  await ctx.close(); }

ok(errors.length === 0, "no script errors" + (errors.length ? " -> " + errors[0] : ""));
console.log("NOT TESTABLE WITHOUT A REAL ANDROID PHONE: Chrome's own Install prompt and the installed app's window; the hardware or gesture Back on the installed app (here the browser's Back, the same history step); unlocking with a fingerprint or face (passkey on Android); whether Android keeps the storage (persist) and clears it with the site data; the share sheet for backup files and saving them into the Files app; the camera and the photo reader's speed; Google's speech-to-text; the keyboard covering a box.");
await browser.close();
console.log(`android: ${passed} checks passed`);

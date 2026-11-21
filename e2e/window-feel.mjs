// Serve the repo on port 8124, then node e2e/window-feel.mjs (ENGINE=webkit for Safari's engine). Every name and figure here is invented.
// WINDOW FEEL (owner approved the test page, Nov 21): (1) a window that rises from the bottom closes when pulled down from its top; (2) while the
// keyboard is open, the window sits on it and the box being typed in stays in view. A test browser has no keyboard, so the phone's visible area
// (visualViewport) is played by a stand-in that shrinks the way it does when a keyboard opens; the owner repeats this on the iPhone itself.
import assert from "node:assert/strict";
import { launchBrowser } from "./engine.mjs";
import { emptyLedger, CHANGES, SCREEN_NAMES, validateState } from "../src/model/index.js";
const browser = await launchBrowser();
const base = process.env.BASE ?? "http://127.0.0.1:8124/app/index.html";
const errors = [], TS = "2026-11-21T03:00:00Z";
let passed = 0;
const ok = (cond, label) => { assert.ok(cond, label); passed++; console.log("ok: " + label); };

const seeded = () => {
  const l = emptyLedger(), s = l.state; l.rev = 1; l.saved_at = "2026-11-20T08:00:00.000+08:00";
  s.accounts.push({ id: "wal", name: "Sample Wallet", class: "asset", role: "", opening_balance: 500000, opening_date: "2026-01-01", hidden_by_default: false, archived: false });
  s.categories = [{ id: "food", name: "Food", kind: "expense", role: "food" }, ...s.categories.filter((c) => c.kind === "income")];
  assert.deepEqual(validateState(s), []);
  l.settings = { notice_seen_at: TS, whatsnew_seen: CHANGES[0].id, version_seen: "999.0.0", welcome_off: true, start_rule_seen: TS, cat_card_seen: TS, firstrun_done: TS, bankLogosTried: {}, intro_off: Object.fromEntries(Object.keys(SCREEN_NAMES).map((k) => [k, true])) };
  return l;
};
const phone = async ({ reduced = false } = {}) => {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: reduced ? "reduce" : "no-preference",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1" });
  await ctx.route("**/*", (route) => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { get: () => true }); sessionStorage.setItem("logOpen", "1");
    // the stand-in for the phone's visible area: full height until a "keyboard" opens
    const vv = new EventTarget(); vv.offsetTop = 0; vv.offsetLeft = 0; vv.scale = 1; vv.width = innerWidth; vv.height = innerHeight;
    Object.defineProperty(window, "visualViewport", { get: () => vv, configurable: true });
    window.__keyboard = (px) => { vv.height = innerHeight - px; vv.dispatchEvent(new Event("resize")); };
  });
  await ctx.clock.setFixedTime(new Date(TS));
  const page = await ctx.newPage(); page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base); await page.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 });
  await page.evaluate(async (text) => { localStorage.setItem("financialTracker.ledger", text);
    await new Promise((res) => { const r = indexedDB.open("financialTracker", 3); r.onsuccess = () => { const tx = r.result.transaction("kv", "readwrite"); tx.objectStore("kv").put(text, "ledger"); tx.oncomplete = () => { r.result.close(); res(); }; }; }); }, JSON.stringify(seeded()));
  await page.reload(); await page.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 });
  return { ctx, page };
};
const openAdd = async (page) => { await page.click('[data-action="open-other"]'); await page.waitForSelector("#sheet #f-amount"); await page.waitForTimeout(300); };
const sheetOpen = (page) => page.locator("#sheet > .sheet").count().then((n) => n === 1);
// a pull with the mouse: press on `sel`, move down `dy` in steps (`ms` between steps), release
const pullDown = async (page, sel, dy, { steps = 12, ms = 16 } = {}) => {
  const b = await page.locator(sel).first().boundingBox(), x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= steps; i++) { await page.mouse.move(x, y + (dy * i) / steps); await page.waitForTimeout(ms); }
  await page.mouse.up(); await page.waitForTimeout(450);
};

// ---- 1. pull down to close
{ const { ctx, page } = await phone();
  await openAdd(page);
  await pullDown(page, "#sheet .sheet h3", 40, { steps: 10, ms: 40 });
  ok(await sheetOpen(page) && await page.evaluate(() => document.querySelector("#sheet > .sheet").style.transform === ""), "a short, slow pull springs back: the window stays, back in its place");
  await pullDown(page, "#sheet .sheet h3", 180);
  ok(!(await sheetOpen(page)), "pulled down past the line from its top, Add expense closes");
  await openAdd(page);
  await pullDown(page, "#sheet .sheet h3", 60, { steps: 3, ms: 16 });
  ok(!(await sheetOpen(page)), "a quick flick down closes it too");

  await openAdd(page); await page.fill("#f-amount", "75");
  await pullDown(page, "#sheet .sheet h3", 180);
  ok(await sheetOpen(page) && (await page.locator("#warn").innerText()).includes("Discard what you typed?"), "with something typed it springs back and asks \"Discard what you typed?\"");
  await page.click('#warn button:has-text("Keep editing")');
  ok(await sheetOpen(page) && await page.inputValue("#f-amount") === "75", "Keep editing: the window and what was typed stay");
  await pullDown(page, "#sheet .sheet h3", 180); await page.click('#warn button:has-text("Discard")'); await page.waitForTimeout(300);
  ok(!(await sheetOpen(page)), "Discard closes it");

  await openAdd(page);
  await pullDown(page, "#sheet #f-amount", 180);
  ok(await sheetOpen(page), "a pull that starts in a box is not a pull (the box keeps its own drag)");
  await page.evaluate(() => { const s = document.querySelector("#sheet > .sheet"); s.style.maxHeight = "300px"; s.scrollTop = 120; });
  await pullDown(page, "#sheet .sheet label >> nth=2", 180);
  ok(await sheetOpen(page), "a window not scrolled to its top is not pulled: the finger scrolls it");
  await page.evaluate(() => { const s = document.querySelector("#sheet > .sheet"); s.style.maxHeight = ""; s.scrollTop = 0; });
  const row = await page.locator("#sheet .pickrow").first().boundingBox(), head = await page.locator("#sheet .sheet h3").boundingBox();
  await pullDown(page, "#sheet .sheet h3", Math.min(100, row.y + row.height / 2 - (head.y + head.height / 2)), { steps: 10, ms: 60 });   // slow: springs back, ending over the Category row
  ok(await page.locator("#sheet .pickrow").first().getAttribute("aria-expanded") !== "true" && await sheetOpen(page), "a pull never taps what the finger ends over (the Category list stays shut)");
  await page.click('#sheet [data-action="close-sheet"]:has-text("Cancel")'); await page.waitForTimeout(300);

  await ctx.close(); }

// ---- 2. Reduce Motion: nothing follows the finger; a long enough pull closes at once
{ const { ctx, page } = await phone({ reduced: true });
  await openAdd(page);
  const b = await page.locator("#sheet .sheet h3").boundingBox();
  await page.mouse.move(b.x + 20, b.y + 10); await page.mouse.down(); await page.mouse.move(b.x + 20, b.y + 90, { steps: 8 });
  ok(await page.evaluate(() => document.querySelector("#sheet > .sheet").style.transform === ""), "under Reduce Motion the window does not follow the finger");
  await page.mouse.move(b.x + 20, b.y + 200, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(200);
  ok(!(await sheetOpen(page)), "and a long pull still closes it, at once");
  await ctx.close(); }

// ---- 3. the box you type in stays above the keyboard
{ const { ctx, page } = await phone();
  await openAdd(page);
  ok(await page.evaluate(() => document.querySelector("#sheet > .sheet").style.bottom === ""), "with no keyboard the window sits at the bottom as before (nothing is set)");
  await page.focus("#f-payee");
  await page.evaluate(() => window.__keyboard(360)); await page.waitForTimeout(400);
  const r = await page.evaluate(() => { const s = document.querySelector("#sheet > .sheet"), b = s.getBoundingClientRect(), f = document.activeElement.getBoundingClientRect(); return { bottom: s.style.bottom, sheetBottom: b.bottom, visible: visualViewport.height, boxTop: f.top, boxBottom: f.bottom, sheetTop: b.top }; });
  ok(r.bottom === "360px" && Math.round(r.sheetBottom) <= Math.round(r.visible), "with the keyboard open (360 px) the window sits on top of it (" + r.bottom + ", bottom " + Math.round(r.sheetBottom) + " of " + r.visible + ")");
  ok(r.boxBottom <= r.sheetBottom && r.boxTop >= r.sheetTop, "the box being typed in is inside what can be seen");
  await page.evaluate(() => window.__keyboard(0)); await page.waitForTimeout(200);
  ok(await page.evaluate(() => document.querySelector("#sheet > .sheet").style.bottom === ""), "when the keyboard closes the window goes back to the bottom");
  await ctx.close(); }

ok(errors.length === 0, "no script errors" + (errors.length ? " -> " + errors[0] : ""));
await browser.close();
console.log(`window-feel: ${passed} checks passed`);

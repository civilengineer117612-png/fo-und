// Serve the repo on port 8124, then node e2e/sheet-scroll.mjs (ENGINE=webkit for Safari's engine). Every name and figure here is invented.
// A TALL WINDOW DOES NOT JUMP (owner, Nov 12): in a window taller than the screen, choosing something at its bottom must not throw the window
// back up. Found on WebKit after the feel change (fo-und#340): the scroll position went from 138 to 46. Chromium never showed it.
// Each run also prints `diag` lines: the same steps with single page rules switched back, so one CI run says which rule moves the window.
import assert from "node:assert/strict";
import { launchBrowser, ENGINE } from "./engine.mjs";
import { emptyLedger, CHANGES, SCREEN_NAMES } from "../src/model/index.js";
const browser = await launchBrowser();
const base = process.env.BASE ?? "http://127.0.0.1:8124/app/index.html";
const errors = [], TS = "2026-11-12T03:00:00Z";
let passed = 0;
const ok = (cond, label) => { assert.ok(cond, label); passed++; console.log("ok: " + label); };

const seeded = () => {
  const l = emptyLedger(), s = l.state; l.rev = 1; l.saved_at = "2026-11-10T08:00:00.000+08:00";
  const acct = (id, name, opening) => ({ id, name, class: "asset", role: "", opening_balance: opening, opening_date: "2026-01-01", hidden_by_default: false, archived: false });
  s.accounts.push(acct("w", "Wallet", 100000), acct("g", "GCash", 50000));
  l.settings = { notice_seen_at: TS, whatsnew_seen: CHANGES[0].id, welcome_off: true, start_rule_seen: TS, cat_card_seen: TS, bankLogosTried: {}, intro_off: Object.fromEntries(Object.keys(SCREEN_NAMES).map((k) => [k, true])) };
  return l;
};

// One run of the owner's steps: a short screen, Add expense, scroll the window to its bottom, open Paid from, choose GCash.
// opts: wait (ms after the window opens before typing; run.mjs 5i types at once, while the window is still sliding up), blur (leave the amount box
// before choosing), js (a script run in the page before the steps).
async function steps(extraCss, { wait = 400, blur = false, js = null } = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1" });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, "standalone", { get: () => true }); sessionStorage.setItem("logOpen", "1"); });
  await ctx.clock.setFixedTime(new Date(TS));
  const page = await ctx.newPage(); page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base); await page.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 });
  await page.evaluate(async (text) => { localStorage.setItem("financialTracker.ledger", text);
    await new Promise((res) => { const r = indexedDB.open("financialTracker", 3); r.onsuccess = () => { const tx = r.result.transaction("kv", "readwrite"); tx.objectStore("kv").put(text, "ledger"); tx.oncomplete = () => { r.result.close(); res(); }; }; }); }, JSON.stringify(seeded()));
  await page.reload(); await page.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 });
  if (extraCss) await page.addStyleTag({ content: extraCss });
  if (js) await page.evaluate(js);
  await page.setViewportSize({ width: 360, height: 520 });   // a short screen, so the window has to scroll
  await page.click('[data-action="open-other"]'); await page.waitForSelector("#sheet #f-amount");
  if (wait) await page.waitForTimeout(wait);   // the window has arrived (wait 0: typed at once, as run.mjs 5i does)
  await page.fill("#f-amount", "50");
  const top = () => page.evaluate(() => document.querySelector("#sheet .sheet").scrollTop);
  await page.evaluate(() => { const s = document.querySelector("#sheet .sheet"); s.scrollTop = s.scrollHeight; });
  const before = await top();
  const paid = page.locator("#sheet .pick").nth(1);
  await paid.locator(".pickrow").click();
  const opened = await top();
  if (blur) await page.evaluate(() => document.activeElement?.blur());
  await paid.locator('.chip:has-text("GCash")').click();
  await page.waitForTimeout(300);
  const after = await top();
  const chosen = await page.evaluate(() => document.querySelector("#sheet .pick:nth-of-type(2) .pickrow, #sheet .pickrow:nth-of-type(1)") && [...document.querySelectorAll("#sheet .pickrow")].map((r) => r.textContent.trim()).join(" | "));
  const sizes = await page.evaluate(() => { const s = document.querySelector("#sheet .sheet"); return { scrollHeight: s.scrollHeight, clientHeight: s.clientHeight }; });
  await ctx.close();
  return { before, opened, after, chosen, ...sizes };
}

// diagnosis first (printed only): each rule the feel change added to the page, switched back on its own
const VARIANTS = {
  "html overscroll as before": "html { overscroll-behavior: auto !important; overscroll-behavior-x: none !important; }",
  "html touch-action as before": "html { touch-action: auto !important; }",
  "both as before": "html { overscroll-behavior: auto !important; overscroll-behavior-x: none !important; touch-action: auto !important; }",
  "no transitions": "*, *::before, *::after { transition: none !important; animation: none !important; }",
};
for (const [name, css] of Object.entries(VARIANTS)) {
  const r = await steps(css);
  console.log(`  diag sheet-scroll (${ENGINE}) ${name}: ${r.before} -> opened ${r.opened} -> chosen ${r.after} (height ${r.scrollHeight}/${r.clientHeight})`);
}
// the same steps typed at once (as run.mjs 5i, which failed on WebKit 138 to 46), each 3 times: which change keeps the window still
const NOW = {
  "typed at once": [null, { wait: 0 }],
  "typed at once, no slide-up": [".sheet.enter, #scrim.enter { animation: none !important; }", { wait: 0 }],
  "typed at once, amount box left first": [null, { wait: 0, blur: true }],
};
for (const [name, [css, o]] of Object.entries(NOW)) for (let i = 1; i <= 3; i++) {
  const r = await steps(css, o);
  console.log(`  diag sheet-scroll (${ENGINE}) ${name} #${i}: ${r.before} -> opened ${r.opened} -> chosen ${r.after}`);
}

// the check: the page exactly as shipped
const r = await steps(null);
console.log(`  diag sheet-scroll (${ENGINE}) as shipped: ${r.before} -> opened ${r.opened} -> chosen ${r.after} (height ${r.scrollHeight}/${r.clientHeight})`);
ok(r.before > 50, "the window is taller than the short screen and was scrolled to its bottom (" + r.before + ")");
ok(/GCash/.test(r.chosen), "GCash is chosen as Paid from");
ok(r.after >= r.before - 2, "choosing something at the bottom does not throw the window back up (" + r.before + " to " + r.after + ")");
// F4 (Nov 13): DRAW ONCE AT START. With nothing touched for 4 seconds (the bank logos tried, the start-up saves done), the header, the screen and the
// bottom bar are each written once: a part rebuilt again under a finger loses the tap (Phase 1 counted 3 writes).
{ const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, "standalone", { get: () => true }); sessionStorage.setItem("logOpen", "1");
    window.__draws = { top: 0, screen: 0, nav: 0 };
    new MutationObserver(() => { for (const id of Object.keys(window.__draws)) { const el = document.getElementById(id); if (el && !el.__watched) { el.__watched = true;
      new MutationObserver((ms) => { window.__draws[id] += ms.filter((m) => m.target === el && m.addedNodes.length).length; }).observe(el, { childList: true }); } } }).observe(document, { childList: true, subtree: true }); });
  await ctx.clock.setFixedTime(new Date(TS));
  const page = await ctx.newPage(); page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base); await page.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 });
  await page.evaluate(async (text) => { localStorage.setItem("financialTracker.ledger", text);
    await new Promise((res) => { const r = indexedDB.open("financialTracker", 3); r.onsuccess = () => { const tx = r.result.transaction("kv", "readwrite"); tx.objectStore("kv").put(text, "ledger"); tx.oncomplete = () => res(); }; }); }, JSON.stringify(seeded()));
  await page.reload(); await page.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 });
  await page.waitForTimeout(4000);
  const d = await page.evaluate(() => window.__draws);
  console.log(`  diag sheet-scroll (${ENGINE}) start-up writes: header ${d.top}, screen ${d.screen}, bottom bar ${d.nav}`);
  ok(d.top === 1 && d.screen === 1 && d.nav === 1, "start-up draws the header, the screen and the bottom bar once each (" + d.top + ", " + d.screen + ", " + d.nav + ")");
  await ctx.close(); }

// THE OWNER'S BAR (Nov 13): typed at once, as a quick thumb does, 20 times in a row in one job; every run must keep the window where it was.
const runs = [];
for (let i = 0; i < 20; i++) runs.push(await steps(null, { wait: 0 }));
const jumped = runs.filter((x) => !(x.before > 50 && x.after >= x.before - 2));
console.log(`  diag sheet-scroll (${ENGINE}) 20 repeats typed at once: ` + runs.map((x) => x.before + ">" + x.after).join(" "));
ok(jumped.length === 0, "20 of 20 repeats keep the window where it was when typed at once (" + (20 - jumped.length) + " of 20)");
ok(errors.length === 0, "no script errors" + (errors.length ? " -> " + errors[0] : ""));
await browser.close();
console.log(`sheet-scroll: ${passed} checks passed`);

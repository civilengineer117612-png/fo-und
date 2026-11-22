// Serve the repo on port 8124, then node e2e/swipe.mjs. Every name and figure here is invented.
// SWIPE BETWEEN PERIODS (owner, Nov 15, overhaul A2; data version unchanged). A swipe exists exactly where period arrows or period tabs exist:
// Log (the day), Cash flow and Cards (the month), Budget's Month view (its month arrows) and Per payday (the payday tabs). Never on Per week, never
// between Month and Per payday (a view, not a period). A swipe NEVER opens or taps what is under the finger (owner: prove it across a Log entry).
import assert from "node:assert/strict";
import { launchBrowser, tapSafety } from "./engine.mjs";
import * as M from "../src/model/index.js";
const browser = await launchBrowser();
const base = process.env.BASE ?? "http://127.0.0.1:8124/app/index.html";
const errors = [], TS = "2026-11-15T03:00:00Z", CT = "2026-11-01T09:00:00.000+08:00";
let passed = 0;
const ok = (cond, label) => { assert.ok(cond, label); passed++; console.log("ok: " + label); };

const ledger = () => {
  const l = M.emptyLedger(), s = l.state; s.categories = M.defaultCategories(); l.rev = 5; l.saved_at = CT;
  s.accounts.push({ id: "cash", name: "Cash", class: "asset", role: "", opening_balance: 500000, opening_date: "2026-09-01", hidden_by_default: false, archived: false });
  const cat = (n) => s.categories.find((c) => c.name === n).id;
  let k = 0;
  for (const [d, p, c, a] of [["2026-11-15", "Sample Bakery", "Food", 8500], ["2026-11-14", "Sample Grocer", "Essentials", 124050], ["2026-10-20", "Sample Diner", "Food", 61000]]) {
    const id = "t" + ++k; s.transactions.push({ id, date: d, payee: p, memo: "", status: "verified", source: "manual", created_at: d + "T09:00:00.000+08:00", verified_at: d + "T09:00:00.000+08:00" });
    s.entries.push({ transaction_id: id, category_id: cat(c), amount: a }, { transaction_id: id, account_id: "cash", amount: -a });
  }
  for (const [c, a] of [["Food", 800000], ["Essentials", 400000]]) s.rules.push({ id: "r" + ++k, kind: "budget", subject_id: cat(c), amount: a, effective_from: "2026-09-01", created_at: CT });
  l.settings = { notice_seen_at: CT, firstrun_done: CT, whatsnew_seen: M.CHANGES[0].id, version_seen: "999.0.0", start_rule_seen: CT, cat_card_seen: CT, last_backup_at: CT, bankLogosTried: {}, pay_schedule: { kind: "twice", days: [15, "last"] }, income_base_pin: 5000000,
    intro_off: Object.fromEntries(["plan", "money", "income", "cards", "budget", "goals", "scheduled", "checkin", "scan", "trips", "buffer", "setup", "log", "verify"].map((x) => [x, true])) };
  return l;
};
async function open({ reduced = false } = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: reduced ? "reduce" : "no-preference",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1" });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, "standalone", { get: () => true }); sessionStorage.setItem("logOpen", "1"); });
  await ctx.clock.setFixedTime(new Date(TS));
  const page = await ctx.newPage(); page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(new URL(base).origin + "/e2e/");
  await page.evaluate(async (text) => { localStorage.setItem("financialTracker.ledger", text);
    await new Promise((res) => { const r = indexedDB.open("financialTracker", 3); r.onupgradeneeded = () => { for (const n of ["kv", "photos", "safety"]) if (!r.result.objectStoreNames.contains(n)) r.result.createObjectStore(n); };
      r.onsuccess = () => { const tx = r.result.transaction("kv", "readwrite"); tx.objectStore("kv").put(text, "ledger"); tx.oncomplete = () => { r.result.close(); res(); }; }; }); }, JSON.stringify(ledger()));
  await page.goto(base); await page.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 }); await page.waitForTimeout(600);
  return { ctx, page };
}
const text = async (page, sel) => (await page.locator(sel).innerText()).replace(/\s+/g, " ").trim();
// A finger drawn across the screen from x0 to x1 at height y: pressed, moved in steps, released where it ends.
const swipe = async (page, x0, x1, y, steps = 10) => { await page.mouse.move(x0, y); await page.mouse.down(); for (let i = 1; i <= steps; i++) await page.mouse.move(x0 + ((x1 - x0) * i) / steps, y + i * 0.4); await page.mouse.up(); await page.waitForTimeout(450); };
const menu = async (page, name) => { await page.click("#menuBtn"); await page.click(`#menu .item:has-text("${name}")`); await page.waitForFunction(() => !document.querySelector("#menu .drawer")); await page.waitForTimeout(300); };

// ---- 1. Log: a swipe across an entry row never opens it, and changes the day
{ const { ctx, page } = await open();
  const row = page.locator('#screen [data-action="open-tx"]').filter({ hasText: "Sample Bakery" }).first(), box = await row.boundingBox();
  ok(box !== null, "today's entry is on Log");
  await swipe(page, box.x + box.width - 20, box.x + 20, box.y + box.height / 2);   // right to left across the row: later, but today is the end
  ok(await page.locator("#sheet .sheet").count() === 0, "a swipe across an entry row does not open it (to the left, at today)");
  ok(/spent today/i.test(await text(page, "#screen")), "at today a swipe to the left changes nothing");
  await swipe(page, box.x + 20, box.x + box.width - 20, box.y + box.height / 2);   // left to right across the same row: yesterday
  ok(await page.locator("#sheet .sheet").count() === 0, "a swipe across an entry row does not open it (to the right)");
  ok(/spent that day/i.test(await text(page, "#screen")) && (await text(page, "#screen")).includes("Sample Grocer"), "a swipe to the right shows yesterday");
  await swipe(page, 300, 80, 400);
  ok(/spent today/i.test(await text(page, "#screen")), "a swipe to the left comes back to today");
  await page.click('#screen [data-action="open-tx"]:has-text("Sample Bakery")');
  ok(await page.locator("#sheet .sheet").count() === 1, "a plain tap on the same row still opens it");
  await page.click('#sheet button:has-text("Close"), #sheet button:has-text("Cancel")'); await page.waitForFunction(() => !document.querySelector("#sheet .sheet"));
  const y0 = await page.evaluate(() => scrollY);
  await page.mouse.move(200, 600); await page.mouse.down(); for (let i = 1; i <= 8; i++) await page.mouse.move(204, 600 - i * 30); await page.mouse.up(); await page.waitForTimeout(300);
  ok(/spent today/i.test(await text(page, "#screen")) && await page.locator("#sheet .sheet").count() === 0, "an up-and-down move is not a swipe (day unchanged, y " + y0 + ")");
  await ctx.close(); }

// ---- 2. Cash flow: the month steps like its arrows; at this month a swipe to the left does nothing
{ const { ctx, page } = await open();
  await menu(page, "Cash flow");
  ok((await text(page, "#screen .stepper")).includes("November 2026"), "Cash flow opens on November");
  await swipe(page, 320, 80, 520);
  ok((await text(page, "#screen .stepper")).includes("November 2026"), "at this month a swipe to the left changes nothing (its arrow is off)");
  await swipe(page, 70, 320, 520);
  ok((await text(page, "#screen .stepper")).includes("October 2026"), "a swipe to the right shows October, the same as the left arrow");
  await ctx.close(); }

// ---- 3. Budget: Month view steps months (an earlier month is read-only); Per payday steps the payday tabs; never Per week, never the views
{ const { ctx, page } = await open();
  await menu(page, "Plan & Save");
  ok(await page.locator('#screen [data-action="budget-month"]').count() === 2 && (await text(page, "#screen .stepper")).includes("November 2026"), "Budget's Month view has month arrows");
  await swipe(page, 70, 320, 600);
  ok((await text(page, "#screen .stepper")).includes("October 2026") && await page.locator('#screen button[data-action="bv-view"][data-id="month"][aria-pressed="true"]').count() === 1, "a swipe to the right shows October; still the Month view");
  ok(await page.locator('#screen [data-action="open-budget"]').count() === 0 && (await text(page, "#screen")).includes("An earlier month, as it was"), "an earlier month is shown as it was and cannot be changed there");
  await page.click('#screen [data-action="budget-month"][data-step="1"]');
  ok((await text(page, "#screen .stepper")).includes("November 2026") && await page.locator('#screen [data-action="budget-month"][data-step="1"][disabled]').count() === 1, "the right arrow brings back this month, and stops there");
  await page.click('#screen button[data-action="bv-view"][data-id="payday"]'); await page.waitForTimeout(300);
  ok(await page.locator('#screen button[data-action="bv-payday"][aria-pressed="true"]').first().innerText() === "15th", "Per payday starts on the 15th");
  await swipe(page, 320, 80, 620);
  ok(await page.locator('#screen button[data-action="bv-payday"][aria-pressed="true"]').first().innerText() === "Last day" && await page.locator('#screen button[data-action="bv-view"][data-id="payday"][aria-pressed="true"]').count() === 1, "a swipe to the left goes to the Last day payday, never to another view");
  await swipe(page, 320, 80, 620);
  ok(await page.locator('#screen button[data-action="bv-payday"][aria-pressed="true"]').first().innerText() === "Last day", "at the last payday a swipe to the left does nothing");
  await page.click('#screen button[data-action="bv-view"][data-id="week"]'); await page.waitForTimeout(300);
  const week = await text(page, "#screen");
  await swipe(page, 70, 320, 620); await swipe(page, 320, 70, 620);
  ok(await text(page, "#screen") === week && await page.locator('#screen button[data-action="bv-view"][data-id="week"][aria-pressed="true"]').count() === 1, "Per week has no swipe");
  await ctx.close(); }

// ---- 4. Reduce Motion: the screen does not follow the finger and nothing slides in; the step still happens
{ const { ctx, page } = await open({ reduced: true });
  await menu(page, "Cash flow");
  await page.mouse.move(70, 520); await page.mouse.down(); for (let i = 1; i <= 8; i++) await page.mouse.move(70 + i * 30, 520);
  ok(await page.$eval("#screen", (el) => getComputedStyle(el).transform) === "none", "under Reduce Motion the screen does not follow the finger");
  await page.mouse.up(); await page.waitForTimeout(200);
  ok((await text(page, "#screen .stepper")).includes("October 2026") && await page.$eval("#screen", (el) => getComputedStyle(el).animationName) === "none", "and the month changes at once");
  await ctx.close(); }

ok(tapSafety.size === 0, "tap-safety: 0 places" + (tapSafety.size ? " -> " + [...tapSafety.keys()].join("; ") : ""));
ok(errors.length === 0, "no script errors" + (errors.length ? " -> " + errors[0] : ""));
await browser.close();
console.log(`swipe: ${passed} checks passed`);

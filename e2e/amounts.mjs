// Serve the repo on port 8124, then node e2e/amounts.mjs. Every name and figure here is invented.
// AMOUNTS (owner, Nov 12, L2 and P3): a comma typed anywhere in an amount used to be dropped ("1,5" was saved as 15.00). Now a comma is read only
// between thousands; anything else is refused and says so under the box. Entries typed before the fix that look like it are only listed, once, on
// Weekly review; nothing is changed. This script has its own ledger, so it can be run alone.
import assert from "node:assert/strict";
import { launchBrowser } from "./engine.mjs";
import { emptyLedger, CHANGES, SCREEN_NAMES, AMOUNT_HINT, validateState } from "../src/model/index.js";
const browser = await launchBrowser();
const base = process.env.BASE ?? "http://127.0.0.1:8124/app/index.html";
const errors = [], TS = "2026-11-12T03:00:00Z";
let passed = 0;
const ok = (cond, label) => { assert.ok(cond, label); passed++; console.log("ok: " + label); };

const seeded = () => {
  const l = emptyLedger(), s = l.state; l.rev = 1; l.saved_at = "2026-11-10T08:00:00.000+08:00";
  s.accounts.push({ id: "chk", name: "Sample Checking", class: "asset", role: "", opening_balance: 5000000, opening_date: "2026-01-01", hidden_by_default: false, archived: false });
  s.categories = [{ id: "food", name: "Food", kind: "expense", role: "food" }, { id: "fun", name: "Fun", kind: "expense" }, ...s.categories.filter((c) => c.kind === "income")];
  const spend = (id, date, payee, amount) => { s.transactions.push({ id, date, payee, memo: "", status: "verified", source: "manual", created_at: date + "T09:00:00+08:00", verified_at: date + "T09:05:00+08:00" });
    s.entries.push({ transaction_id: id, account_id: "chk", amount: -amount }, { transaction_id: id, category_id: "food", amount }); };
  spend("k1", "2026-10-05", "Kape", 6500); spend("k2", "2026-10-12", "Kape", 7000); spend("k3", "2026-10-19", "Kape", 6500);
  spend("k4", "2026-10-26", "Kape", 65000);   // typed "6,50,0"-style slip: ten times the usual
  spend("m1", "2026-10-06", "Merienda", 4000); spend("m2", "2026-10-13", "Merienda", 4500);
  spend("t1", "2026-10-07", "Taho", 2000); spend("t2", "2026-10-14", "Taho", 2500); spend("t3", "2026-10-21", "Taho", 25000);   // a second one to check: ten times the usual
  assert.deepEqual(validateState(s), []);
  l.settings = { notice_seen_at: TS, whatsnew_seen: CHANGES[0].id, welcome_off: true, start_rule_seen: TS, cat_card_seen: TS, bankLogosTried: {}, intro_off: Object.fromEntries(Object.keys(SCREEN_NAMES).map((k) => [k, true])) };
  return l;
};
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1" });
await ctx.route("**/*", (route) => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
await ctx.addInitScript(() => { Object.defineProperty(navigator, "standalone", { get: () => true }); sessionStorage.setItem("logOpen", "1"); });
await ctx.clock.setFixedTime(new Date(TS));   // on the window, before any page: on WebKit a fresh page's own clock was not ready yet
const open = async () => { const page = await ctx.newPage(); page.on("pageerror", (e) => errors.push(e.message)); await page.goto(base); await page.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 }); return page; };
const stored = (page) => page.evaluate(() => new Promise((res) => { const r = indexedDB.open("financialTracker", 3); r.onsuccess = () => { const g = r.result.transaction("kv").objectStore("kv").get("ledger"); g.onsuccess = () => { r.result.close(); res(JSON.parse(g.result)); }; }; }));
const quiet = async (page) => { let last = null, same = 0; while (same < 4) { const now = JSON.stringify(await stored(page)); same = now === last ? same + 1 : 0; last = now; await page.waitForTimeout(400); } };

const first = await open();
await first.evaluate(async (text) => { localStorage.setItem("financialTracker.ledger", text);
  await new Promise((res) => { const r = indexedDB.open("financialTracker", 3); r.onsuccess = () => { const tx = r.result.transaction("kv", "readwrite"); tx.objectStore("kv").put(text, "ledger"); tx.oncomplete = () => { r.result.close(); res(); }; }; });
}, JSON.stringify(seeded()));
await first.close();
const page = await open();
await quiet(page);
const spentOf = (l) => l.state.entries.filter((e) => e.category_id === "food" && e.amount > 0).map((e) => e.amount).sort((a, b) => a - b).join(",");
const START = "2000,2500,4000,4500,6500,6500,7000,25000,65000";
ok(spentOf(await stored(page)) === START, "the ledger starts with nine typed entries");

// ---- 1. a comma that is not between thousands is refused and says so; nothing is saved
await page.click('[data-action="open-other"]'); await page.waitForSelector("#sheet #f-amount");
await page.evaluate(() => document.querySelector('#sheet [data-action="pick-cat"][data-id="food"]').click());
await page.evaluate(() => document.querySelector('#sheet [data-action="pick-acct"][data-id="chk"]').click());
await page.waitForSelector("#sheet #f-amount");
const hint = () => page.locator("#sheet #f-amount + .amthint");
for (const typed of ["1,5", "12,50", "1,2345", "1,"]) {
  await page.fill("#f-amount", typed);
  ok(await hint().count() === 1 && (await hint().innerText()).includes(AMOUNT_HINT) && await page.locator("#f-save").isDisabled(), `"${typed}" is refused: the line under the box says how to type it, and Save is off`);
}
ok(await page.getAttribute("#f-amount", "aria-invalid") === "true", "the box is marked as not valid for a screen reader");
ok(spentOf(await stored(page)) === START, "nothing was saved (\"1,5\" used to be saved as 15.00)");
// the line survives a redraw of the window (choosing another category draws it again)
await page.evaluate(() => document.querySelector('#sheet [data-action="pick-cat"][data-id="fun"]').click());
await page.waitForSelector("#sheet #f-amount");
ok(await page.inputValue("#f-amount") === "1," && await hint().count() === 1, "after the window is drawn again the line is still under the box");
await page.evaluate(() => document.querySelector('#sheet [data-action="pick-cat"][data-id="food"]').click());
await page.waitForSelector("#sheet #f-amount");

// ---- 2. a point for centavos and a comma between thousands are read exactly
await page.fill("#f-amount", "1.5");
ok(await hint().count() === 0 && await page.getAttribute("#f-amount", "aria-invalid") === "false" && !(await page.locator("#f-save").isDisabled()), "\"1.5\" is fine: the line is gone and Save is on");
await page.click("#f-save"); await page.locator("#toast").filter({ hasText: "Saved" }).waitFor({ timeout: 8000 });
await quiet(page);
ok(spentOf(await stored(page)) === "150," + START, "it is saved as 1.50");
await page.click('[data-action="open-other"]'); await page.waitForSelector("#sheet #f-amount");
await page.evaluate(() => document.querySelector('#sheet [data-action="pick-cat"][data-id="food"]').click());
await page.evaluate(() => document.querySelector('#sheet [data-action="pick-acct"][data-id="chk"]').click());
await page.waitForSelector("#sheet #f-amount");
await page.fill("#f-amount", "P1,250.50");
ok(await hint().count() === 0 && !(await page.locator("#f-save").isDisabled()), "\"P1,250.50\" is fine");
await page.click("#f-save"); await page.locator("#toast").filter({ hasText: "Saved" }).waitFor({ timeout: 8000 });
await quiet(page);
ok(spentOf(await stored(page)) === "150," + START + ",125050", "it is saved as 1,250.50");

// ---- 3. Weekly review lists the old entries that look like a dropped comma, and KEEPS the card until each is resolved (owner, Nov 12)
const toReview = async () => {
  await page.click("#menuBtn"); await page.click('#menu .item:has-text("Weekly review")'); await page.waitForFunction(() => !document.querySelector("#menu .drawer"));
  if (await page.locator('#screen .hub button:has-text("Weekly review")').count()) await page.click('#screen .hub button:has-text("Weekly review")');
  await page.waitForFunction(() => document.querySelector("#screen").innerText.includes("Week of"));
};
const reload = async () => { await page.reload(); await page.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 }); await toReview(); };
await toReview();
let card = await page.locator("#amount-check").innerText();
ok(card.includes("Check these 2 amounts.") && card.includes("Kape") && card.includes("650.00") && card.includes("Taho") && card.includes("250.00") && card.includes("Usually about") && card.includes("Nothing was changed."), "Weekly review shows Check these 2 amounts: the 650.00 Kape and the 250.00 Taho, each with what it usually is");
ok(!card.includes("Merienda") && !card.includes("1,250.50"), "entries that are not ten times their usual are not listed");
ok((await page.locator("#amount-check button").allInnerTexts()).map((t) => t.trim()).join("|") === "This amount is right|This amount is right", "each listed entry has one button, This amount is right, and there is no Got it");
await reload();
ok((await page.locator("#amount-check").innerText()).includes("Check these 2 amounts."), "after a reload, with nothing done, the card is still there with both");
const before = await stored(page);
await page.click('#amount-check .rs:has-text("Kape") button[data-action="amount-ok"]');
await page.waitForFunction(() => document.querySelector("#amount-check")?.innerText.includes("Check this amount."));
await quiet(page);
const mid = await stored(page);
ok(JSON.stringify(mid.state) === JSON.stringify(before.state), "This amount is right changes no entry, account or category");
ok(JSON.stringify(mid.settings.amount_check_ok) === JSON.stringify(["k4"]), "it only keeps the owner's mark for that one entry");
card = await page.locator("#amount-check").innerText();
ok(card.includes("Check this amount.") && card.includes("Taho") && !card.includes("Kape"), "the count goes down: one left, the Taho");
await reload();
ok((await page.locator("#amount-check").innerText()).includes("Check this amount.") && (await page.locator("#amount-check").innerText()).includes("Taho"), "after a reload the card stays, with the one still to check");
await page.click('#amount-check .rs:has-text("Taho") button[data-action="amount-ok"]');
await page.waitForFunction(() => !document.querySelector("#amount-check"));
await quiet(page);
ok(JSON.stringify((await stored(page)).state) === JSON.stringify(before.state), "still no entry changed");
await reload();
ok(await page.locator("#amount-check").count() === 0, "the last one resolved: after a reload the card is gone");

ok(errors.length === 0, "no script errors" + (errors.length ? " -> " + errors[0] : ""));
await browser.close();
console.log(`amounts: ${passed} checks passed`);

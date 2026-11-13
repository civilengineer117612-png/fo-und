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
const START = "4000,4500,6500,6500,7000,65000";
ok(spentOf(await stored(page)) === START, "the ledger starts with six typed entries");

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

// ---- 3. Weekly review lists the old entry that looks like a dropped comma, once, and changes nothing
await page.click("#menuBtn"); await page.click('#menu .item:has-text("Weekly review")'); await page.waitForFunction(() => !document.querySelector("#menu .drawer"));
if (await page.locator('#screen .hub button:has-text("Weekly review")').count()) await page.click('#screen .hub button:has-text("Weekly review")');
await page.waitForSelector("#amount-check");
const card = await page.locator("#amount-check").innerText();
ok(card.includes("Check this amount.") && card.includes("Kape") && card.includes("650.00") && card.includes("Usually about") && card.includes("65.00") && card.includes("Nothing was changed."), "Weekly review shows Check this amount: the 650.00 Kape, usually about 65.00");
ok(!card.includes("Merienda") && !card.includes("1,250.50"), "entries that are not ten times their usual are not listed");
ok(await page.locator("#amount-check button").count() === 1 && (await page.locator("#amount-check button").innerText()).trim() === "Got it", "the card has one button, Got it");
const before = await stored(page);
await page.click("#amount-check button"); await page.waitForFunction(() => !document.querySelector("#amount-check"));
await quiet(page);
const after = await stored(page);
ok(JSON.stringify(after.state) === JSON.stringify(before.state), "Got it changes no entry, account or category");
ok(after.settings.amount_check_seen === true && JSON.stringify({ ...after.settings, amount_check_seen: undefined }) === JSON.stringify({ ...before.settings, amount_check_seen: undefined }), "it only marks the card as seen");
await page.reload(); await page.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 });
await page.click("#menuBtn"); await page.click('#menu .item:has-text("Weekly review")'); await page.waitForFunction(() => !document.querySelector("#menu .drawer"));
if (await page.locator('#screen .hub button:has-text("Weekly review")').count()) await page.click('#screen .hub button:has-text("Weekly review")');
await page.waitForFunction(() => document.querySelector("#screen").innerText.includes("Week of"));
ok(await page.locator("#amount-check").count() === 0, "and the card does not come back");

ok(errors.length === 0, "no script errors" + (errors.length ? " -> " + errors[0] : ""));
await browser.close();
console.log(`amounts: ${passed} checks passed`);

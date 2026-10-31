// Serve the repo on port 8124, then node e2e/ledger-check.mjs. Every name and figure here is invented.
// The ledger check is a REPORT, never a block: a ledger with a problem still opens and still backs up, and Setup, About this app says how many problems were found.
import assert from "node:assert/strict";
import { launchBrowser } from "./engine.mjs";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { emptyLedger, CHANGES } from "../src/model/index.js";
const require = createRequire(import.meta.url);
const browser = await launchBrowser();
const base = process.env.BASE ?? "http://127.0.0.1:8124/app/index.html";
const errors = [], TS = "2026-10-22T03:00:00Z", AT = "2026-10-20T09:00:00.000+08:00";
async function open(seedLedger) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1" });
  await ctx.route("**/*", (route) => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
  await ctx.addInitScript(() => { Object.defineProperty(navigator, "standalone", { get: () => true }); sessionStorage.setItem("logOpen", "1"); });
  const page = await ctx.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date(TS));
  await page.goto(base); await page.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 });
  await page.evaluate(async (text) => {
    localStorage.setItem("financialTracker.ledger", text);
    await new Promise((res) => { const r = indexedDB.open("financialTracker", 3); r.onsuccess = () => { const tx = r.result.transaction("kv", "readwrite"); tx.objectStore("kv").put(text, "ledger"); tx.oncomplete = () => { r.result.close(); res(); }; }; r.onerror = () => res(); });
  }, JSON.stringify(seedLedger));
  await page.reload(); await page.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 });
  return { ctx, page };
}
const seeded = () => {
  const l = emptyLedger(); l.rev = 1; l.saved_at = TS;
  l.state.accounts.push({ id: "example-bank", name: "Example Bank", class: "asset", role: "bank", opening_balance: 100000, opening_date: "2026-01-01", hidden_by_default: false, archived: false });
  l.state.categories.push({ id: "food", name: "Food", kind: "expense" });
  l.state.transactions.push({ id: "ok1", date: "2026-10-05", payee: "Shop", memo: "", status: "verified", source: "manual", created_at: AT, verified_at: AT });
  l.state.entries.push({ transaction_id: "ok1", category_id: "food", amount: 5000 }, { transaction_id: "ok1", account_id: "example-bank", amount: -5000 });
  l.settings = { notice_seen_at: TS, whatsnew_seen: CHANGES[0].id, welcome_off: true, start_rule_seen: TS, cat_card_seen: TS, intro_off: { scan: true, income: true, log: true, money: true } };
  return l;
};
const goRow = async (page, row) => { await page.click("#menuBtn"); await page.click('#menu .item[data-tab="setup"]'); await page.waitForFunction(() => !document.querySelector("#menu .drawer")); if (await page.locator('[data-action="intro-done"]').count()) { await page.click('[data-action="intro-done"]'); await page.waitForTimeout(200); } await page.click(`.setrow:has-text("${row}")`); await page.waitForTimeout(250); };
const goAbout = async (page) => { await goRow(page, "About this app"); await page.locator("#about-ledgercheck").waitFor({ state: "attached" }); };
try {
  { const { ctx, page } = await open(seeded());
    await goAbout(page);
    assert.equal(await page.locator("#about-ledgercheck").innerText(), "Ledger check: OK");
    await ctx.close(); console.log("ok: a sound ledger says Ledger check: OK"); }
  { const l = seeded();   // one entry that does not add to zero, and an amount that belongs to no entry: two problems
    l.state.transactions.push({ id: "bad1", date: "2026-10-06", payee: "Shop", memo: "", status: "verified", source: "manual", created_at: AT, verified_at: AT });
    l.state.entries.push({ transaction_id: "bad1", category_id: "food", amount: 7000 }, { transaction_id: "bad1", account_id: "example-bank", amount: -6000 }, { transaction_id: "ghost", account_id: "example-bank", amount: 300 });
    const { ctx, page } = await open(l);
    assert.ok(await page.locator("#nav button").count() >= 2, "a ledger with a problem still opens");
    await goAbout(page);
    assert.equal(await page.locator("#about-ledgercheck").innerText(), "Ledger check: 2 problems (tell the project chat)");
    await page.click('.back button:has-text("Setup")'); await page.click('.setrow:has-text("Backup and restore")'); await page.waitForTimeout(250);
    assert.equal(await page.locator('[data-action="open-backup"]').first().isDisabled(), false, "and it can still be backed up");
    await page.locator('[data-action="open-backup"]').first().click();
    assert.ok((await page.locator("#sheet").innerText()).toLowerCase().includes("back up"), "the backup window opens");
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("financialTracker.ledger")));
    assert.equal(stored.state.entries.length, 5, "nothing was changed or removed");
    await ctx.close(); console.log("ok: a ledger with problems still opens and backs up, and says how many problems"); }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }

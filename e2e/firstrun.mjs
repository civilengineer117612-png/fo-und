// Serve the repo on port 8124, then node e2e/firstrun.mjs. Every name and figure here is invented.
// FIRST-RUN SETUP (owner, Nov 15, overhaul A1; data version unchanged). A brand-new phone shows five steps instead of the notice and the welcome card:
// nothing is saved before Start fresh; step 2 needs one account; a step left half way comes back after a restart; the paydays and the pay are kept
// by the same rules as Budget; the backup reminder can be turned off and on; "I have a backup" opens Restore, Cancel goes back with nothing saved,
// and a restore skips the rest and shows the ledger check. Reduce Motion stills the slide; every button is at least 44 px high.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchBrowser, tapSafety } from "./engine.mjs";
import * as M from "../src/model/index.js";
const browser = await launchBrowser();
const base = process.env.BASE ?? "http://127.0.0.1:8124/app/index.html";
const errors = [], TS = "2026-11-15T03:00:00Z";
let passed = 0;
const ok = (cond, label) => { assert.ok(cond, label); passed++; console.log("ok: " + label); };

const context = async (o = {}) => {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, ...o,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1" });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, "standalone", { get: () => true }); sessionStorage.setItem("logOpen", "1"); });
  await ctx.clock.setFixedTime(new Date(TS));
  return ctx;
};
const openPage = async (ctx) => { const page = await ctx.newPage(); page.on("pageerror", (e) => errors.push(e.message)); await page.goto(base); await page.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 }); return page; };
const ledgerOf = async (page) => { await page.waitForFunction(() => !document.documentElement.dataset.saving); return page.evaluate(() => JSON.parse(localStorage.getItem("financialTracker.ledger") ?? "null")); };
const text = async (page, sel) => (await page.locator(sel).innerText()).replace(/\s+/g, " ").trim();
const step = (page) => page.locator("#sheet .frn").innerText();
const onStep = (page, n) => page.waitForFunction((n) => document.querySelector("#sheet .frn")?.textContent === `Step ${n} of 5`, n, { timeout: 8000 });

// ---- 1. a brand-new phone: step 1, nothing saved yet, one filled button, no way to tap past it
let ctx = await context(), page = await openPage(ctx);
await onStep(page, 1);
ok((await text(page, "#sheet")).includes("Welcome to fo/und") && (await text(page, "#sheet")).includes("once verified it is final") && (await text(page, "#sheet")).includes("cannot be recovered"), "a new phone opens on step 1, with the notice's key facts");
ok(await page.locator('#sheet button:has-text("I understand")').count() === 0 && await page.locator('#sheet [data-action^="welcome"]').count() === 0, "the old notice and the welcome card are not shown");
ok(await page.locator("#sheet button.primary").count() === 1 && await page.locator('#sheet button:has-text("Cancel")').count() === 0 && await page.locator("#scrim[data-action]").count() === 0, "one filled button (Start fresh), no Cancel, and the dark around it closes nothing");
ok(await ledgerOf(page) === null, "nothing is saved before Start fresh");
const small = await page.$$eval("#sheet button", (bs) => bs.filter((b) => b.getBoundingClientRect().height < 44).map((b) => b.textContent.trim()));
ok(small.length === 0, "every button on step 1 is at least 44 px high" + (small.length ? " -> " + small.join(", ") : ""));

// ---- 2. step 2 needs one account (owner, Nov 15); an account is added by Setup's rule; a restart comes back to the same step
await page.click('#sheet button:has-text("Start fresh")'); await onStep(page, 2);
ok((await ledgerOf(page))?.settings.firstrun_step === 2, "Start fresh is the first save, and the step is kept");
await page.click('#sheet button[data-action="fr-next"]');
ok((await text(page, "#sheet")).includes("Add at least one account to go on") && (await step(page)) === "Step 2 of 5", "Next with no account says what is needed and stays on step 2");
await page.fill("#fr-aname", "Sample Cash"); await page.fill("#fr-aopen", "1,000");
await page.click('#sheet button:has-text("Add this account")');
await page.locator('#sheet .frrow:has-text("Sample Cash")').waitFor();
let led = await ledgerOf(page), cash = led.state.accounts.find((a) => a.name === "Sample Cash");
ok(cash && cash.class === "asset" && cash.opening_balance === 100000 && cash.opening_date === "2026-11-15", "the account is kept with what is in it today, dated today");
await page.click('#sheet button:has-text("Add another account")');
await page.fill("#fr-aname", "Sample Card"); await page.click('#sheet [data-action="fr-akind"][data-id="liability"]'); await page.fill("#fr-aopen", "250");
await page.click('#sheet button[data-action="fr-next"]');   // typed but not added: Next adds it first
await onStep(page, 3);
led = await ledgerOf(page);
ok(led.state.accounts.find((a) => a.name === "Sample Card")?.class === "liability" && led.state.accounts.find((a) => a.name === "Sample Card").opening_balance === 25000, "a card typed but not added is added by Next, as what you owe");
await page.reload(); await page.locator("#nav button").first().waitFor();
await onStep(page, 3);
ok(true, "closed half way, the app opens again on the same step");

// ---- 3. the paydays and the pay, by Budget's own rule; a bad day is said and nothing moves on
await page.fill("#fr-d1", "30"); await page.click('#sheet button[data-action="fr-next"]');
ok((await text(page, "#sheet")).includes("Type the payday as a day from 1 to 28") && (await step(page)) === "Step 3 of 5", "a payday that cannot be is refused with the same words as Budget");
await page.fill("#fr-d1", "15"); await page.fill("#fr-d2", "last"); await page.fill("#fr-pay", "25,000");
await page.click('#sheet button[data-action="fr-next"]'); await onStep(page, 4);
led = await ledgerOf(page);
ok(JSON.stringify(led.settings.pay_schedule) === JSON.stringify({ kind: "twice", days: [15, "last"] }) && led.settings.income_base_pin === 2500000, "the paydays and the monthly pay are kept as Budget keeps them");

// ---- 4. keep it safe: the reminder switch is the same setting as Setup's
ok((await text(page, "#sheet")).includes("App lock") && (await text(page, "#sheet")).includes("Backup reminder"), "step 4 offers the app lock and the backup reminder");
await page.click('#sheet button[data-action="toggle-backup-reminder"]');
await page.waitForFunction(() => JSON.parse(localStorage.getItem("financialTracker.ledger")).settings.backup_reminder === false);
ok(await page.locator('#sheet button[data-action="toggle-backup-reminder"][aria-pressed="false"]').count() === 1, "the reminder turns off, and stays on step 4");
await page.click('#sheet button[data-action="fr-back"]'); await onStep(page, 3);
ok(await page.inputValue("#fr-d1") === "15" && await page.inputValue("#fr-pay") === "25,000", "Back keeps what was typed");
await page.click('#sheet button[data-action="fr-later"]'); await onStep(page, 4);
await page.click('#sheet button[data-action="fr-later"]'); await onStep(page, 5);

// ---- 5. you are set: read back from the ledger, plain figures, the category tip from the old welcome card
const done = await text(page, "#sheet");
ok(done.includes("In your accounts 1 account ₱1,000.00") && done.includes("Owed on cards 1 card ₱250.00") && done.includes("Pay each month On the 15th and the last day ₱25,000.00") && done.includes("Backup reminder Off"), "step 5 says what was set, with the figures as they are");
ok(done.includes("Categories: 9 to start") && done.includes("Rename them, set each to Needs, Wants or Savings") && await page.locator('#sheet button[data-action="fr-cats"]').count() === 1, "the welcome card's tip moved here, with Edit categories");
await page.click('#sheet button:has-text("Log your first expense")');
await page.locator('#sheet h3:has-text("Add expense"), #sheet #f-amount').first().waitFor();
led = await ledgerOf(page);
ok(led.settings.firstrun_done && !("firstrun_step" in led.settings) && !led.settings.welcome_pending, "the setup is done for good, and no welcome card is waiting");
await page.click('#sheet button:has-text("Cancel")'); await page.waitForFunction(() => !document.querySelector("#sheet .sheet"));
ok(!(await text(page, "#screen")).includes("No backup yet"), "with the reminder off, Log says nothing about backups");

// ---- 6. the reminder back on, from Setup: Log shows it; a backup made today takes it away
await page.reload(); await page.locator("#nav button").first().waitFor(); await page.waitForTimeout(500);
ok(await page.locator("#sheet .fr").count() === 0, "after the setup, a restart opens the app, not the steps");
await page.evaluate(() => { const l = JSON.parse(localStorage.getItem("financialTracker.ledger")); l.settings.intro_off = { setup: true }; localStorage.setItem("financialTracker.ledger", JSON.stringify(l)); });
await page.click(".fn-go").catch(() => {});
await page.click("#menuBtn"); await page.click('#menu .item:has-text("Setup")'); await page.waitForFunction(() => !document.querySelector("#menu .drawer"));
if (await page.locator('#sheet button:has-text("Got it")').count()) await page.click('#sheet button:has-text("Got it")');
await page.click('.setrow[data-id="backup"]');
await page.click('#backup-reminder button[data-action="toggle-backup-reminder"]');
await page.waitForFunction(() => JSON.parse(localStorage.getItem("financialTracker.ledger")).settings.backup_reminder === true);
await page.click('#nav button:has-text("Log")');
ok((await text(page, "#screen")).includes("No backup yet"), "turned on in Setup, Log shows the line");
const backupText = JSON.stringify(await ledgerOf(page));
await ctx.close();

// ---- 7. "I have a backup": Cancel goes back to step 1 with nothing saved; a restore skips the rest and shows the ledger check
ctx = await context(); page = await openPage(ctx);
await onStep(page, 1);
await page.click('#sheet button:has-text("I have a backup")');
await page.locator("#r-file").waitFor();
await page.click('#sheet button:has-text("Cancel")');
await onStep(page, 1);
ok(await ledgerOf(page) === null, "Cancel on Restore goes back to step 1 with nothing saved");
const backed = JSON.parse(backupText); backed.settings.firstrun_step = 4; delete backed.settings.firstrun_done;   // a backup made half way through the setup
const file = join(mkdtempSync(join(tmpdir(), "fr-")), "fo-und backup 2026-11-15 10-00.json"), PW = "invented passphrase 2026";
writeFileSync(file, Buffer.from(await (await M.sealBackupPart({ ledger: JSON.stringify(backed), passphrase: PW, id: M.newBackupId(), savedAt: "2026-11-15T10:00:00.000+08:00" })).arrayBuffer()));
await page.click('#sheet button:has-text("I have a backup")');
await page.setInputFiles("#r-file", [file]); await page.fill("#r-pass", PW); await page.click("#f-save");
await page.locator('#sheet :text("Replace this phone")').first().waitFor({ timeout: 30000 });
await Promise.all([page.waitForEvent("load", { timeout: 30000 }), (async () => { await page.click("#f-save"); await page.click("#f-save").catch(() => {}); })()]);
await page.locator("#nav button").first().waitFor();
await page.locator('#sheet h3:has-text("Your ledger is back")').waitFor({ timeout: 15000 });
ok((await text(page, "#sheet")).includes("Ledger check: OK") && (await text(page, "#sheet")).includes("2 accounts"), "after the restore the rest is skipped and the ledger check is shown");
await page.click('#sheet button:has-text("Got it")');
ok(await page.locator("#sheet .fr").count() === 0, "a backup made half way through the setup does not bring the steps back");
await page.reload(); await page.locator("#nav button").first().waitFor(); await page.waitForTimeout(600);
ok(await page.locator("#sheet .fr").count() === 0 && (await ledgerOf(page)).settings.firstrun_done, "nor after a restart: the setup is marked done");
await ctx.close();

// ---- 8. Reduce Motion: the step does not slide
ctx = await context({ reducedMotion: "reduce" }); page = await openPage(ctx);
await onStep(page, 1); await page.click('#sheet button:has-text("Start fresh")'); await onStep(page, 2);
ok(await page.$eval("#sheet .frpage", (el) => getComputedStyle(el).animationName) === "none", "under Reduce Motion the next step appears at once");
await ctx.close();

// ---- 9. an existing ledger never sees the setup
ctx = await context(); page = await ctx.newPage(); page.on("pageerror", (e) => errors.push(e.message));
await page.goto(base);
await page.evaluate((t) => localStorage.setItem("financialTracker.ledger", t), JSON.stringify({ ...M.emptyLedger(), settings: { notice_seen_at: "2026-10-01T08:00:00.000+08:00", whatsnew_seen: M.CHANGES[0].id, cat_card_seen: "2026-10-01T08:00:00.000+08:00", start_rule_seen: "2026-10-01T08:00:00.000+08:00" } }));
await page.reload(); await page.locator("#nav button").first().waitFor(); await page.waitForTimeout(800);
ok(await page.locator("#sheet .fr").count() === 0, "a ledger already in use opens as before");
await ctx.close();

ok(tapSafety.size === 0, "tap-safety: 0 places" + (tapSafety.size ? " -> " + [...tapSafety.keys()].join("; ") : ""));
ok(errors.length === 0, "no script errors" + (errors.length ? " -> " + errors[0] : ""));
await browser.close();
console.log(`firstrun: ${passed} checks passed`);

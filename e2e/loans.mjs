// Serve the repo on port 8124, then node e2e/loans.mjs (ENGINE=webkit for Safari's engine). Every name and figure here is invented.
// LOANS (owner, Nov 23; data version 13). On the real screens: Cards' own "Loans" list; the loan window (Pay this loan = a move, never spending; the lender's
// balance: higher = interest, booked only on the tap and verified by count; lower = log the missing payment); a loan in no "Paid from"; Setup's Loan kind;
// a payslip's repayment line offers "Lowers". The stored ledger is read back after each save.
import assert from "node:assert/strict";
import { launchBrowser, ENGINE, tapSafety } from "./engine.mjs";
import * as M from "../src/model/index.js";

const browser = await launchBrowser();
const base = process.env.BASE ?? "http://127.0.0.1:8124/app/index.html";
const errors = [], TS = "2026-11-23T03:00:00Z", NOW = new Date(TS);
let passed = 0;
const ok = (cond, label) => { assert.ok(cond, label); passed++; console.log("ok: " + label); };

// The invented ledger: Cash, a bank, a card, two loans (24,000.00 and 50,000.00 owed), and a verified payslip whose 1,200.00 repayment lowers the first loan.
let s = M.ensureIncomeCategories(M.emptyState());
const acct = (o) => ({ role: "", hidden_by_default: false, archived: false, last4: "", opening_date: "2026-11-01", ...o });
s.accounts = [acct({ id: "cash", name: "Cash", class: "asset", opening_balance: 350000 }), acct({ id: "bank", name: "Sample Bank", class: "asset", opening_balance: 4200000 }), acct({ id: "card", name: "Sample Card", class: "liability", opening_balance: 850000 })];
s.categories = [...s.categories, { id: "food", name: "Food", kind: "expense", role: "food" }];
for (const [id, name, owed] of [["sl", "Sample Salary Loan", 2400000], ["bl", "Sample Bank Loan", 5000000]]) s = M.planAccount(s, { id, name, kind: "loan", opening: owed, date: "2026-11-01" }).state;
const slip = M.planPayslip(s, { id: "ps1", transaction_id: "tx-ps1", employer: "Sample Employer Inc", period_from: "2026-11-01", period_to: "2026-11-15", pay_date: "2026-11-15", account_id: "bank",
  printed_gross: 3000000, printed_net: 2830000, deposit: 2830000, printed_deductions: 170000,
  items: [{ section: "earning", label: "Basic Pay", amount: 3000000, category: "salary" }, { section: "deduction", label: "SSS", amount: 50000, category: "sss" }, { section: "deduction", label: "SSS Salary Loan", amount: 120000, category: "loans", loan_id: "sl" }] }, NOW);
assert.ok(slip.ok, JSON.stringify(slip.violations)); s = slip.state;
const seed = { ...M.emptyLedger(), rev: 3, saved_at: "2026-11-22T08:00:00.000+08:00", state: s,
  settings: { notice_seen_at: TS, whatsnew_seen: M.CHANGES[0].id, version_seen: "999.0.0", welcome_off: true, start_rule_seen: TS, cat_card_seen: TS, firstrun_done: TS, bankLogosTried: {}, last_backup_at: TS, intro_off: Object.fromEntries(Object.keys(M.SCREEN_NAMES).map((k) => [k, true])) } };
assert.deepEqual(M.validateState(s), []);

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1";
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: IPHONE });
await ctx.route("**/*", (route) => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
await ctx.addInitScript(() => { Object.defineProperty(navigator, "standalone", { get: () => true }); try { sessionStorage.setItem("logOpen", "1"); } catch {} });
await ctx.clock.setFixedTime(NOW);
const page = await ctx.newPage(); page.on("pageerror", (e) => errors.push(e.message));
const ready = () => page.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 });
await page.goto(base); await ready();
await page.evaluate(async (t) => { localStorage.setItem("financialTracker.ledger", t); await new Promise((res) => { const r = indexedDB.open("financialTracker", 3); r.onsuccess = () => { const x = r.result.transaction("kv", "readwrite"); x.objectStore("kv").put(t, "ledger"); x.oncomplete = () => { r.result.close(); res(); }; }; }); }, JSON.stringify(seed));
await page.reload(); await ready();
const stored = async () => { await page.waitForFunction(() => !document.documentElement.hasAttribute("data-saving")); return page.evaluate(async () => { const db = await new Promise((res) => { const r = indexedDB.open("financialTracker", 3); r.onsuccess = () => res(r.result); }); const t = await new Promise((res) => { const g = db.transaction("kv").objectStore("kv").get("ledger"); g.onsuccess = () => res(g.result); }); db.close(); return JSON.parse(t); }); };
const owedOf = (l, id) => M.loanOwed(l.state, l.state.accounts.find((a) => a.id === id));
const go = async (name) => { await page.click("#menuBtn"); await page.click(`#menu .item:has-text("${name}")`); await page.waitForFunction(() => !document.querySelector("#menu .drawer")); };
const closeSheet = async () => { await page.evaluate(() => document.getElementById("scrim")?.click()); await page.waitForTimeout(250); if (await page.locator("#warn [data-action='warn-save']").count()) await page.click("#warn [data-action='warn-save']"); await page.waitForFunction(() => !document.querySelector("#sheet .sheet")); };
const pickIn = async (key, name) => { await page.click(`#sheet .pickrow[data-key="${key}"]`); await page.click(`#sheet .picklist:not([hidden]) .pickitem:has-text("${name}")`); };

// ---- 1. Cards: the Loans list, apart from the cards
await go("Cards"); await page.click('[data-action="cards-eye"]');
const loanRows = await page.evaluate(() => [...document.querySelectorAll('[data-action="open-loan"]')].map((b) => b.innerText.replace(/\s+/g, " ").trim()));
ok(loanRows.length === 2 && loanRows[0].includes("Sample Salary Loan") && loanRows[0].includes("22,800.00") && loanRows[0].includes("Lowered from your pay") && loanRows[1].includes("50,000.00"), "Cards lists both loans with what is owed (" + loanRows.join(" | ") + ")");
ok(await page.evaluate(() => [...document.querySelectorAll("h2")].some((h) => h.textContent === "Loans")) && !(await page.locator('.gcard:has-text("Sample Salary Loan")').count()), "under their own heading, never with the cards or accounts");

// ---- 2. Pay this loan: a move from your account, a draft, never spending
await page.click('[data-action="open-loan"][data-id="sl"]');
ok((await page.locator("#sheet .hero").innerText()).includes("22,800.00") && (await page.locator("#sheet").innerText()).includes("1,200.00 lowered from your pay"), "the loan window: what you owe and what the payslip lowered");
await page.click('#sheet [data-action="loan-pay"]'); await page.waitForSelector("#sheet #f-amount");
ok((await page.locator('#sheet .pickrow[data-key="to"]').innerText()).includes("Sample Salary Loan"), "Pay this loan opens Move money with the loan as To");
await page.fill("#sheet #f-amount", "1000"); await pickIn("from", "Sample Bank");
await page.waitForFunction(() => !document.querySelector("#f-save")?.disabled); await page.click("#f-save");
await page.waitForFunction(() => !document.querySelector("#sheet .sheet"));
let l = await stored();
const pay = l.state.transactions.find((t) => t.payee === "Loan payment"), payLegs = l.state.entries.filter((e) => e.transaction_id === pay?.id);
ok(pay?.status === "draft" && JSON.stringify(payLegs.map((e) => [e.account_id, e.amount, e.card_state ?? null]).sort()) === JSON.stringify([["bank", -100000, null], ["sl", 100000, null]]), "saved as ONE draft move: the bank down, the loan down, no card mark");
ok(owedOf(l, "sl") === 2180000 && M.spendingByCategory(l.state, { month: "2026-11" }).total === 0, "the loan owes 21,800.00 and nothing is spending");

// ---- 3. The lender's balance: higher is interest, booked only on the tap
await page.click('[data-action="open-loan"][data-id="sl"]');
await page.fill("#sheet #f-lender", "22,100"); await page.waitForTimeout(150);
ok((await page.locator("#loan-count").innerText()).includes("300.00 more: interest."), "typing a higher figure says it is interest (" + (await page.locator("#loan-count").innerText()).replace(/\s+/g, " ") + ")");
l = await stored();
ok(!l.state.transactions.some((t) => t.payee === "Loan interest"), "nothing is booked by typing");
await page.click('#sheet [data-action="loan-interest"]'); await page.waitForFunction(() => !document.querySelector("#sheet .sheet"));
l = await stored();
const int = l.state.transactions.find((t) => t.payee === "Loan interest"), intLegs = l.state.entries.filter((e) => e.transaction_id === int?.id);
ok(int?.status === "verified" && int.verified_by === "verified by count" && JSON.stringify(intLegs.map((e) => [e.account_id ?? e.category_id, e.amount]).sort()) === JSON.stringify([["cat-loan-interest", 30000], ["sl", -30000]]), "the tap books ONE entry, verified by count: the loan up 300.00, Loan interest 300.00");
ok(owedOf(l, "sl") === 2210000, "the loan now owes what the lender says");

// ---- 4. A lower figure is a missing payment, never interest
await page.click('[data-action="open-loan"][data-id="sl"]');
await page.fill("#sheet #f-lender", "21,600"); await page.waitForTimeout(150);
ok((await page.locator("#loan-count").innerText()).includes("500.00 less: a payment is not logged yet."), "a lower figure says a payment is missing");
await page.click('#sheet [data-action="loan-missing"]'); await page.waitForSelector("#sheet #f-amount");
ok((await page.inputValue("#sheet #f-amount")) === "500.00" && (await page.locator('#sheet .pickrow[data-key="to"]').innerText()).includes("Sample Salary Loan"), "Log the payment opens Move money with 500.00 to the loan");
await closeSheet();

// ---- 5. Money received from a loan: Move money from the loan
await page.click('[data-action="open-loan"][data-id="bl"]'); await page.click('#sheet [data-action="loan-received"]'); await page.waitForSelector("#sheet #f-amount");
ok((await page.locator('#sheet .pickrow[data-key="from"]').innerText()).includes("Sample Bank Loan"), "Money received from this loan opens Move money from the loan");
await closeSheet();

// ---- 6. A loan is never under Paid from
await page.click('#nav button:has-text("Log")'); await page.click('[data-action="open-other"]'); await page.waitForSelector("#sheet #f-amount");
const paidFrom = await page.evaluate(() => [...document.querySelectorAll('#sheet .pickrow[data-key="acct"] + .picklist .pickitem')].map((b) => b.innerText.trim()));
ok(paidFrom.length > 0 && !paidFrom.some((n) => /Loan/.test(n)), "Paid from lists no loan (" + paidFrom.join(", ") + ")");
await closeSheet();

// ---- 7. The payslip's repayment line offers Lowers, with the loan chosen
await page.click("#menuBtn"); await page.click('#menu .item:has-text("Cash flow")'); await page.waitForFunction(() => !document.querySelector("#menu .drawer"));
await page.click("#top .titleswitch"); await page.click('button.choice[data-action="open-payslips"]'); await page.click('#sheet button[data-action="edit-slip"]');
await page.evaluate(() => { for (const d of document.querySelectorAll("#sheet details.tot")) d.open = true; });
await page.click('#sheet .pl-main:has-text("SSS Salary Loan")');
ok((await page.locator('#sheet .pickrow[data-key="slipdloan"]').innerText()).includes("Sample Salary Loan"), "the repayment line shows Lowers: Sample Salary Loan");
await closeSheet();

// ---- 8. Setup: add a loan
await go("Setup"); await page.click('.setrow:has-text("Accounts")'); await page.click("#add-account-open");
await page.fill("#a-name", "Sample Pag-IBIG Loan"); await page.selectOption("#a-kind", "loan"); await page.fill("#a-open", "30000");
ok((await page.locator("#a-open-note").innerText()).startsWith("Payments with an earlier date"), "the add form speaks of payments for a loan");
await page.click('[data-action="add-account"]');
await page.waitForFunction(() => /Added Sample Pag-IBIG Loan/.test(document.querySelector("#toast")?.innerText ?? ""));
l = await stored();
const made = l.state.accounts.find((a) => a.name === "Sample Pag-IBIG Loan");
ok(made?.class === "loan" && made.opening_balance === 3000000 && owedOf(l, made.id) === 3000000, "Setup made a loan owing 30,000.00");
ok(l.v === 13 && M.validateState(l.state).length === 0, "the stored ledger is data version 13 and sound");

ok(tapSafety.size === 0, "tap-safety: 0 places" + (tapSafety.size ? " -> " + [...tapSafety.keys()].join("; ") : ""));
ok(errors.length === 0, "no script errors" + (errors.length ? " -> " + errors[0] : ""));
await ctx.close(); await browser.close();
console.log(`loans (${ENGINE}): ${passed} checks passed`);

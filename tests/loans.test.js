import { test } from "node:test";
import assert from "node:assert/strict";
import * as M from "../src/model/index.js";
import { account } from "./fixtures.js";

// LOANS (owner, Nov 23; data version 13). Every name and figure is invented; amounts are centavos (100000 is 1,000.00). Each case is worked by hand.
const NOW = new Date("2026-11-23T03:00:00Z"), MONTH = "2026-11";
function ledger() {
  const s = M.emptyState();
  s.accounts = [account({ id: "chk", name: "Sample Checking", class: "asset", opening_balance: 5000000, last4: "" }),
    account({ id: "card", name: "Sample Card", class: "liability", opening_balance: 0, last4: "" }),
    account({ id: "res", name: "Sample Reserve", class: "asset", opening_balance: 100000, reserve_for: "card", last4: "" })];
  s.categories = [{ id: "food", name: "Food", kind: "expense" }];
  const made = M.planAccount(M.ensureIncomeCategories(s), { id: "loan", name: "Sample Salary Loan", kind: "loan", opening: 2400000, date: "2026-11-01" });   // 24,000.00 owed
  assert.ok(made.ok, JSON.stringify(made.violations));
  return made.state;
}
const owed = (st) => M.loanOwed(st, st.accounts.find((a) => a.id === "loan"));
const bal = (st, id) => M.naturalBalance(st.accounts.find((a) => a.id === id), M.countedEntries(st));
const verify = (st, id) => { const r = M.verifyDraft(st, id, NOW); assert.ok(r.ok, JSON.stringify(r.violations)); return r.state; };
const move = (st, o) => { const r = M.planTransfer(st, { transaction_id: o.id, date: "2026-11-10", from_account_id: o.from, to_account_id: o.to, amount: o.amount, source: "manual" }, NOW); assert.ok(r.ok, JSON.stringify(r.violations)); return r.state; };
// A payslip: Basic Pay 30,000.00; SSS 500.00 and a salary loan repayment 1,200.00 (linked to the loan, or not); net and deposit 28,300.00.
const slip = (o = {}) => ({ id: "ps1", transaction_id: "tx-ps1", employer: "Sample Employer Inc", period_from: "2026-11-01", period_to: "2026-11-15", pay_date: "2026-11-15", account_id: "chk",
  printed_gross: 3000000, printed_net: 2830000, deposit: 2830000, printed_deductions: 170000,
  items: [{ section: "earning", label: "Basic Pay", amount: 3000000, category: "salary" }, { section: "deduction", label: "SSS", amount: 50000, category: "sss" },
    { section: "deduction", label: "SSS Salary Loan", amount: 120000, category: "loans", ...(o.link === false ? {} : { loan_id: "loan" }) }], ...o.extra });
const pay = (st, o) => { const r = M.planPayslip(st, slip(o), NOW); assert.ok(r.ok, JSON.stringify(r.violations)); return r.state; };

test("a loan is its own kind: what you owe is the amount owed, and no card rule ever touches it", () => {
  const s = ledger(), loan = s.accounts.find((a) => a.id === "loan");
  assert.deepEqual([loan.class, loan.opening_balance], ["loan", 2400000]);
  assert.equal(owed(s), 2400000);
  assert.deepEqual(M.validateState(s), []);
  assert.deepEqual(M.cardsSummary(s, { from: "2026-11-01", to: "2026-11-30" }).cards.map((c) => c.account_id), ["card"], "not listed with the credit cards");
  assert.ok(!M.accountsOverview(s, { from: "2026-11-01", to: "2026-11-30" }).money.some((m) => m.account_id === "loan"), "not money you have");
  const bad = M.checkTransactionSave(s, { transaction: { id: "x", date: "2026-11-10", payee: "x", memo: "", source: "manual", created_at: "2026-11-23T11:00:00+08:00", status: "draft" },
    entries: [{ transaction_id: "x", account_id: "loan", amount: 1000, card_state: "posted" }, { transaction_id: "x", account_id: "chk", amount: -1000 }] });
  assert.ok(!bad.ok && bad.violations.some((v) => v.code === "CARD_STATE_UNEXPECTED"), "a card's pending or posted mark is refused on a loan");
});

test("paying a loan yourself is a move: the loan owes 1,000.00 less, the account holds 1,000.00 less, nothing is spending", () => {
  let s = move(ledger(), { id: "p1", from: "chk", to: "loan", amount: 100000 });
  assert.deepEqual(s.entries.filter((e) => e.transaction_id === "p1"), [{ transaction_id: "p1", account_id: "loan", amount: 100000 }, { transaction_id: "p1", account_id: "chk", amount: -100000 }], "no card mark");
  assert.equal(s.transactions.find((t) => t.id === "p1").status, "draft", "typed: it waits in Verify");
  s = verify(s, "p1");
  assert.deepEqual([owed(s), bal(s, "chk")], [2300000, 4900000]);
  assert.equal(M.spendingByCategory(s, { month: MONTH }).total, 0, "never spending");
});

test("money received from a loan is a move into your account: what you owe goes up by it, and it is never income", () => {
  let s = verify(move(ledger(), { id: "r1", from: "loan", to: "chk", amount: 500000 }), "r1");
  assert.deepEqual([owed(s), bal(s, "chk")], [2900000, 5500000]);
  assert.deepEqual(M.incomeBySource(s, { from: "2026-11-01", to: "2026-11-30" }), M.incomeBySource(ledger(), { from: "2026-11-01", to: "2026-11-30" }), "income unchanged");
});

test("a payslip line linked to the loan lowers it by the line; the deposit and every income figure stay what an unlinked payslip gives", () => {
  const linked = pay(ledger(), {}), plain = pay(ledger(), { link: false });
  const legs = linked.entries.filter((e) => e.transaction_id === "tx-ps1");
  assert.deepEqual(legs, [{ transaction_id: "tx-ps1", account_id: "chk", amount: 2830000 }, { transaction_id: "tx-ps1", category_id: "cat-salary", amount: -2830000 },
    { transaction_id: "tx-ps1", account_id: "loan", amount: 120000 }, { transaction_id: "tx-ps1", category_id: M.LOAN_PAY_CATEGORY_ID, amount: -120000 }], "one entry: the deposit, and the loan lowered against pay sent to it");
  assert.equal(legs.reduce((n, e) => n + e.amount, 0), 0, "it balances");
  assert.equal(linked.transactions.find((t) => t.id === "tx-ps1").status, "verified", "verified by the payslip check, with the repayment");
  assert.equal(owed(linked), 2280000, "24,000.00 - 1,200.00");
  assert.equal(owed(plain), 2400000, "an unlinked line lowers nothing");
  assert.equal(bal(linked, "chk"), bal(plain, "chk"), "the deposit is the same money in");
  const range = { from: "2026-11-01", to: "2026-11-30" };
  for (const f of ["incomeBySource", "incomeBreakdown", "incomeMonths", "deductionsByMonth"]) assert.deepEqual(M[f](linked, range), M[f](plain, range), f + " unchanged");
  assert.deepEqual(M.monthPay(linked, MONTH), M.monthPay(plain, MONTH), "Budget's received pay unchanged");
  assert.equal(M.spendingByCategory(linked, { month: MONTH }).total, 0, "never spending");
  assert.equal(linked.categories.find((c) => c.id === M.LOAN_PAY_CATEGORY_ID).kind, "withheld");
  assert.equal(M.paidFromPay(linked, "loan"), 120000);
  assert.deepEqual(M.validateState(linked), []);
  assert.equal(M.ledgerCheckLine(linked), "Ledger check: OK");
});

test("a payslip saved as a draft keeps its repayment a draft with it; removing a verified payslip cancels the repayment with the pay", () => {
  const d = pay(ledger(), { extra: { status: "draft" } });
  assert.equal(d.transactions.find((t) => t.id === "tx-ps1").status, "draft");
  let s = pay(ledger(), {});
  const r = M.deletePayslip(s, "ps1", NOW); assert.ok(r.ok, JSON.stringify(r.violations)); s = r.state;
  assert.equal(owed(s), 2400000, "the cancellation puts the loan back as it was");
  assert.equal(bal(s, "chk"), 5000000);
  assert.deepEqual(M.validateState(s), []);
});

test("a count of the lender's balance: a higher figure is interest, booked only on the tap; a lower one is a payment to log, never interest", () => {
  let s = pay(ledger(), {});   // the ledger owes 22,800.00
  assert.deepEqual(M.loanCount(s, "loan", 2280000), { ok: true, owed: 2280000, lender: 2280000, kind: "match", amount: 0 });
  assert.deepEqual(M.loanCount(s, "loan", 2310000), { ok: true, owed: 2280000, lender: 2310000, kind: "interest", amount: 30000 }, "300.00 interest");
  assert.deepEqual(M.loanCount(s, "loan", 2200000), { ok: true, owed: 2280000, lender: 2200000, kind: "lower", amount: 80000 });
  assert.ok(!M.planLoanInterest(s, { id: "i0", loan_id: "loan", lender: 2200000, date: "2026-11-23" }, NOW).ok, "a lower figure is never booked as interest");
  assert.ok(!M.planLoanInterest(s, { id: "i0", loan_id: "chk", lender: 2310000, date: "2026-11-23" }, NOW).ok, "only a loan");
  assert.equal(owed(s), 2280000, "looking changes nothing");
  const r = M.planLoanInterest(s, { id: "i1", loan_id: "loan", lender: 2310000, date: "2026-11-23" }, NOW); assert.ok(r.ok, JSON.stringify(r.violations)); s = r.state;
  const t = s.transactions.find((x) => x.id === "i1");
  assert.deepEqual([t.status, t.verified_by], ["verified", "verified by count"], "the owner's tap at the count verifies it");
  assert.equal(owed(s), 2310000, "the ledger now owes what the lender says");
  assert.equal(M.spendingByCategory(s, { month: MONTH }).rows.find((x) => x.category_id === M.LOAN_INTEREST_CATEGORY_ID)?.amount, 30000, "interest is an expense");
  assert.equal(M.loanCount(s, "loan", 2310000).kind, "match");
  assert.deepEqual(M.validateState(s), []);
});

test("net worth counts loans: what you have minus what the cards and loans are owed", () => {
  const s = ledger(), series = M.netWorthSeries(s, { today: "2026-11-23", months: 1 }), now = series.points.at(-1);
  assert.equal(now.assets, 5000000 + 100000);
  assert.equal(now.owed, 2400000, "the loan, the card owes nothing");
  assert.equal(now.net, 5100000 - 2400000);
  assert.deepEqual(M.loansSummary(s), { rows: [{ account_id: "loan", name: "Sample Salary Loan", owed: 2400000, from_pay: 0 }], owed: 2400000 });
});

// ---------- the data change: version 12 to 13 (a hand-written version 12 ledger, as the owner's phone holds today) ----------
const v12 = () => ({ v: 12, rev: 9, saved_at: "2026-11-20T08:00:00.000+08:00", settings: { foo: "bar" }, state: { ...M.emptyState(),
  accounts: [account({ id: "chk", name: "Sample Checking", class: "asset", opening_balance: 900000, last4: "" }), account({ id: "card", name: "Sample Card", class: "liability", opening_balance: 50000, last4: "" })],
  categories: [{ id: "food", name: "Food", kind: "expense" }, { id: "cat-salary", name: "Salary", kind: "income" }],
  people: [{ id: "p1", name: "Ana" }],
  transactions: [{ id: "e", date: "2026-11-02", payee: "Lunch", memo: "", status: "verified", source: "manual", created_at: "2026-11-02T12:00:00+08:00", verified_at: "2026-11-02T12:05:00+08:00" }],
  entries: [{ transaction_id: "e", category_id: "food", amount: 18500 }, { transaction_id: "e", account_id: "chk", amount: -18500 }] } });

test("data version 12 upgrades to 13: nothing is added or changed, only the version number", () => {
  const before = v12(), snapshot = JSON.stringify(before);
  assert.equal(M.parseLedger(snapshot).older, true, "an older ledger");
  const r = M.upgradeLedger(before, { now: NOW });
  assert.equal(r.ok, true, r.error); assert.deepEqual([r.steps, r.ledger.v, M.LEDGER_VERSION], [1, 13, 13]);
  assert.equal(JSON.stringify(before), snapshot, "the input is never changed");
  assert.deepEqual(r.ledger.state, before.state, "every record and every figure is the same");
  assert.deepEqual(r.ledger.settings, before.settings);
});
test("SAFETY COPY: before the update to version 13 the app keeps the version 12 data, and the copy reads back exactly as it was", () => {
  const before = v12(), original = JSON.stringify(before);
  const copies = M.rotateCopies([], original, { at: "2026-11-23T08:00:00+08:00", from_version: before.v, build: "test" });
  assert.equal(copies.length, 1); assert.equal(copies[0].text, original, "the copy is the data before the change, byte for byte");
  assert.equal(copies[0].from_version, 12);
  const back = M.restorableCopy(copies[0], 200);
  assert.deepEqual([back.v, back.rev], [12, 201]);
  assert.deepEqual(back.state, before.state, "the copy reads back with every record");
  assert.equal(M.parseLedger(JSON.stringify(back)).ok, true);
  assert.equal(M.upgradeLedger(back).ledger.v, 13, "a restored copy upgrades again");
});
test("a version 12 backup file opens, restores and upgrades; a loan added afterwards backs up and opens again", async () => {
  const pass = "a long passphrase for tests";
  const opened = await M.decryptLedgerBackup(await M.encryptLedgerBackup(v12(), pass), pass);
  assert.equal(opened.v, 12);
  const up = M.upgradeLedger(M.restoreLedger(M.emptyLedger(), opened, NOW), { now: NOW }); assert.ok(up.ok, up.error);
  const made = M.planAccount(up.ledger.state, { id: "loan", name: "Sample Bank Loan", kind: "loan", opening: 1000000, date: "2026-11-01" }); assert.ok(made.ok);
  const back = await M.decryptLedgerBackup(await M.encryptLedgerBackup({ ...up.ledger, state: made.state }, pass), pass);
  assert.equal(back.v, 13);
  assert.equal(M.loanOwed(back.state, back.state.accounts.find((a) => a.id === "loan")), 1000000);
  assert.deepEqual(M.validateState(back.state), []);
});

test("linking the loan on a payslip already verified cancels its pay entry once and makes a new one with the repayment; the money in is the same", () => {
  let s = pay(ledger(), { link: false });
  assert.equal(owed(s), 2400000);
  const r = M.updatePayslip(s, "ps1", slip({}), NOW); assert.ok(r.ok, JSON.stringify(r.violations)); s = r.state;
  assert.equal(owed(s), 2280000, "the repayment now lowers the loan");
  assert.equal(bal(s, "chk"), 5000000 + 2830000, "the deposit counts once");
  assert.ok(s.transactions.some((t) => t.reverses === "tx-ps1"), "the old pay entry is cancelled, never edited");
  assert.deepEqual(M.incomeBySource(s, { from: "2026-11-01", to: "2026-11-30" }), M.incomeBySource(pay(ledger(), { link: false }), { from: "2026-11-01", to: "2026-11-30" }), "income unchanged");
  assert.deepEqual(M.validateState(s), []);
  assert.equal(M.ledgerCheckLine(s), "Ledger check: OK");
});

test("only a Loan repayments line lowers a loan: a line moved to another category keeps no link in effect", () => {
  const s0 = ledger(), input = slip({}); input.items[2] = { ...input.items[2], category: "other_deduction" };
  const r = M.planPayslip(s0, input, NOW); assert.ok(r.ok, JSON.stringify(r.violations));
  assert.equal(owed(r.state), 2400000);
});
test("the loan a repayment line lowers is remembered per employer and label, only when the owner chose it", () => {
  const items = [{ section: "deduction", label: "SSS Salary Loan", category: "loans", loan_id: "loan", loan_chosen: true }, { section: "deduction", label: "Company Loan", category: "loans", loan_id: "loan" }];
  const st = M.rememberChoices({}, "Sample Employer Inc", items);
  assert.deepEqual(Object.values(st.payslip_loans), ["loan"], "only the line the owner chose");
  assert.equal(M.draftItem({ section: "deduction", label: "SSS Salary Loan", amount: 120000, employer: "Sample Employer Inc", settings: st }).loan_id, "loan", "the next payslip's line starts linked");
  assert.equal(M.draftItem({ section: "deduction", label: "Company Loan", amount: 120000, employer: "Sample Employer Inc", settings: st }).loan_id, undefined);
});

test("BACKUP: the loan a repayment line lowers (\"Lowers\", remembered per employer and label) is in the one-file backup and comes back with the restore", async () => {
  const pass = "invented pass phrase for loans";
  const settings = M.rememberChoices({ foo: "bar" }, "Sample Employer Inc", [{ section: "deduction", label: "SSS Salary Loan", category: "loans", loan_id: "loan", loan_chosen: true }]);
  const l = { ...M.emptyLedger(), rev: 4, saved_at: "2026-11-23T08:00:00.000+08:00", state: ledger(), settings };
  const text = JSON.stringify(l), file = Object.assign(await M.sealBackupPart({ passphrase: pass, iterations: 100000, savedAt: "2026-11-23", ledger: text, items: [], id: M.newBackupId(), part: 1, parts: 1 }), { name: "x.json" });
  const set = await M.openBackupSet([file], pass);
  assert.deepEqual(set.ledger.settings.payslip_loans, settings.payslip_loans, "the memory is in the file");
  const back = M.restoreLedger(M.emptyLedger(), set.ledger, NOW);
  assert.deepEqual(back.settings.payslip_loans, { [M.memoryKey("Sample Employer Inc", "deduction", "SSS Salary Loan")]: "loan" }, "and comes back with the restore");
  assert.equal(M.draftItem({ section: "deduction", label: "SSS Salary Loan", amount: 120000, employer: "Sample Employer Inc", settings: back.settings }).loan_id, "loan", "the next payslip's line starts linked after the restore");
});

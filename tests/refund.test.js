import { test } from "node:test";
import assert from "node:assert/strict";
import * as M from "../src/model/index.js";
import { UNLOGGED_CATEGORY_ID } from "../src/model/seed.js";
import { makeState, account } from "./fixtures.js";

// P0-5 fix 4 (docs/ACCOUNTING.md, recognition and cutoff): a refund reduces spending in its category and is never income; past refunds saved as income are put right through
// corrections after the owner confirms each category; pay counts in the month the deposit arrived, and the months that moved are shown. Invented figures, centavos.
const NOW = new Date("2026-10-20T03:00:00Z"), TS = "2026-10-01T09:00:00.000+08:00";
let n = 0;
function base() {
  const s = makeState();
  s.accounts = [account({ id: "chk", name: "Checking", class: "asset", opening_balance: 1000000 })];
  s.categories = [{ id: "food", name: "Food", kind: "expense" }, { id: "shop", name: "Shopping", kind: "expense" }, { id: UNLOGGED_CATEGORY_ID, name: "Unlogged", kind: "expense" }];
  s.payslips = []; s.payslipLines = []; s.payslipItems = []; s.payslipItemChanges = []; s.payslipRevisions = []; s.tags = []; s.rules = []; s.categoryMaps = [];
  return M.ensureIncomeCategories(s);
}
const bal = (s) => M.naturalBalance(s.accounts[0], M.countedEntries(s));
const trial = (s) => s.entries.reduce((a, e) => a + e.amount, 0);
const spend = (s, date, cat, amount, payee = "Shop") => { const p = M.planExpense(s, { transaction_id: "e" + ++n, date, category_id: cat, amount, account_id: "chk", payee }, NOW); assert.ok(p.ok); return M.verifyDraft(M.applyDrafts(s, p.drafts), p.drafts[0].transaction.id, NOW).state; };
// the OLD refund flow: money received under the income category Refund
const oldRefund = (s, date, amount, payee = "Shop refund") => { const r = M.planPayReceived(s, { transaction_id: "rf" + ++n, date, amount, account_id: "chk", category_id: "cat-refund", payee }, NOW); assert.ok(r.ok); return r.state; };
const month = (s, m) => M.spendingByCategory(s, { month: m }).total;
const inc = (s, m) => M.incomeBySource(s, { from: m + "-01", to: m + "-31" }).total;

test("a refund reduces spending in its category, never income, and the money is in the account", () => {
  let s = spend(base(), "2026-10-05", "food", 100000);
  const r = M.planRefund(s, { transaction_id: "r1", date: "2026-10-09", amount: 30000, account_id: "chk", category_id: "food", payee: "Shop" }, NOW);
  assert.ok(r.ok, JSON.stringify(r.violations)); s = r.state;
  assert.equal(month(s, "2026-10"), 70000, "Food spending is 1,000.00 less 300.00");
  assert.deepEqual(M.spendingByCategory(s, { month: "2026-10" }).rows.map((x) => [x.name, x.amount]), [["Food", 70000]]);
  assert.equal(inc(s, "2026-10"), 0, "it is not income");
  assert.equal(bal(s), 1000000 - 100000 + 30000); assert.equal(trial(s), 0);
  assert.equal(s.transactions.find((t) => t.id === "r1").status, "verified");
  const full = M.planRefund(s, { transaction_id: "r2", date: "2026-10-10", amount: 70000, account_id: "chk", category_id: "food" }, NOW).state;
  assert.equal(month(full, "2026-10"), 0, "a full refund takes the spending back to nothing");
});
test("a refund needs an amount, an account that holds money, a day and a spending category", () => {
  const s = base(), ok = { transaction_id: "r1", date: "2026-10-09", amount: 100, account_id: "chk", category_id: "food" };
  assert.equal(M.planRefund(s, { ...ok, amount: 0 }, NOW).ok, false);
  assert.equal(M.planRefund(s, { ...ok, account_id: "nope" }, NOW).ok, false);
  assert.equal(M.planRefund(s, { ...ok, category_id: "cat-salary" }, NOW).ok, false, "an income category is not spending");
  assert.equal(M.planRefund(s, { ...ok, category_id: "cat-refund" }, NOW).ok, false, "the old Refund income category is not a way to record one");
  assert.equal(M.planRefund(s, { ...ok, date: "soon" }, NOW).ok, false);
});

test("past refunds saved as income are found, with a guess from the purchase they came from; interest and pay are not refunds", () => {
  let s = spend(base(), "2026-09-20", "shop", 50000, "Sample Store"); s = spend(s, "2026-09-25", "food", 30000, "Corner Bakery");
  s = oldRefund(s, "2026-10-03", 20000, "Sample Store"); s = oldRefund(s, "2026-10-04", 30000, "Unknown shop");
  const interest = M.planPayReceived(s, { transaction_id: "int1", date: "2026-10-05", amount: 500, account_id: "chk", category_id: "cat-interest" }, NOW).state;
  const rows = M.pastRefunds(interest);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => [r.amount, r.guess]), [[20000, "shop"], [30000, "food"]], "by the same payee, else by the same amount on that account");
  assert.deepEqual(M.pastRefunds(base()), []);
});

test("the repair cancels each chosen refund once and counts the money against the category; every balance is the same; a refund without a choice is left alone", () => {
  let s = spend(base(), "2026-09-20", "shop", 50000, "Sample Store"); s = oldRefund(s, "2026-10-03", 20000, "Sample Store"); s = oldRefund(s, "2026-10-04", 7000, "Unknown shop");
  const [first, second] = M.pastRefunds(s);
  assert.equal(inc(s, "2026-10"), 27000); assert.equal(month(s, "2026-10"), 0);
  const plan = M.planRefundRepair(s, { [first.transaction_id]: "shop" }, { now: NOW });
  assert.ok(plan.ok, JSON.stringify(plan.violations)); assert.equal(plan.count, 1);
  const done = M.applyRefundRepair(s, plan);
  assert.equal(bal(done), bal(s), "the balance does not change"); assert.equal(trial(done), 0);
  assert.equal(inc(done, "2026-10"), 7000, "the repaired refund is no longer income; the other is untouched"); assert.equal(month(done, "2026-10"), -20000, "it brings that month's spending down");
  assert.ok(done.transactions.some((t) => t.id === "rev:" + first.transaction_id && t.reverses === first.transaction_id));
  assert.ok(done.transactions.some((t) => t.id === "refund:" + first.transaction_id && t.corrects === first.transaction_id && t.status === "verified"));
  assert.ok(done.transactions.find((t) => t.id === first.transaction_id).status === "verified", "the old entry is never edited or deleted");
  assert.deepEqual(M.pastRefunds(done).map((r) => r.transaction_id), [second.transaction_id], "only the other one is still waiting");
  assert.equal(M.applyRefundRepair(done, plan), done, "a second tap changes nothing");
  assert.deepEqual(plan.months.map((m) => [m.month, m.spendingBefore, m.spendingAfter, m.incomeBefore, m.incomeAfter]), [["2026-10", 0, -20000, 27000, 7000]], "the month shows before and after");
  assert.equal(M.planRefundRepair(s, { [first.transaction_id]: "cat-salary" }, { now: NOW }).ok, false, "only a spending category will do");
  assert.equal(M.planRefundRepair(s, {}, { now: NOW }).count, 0);
});

// ---------- cutoff: pay counts when the deposit arrives ----------
const slip = (s, id, from, to, pay, amount = 800000) => { const r = M.planPayslip(s, { id, transaction_id: "t" + id, employer: "Co", period_from: from, period_to: to, pay_date: pay, account_id: "chk", printed_gross: amount, printed_net: amount, deposit: amount, earnings: [{ kind: "basic", amount }], deductions: [] }, NOW); assert.ok(r.ok); return r.state; };
test("pay counts in the month of the deposit, and the months that moved are listed with before and after", () => {
  let s = slip(base(), "a", "2026-09-16", "2026-09-30", "2026-10-05"); s = slip(s, "b", "2026-10-01", "2026-10-15", "2026-10-15");
  assert.equal(inc(s, "2026-09"), 0); assert.equal(inc(s, "2026-10"), 1600000);
  assert.deepEqual(M.payMonthShift(s), [{ month: "2026-09", before: 800000, after: 0, change: -800000 }, { month: "2026-10", before: 800000, after: 1600000, change: 800000 }]);
  assert.deepEqual(M.payMonthShift(slip(base(), "c", "2026-10-01", "2026-10-15", "2026-10-15")), [], "pay received in the month it was for moves nothing");
  assert.deepEqual(M.payMonthShift(base()), []);
});
test("a removed payslip nets to nothing in the deposit month, and pay periods with no payslip are still found by the period", () => {
  let s = slip(base(), "a", "2026-09-16", "2026-09-30", "2026-10-05"); s = M.deletePayslip(s, "a", NOW).state;
  assert.equal(inc(s, "2026-09"), 0); assert.equal(inc(s, "2026-10"), 0);
  let t = base();
  for (const [from, to, pay] of [["2026-08-01", "2026-08-15", "2026-08-20"], ["2026-08-16", "2026-08-31", "2026-09-05"], ["2026-09-01", "2026-09-15", "2026-09-20"], ["2026-10-01", "2026-10-15", "2026-10-20"]]) t = slip(t, "p" + from, from, to, pay);
  assert.deepEqual(M.missingPayPeriods(t, null, "2026-10-25").map((g) => g.from), ["2026-09-16"], "the half-month with no payslip is found by its period, not its pay date");
});

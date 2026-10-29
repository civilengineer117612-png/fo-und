import { test } from "node:test";
import assert from "node:assert/strict";
import { planPayslip, updatePayslip, verifyDraft, payslipProblems, payslipDraftBlock, incomeBySource, incomeBreakdown, netPerPayday, employerHistory, deductionsByMonth, linesOf, matchPayslips, missingPayPeriods, ensureIncomeCategories } from "../src/model/index.js";
import { makeState, account } from "./fixtures.js";

// Invented numbers. Hand-worked: earnings 9,000.00 + 1,000.00 = 10,000.00; deductions 700 + 300 + 100 + 100 = 1,200.00; net 8,800.00.
const NOW = new Date("2026-10-16T04:00:00Z"), RANGE = { from: "2026-10-01", to: "2026-10-31" };
function ledger() {
  const s = makeState();
  s.categories.push({ id: "cat-salary", name: "Salary", kind: "income" }, { id: "cat-overtime", name: "Overtime", kind: "income" });
  return ensureIncomeCategories(s);
}
const base = (o = {}) => ({ id: "ps1", transaction_id: "tx-ps1", employer: "Sample Employer Inc", period_from: "2026-10-01", period_to: "2026-10-15", pay_date: "2026-10-15", account_id: "chk",
  printed_gross: 1000000, printed_net: 880000, deposit: 880000, earnings: [{ kind: "basic", amount: 900000 }, { kind: "rice", amount: 100000 }],
  deductions: [{ kind: "tax", amount: 70000 }, { kind: "sss", amount: 30000 }, { kind: "philhealth", amount: 10000 }, { kind: "pagibig", amount: 10000 }], ...o });
const WRONG = (o = {}) => base({ printed_gross: 1100000, ...o });   // the printed gross is 1,000.00 more than the lines
const verifiedIncome = (s) => s.transactions.filter((t) => t.status === "verified" && s.entries.some((e) => e.transaction_id === t.id && e.category_id && ["cat-salary", "cat-overtime"].includes(e.category_id)));

test("the checks report every problem and the gap for the one plain question", () => {
  const ok = planPayslip(ledger(), base(), NOW);
  assert.deepEqual(payslipProblems(ok.payslip, ok.lines), { flags: [], gap: 0 });
  const bad = planPayslip(ledger(), WRONG(), NOW), p = payslipProblems(bad.payslip, bad.lines);
  assert.deepEqual(p.flags.map((f) => f.code), ["GROSS"]); assert.equal(p.gap, 100000, "differ by 1,000.00");
  const ded = planPayslip(ledger(), base({ printed_deductions: 130000 }), NOW), q = payslipProblems(ded.payslip, ded.lines);
  assert.deepEqual(q.flags.map((f) => f.code), ["DEDUCTIONS"]); assert.equal(q.gap, 10000, "printed deductions 1,300.00 against lines 1,200.00: 100.00");
});

test("DRAFT PATH: a payslip whose checks fail, saved as a draft, creates NO verified income and counts as no income", () => {
  const s0 = ledger(), r = planPayslip(s0, WRONG({ status: "draft" }), NOW);
  assert.ok(r.ok, JSON.stringify(r.violations));
  assert.equal(r.transaction.status, "draft"); assert.equal(r.transaction.verified_at, undefined);
  assert.deepEqual(verifiedIncome(r.state), [], "no verified income entry exists");
  assert.equal(incomeBySource(r.state, RANGE).total, 0, "the month shows no income");
  assert.equal(netPerPayday(r.state, "2026").length, 0, "no payday row");
  assert.equal(employerHistory(r.state).length, 0); assert.deepEqual(deductionsByMonth(r.state, null).months, []);
  const b = incomeBreakdown(r.state, RANGE); assert.equal(b.total, 0); assert.deepEqual(b.lines, []); assert.equal(b.deductions, 0); assert.equal(b.unmatched, 0, "the lines of a draft are not counted either");
  assert.equal(r.entries.filter((e) => e.account_id === "chk").reduce((n, e) => n + e.amount, 0), 880000, "it is still an ordinary draft: the account holds it like any draft");
  assert.equal(linesOf(r.state, "ps1").length, 6, "and its lines are kept, readable");
});

test("a payslip saved with passing checks is verified income exactly as before", () => {
  const r = planPayslip(ledger(), base(), NOW);
  assert.equal(r.transaction.status, "verified"); assert.equal(verifiedIncome(r.state).length, 1); assert.equal(incomeBySource(r.state, RANGE).total, 880000);
});

test("VERIFY: a draft payslip that still does not add up cannot become verified; after the figures are put right it can", () => {
  const r = planPayslip(ledger(), WRONG({ status: "draft" }), NOW);
  const refused = verifyDraft(r.state, "tx-ps1");
  assert.equal(refused.ok, false); assert.match(refused.violations[0].message, /still differ by .*1,000\.00/); assert.equal(refused.state.transactions.find((t) => t.id === "tx-ps1").status, "draft");
  assert.match(payslipDraftBlock(r.state, "tx-ps1").message, /Change the payslip first/);
  const fixed = updatePayslip(r.state, "ps1", base({ status: "draft" }), NOW);
  assert.ok(fixed.ok, JSON.stringify(fixed.violations)); assert.equal(fixed.transaction.status, "draft", "editing keeps it a draft until it is verified");
  const v = verifyDraft(fixed.state, "tx-ps1");
  assert.ok(v.ok, JSON.stringify(v.violations)); assert.equal(v.state.transactions.find((t) => t.id === "tx-ps1").status, "verified");
  assert.equal(incomeBySource(v.state, RANGE).total, 880000, "now it is income");
  assert.equal(netPerPayday(v.state, "2026").length, 1);
});

test("a draft payslip never matches money that arrived, and an ordinary draft is not blocked by the payslip rule", () => {
  const r = planPayslip(ledger(), WRONG({ status: "draft" }), NOW);
  const s = { ...r.state, transactions: [...r.state.transactions, { id: "in1", date: "2026-10-15", payee: "Sample Employer Inc", memo: "", status: "verified", source: "manual", created_at: "2026-10-15T09:00:00+08:00", verified_at: "2026-10-15T09:00:00+08:00" }],
    entries: [...r.state.entries, { transaction_id: "in1", account_id: "chk", amount: 880000 }, { transaction_id: "in1", category_id: "cat-salary", amount: -880000 }] };
  assert.equal(matchPayslips(s).length, 0, "a payslip that is only a draft is not 'arriving'");
  const plain = { ...s, transactions: [...s.transactions, { id: "d1", date: "2026-10-15", payee: "Other", memo: "", status: "draft", source: "manual", created_at: "2026-10-15T09:00:00+08:00" }], entries: [...s.entries, { transaction_id: "d1", account_id: "chk", amount: 100 }, { transaction_id: "d1", category_id: "cat-salary", amount: -100 }] };
  assert.ok(verifyDraft(plain, "d1").ok);
});

test("a payslip kept as a draft does not hide a missing pay period", () => {
  const mk = (...periods) => periods.reduce((st, [from, to, status], i) => planPayslip(st, base({ id: "p" + i, transaction_id: "t" + i, period_from: from, period_to: to, pay_date: to, deposit: 880000 + i, status }), NOW).state, ledger());
  const live = mk(["2026-03-01", "2026-03-15"], ["2026-03-16", "2026-03-31"], ["2026-04-01", "2026-04-15"], ["2026-04-16", "2026-04-30"], ["2026-05-01", "2026-05-15"]);
  assert.deepEqual(missingPayPeriods(live, null, "2026-06-10"), [{ from: "2026-05-16", to: "2026-05-31" }]);
  const draft = mk(["2026-03-01", "2026-03-15"], ["2026-03-16", "2026-03-31"], ["2026-04-01", "2026-04-15"], ["2026-04-16", "2026-04-30", "draft"], ["2026-05-01", "2026-05-15"]);
  assert.deepEqual(missingPayPeriods(draft, null, "2026-06-10"), [{ from: "2026-04-16", to: "2026-04-30" }, { from: "2026-05-16", to: "2026-05-31" }], "the draft half still shows as missing");
});

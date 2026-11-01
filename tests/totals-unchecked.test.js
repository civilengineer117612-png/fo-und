// Owner, Nov 1: a payslip read from a photo or PDF whose printed gross or net could not be found is NOT CHECKED. Saving it makes a DRAFT, never
// verified income (same as a failed check); its gross and net are what the lines add to, so no check may count it as proven (that would compare a
// value with itself). It becomes income only through Verify's explicit "Verify anyway", and keeps a note for good. Invented numbers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planPayslip, updatePayslip, verifyDraft, payslipProblems, payslipDraftBlock, payslipNotes, incomeBySource, ensureIncomeCategories, TOTALS_UNCHECKED } from "../src/model/index.js";
import { makeState } from "./fixtures.js";

const NOW = new Date("2026-10-16T04:00:00Z"), RANGE = { from: "2026-10-01", to: "2026-10-31" };
const ledger = () => { const s = makeState(); s.categories.push({ id: "cat-salary", name: "Salary", kind: "income" }, { id: "cat-overtime", name: "Overtime", kind: "income" }); return ensureIncomeCategories(s); };
// Hand-worked: lines 9,000.00 + 1,000.00 = 10,000.00 gross; 1,200.00 deductions; 8,800.00 net. Here the gross and net are the LINES' figures, not printed ones.
const unchecked = (o = {}) => ({ id: "ps1", transaction_id: "tx-ps1", employer: "Sample Employer Inc", period_from: "2026-10-01", period_to: "2026-10-15", pay_date: "2026-10-15", account_id: "chk",
  printed_gross: 1000000, printed_net: 880000, deposit: 880000, totals_unchecked: true, earnings: [{ kind: "basic", amount: 900000 }, { kind: "rice", amount: 100000 }],
  deductions: [{ kind: "tax", amount: 70000 }, { kind: "sss", amount: 30000 }, { kind: "philhealth", amount: 10000 }, { kind: "pagibig", amount: 10000 }], ...o });

test("a payslip whose printed totals were not found is saved as a draft, never verified income, even if asked to be verified", () => {
  const r = planPayslip(ledger(), unchecked(), NOW);
  assert.ok(r.ok, JSON.stringify(r.violations));
  assert.equal(r.transaction.status, "draft"); assert.equal(r.payslip.totals_unchecked, true);
  assert.equal(incomeBySource(r.state, RANGE).total, 0);
  assert.equal(planPayslip(ledger(), unchecked({ status: "verified" }), NOW).transaction.status, "draft");
});

test("audit: its figures agree with its lines (they came from them) and it is still never 'adds up'", () => {
  const r = planPayslip(ledger(), unchecked(), NOW), p = payslipProblems(r.payslip, r.lines);
  assert.deepEqual(p.flags.map((f) => f.code), ["UNCHECKED"]); assert.equal(p.flags[0].message, TOTALS_UNCHECKED);
  const proven = planPayslip(ledger(), unchecked({ totals_unchecked: undefined }), NOW);
  assert.deepEqual(payslipProblems(proven.payslip, proven.lines).flags, [], "the same figures typed from the page are proven: only the source differs");
});

test("Verify asks first; only the explicit yes makes it income, and the note stays for good", () => {
  const r = planPayslip(ledger(), unchecked(), NOW);
  assert.deepEqual(payslipDraftBlock(r.state, "tx-ps1"), { gap: 0, unchecked: true, message: TOTALS_UNCHECKED });
  assert.equal(verifyDraft(r.state, "tx-ps1", NOW).ok, false);
  const v = verifyDraft(r.state, "tx-ps1", NOW, { acceptPaperGap: true });
  assert.ok(v.ok); assert.equal(incomeBySource(v.state, RANGE).total, 880000);
  const slip = v.state.payslips.find((p) => p.id === "ps1");
  assert.ok(payslipNotes(v.state, slip).includes("Totals not checked against the page."));
  assert.ok(!payslipNotes(v.state, slip).some((n) => /^Paper differs/.test(n)));
});

test("typing the printed totals while editing the draft makes it an ordinary payslip again", () => {
  const r = planPayslip(ledger(), unchecked(), NOW);
  const u = updatePayslip(r.state, "ps1", { ...unchecked(), totals_unchecked: undefined }, NOW);
  assert.ok(u.ok, JSON.stringify(u.violations));
  const slip = u.state.payslips.find((p) => p.id === "ps1");
  assert.equal(slip.totals_unchecked, undefined); assert.equal(payslipDraftBlock(u.state, "tx-ps1"), null);
});

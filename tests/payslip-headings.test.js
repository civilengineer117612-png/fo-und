import { test } from "node:test";
import assert from "node:assert/strict";
import { pdfScanText } from "../src/model/scan.js";
import { readPayslip, planPayslip, verifyDraft, payslipDraftBlock, payslipProblems, payslipNotes, incomeBySource, ensureIncomeCategories, SECTIONS_UNCLEAR } from "../src/model/index.js";
import { payrollItems } from "../e2e/payroll-table.mjs";
import { makeState } from "./fixtures.js";

// Guard 2 (owner, Nov 7): a section heading that cannot be read gives "Check this: section headings unclear" and a draft, never a silent wrong section. Invented text.
const TODAY = "2026-10-20", NOW = new Date("2026-10-16T04:00:00Z"), RANGE = { from: "2026-10-01", to: "2026-10-31" };
const head = ["Sample Employer Inc", "PAYSLIP", "Pay period: 01/10/2026 - 15/10/2026", "Pay date: Oct 15, 2026"];
const page = (...rest) => [...head, ...rest].join("\n");
const sectionOf = (r, label) => r.items.find((i) => i.label === label)?.section;

test("a readable page is untouched: sections come from the headings, nothing is flagged", () => {
  const r = readPayslip(page("EARNINGS", "Basic Salary   9,000.00", "Rice Subsidy   1,000.00", "DEDUCTIONS", "Union Dues   300.00", "Gross Pay   10,000.00", "Net Pay   9,700.00"), TODAY);
  assert.equal(r.sections_unclear, undefined); assert.ok(!r.notes.includes(SECTIONS_UNCLEAR));
  assert.deepEqual([sectionOf(r, "Basic Salary"), sectionOf(r, "Union Dues")], ["earning", "deduction"]);
});

test("a heading read with a letter or two wrong is still a heading (guard 1): Union Dues lands in deductions, nothing flagged", () => {
  for (const bad of ["Dedxctons", "DEDUCTONS", "Deduct1ons"]) {
    const r = readPayslip(page("EARNINGS", "Basic Salary   9,000.00", bad, "Union Dues   300.00", "Gross Pay   9,000.00", "Net Pay   8,700.00"), TODAY);
    assert.equal(sectionOf(r, "Union Dues"), bad === "Deduct1ons" ? "earning" : "deduction", bad);
    // a letter read as a digit cannot be matched (a digit makes it a line, never a heading) but it IS a heading read badly: the page says so instead of trusting the heading above
    assert.equal(r.sections_unclear, bad === "Deduct1ons" ? true : undefined, bad);
  }
});

test("a heading that holds label words is still read within the allowed difference: Tax Deductons puts Union Dues in deductions", () => {
  for (const bad of ["Tax Deductons", "Tax Deductoins", "TAX DEDUCTIONS"]) {
    const r = readPayslip(page("EARNINGS", "Basic Salary   9,000.00", bad, "Union Dues   300.00"), TODAY);
    assert.equal(sectionOf(r, "Union Dues"), "deduction", bad); assert.equal(r.sections_unclear, undefined, bad);
  }
});

test("an UNREADABLE heading: the line under it would have landed silently in the heading above; now the page says Check this: section headings unclear", () => {
  const r = readPayslip(page("EARNINGS", "Basic Salary   9,000.00", "Dithr' ou", "Union Dues   300.00", "Gross Pay   9,000.00", "Net Pay   8,700.00"), TODAY);
  assert.equal(r.sections_unclear, true); assert.ok(r.notes.includes(SECTIONS_UNCLEAR)); assert.equal(SECTIONS_UNCLEAR, "Check this: section headings unclear");
  const caps = readPayslip(page("EARNINGS", "Basic Salary   9,000.00", "XQZVWK PLNTS", "Union Dues   300.00"), TODAY);
  assert.equal(caps.sections_unclear, true, "a mostly-capitals line no known heading explains");
});

test("lines placed by their own words are never in doubt: a garbled heading does not flag a page where every line says what it is", () => {
  const r = readPayslip(page("EARNINGS", "Basic Salary   9,000.00", "Dithr' ou", "SSS   300.00", "PhilHealth   100.00", "Gross Pay   9,000.00", "Net Pay   8,600.00"), TODAY);
  assert.equal(r.sections_unclear, undefined); assert.deepEqual([sectionOf(r, "SSS"), sectionOf(r, "PhilHealth")], ["deduction", "deduction"]);
});

test("amounts and line labels are never headings: a label with its figure on the next line, an information line, a figure line", () => {
  const r = readPayslip(page("EARNINGS", "Basic Salary   9,000.00", "Hot meal", "  500.00", "Overtime", "  1,500.00", "Earnings   2,000.00", "Gross Pay   11,500.00"), TODAY);
  assert.equal(r.sections_unclear, undefined, "plain label lines do not make a page unclear");
  assert.equal(sectionOf(r, "Basic Salary"), "earning");
  const odd = readPayslip(page("EARNINGS", "Basic Salary   9,000.00", "Deductions   300.00", "Union Dues   300.00"), TODAY);
  assert.equal(sectionOf(odd, "Union Dues"), "earning", "a line with a figure is not a heading even when its word is Deductions");
});

test("a payroll TABLE: a title read with a letter or two wrong is the same table; a title that cannot be read gives the line and a draft", () => {
  const sum = (a) => a.reduce((s, l) => s + l.amount, 0), clean = readPayslip(pdfScanText(payrollItems()), "2026-10-23", { allowHistorical: true });
  const swap = (from, to) => (a) => { a.find((i) => i.str === from).str = to; };
  const near = readPayslip(pdfScanText(payrollItems({ change: swap("Tax Deductions", "Tax Deductons") })), "2026-10-23", { allowHistorical: true });
  assert.deepEqual(near, clean, "one letter wrong in a table title reads the same");
  const near2 = readPayslip(pdfScanText(payrollItems({ change: swap("Pre-Tax Deductions", "Pre-Tax Dedxctons") })), "2026-10-23", { allowHistorical: true });
  assert.equal(sum(near2.deductions), sum(clean.deductions));
  assert.equal(clean.sections_unclear, undefined);
  for (const [from, to] of [["Tax Deductions", "Tax Dxxxctxxns"], ["Pre-Tax Deductions", "Pre-Txx Dxxxctxxns"]]) {
    const r = readPayslip(pdfScanText(payrollItems({ change: swap(from, to) })), "2026-10-23", { allowHistorical: true });
    assert.equal(r.sections_unclear, true, from); assert.ok(r.notes.includes(SECTIONS_UNCLEAR), from);
    assert.ok(r.flags.some((f) => f.field === "sections" && f.reason === "section headings unclear"), from);
  }
});

// ---------- saved as a draft, asked at Verify, noted for good ----------
const ledger = () => { const s = makeState(); s.categories.push({ id: "cat-salary", name: "Salary", kind: "income" }, { id: "cat-overtime", name: "Overtime", kind: "income" }); return ensureIncomeCategories(s); };
const slip = (o = {}) => ({ id: "ps1", transaction_id: "tx-ps1", employer: "Sample Employer Inc", period_from: "2026-10-01", period_to: "2026-10-15", pay_date: "2026-10-15", account_id: "chk",
  printed_gross: 1000000, printed_net: 880000, deposit: 880000, earnings: [{ kind: "basic", amount: 900000 }, { kind: "rice", amount: 100000 }],
  deductions: [{ kind: "tax", amount: 70000 }, { kind: "sss", amount: 30000 }, { kind: "philhealth", amount: 10000 }, { kind: "pagibig", amount: 10000 }], ...o });
test("a payslip with unclear headings is saved as a draft even when its figures add up and it is asked to be verified; a clear one is verified as before", () => {
  const clear = planPayslip(ledger(), slip(), NOW); assert.equal(clear.transaction.status, "verified"); assert.equal(clear.payslip.sections_unclear, undefined);
  const r = planPayslip(ledger(), slip({ sections_unclear: true, status: "verified" }), NOW);
  assert.ok(r.ok, JSON.stringify(r.violations)); assert.equal(r.transaction.status, "draft"); assert.equal(r.payslip.sections_unclear, true);
  assert.equal(incomeBySource(r.state, RANGE).total, 0, "a draft is no income yet");
  assert.deepEqual(payslipProblems(r.payslip, r.lines).flags.map((f) => [f.code, f.message]), [["SECTIONS", SECTIONS_UNCLEAR]]);
});
test("Verify asks first (never silent); only the explicit yes makes it income, and the note stays", () => {
  const r = planPayslip(ledger(), slip({ sections_unclear: true }), NOW);
  assert.deepEqual(payslipDraftBlock(r.state, "tx-ps1"), { gap: 0, unclear: true, message: SECTIONS_UNCLEAR });
  assert.equal(verifyDraft(r.state, "tx-ps1", NOW).ok, false);
  const v = verifyDraft(r.state, "tx-ps1", NOW, { acceptPaperGap: true }); assert.ok(v.ok);
  assert.equal(incomeBySource(v.state, RANGE).total, 880000);
  const notes = payslipNotes(v.state, v.state.payslips.find((p) => p.id === "ps1"));
  assert.ok(notes.includes("Section headings were unclear.")); assert.ok(!notes.some((n) => /^Paper differs/.test(n)));
});

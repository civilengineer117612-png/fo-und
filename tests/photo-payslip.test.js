// A payroll table read from a PHOTO or a screenshot (owner's report, Nov 1). Each test is one misread the owner found on a real scan, reproduced on
// an INVENTED payslip of the same layout (e2e/payslip-photo.mjs; hand-worked figures there). The date is fixed: no test reads the real clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { linesFromBoxes, readPayslip } from "../src/model/index.js";
import { photoBoxes, PHOTO_FIGURES as F, PHOTO_EARNINGS, PHOTO_DEDUCTIONS } from "../e2e/payslip-photo.mjs";

const TODAY = "2026-01-20";
const cents = (s) => Math.round(Number(s.replace(/,/g, "")) * 100);
const read = (opts = {}) => readPayslip(linesFromBoxes(photoBoxes(opts)), TODAY);
const side = (r, s) => r.items.filter((i) => i.section === s);
const sum = (list) => list.reduce((n, i) => n + i.amount, 0);

test("misread 1: the Hours column is never taken as the amount", () => {
  const r = read(), earn = side(r, "earning");
  for (const [label, , amount] of PHOTO_EARNINGS) assert.equal(earn.find((i) => i.label === label)?.amount, cents(amount), label);
  assert.equal(earn.find((i) => i.label === "Regular").hours, "64.00");   // the hours stay with their line, as hours
});

test("misread 2: column titles and headings never become lines", () => {
  const labels = read().items.map((i) => i.label);
  for (const word of ["Hours", "Amount", "Description", "Current", "Balance", "Value", "Number", "Summary", "Hours and Earnings"]) assert.ok(!labels.includes(word), word + " became a line");
});

test("misread 3: rows of the Summary, Accruals, Absences, Net Pay Distribution and Other Information tables never become lines", () => {
  const labels = read().items.map((i) => i.label.toLowerCase());
  for (const word of ["pto", "current", "direct deposit", "number", "gross", "net pay", "taxes", "pre-tax", "ytd"]) assert.ok(!labels.some((l) => l.includes(word)), word + " became a line");
});

test("misread 4: a summary table with its titles above its figures fills the totals and never makes deduction lines", () => {
  const r = read();
  assert.equal(r.printed_gross, F.gross); assert.equal(r.printed_net, F.net); assert.equal(r.printed_deductions, F.preTax + F.tax);
  for (const amount of [F.gross, F.net]) assert.ok(!r.items.some((i) => i.amount === amount), "a summary figure became a line");
});

test("misread 5: a line's section comes from its table: the tax line is a deduction, also when its words run together", () => {
  for (const glued of [false, true]) {
    const r = read({ glued }), tax = r.items.find((i) => /^tax\s?deduction$/i.test(i.label));
    assert.equal(tax?.section, "deduction", "glued " + glued);
    assert.ok(!side(r, "earning").some((i) => /^tax/i.test(i.label)));
    assert.ok(side(r, "earning").some((i) => /^program\s?allowance$/i.test(i.label) && i.amount === 30000), "glued " + glued);
  }
});

test("misread 6: dates printed as 16-Jan-2026 under their titles are read", () => {
  const r = read();
  assert.equal(r.pay_date, F.payDate); assert.equal(r.period_from, F.from); assert.equal(r.period_to, F.to);
});

test("misread 7: every printed earnings and deduction line is kept (the owner's missing Meal Allowance line too) and the page is proven", () => {
  const r = read();
  assert.deepEqual(side(r, "earning").map((i) => i.label), PHOTO_EARNINGS.map(([l]) => l));
  assert.deepEqual(side(r, "deduction").map((i) => i.label), PHOTO_DEDUCTIONS.map(([l]) => l));
  assert.equal(sum(side(r, "earning")), F.gross); assert.equal(sum(side(r, "deduction")), F.preTax + F.tax);
  assert.deepEqual(r.flags, []); assert.equal(r.deposit, F.deposit);
});

test("misread 8: a thousands comma read as a dot (1.000.00) and a decimal point read as a comma (4,00) still give the right amounts and hours", () => {
  const r = read({ dots: true }), plain = read();
  assert.deepEqual(r.items, plain.items); assert.deepEqual(r.flags, []);
  assert.equal(r.printed_gross, F.gross); assert.equal(r.deposit, F.deposit);
});

test("the same page photographed tilted, smaller or larger reads the same", () => {
  const plain = read();
  for (const opts of [{ tilt: 0.02 }, { tilt: -0.03 }, { scale: 1.2 }, { scale: 3.5, tilt: 0.015 }]) {
    const r = read(opts);
    assert.deepEqual(r.items, plain.items, JSON.stringify(opts));
    assert.equal(r.printed_gross, F.gross); assert.equal(r.printed_net, F.net); assert.equal(r.pay_date, F.payDate);
  }
});

// The owner's rule (Nov 1): a check may ONLY compare against figures read from the printed page. Never against a total made from the lines.
test("no printed totals on the page: gross and net stay empty (never the lines' own total) and the payslip says it was not checked", () => {
  const r = read({ summary: false, distribution: false });
  assert.equal(r.printed_gross, null); assert.equal(r.printed_net, null); assert.equal(r.deposit, null);
  assert.equal(sum(side(r, "earning")), F.gross);   // the lines themselves are still read
  assert.ok(r.notes.includes("Not checked: the printed totals were not found. Check every line against the page."));
  assert.equal(read().notes.includes("Not checked: the printed totals were not found. Check every line against the page."), false);
});

test("audit: no check compares a value with itself: changing a line never moves the figures it is checked against", () => {
  for (const opts of [{}, { summary: false }, { distribution: false }, { summary: false, distribution: false }]) {
    const before = read(opts);
    const boxes = photoBoxes(opts), regular = boxes.find((b) => b.text === "6,000.00");
    regular.text = "6,100.00"; boxes.find((b) => b.text === "250.00").text = "260.00";
    const after = readPayslip(linesFromBoxes(boxes), TODAY);
    assert.equal(sum(side(after, "earning")), sum(side(before, "earning")) + 10000, JSON.stringify(opts));
    assert.equal(sum(side(after, "deduction")), sum(side(before, "deduction")) + 1000, JSON.stringify(opts));
    for (const k of ["printed_gross", "printed_net", "deposit", "printed_deductions"]) assert.equal(after[k], before[k], k + " moved with the lines " + JSON.stringify(opts));
  }
});

// The same rules when a page is NOT recognised as a table and is read line by line (any other payslip photo).
test("line by line: column titles, other tables' rows and a glued tax line are placed by the rules, and 16-Jan-2026 is a date", () => {
  const text = ["Payslip", "Example Employer Inc.", "Pay date 16-Jan-2026", "Earnings", "Hours 692.31", "Basic Pay 5,000.00", "Description Hours Amount", "Current 0.00",
    "Tax Deductions", "TaxDeduction 150.00", "Accruals", "PTO 0.00 0.00", "Summary", "Gross 5,000.00", "Net Pay 4,850.00", "Net Pay Distribution", "Number 4,850.00", "Other Information", "Value 5,000.00"].join("\n");
  const r = readPayslip(text, TODAY);
  assert.deepEqual(r.items.map((i) => [i.section, i.label, i.amount]), [["earning", "Basic Pay", 500000], ["deduction", "TaxDeduction", 15000]]);
  assert.equal(r.pay_date, "2026-01-16");
  assert.equal(r.printed_gross, 500000); assert.equal(r.printed_net, 485000);
  assert.ok(!r.notes.some((n) => /could not be placed/.test(n)), "a title or another table's row counted as a line that could not be placed");
});

test("no Net Pay Distribution on the page: the deposit stays empty, never the net copied over", () => {
  const r = read({ distribution: false });
  assert.equal(r.printed_net, F.net); assert.equal(r.deposit, null);
});

test("a tax line can never be an earning, even under the Earnings heading and with its words run together", () => {
  const r = readPayslip(["Earnings", "Basic Pay 5,000.00", "TaxDeduction 150.00", "Gross 5,000.00", "Net Pay 4,850.00"].join("\n"), TODAY);
  assert.deepEqual(r.items.map((i) => [i.section, i.label]), [["earning", "Basic Pay"], ["deduction", "TaxDeduction"]]);
});

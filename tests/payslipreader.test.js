import { test } from "node:test";
import assert from "node:assert/strict";
import { draftItem } from "../src/model/index.js";
import { pdfScanText, readPayslip } from "../src/model/scan.js";
import { payrollItems } from "../e2e/payroll-table.mjs";
// Invented documents only. The reader hands over EVERY printed line, in print order, as printed.
const TODAY = "2026-10-23";
const readPdf = (opts) => readPayslip(pdfScanText(payrollItems(opts)), TODAY, { allowHistorical: true });
const put = (a, str, x, y) => a.push({ str, x, y, w: str.length * 5, h: 8.333333333 });

test("a payroll PDF keeps every printed line with its label, section, amount and its own hours, in print order", () => {
  const r = readPdf();
  assert.deepEqual(r.items.map((i) => [i.section, i.label, i.amount, i.hours ?? null]), [
    ["earning", "Regular", 1200000, "64.00"], ["earning", "Allowance Non Taxable", 150000, "0.00"], ["earning", "Overtime", 250000, "8.00"], ["earning", "Retro Regular", 100000, "8.00"],
    ["deduction", "HDMF", 10000, null], ["deduction", "PhilHealth", 40000, null], ["deduction", "SSS", 70000, null], ["deduction", "Tax Deduction", 60000, null]]);
  assert.deepEqual(r.items.map((i) => i.position), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(r.items.filter((i) => i.section === "earning").reduce((n, i) => n + i.amount, 0), r.printed_gross, "the printed lines add to the printed gross");
  assert.deepEqual(readPdf({ reverse: true }).items, r.items, "the order of the PDF's own text pieces does not matter");
  // the owner's rules on top: exact Overtime is only SUGGESTED, Retro is back pay, Non Taxable is a flag; HDMF is Pag-IBIG
  const d = r.items.map((i) => draftItem({ ...i, employer: "Example Employer Ltd", settings: {} }));
  assert.equal(d.find((i) => i.label === "Overtime").overtime, true); assert.equal(d.find((i) => i.label === "Overtime").via_overtime, "suggested");
  assert.equal(d.find((i) => i.label === "Retro Regular").back_pay, true); assert.equal(d.find((i) => i.label === "Allowance Non Taxable").tax, "non_taxable");
  assert.equal(d.find((i) => i.label === "HDMF").category, "pagibig");
  assert.equal(d.find((i) => i.label === "Regular").category, undefined, "nothing is guessed for an unfamiliar label");
});

test("pay rate, pay basis and period type are read as printed", () => {
  const r = readPdf();
  assert.deepEqual(r.info, { pay_basis: "Monthly Non Exempt", pay_rate: "34,000.00", period_type: "Bi-Week" });
  assert.deepEqual(readPdf({ change: (a) => a.splice(a.findIndex((i) => i.str === "Pay Basis"), 2) }).info.pay_basis, undefined, "absent when the paper has none");
});

test("a printed 0.00 line is kept, and an Employer share section is read as its own section that never touches the earnings or deductions", () => {
  const r = readPdf({ change: (a) => {
    put(a, "Lates", 25, 520); a.push({ str: "0.00", x: 290 - 20, y: 520, w: 20, h: 8.33 });
    put(a, "Employer Share", 310, 445); put(a, "Description", 310, 435); a.push({ str: "Amount", x: 570 - 30, y: 435, w: 30, h: 8.33 });
    put(a, "SSS ER", 310, 425); a.push({ str: "1,050.00", x: 570 - 40, y: 425, w: 40, h: 8.33 });
  } });
  assert.deepEqual(r.items.find((i) => i.label === "Lates"), { section: "earning", label: "Lates", amount: 0, position: r.items.findIndex((i) => i.label === "Lates") });
  assert.deepEqual(r.items.filter((i) => i.section === "employer").map((i) => [i.label, i.amount]), [["SSS ER", 105000]]);
  assert.equal(r.items.filter((i) => i.section === "earning").reduce((n, i) => n + i.amount, 0), 1700000, "the 0.00 line adds nothing");
  assert.equal(r.items.filter((i) => i.section === "deduction").reduce((n, i) => n + i.amount, 0), 180000, "the employer line is not a deduction");
  assert.deepEqual(r.unread, { earning: 0, deduction: 0 });
  assert.equal(r.printed_deductions, 180000, "and not in the printed deductions the reader works out"); assert.deepEqual(r.flags, readPdf().flags, "no new difference is flagged");
  assert.equal(r.printed_net, 1520000);
});

test("a photo's text keeps every line it can place, repeated labels and 0.00 included, and says how many it could not place", () => {
  const text = ["Sample Employer Inc", "Pay period: 01/10/2026 - 15/10/2026", "Pay Rate: 1,250.00", "Period Type: Semi-Monthly", "EARNINGS", "Basic Salary 20,000.00", "Overtime 2,400.00", "Night Differential 640.00", "Meal Subsidy 700.00",
    "Gross Pay 23,740.00", "DEDUCTIONS", "SSS 900.00", "Salary Loan 1,250.00", "Salary Loan 640.00", "Absences 0.00", "Canteen 350.00", "Total Deductions 3,140.00", "Employer Share", "SSS ER 1,050.00", "Net Pay 20,600.00"].join("\n");
  const r = readPayslip(text, TODAY, { allowHistorical: true });
  assert.deepEqual(r.items.map((i) => [i.section, i.label, i.amount]), [["earning", "Basic Salary", 2000000], ["earning", "Overtime", 240000], ["earning", "Night Differential", 64000], ["earning", "Meal Subsidy", 70000],
    ["deduction", "SSS", 90000], ["deduction", "Salary Loan", 125000], ["deduction", "Salary Loan", 64000], ["deduction", "Absences", 0], ["deduction", "Canteen", 35000], ["employer", "SSS ER", 105000]],
  "repeated labels stay separate, 0.00 stays, the employer line is its own section, totals are not lines");
  assert.deepEqual(r.info, { pay_rate: "1,250.00", period_type: "Semi-Monthly" });
  const noHeading = readPayslip(["Sample Employer Inc", "Basic Salary 20,000.00", "Mystery Pay 100.00", "Net Pay 20,100.00"].join("\n"), TODAY, { allowHistorical: true });
  assert.deepEqual(noHeading.items.map((i) => i.label), ["Basic Salary"], "Basic Salary is placed by its word; Mystery Pay has no heading above it");
  assert.ok(noHeading.notes.some((n) => /1 line on the page could not be placed/.test(n)));
});

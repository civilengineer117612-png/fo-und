import { test } from "node:test";
import assert from "node:assert/strict";
import { readPayslip, payslipProblems } from "../src/model/index.js";

// Owner (Nov 1): a payslip line the photo reader misses must never become a silent total. The e2e-webkit run read the invented payslip of block
// 5j without its "Basic Salary 9,000.00" line. Whatever reader the phone uses, the printed gross stays as read, so the lines no longer add up to
// it and the form says "Check this" (and the payslip is offered as a draft). Invented figures only.
const PAPER = ["Sample Employer Inc", "PAYSLIP", "Pay period: 01/10/2026 - 02/10/2026", "Pay date: Oct 2, 2026", "EARNINGS", "Basic Salary   9,000.00", "Rice Subsidy   1,000.00",
  "Overtime   1,500.00", "Gross Pay   11,500.00", "DEDUCTIONS", "Withholding Tax   700.00", "SSS   300.00", "PhilHealth   100.00", "Pag-IBIG   100.00", "Total Deductions   1,200.00", "Net Pay   10,300.00"];
const read = (lines) => readPayslip(lines.join("\n"), "2026-10-03");
const linesOf = (r) => [...r.earnings.map((l) => ({ ...l, side: "earning" })), ...r.deductions.map((l) => ({ ...l, side: "deduction" }))];
const problems = (r) => payslipProblems({ printed_gross: r.printed_gross, printed_net: r.printed_net, deposit: r.printed_net, printed_deductions: r.printed_deductions ?? 0 }, linesOf(r));

test("the whole paper adds up: nothing to check", () => {
  const r = read(PAPER);
  assert.equal(r.printed_gross, 1150000);
  assert.deepEqual(problems(r).flags, []);
});

test("a line the reader misses is flagged with its exact gap, never a silent total", () => {
  for (const missing of ["Basic Salary", "Rice Subsidy", "Overtime", "SSS", "Withholding Tax"]) {
    const r = read(PAPER.filter((l) => !l.startsWith(missing))), p = problems(r);
    assert.equal(r.printed_gross, 1150000, missing + ": the printed gross is kept as read");
    assert.ok(p.flags.length > 0, missing + ": the payslip is flagged");
    const amount = Number(PAPER.find((l) => l.startsWith(missing)).match(/([\d,]+\.\d\d)$/)[1].replace(/,/g, "")) * 100;
    assert.equal(p.gap, amount, missing + ": the gap is exactly the missed line (" + p.gap + ")");
  }
});

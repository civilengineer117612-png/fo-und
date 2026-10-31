import { test } from "node:test";
import assert from "node:assert/strict";
import * as M from "../src/model/index.js";
import { makeState, account } from "./fixtures.js";

// P0-5 fix 5 (docs/ACCOUNTING.md, principle 9): an earnings line with no category counts in the budget's base only if a line with the same label was on at least 2 of the
// last 3 payslips from that employer (this one included); otherwise it is treated as non-recurring. "13th month" and "Bonus" are suggested as their categories. Invented figures.
const NOW = new Date("2026-10-31T03:00:00Z");
let n = 0;
function base() {
  const s = makeState();
  s.accounts = [account({ id: "chk", name: "Checking", class: "asset", opening_balance: 0 })]; s.categories = [];
  for (const k of ["payslips", "payslipLines", "payslipItems", "payslipItemChanges", "payslipRevisions"]) s[k] = [];
  return M.ensureIncomeCategories(s);
}
const E = (label, amount, o = {}) => ({ section: "earning", label, amount, ...o });
const BASIC = E("Basic Salary", 1000000, { category: "salary" });
function slip(s, date, extra = [], employer = "Co", type = "Bi-Week") {
  const items = [BASIC, ...extra, { section: "deduction", label: "SSS", amount: 200000 }];
  const gross = items.filter((i) => i.section === "earning").reduce((a, i) => a + i.amount, 0), id = "p" + ++n;
  const r = M.planPayslip(s, { id, transaction_id: "t" + id, employer, period_from: date, period_to: date, pay_date: date, account_id: "chk", printed_gross: gross, printed_net: gross - 200000, deposit: gross - 200000, period_type: type, items }, NOW);
  assert.ok(r.ok, JSON.stringify(r.violations)); return r.state;
}
const stableOf = (s, date) => M.netPerPayday(s).find((r) => r.date === date);

test("a new uncategorised line is non-recurring; once it appears on 2 of the last 3 payslips it counts as recurring", () => {
  const rice = E("Rice Subsidy", 100000);
  let s = slip(base(), "2026-08-07", [rice]);
  assert.equal(stableOf(s, "2026-08-07").variable, 100000, "the first payslip: seen once, not twice");
  s = slip(s, "2026-08-21", [rice]);
  assert.equal(stableOf(s, "2026-08-21").variable, 0, "second payslip: on 2 of the last 2");
  s = slip(s, "2026-09-04", [rice, E("Productivity Award", 500000)]);
  const c = stableOf(s, "2026-09-04");
  assert.equal(c.variable, 500000, "a one-off award on the third payslip is non-recurring; the rice (3 of 3) is recurring");
  assert.deepEqual(c.parts.map((p) => [p.label, p.why]), [["Productivity Award", "one_off"]]);
  assert.equal(c.stable, c.net - 500000);
});
test("only the same employer counts, labels match whatever the case and spacing, and a line that left the payslips is not recurring", () => {
  const rice = E("Rice Subsidy", 100000);
  let s = slip(base(), "2026-08-07", [rice], "Other Co");
  s = slip(s, "2026-08-21", [E("RICE  subsidy", 100000)]);
  assert.equal(stableOf(s, "2026-08-21").variable, 100000, "another employer's payslip does not count");
  s = slip(s, "2026-09-04", [E("rice subsidy", 100000)]);
  assert.equal(stableOf(s, "2026-09-04").variable, 0, "2 of the last 3 from this employer, whatever the case");
  let t = slip(base(), "2026-08-07", [rice]); t = slip(t, "2026-08-21", [rice]); t = slip(t, "2026-09-04"); t = slip(t, "2026-09-18"); t = slip(t, "2026-10-02", [rice]);
  assert.equal(stableOf(t, "2026-10-02").variable, 100000, "it was not on the two payslips just before, so it is back to non-recurring");
});
test("a category the owner chose decides: Allowances stay recurring even when new; Bonus, Holiday and night pay stay variable even when repeated", () => {
  const bonus = E("Mid-year Bonus", 300000, { category: "bonus" }), meal = E("Meal Allowance", 80000, { category: "allowance" });
  let s = slip(base(), "2026-08-07", [bonus, meal]); s = slip(s, "2026-08-21", [bonus, meal]);
  assert.deepEqual(stableOf(s, "2026-08-21").parts.map((p) => p.label), ["Mid-year Bonus"]);
  assert.equal(stableOf(s, "2026-08-07").variable, 300000, "the new allowance is recurring by its category");
});
test("an old payslip with no printed lines is unchanged: only its confirmed overtime is left out", () => {
  const s = base();
  s.payslips.push({ id: "old", employer: "Co", period_from: "2026-08-01", period_to: "2026-08-15", pay_date: "2026-08-15", account_id: "chk", transaction_id: "x", printed_gross: 1000000, printed_net: 800000, deposit: 800000 });
  s.payslipLines.push({ payslip_id: "old", side: "earning", kind: "basic", amount: 1000000 }, { payslip_id: "old", side: "deduction", kind: "sss", amount: 200000 });
  assert.equal(M.netPerPayday(s)[0].stable, 800000);
});
test("the base income leaves out one-off awards with no category (two different ones, so the middle pay would move without the rule)", () => {
  const rice = E("Rice Subsidy", 100000);
  const mk = (awards) => { let s = slip(base(), "2026-08-07", [rice]); s = slip(s, "2026-08-21", [rice, ...(awards ? [E("Spot Award", 900000)] : [])]); return slip(s, "2026-09-04", [rice, ...(awards ? [E("Team Prize", 900000)] : [])]); };
  assert.equal(M.baseIncome(mk(true)).amount, M.baseIncome(mk(false)).amount);
});
test("'13th month' and 'Bonus' are suggested as their category, only for those exact labels", () => {
  const cat = (label) => M.draftItem({ section: "earning", label, amount: 1, employer: "Co", settings: {} });
  for (const l of ["13th month", "13th Month", "Bonus", " bonus "]) { const d = cat(l); assert.equal(d.category, "bonus", l); assert.equal(d.via, "suggested", l); }
  for (const l of ["13th Month Pay", "Bonus Pay", "Performance Bonus", "Overtime"]) assert.notEqual(cat(l).category, "bonus", l);
  assert.equal(M.draftItem({ section: "deduction", label: "Bonus", amount: 1, employer: "Co", settings: {} }).category, undefined, "a deduction is never a bonus");
  assert.equal(M.suggestBonus("13th month"), true); assert.equal(M.suggestBonus("13th month pay"), false);
});

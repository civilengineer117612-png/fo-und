import { test } from "node:test";
import assert from "node:assert/strict";
import { planPayslip, ensureIncomeCategories, draftItem, netPerPayday, baseIncome, suggestPlan, payBase, extraPaydays, payFrequency, periodKind, inferKind, stableOf,
  addPrintedLines, itemsOf, revisionChanges, itemsOf as itemsFor, validateState } from "../src/model/index.js";
import { UNLOGGED_CATEGORY_ID } from "../src/model/seed.js";
import { makeState, account } from "./fixtures.js";

// Stable pay (owner, Oct 31): the budget counts on what a payday reliably brings, so overtime, holiday and night pay, bonus and back pay are left out of its base.
// Every figure is invented and worked by hand; amounts are centavos (100000 is 1,000.00).
const NOW = new Date("2026-10-31T03:00:00Z");
const it = (section, label, amount, o = {}) => { const { via, via_overtime, ...d } = { ...draftItem({ section, label, amount, employer: "Sample Employer Inc", settings: {} }), ...o }; return d; };
let n = 0;
function ledger() {
  const s = makeState();
  s.accounts = [account({ id: "chk", name: "Test Checking", class: "asset", opening_balance: 100000000 })];
  s.categories = [{ id: UNLOGGED_CATEGORY_ID, name: "Unlogged", kind: "expense" }];
  s.payslips = []; s.payslipLines = []; s.payslipItems = []; s.payslipItemChanges = []; s.payslipRevisions = [];
  return ensureIncomeCategories(s);
}
// A payslip with its printed lines. earnings: [[label, centavos, options]], ded: centavos of one SSS line. Type "Bi-Week" etc. goes in `type`.
function slip(s, date, earnings, ded, type = "Bi-Week") {
  const id = "p" + ++n, gross = earnings.reduce((a, [, v]) => a + v, 0), net = gross - ded;
  const r = planPayslip(s, { id, transaction_id: "tx" + n, employer: "Sample Employer Inc", period_from: date, period_to: date, pay_date: date, account_id: "chk", printed_gross: gross, printed_net: net, deposit: net,
    ...(type ? { period_type: type } : {}), items: [...earnings.map(([l, v, o]) => it("earning", l, v, o)), it("deduction", "SSS", ded)] }, NOW);
  assert.ok(r.ok, JSON.stringify(r.violations));
  return r.state;
}
const BASIC = (v) => ["Basic Salary", v, { category: "salary" }];

test("stable pay: A 8,000.00, B 11,000.00 with 2,000.00 holiday and night pay and 1,000.00 back pay, C 8,200.00 give 8,000 / 8,000 / 8,200; base 8,000 a payday, 16,000 a month", () => {
  let s = ledger();
  s = slip(s, "2026-08-07", [BASIC(1000000)], 200000);                                                              // net 8,000.00
  s = slip(s, "2026-08-21", [BASIC(1000000), ["Holiday Pay", 200000, { category: "holiday_night" }], ["Retro Basic", 100000]], 200000);   // gross 13,000, net 11,000
  s = slip(s, "2026-09-04", [BASIC(1020000)], 200000);                                                              // net 8,200.00
  const rows = netPerPayday(s);
  assert.deepEqual(rows.map((r) => r.net), [800000, 1100000, 820000]);
  assert.deepEqual(rows.map((r) => r.stable), [800000, 800000, 820000], "B: 11,000 less 2,000 holiday and night pay less 1,000 back pay");
  assert.deepEqual(rows.map((r) => r.variable), [0, 300000, 0]);
  assert.deepEqual(rows[1].parts.map((p) => [p.label, p.amount, p.why]), [["Holiday Pay", 200000, "holiday_night"], ["Retro Basic", 100000, "back_pay"]]);
  const b = baseIncome(s);
  assert.equal(b.perPayday, 800000, "median of 8,000 / 8,000 / 8,200 (the lower middle is the middle one)");
  assert.equal(b.amount, 1600000, "bi-weekly: 2 x 8,000.00");
  assert.equal(b.paydays, 2); assert.equal(b.frequency.from, "period_type");
  assert.equal(b.text, 'Last 3 payslips, extra pay left out. 2 paydays a month, from "Bi-Week".');
  assert.equal(b.extra.length, 0);
});

test("a third payday in a month is an Extra payday: never in the base, and the base stays 16,000.00", () => {
  let s = ledger();
  for (const d of ["2026-09-04", "2026-09-18", "2026-10-02", "2026-10-16", "2026-10-30"]) s = slip(s, d, [BASIC(1000000)], 200000);
  const b = baseIncome(s);
  assert.equal(b.amount, 1600000);
  assert.deepEqual(b.extra.map((r) => [r.date, r.net]), [["2026-10-30", 800000]], "Oct 30 is the third payday of October: Extra payday 8,000.00");
  // the extra payday is left out even when it is bigger: the base does not follow it
  let t = ledger();
  for (const d of ["2026-09-04", "2026-09-18", "2026-10-02", "2026-10-16"]) t = slip(t, d, [BASIC(1000000)], 200000);
  t = slip(t, "2026-10-30", [BASIC(1000000), ["Bonus", 900000, { category: "bonus" }]], 200000);
  assert.equal(baseIncome(t).amount, 1600000);
  const pb = payBase(netPerPayday(t));
  assert.equal(pb.rows.length, 4); assert.equal(pb.extra.length, 1);
});

test("semi-monthly: the monthly base is 2 x the per-payday base, and a month never has an Extra payday", () => {
  let s = ledger();
  for (const d of ["2026-08-15", "2026-08-30", "2026-09-15", "2026-09-30", "2026-10-15", "2026-10-30"]) s = slip(s, d, [BASIC(1000000)], 200000, "Semi-Monthly");
  const b = baseIncome(s);
  assert.equal(b.amount, 1600000); assert.equal(b.paydays, 2); assert.equal(b.extra.length, 0);
  assert.equal(b.text, 'Last 3 payslips, extra pay left out. 2 paydays a month, from "Semi-Monthly".');
  const rows = netPerPayday(s).map((r, i) => ({ ...r, date: ["2026-10-05", "2026-10-15", "2026-10-30"][i % 3] })).slice(0, 3);
  assert.equal(extraPaydays(rows, payFrequency(rows)).size, 0, "three payslips in a month, but the employer pays semi-monthly: none is extra");
});

test("monthly: one payday a month, the base is that payday's stable pay", () => {
  let s = ledger();
  for (const d of ["2026-08-28", "2026-09-28", "2026-10-28"]) s = slip(s, d, [BASIC(2500000), ["Overtime", 100000]], 500000, "Monthly");
  const b = baseIncome(s);
  assert.equal(b.amount, 2000000, "net 21,000.00 less 1,000.00 overtime");
  assert.equal(b.paydays, 1); assert.match(b.text, /1 payday a month, from "Monthly"/);
});

test("a payslip whose only variable line is Overtime gives the same base as today (deposit less overtime)", () => {
  let s = ledger();
  s = slip(s, "2026-08-07", [BASIC(1000000), ["Overtime", 150000]], 200000);
  s = slip(s, "2026-08-21", [BASIC(1000000)], 200000);
  s = slip(s, "2026-09-04", [BASIC(1000000), ["OT", 50000]], 200000);
  for (const r of netPerPayday(s)) { assert.equal(r.stable, r.base, "stable pay is exactly the old base"); assert.equal(r.variable, r.overtime); }
  assert.equal(baseIncome(s).amount, 1600000);
});

test("an old payslip (no printed lines) keeps today's rule: only its confirmed overtime is left out", () => {
  const s = ledger();
  s.payslips.push({ id: "old", employer: "Sample Employer Inc", period_from: "2026-08-01", period_to: "2026-08-15", pay_date: "2026-08-15", account_id: "chk", transaction_id: "x1", printed_gross: 1300000, printed_net: 1100000, deposit: 1100000 });
  s.payslipLines.push({ payslip_id: "old", side: "earning", kind: "basic", amount: 1000000 }, { payslip_id: "old", side: "earning", kind: "overtime", amount: 300000 }, { payslip_id: "old", side: "deduction", kind: "sss", amount: 200000 });
  const [r] = netPerPayday(s);
  assert.equal(r.stable, 800000); assert.equal(r.stable, r.base);
  assert.deepEqual(stableOf({ deposit: 1100000, items: [], lines: s.payslipLines }).parts.map((p) => p.why), ["overtime"]);
  // holiday pay on an old payslip is NOT recognised (its lines have no such kind): it stays in the base until the printed lines are added
  s.payslipLines = [{ payslip_id: "old", side: "earning", kind: "basic", amount: 1000000 }, { payslip_id: "old", side: "earning", kind: "other", amount: 300000 }, { payslip_id: "old", side: "deduction", kind: "sss", amount: 200000 }];
  assert.equal(netPerPayday(s)[0].stable, 1100000);
});

test("the variable part never exceeds what arrived: stable pay is never negative", () => {
  assert.deepEqual(stableOf({ deposit: 500000, items: [{ section: "earning", label: "Bonus", amount: 900000, category: "bonus" }] }).stable, 0);
});

test("pay frequency: from the period type, else worked out from the pay dates (and said so)", () => {
  assert.equal(periodKind("Bi-Week"), "biweekly"); assert.equal(periodKind("Semi-Monthly"), "semimonthly"); assert.equal(periodKind("Monthly"), "monthly"); assert.equal(periodKind("Weekly"), null); assert.equal(periodKind(""), null);
  assert.equal(inferKind(["2026-08-07", "2026-08-21", "2026-09-04", "2026-09-18"]), "biweekly");
  assert.equal(inferKind(["2026-08-15", "2026-08-30", "2026-09-14", "2026-09-30"]), "semimonthly");
  assert.equal(inferKind(["2026-08-28", "2026-09-28", "2026-10-27"]), "monthly");
  assert.equal(inferKind(["2026-08-07", "2026-08-21"]), null, "two payslips cannot show a pattern");
  let s = ledger();
  for (const d of ["2026-08-07", "2026-08-21", "2026-09-04", "2026-09-18"]) s = slip(s, d, [BASIC(1000000)], 200000, "");
  const b = baseIncome(s);
  assert.equal(b.amount, 1600000); assert.equal(b.frequency.from, "pay dates");
  assert.equal(b.text, "Last 3 payslips, extra pay left out. 2 paydays a month, worked out from your pay dates.");
});

test("the suggestion follows the same stable base, the funding order is unchanged and the lines add up to the income of each payday", () => {
  let s = ledger();
  s.categories.push({ id: "rent", name: "Rent", kind: "expense", role: "rent" }, { id: "food", name: "Food", kind: "expense", role: "food" }, { id: "misc", name: "Misc", kind: "expense" });
  const spend = (date, cat, amount) => { const id = "t" + ++n; s.transactions.push({ id, date, payee: "", memo: "", status: "verified", source: "manual", created_at: "2026-01-01T09:00:00.000+08:00", verified_at: "2026-01-01T09:00:00.000+08:00" }); s.entries.push({ transaction_id: id, category_id: cat, amount }, { transaction_id: id, account_id: "chk", amount: -amount }); };
  for (const m of ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]) { spend(m + "-01", "rent", 400000); spend(m + "-05", "food", 300000); spend(m + "-20", "misc", 100000); }
  // paydays on the 15th and the last day: stable 8,000.00 each; the 15th payday of August and September each carry 3,000.00 of holiday, night and back pay (11,000.00 arrives, so the plain median of the arrivals would be 11,000.00)
  s = slip(s, "2026-08-15", [BASIC(1000000), ["Holiday Pay", 200000, { category: "holiday_night" }], ["Retro Basic", 100000]], 200000, "Semi-Monthly");
  s = slip(s, "2026-08-31", [BASIC(1000000)], 200000, "Semi-Monthly");
  s = slip(s, "2026-07-15", [BASIC(1000000)], 200000, "Semi-Monthly");
  s = slip(s, "2026-07-31", [BASIC(1000000)], 200000, "Semi-Monthly");
  s = slip(s, "2026-09-15", [BASIC(1000000), ["Holiday Pay", 200000, { category: "holiday_night" }], ["Retro Basic", 100000]], 200000, "Semi-Monthly");
  s = slip(s, "2026-09-30", [BASIC(1000000)], 200000, "Semi-Monthly");
  const paydays = [{ id: "first", label: "1st payday", day: 15 }, { id: "second", label: "2nd payday", day: "last" }];
  const r = suggestPlan({ state: s, paydays, today: "2026-10-05", month: "2026-10", rent: 400000 });
  assert.ok(r.ok, r.message);
  assert.deepEqual(r.paydays.map((p) => p.income), [800000, 800000], "median of the last 3 stable pays of each payday: the holiday and back pay never lift it");
  assert.ok(r.paydays.every((p) => p.lines.reduce((a, l) => a + l.amount, 0) + p.unallocated - p.short === p.income), "lines + unallocated - short = income");
  assert.equal(r.paydays[0].incomeReason, "Median of the last 3 payslips, extra pay left out.");
  const total = (name) => r.paydays.reduce((a, p) => a + (p.lines.find((l) => l.name === name)?.amount ?? 0), 0);
  assert.equal(total("Rent"), 400000, "the rent is funded at its usual level before anything else");
  assert.ok(total("Food") >= 300000, "a need is never lowered below its usual level");
  assert.equal(r.funding.shortBy, 0);
});

// ---------- Add printed lines to a payslip saved before every printed line was kept ----------
function oldSlip() {
  const s = ledger();
  s.payslips.push({ id: "old", employer: "Sample Employer Inc", period_from: "2026-08-01", period_to: "2026-08-15", pay_date: "2026-08-15", account_id: "chk", transaction_id: "oldtx", printed_gross: 1300000, printed_net: 1100000, deposit: 1100000, printed_deductions: 200000 });
  s.payslipLines.push({ payslip_id: "old", side: "earning", kind: "basic", amount: 1300000 }, { payslip_id: "old", side: "deduction", kind: "sss", amount: 200000 });
  s.transactions.push({ id: "oldtx", date: "2026-08-15", payee: "Sample Employer Inc", memo: "Payslip", status: "verified", source: "manual", created_at: "2026-08-15T09:00:00.000+08:00", verified_at: "2026-08-15T09:00:00.000+08:00" });
  s.entries.push({ transaction_id: "oldtx", account_id: "chk", amount: 1100000 }, { transaction_id: "oldtx", category_id: "cat-salary", amount: -1100000 });
  return s;
}
const lines = (...rows) => rows.map(([section, label, amount, o]) => it(section, label, amount, o));

test("Add printed lines: lines that reconcile are added with a record; the pay, its entry and every balance stay exactly as they were; stable pay then uses them", () => {
  const s = oldSlip(), before = JSON.stringify([s.transactions, s.entries, s.payslips, s.payslipLines]);
  assert.equal(netPerPayday(s)[0].stable, 1100000, "today's rule: no overtime line, so the whole deposit");
  const r = addPrintedLines(s, "old", { items: lines(["earning", "Basic Salary", 1000000, { category: "salary" }], ["earning", "Holiday Pay", 200000, { category: "holiday_night" }], ["earning", "Retro Basic", 100000], ["deduction", "SSS", 200000]) }, NOW);
  assert.ok(r.ok, JSON.stringify(r.violations));
  assert.equal(JSON.stringify([r.state.transactions, r.state.entries, r.state.payslips, r.state.payslipLines]), before, "transactions, entries, the payslip and its lines are untouched");
  assert.equal(r.state.transactions.length, s.transactions.length, "transaction count unchanged");
  assert.equal(itemsOf(r.state, "old").length, 4);
  assert.equal(netPerPayday(r.state)[0].stable, 800000, "from then on the payslip uses the stable-pay rule: 11,000 less 3,000 variable");
  assert.equal(netPerPayday(r.state)[0].net, 1100000, "the money in is still the deposit");
  assert.deepEqual(r.state.payslipRevisions.map((x) => [x.id, x.change, x.changed_on]), [["old-r1", "Breakdown added", "2026-10-31"]]);
  assert.deepEqual(revisionChanges(r.state, "old")[0].changes, ["Breakdown added"]);
  assert.equal(validateState(r.state).filter((v) => v.severity === "error").length, 0);
});

test("Add printed lines: lines that do not reconcile are refused with the difference (Check this); a payslip that already has lines is refused", () => {
  const s = oldSlip();
  const off = addPrintedLines(s, "old", { items: lines(["earning", "Basic Salary", 1000000, { category: "salary" }], ["deduction", "SSS", 200000]) }, NOW);
  assert.equal(off.ok, false); assert.equal(off.violations[0].code, "DOES_NOT_RECONCILE"); assert.match(off.violations[0].message, /differ from this payslip by ₱3,000\.00/);
  assert.equal(off.state.payslipItems.length, 0, "nothing was added");
  const netOff = addPrintedLines(s, "old", { items: lines(["earning", "Basic Salary", 1300000, { category: "salary" }], ["deduction", "SSS", 150000]) }, NOW);
  assert.equal(netOff.ok, false, "net 11,500 is not the payslip's 11,000");
  const ok = addPrintedLines(s, "old", { items: lines(["earning", "Basic Salary", 1300000, { category: "salary" }], ["deduction", "SSS", 200000]) }, NOW);
  assert.ok(ok.ok);
  assert.equal(addPrintedLines(ok.state, "old", { items: lines(["earning", "Basic Salary", 1300000], ["deduction", "SSS", 200000]) }, NOW).violations[0].code, "HAS_LINES");
  assert.equal(addPrintedLines(s, "nope", { items: [] }, NOW).violations[0].code, "UNKNOWN_PAYSLIP");
});

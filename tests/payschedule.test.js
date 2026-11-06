import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as M from "../src/model/index.js";
import { UNLOGGED_CATEGORY_ID } from "../src/model/seed.js";
import { makeState, account } from "./fixtures.js";

// P0-6 PR 3: the pay schedule (twice a month on any two days, every two weeks from one payday, once a month, every week). Invented dates and numbers.
const TS = "2026-01-01T09:00:00.000+08:00", NOW = new Date("2026-10-05T03:00:00Z"), MONTH = "2026-10";
let n = 0; const nid = () => "r" + ++n;
function ledger() {
  const s = makeState();
  s.accounts = [account({ id: "chk", name: "Test Checking", class: "asset", opening_balance: 100000000 })];
  s.categories = [{ id: "food", name: "Food", kind: "expense", role: "food" }, { id: "rent", name: "Rent", kind: "expense", role: "rent" }, { id: UNLOGGED_CATEGORY_ID, name: "Uncategorized", kind: "expense" }, { id: "pay", name: "Pay", kind: "income" }];
  s.payslips = []; s.payslipLines = []; s.subscriptions = []; s.rules = []; s.goals = [];
  return M.planBudgetChange(M.planBudgetChange(s, { id: nid(), category_id: "food", amount: 600000, from_month: MONTH }, NOW).state, { id: nid(), category_id: "rent", amount: 900000, from_month: MONTH }, NOW).state;
}
const dates = (set) => M.paydaysFor(set, MONTH).map((p) => [p.date, p.label, Boolean(p.extra)]);

test("the four kinds give the month's real paydays", () => {
  assert.deepEqual(dates({ pay_schedule: { kind: "twice", days: [10, 25] } }), [["2026-10-10", "10th", false], ["2026-10-25", "25th", false]], "any two days of the month");
  assert.deepEqual(dates({ pay_schedule: { kind: "monthly", days: ["last"] } }), [["2026-10-31", "Payday", false]]);
  assert.deepEqual(dates({ pay_schedule: { kind: "weekly", weekday: 5 } }).map((d) => d[0]), ["2026-10-02", "2026-10-09", "2026-10-16", "2026-10-23", "2026-10-30"], "every Friday: five in October 2026");
  assert.deepEqual(M.paydaysFor({ pay_schedule: { kind: "weekly", weekday: 5 } }, "2026-11").length, 4, "four in November");
  assert.deepEqual(dates({ pay_schedule: { kind: "biweekly", start: "2026-09-04" } }), [["2026-10-02", "2nd", false], ["2026-10-16", "16th", false], ["2026-10-30", "30th (extra)", true]], "every two weeks from Sep 4: three in October, the third is extra");
  assert.deepEqual(dates({ pay_schedule: { kind: "biweekly", start: "2027-01-08" } }).map((d) => d[0]), ["2026-10-02", "2026-10-16", "2026-10-30"], "a start date in the future works backwards the same way");
  assert.deepEqual(dates({ pay_schedule: { days: [15, "last"] } }), [["2026-10-15", "15th", false], ["2026-10-31", "Last day", false]], "an older {days} reads as twice a month");
  assert.deepEqual(dates({}), [], "no schedule: no paydays (only Month is offered)");
});

test("an EXTRA bi-weekly payday shows its own pay but takes no share of any line, and its pay is not in the month's income", () => {
  const set = { pay_schedule: { kind: "biweekly", start: "2026-09-04" }, income_base_pin: 3000000 };
  const v = M.budgetPlan(ledger(), set, MONTH);
  assert.deepEqual(v.perPayday.map((p) => p.income), [1500000, 1500000, 1500000], "30,000.00 a month shared by the two regular paydays; the extra one shows the same pay");
  assert.equal(v.monthView.income, 3000000, "the extra pay is not in the month");
  assert.deepEqual(v.perPayday.map((p) => p.rows.find((r) => r.key === "food").amount), [300000, 300000, 0], "Food 6,000.00 is shared by the regular paydays only");
  assert.equal(v.perPayday[2].left, 1500000, "the extra payday's pay is all Left");
  for (const l of v.lines) assert.equal(v.perPayday.reduce((a, p) => a + p.rows.find((r) => r.key === l.key).amount, 0), l.amount, l.key + " adds up to its month");
});

test("weekly: five Fridays share the month exactly (rounded down, the last takes the rest); a pin and a move use the regular paydays", () => {
  const set = { pay_schedule: { kind: "weekly", weekday: 5 }, income_base_pin: 3000000 };
  const v = M.budgetPlan(ledger(), set, MONTH);
  assert.deepEqual(v.perPayday.map((p) => p.income), [600000, 600000, 600000, 600000, 600000]);
  assert.deepEqual(v.perPayday.map((p) => p.rows.find((r) => r.key === "food").amount), [120000, 120000, 120000, 120000, 120000]);
  const odd = M.budgetPlan(M.planBudgetChange(ledger(), { id: nid(), category_id: "food", amount: 600003, from_month: MONTH }, NOW).state, set, MONTH);
  assert.deepEqual(odd.perPayday.map((p) => p.rows.find((r) => r.key === "food").amount), [120000, 120000, 120000, 120000, 120003], "three odd centavos go to the last Friday, none lost");
  const pinned = M.budgetPlan(ledger(), { ...set, payday_pins: { rent: 4 } }, MONTH);
  assert.deepEqual(pinned.perPayday.map((p) => p.rows.find((r) => r.key === "rent").amount), [0, 0, 0, 0, 900000], "rent whole on the last Friday");
  const line = v.lines.find((l) => l.key === "food"), r = M.movePayday(set, line, v.regularIncomes, 0, 1, 20000);
  assert.deepEqual(r.amounts, [100000, 140000, 120000, 120000, 120000]);
});

test("cutoffs follow the real dates: each payday to the day before the next, the last into next month's first payday", () => {
  const p = M.paydayProgress(ledger(), { pay_schedule: { kind: "biweekly", start: "2026-09-04" } }, MONTH);
  assert.deepEqual(p.map((x) => [x.start, x.end]), [["2026-10-02", "2026-10-15"], ["2026-10-16", "2026-10-29"], ["2026-10-30", "2026-11-12"]]);
  const w = M.paydayProgress(ledger(), { pay_schedule: { kind: "twice", days: [15, "last"] } }, MONTH);
  assert.deepEqual(w.map((x) => [x.start, x.end]), [["2026-10-15", "2026-10-30"], ["2026-10-31", "2026-11-14"]], "the same cutoffs as before for twice a month");
});

test("the Paydays window is filled from the payslips: their own words, bi-weekly from the newest pay date, twice a month from the last two days", () => {
  const s = ledger(), slip = (date, type) => { const id = "p" + ++n; s.payslips.push({ id, employer: "Test Co", period_from: date, period_to: date, pay_date: date, account_id: "chk", transaction_id: "x" + n, printed_gross: 1500000, printed_net: 1500000, deposit: 1500000, ...(type ? { period_type: type } : {}) }); s.payslipLines.push({ payslip_id: id, side: "earning", kind: "basic", amount: 1500000 }); };
  slip("2026-09-04", "Bi-Week"); slip("2026-09-18", "Bi-Week"); slip("2026-10-02", "Bi-Week");
  assert.deepEqual(M.scheduleFromPayslips(s), { schedule: { kind: "biweekly", start: "2026-10-02" }, label: "Bi-Week" });
  const t = ledger(); const slip2 = (date) => { const id = "q" + ++n; t.payslips.push({ id, employer: "Test Co", period_from: date, period_to: date, pay_date: date, account_id: "chk", transaction_id: "y" + n, printed_gross: 1, printed_net: 1, deposit: 100000 }); t.payslipLines.push({ payslip_id: id, side: "earning", kind: "basic", amount: 100000 }); };
  for (const m of ["2026-07", "2026-08", "2026-09"]) { slip2(m + "-10"); slip2(m + "-25"); }
  assert.deepEqual(M.scheduleFromPayslips(t).schedule, { kind: "twice", days: [10, 25] });
  assert.equal(M.scheduleFromPayslips(ledger()), null, "no payslips: nothing to suggest");
});

test("the screen offers the four kinds and saves each shape", () => {
  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
  for (const t of ["Twice a month", "Every two weeks", "Once a month", "Every week"]) assert.ok(app.includes(`"${t}")`), t);
  assert.match(app, /schedule = \{ kind: "biweekly", start: f\.start \}/); assert.match(app, /schedule = \{ kind: "weekly", weekday: f\.weekday \}/);
  assert.match(app, /const moveBtn = per === "payday" && !block\.extra && bvNextReg\(v, w\) && left < 0/, "the move offer never goes from or to an extra payday, and never into the next month");
});

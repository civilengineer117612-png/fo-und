import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as M from "../src/model/index.js";
import { replaceWithCopy, copyHolds, emptyLedger, nextLedger } from "../src/model/index.js";
import { UNLOGGED_CATEGORY_ID } from "../src/model/seed.js";
import { makeState, account } from "./fixtures.js";

// P0-6 PR 2: ONE Budget: a single monthly figure per category, shown as Month, Per payday and Per week. Invented numbers, worked by hand. 100000 is 1,000.00.
const TS = "2026-01-01T09:00:00.000+08:00", NOW = new Date("2026-10-05T03:00:00Z"), MONTH = "2026-10";
let n = 0; const nid = () => "r" + ++n;
function ledger() {
  const s = makeState();
  s.accounts = [account({ id: "chk", name: "Test Checking", class: "asset", opening_balance: 100000000 })];
  s.categories = [{ id: "food", name: "Food", kind: "expense", role: "food" }, { id: "rent", name: "Rent", kind: "expense", role: "rent" }, { id: "fun", name: "Fun", kind: "expense" },
    { id: "games", name: "Games", kind: "expense" }, { id: UNLOGGED_CATEGORY_ID, name: "Uncategorized", kind: "expense" }, { id: "pay", name: "Pay", kind: "income" }];
  s.payslips = []; s.payslipLines = []; s.subscriptions = []; s.rules = [];
  s.goals = [{ id: "trip", name: "Trip", account_id: "chk", hidden_by_default: false }];
  for (const m of ["2026-07", "2026-08", "2026-09"]) for (const [d, v] of [[`${m}-15`, 1200000], [`${m}-30`, 1800000]]) {
    const id = "p" + ++n; s.payslips.push({ id, employer: "Test Co", period_from: d, period_to: d, pay_date: d, account_id: "chk", transaction_id: "x" + n, printed_gross: v, printed_net: v, deposit: v });
    s.payslipLines.push({ payslip_id: id, side: "earning", kind: "basic", amount: v });
  }
  return s;
}
const budget = (s, cat, amount, from = MONTH) => M.planBudgetChange(s, { id: nid(), category_id: cat, amount, from_month: from }, NOW).state;
function base({ food = 500000, rent = 600000, fun = 150000 } = {}) { let s = ledger(); s = budget(s, "food", food); s = budget(s, "rent", rent); s = budget(s, "fun", fun); return s; }
const SET = { pay_schedule: { days: [15, "last"] } };
const view = (s, set = SET) => M.budgetPlan(s, set, MONTH);
const row = (rows, key) => rows.find((r) => r.key === key);

test("two uneven paydays 12,000.00 and 18,000.00: Food 5,000.00 a month is 2,000.00 and 3,000.00 on the paydays, 5,000.00 for the Month, and 5,000.00 x 12 / 52 a week", () => {
  const v = view(base());
  assert.deepEqual(v.perPayday.map((p) => p.income), [1200000, 1800000]);
  assert.equal(v.income.amount, 3000000, "one income: 30,000.00");
  assert.deepEqual(v.perPayday.map((p) => row(p.rows, "food").amount), [200000, 300000], "shared by what each payday brings in, never 5,000.00 on each");
  assert.equal(row(v.monthView.rows, "food").amount, 500000);
  assert.equal(row(v.perWeek.rows, "food").amount, 115384, "5,000.00 x 12 / 52 = 1,153.84 (115,384.6 centavos, rounded down)");
  assert.ok(v.perWeek.roundedAway >= 0 && v.perWeek.roundedAway < 100, "what the rounding leaves out is stated");
});

test("Rent 6,000.00 pinned to the second payday is 0.00 and 6,000.00; the month figure stays 6,000.00", () => {
  const v = view(base(), { ...SET, payday_pins: { rent: 1 } });
  assert.deepEqual(v.perPayday.map((p) => row(p.rows, "rent").amount), [0, 600000]);
  assert.equal(row(v.monthView.rows, "rent").amount, 600000);
  assert.deepEqual(M.pinPayday({ payday_pins: { rent: 1 }, budget_split: { rent: { amounts: [1, 2], for: 3 } } }, "rent", null), { budget_split: {}, payday_pins: {} }, "unpinning is plain");
});

test("moving 500.00 of Food from payday 2 to payday 1 keeps the month at 5,000.00; a changed budget drops a split that no longer adds up", () => {
  const s = base(), line = row(view(s).lines, "food"), incomes = [1200000, 1800000];
  const r = M.movePayday(SET, line, incomes, 1, 0, 50000);
  assert.ok(r.ok); assert.deepEqual(r.amounts, [250000, 250000]);
  const v = view(s, r.settings);
  assert.deepEqual(v.perPayday.map((p) => row(p.rows, "food").amount), [250000, 250000]); assert.equal(row(v.monthView.rows, "food").amount, 500000);
  const bigger = view(budget(s, "food", 600000, MONTH), r.settings);
  assert.deepEqual(bigger.perPayday.map((p) => row(p.rows, "food").amount), [240000, 360000], "the budget changed, so the old split is not used: income shares again");
  assert.equal(M.movePayday(SET, line, incomes, 1, 0, 400000).ok, false, "payday 2 holds only 3,000.00 of it");
  assert.equal(M.movePayday(SET, line, incomes, 0, 0, 100).ok, false);
});

test("EVERY view adds up: each line's payday shares add to its month, each payday to its income less Left, the paydays to the month", () => {
  let s = base(); s = { ...s };
  const set = { ...SET, goal_monthly: { trip: 300000 }, buffer_monthly: 150000, payday_pins: { rent: 1 } };
  const v = M.budgetPlan(s, set, MONTH);
  for (const l of v.lines) assert.equal(sum(v.perPayday.map((p) => row(p.rows, l.key).amount)), l.amount, l.key + ": the shares add to the month exactly");
  assert.ok(v.lines.some((l) => l.key === "goal:trip") && v.lines.some((l) => l.key === "buffer"), "savings and the buffer are in every view");
  for (const p of v.perPayday) assert.equal(p.placed + p.left, p.income);
  assert.equal(sum(v.perPayday.map((p) => p.placed)), v.monthView.placed); assert.equal(sum(v.perPayday.map((p) => p.left)), v.monthView.left);
  assert.equal(v.monthView.placed + v.monthView.left, v.monthView.income);
  assert.equal(v.perWeek.placed + v.perWeek.left, v.perWeek.income);
});
const sum = (l) => l.reduce((a, b) => a + b, 0);

test("a hidden category with history gets 0 and no line anywhere; it is only listed apart", () => {
  let s = base(); s = budget(s, "games", 200000);
  const v = view(s, { ...SET, hidden_categories: ["games"] });
  assert.ok(![...v.lines, ...v.monthView.rows, ...v.perPayday.flatMap((p) => p.rows), ...v.perWeek.rows].some((r) => r.key === "games"));
  assert.deepEqual(v.hidden.map((h) => h.id), ["games"]);
  assert.equal(v.monthView.placed, 500000 + 600000 + 150000, "and its budget is in no total");
});

test("editing one payday's amount changes the month: Food on the first payday 3,000.00 makes 6,000.00 from this month; earlier months keep their budget", () => {
  const s = base(), line = row(view(s).lines, "food"), incomes = [1200000, 1800000];
  const r = M.setPaydayAmount(s, SET, line, incomes, 0, 300000, { newId: nid, now: NOW, month: MONTH });
  assert.ok(r.ok); assert.equal(r.total, 600000);
  assert.equal(M.budgetFor(r.state.rules, "food", MONTH), 600000); assert.equal(M.budgetFor(r.state.rules, "food", "2026-09"), null, "the past month has the budget it had");
  assert.deepEqual(r.settings.budget_split.food, { amounts: [300000, 300000], for: 600000 });
  assert.equal(r.state.rules.length, s.rules.length + 1, "append-only: one new rule, none edited");
});

// ---- the Pay plan moves into Budget ----
const PLAN = (lines, income = [1000000, 1000000]) => M.parsePlan(JSON.stringify({ schema_version: 1, unit: "PHP_centavos", effective_from: "2026-10-01",
  paydays: [{ label: "1st", day: 15, expected_income: income[0] }, { label: "2nd", day: "last", expected_income: income[1] }], lines })).plan;
const planLines = [{ name: "Food", kind: "expense", first: 300000, second: 300000 }, { name: "Fun", kind: "expense", first: 100000, second: 50000 },
  { name: "Trip", kind: "goal", first: 200000, second: 100000 }, { name: "Buffer", kind: "buffer", first: 50000, second: 50000 }];
const oldData = () => { const plan = PLAN(planLines, [650000, 500000 + 0]); assert.ok(plan, "the invented plan parses"); return plan; };

test("old Pay plan data (Food 3,000.00 on each payday) moves to a monthly 6,000.00 with shares 3,000.00 / 3,000.00; nothing is lost", () => {
  const plan = oldData(), s = ledger();
  const settings = { plans: [plan], income_base_pin: 3000000 };
  const rv = M.planMigrationReview(s, settings, MONTH);
  assert.equal(rv.rows.length, 2, "Food and Fun are in the plan but have no budget yet: both listed"); assert.equal(rv.rows.every((r) => r.default === "plan"), true, "no budget: the plan's figure is used, nothing for the bucket to win");
  assert.deepEqual(rv.goals.map((g) => [g.goal_id, g.amount]), [["trip", 300000]]); assert.equal(rv.buffer, 100000);
  const r = M.applyPlanMigration(s, settings, {}, { newId: nid, now: NOW, month: MONTH });
  assert.ok(r.ok);
  assert.equal(M.budgetFor(r.state.rules, "food", MONTH), 600000); assert.deepEqual(r.settings.budget_split.food, { amounts: [300000, 300000], for: 600000 });
  assert.equal(M.budgetFor(r.state.rules, "fun", MONTH), 150000); assert.deepEqual(r.settings.budget_split.fun.amounts, [100000, 50000]);
  assert.equal(r.settings.goal_monthly.trip, 300000); assert.equal(r.settings.buffer_monthly, 100000); assert.equal(r.settings.plan_moved, MONTH);
  assert.deepEqual(r.settings.pay_schedule, { days: [15, "last"] }, "the paydays are kept");
  assert.deepEqual(r.settings.plans, [plan], "the old plan is still there, untouched");
  assert.equal(M.budgetFor(r.state.rules, "food", "2026-09"), null, "past months keep the budgets they had");
  const v = M.budgetPlan(r.state, { ...r.settings, income_base_pin: undefined }, MONTH);
  assert.deepEqual(v.perPayday.map((p) => row(p.rows, "food").amount), [300000, 300000], "the shares are the old amounts");
  assert.equal(M.planMigrationReview(r.state, r.settings, MONTH).done, true, "and it is done once");
  assert.equal(M.applyPlanMigration(r.state, r.settings, {}, { newId: nid, now: NOW, month: MONTH }).ok, false);
});

test("where the bucket and the plan disagree the BUCKET wins by default; one choice per category switches it to the plan; the agreeing ones are not asked", () => {
  const plan = oldData(); let s = ledger();
  s = budget(s, "food", 300000);      // the bucket says 3,000.00 once (the plan holds 3,000.00 on EACH payday: 6,000.00): disagree
  s = budget(s, "fun", 150000);       // 1,500.00: the plan's 1,000.00 + 500.00 agree
  const settings = { plans: [plan] }, rv = M.planMigrationReview(s, settings, MONTH);
  assert.deepEqual(rv.rows.map((r) => [r.name, r.plan, r.budget, r.default]), [["Food", 600000, 300000, "bucket"]]); assert.equal(rv.agree, 1);
  const keep = M.applyPlanMigration(s, settings, {}, { newId: nid, now: NOW, month: MONTH });
  assert.equal(M.budgetFor(keep.state.rules, "food", MONTH), 300000, "the bucket stays");
  assert.deepEqual(M.budgetPlan(keep.state, { ...keep.settings }, MONTH).perPayday.map((p) => row(p.rows, "food").amount).reduce((a, b) => a + b, 0), 300000, "its shares still add to the month");
  const sw = M.applyPlanMigration(s, settings, { food: "plan" }, { newId: nid, now: NOW, month: MONTH });
  assert.equal(M.budgetFor(sw.state.rules, "food", MONTH), 600000); assert.deepEqual(sw.settings.budget_split.food, { amounts: [300000, 300000], for: 600000 });
  assert.deepEqual(keep.settings.budget_split.fun, { amounts: [100000, 50000], for: 150000 }, "an agreeing category keeps the plan's own shares");
});

test("SAFETY COPY: the move goes through the copy mechanism: the ledger is kept and read back first, and a copy that fails stops the move", async () => {
  const s = ledger(), plan = oldData(), current = emptyLedger(); current.rev = 3; current.saved_at = TS; current.state = s; current.settings = { plans: [plan] };
  const r = M.applyPlanMigration(s, current.settings, {}, { newId: nid, now: NOW, month: MONTH });
  const next = nextLedger(current, r.state, r.settings);
  const phone = (o = {}) => { const p = { copies: [], text: null, writes: 0, ...o }; p.io = { readCopies: async () => p.copies, writeCopies: async (l) => { if (p.failCopy) return { local: false, idb: false }; p.copies = l; return { local: true, idb: true }; }, writeLedger: async (t) => { p.writes++; p.text = t; return { local: true, idb: true }; } }; return p; };
  const p = phone(), done = await replaceWithCopy({ current, next, io: p.io, meta: { at: "2026-11-02T12:00:00+08:00", from_version: current.v, build: "test", kind: "repair" } });
  assert.equal(done.ok, true); assert.equal(done.copied, true); assert.equal(p.copies[0].kind, "repair"); assert.deepEqual(JSON.parse(p.copies[0].text), current, "the copy is the ledger as it was"); assert.equal(copyHolds(p.copies[0], current), true);
  assert.equal(JSON.parse(p.text).settings.plan_moved, MONTH);
  const bad = phone({ failCopy: true }), stopped = await replaceWithCopy({ current, next, io: bad.io, meta: { at: "x", from_version: current.v, build: "test", kind: "repair" } });
  assert.equal(stopped.ok, false); assert.equal(bad.writes, 0, "no copy, no move");
  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8"), run = app.slice(app.indexOf('case "plan-move-run": {'), app.indexOf('case "plan-move-run": {') + 1400);
  assert.match(run, /M\.replaceWithCopy\(\{ current: ledger, next, io: \{ readCopies, writeCopies, writeLedger/, "the screen's move uses the same copy list as an upgrade"); assert.match(run, /kind: "repair"/);
});

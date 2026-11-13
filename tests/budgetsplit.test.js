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
  assert.deepEqual(r.settings.pay_schedule, { kind: "twice", days: [15, "last"] }, "the paydays are kept");
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

// ---- cutoff progress and pay received stay (they were on the old Pay plan screen) ----
test("CUTOFF PROGRESS: per payday, what was verified-spent in that payday's own dates and what arrived; drafts, other cutoffs and held gaps do not count", () => {
  const s = ledger(), TSX = "2026-10-01T09:00:00.000+08:00";
  const tx = (id, date, status = "verified") => s.transactions.push({ id, date, payee: "", memo: "", status, source: "manual", created_at: TSX, ...(status === "verified" ? { verified_at: TSX } : {}) });
  const spend = (id, date, amount, status) => { tx(id, date, status); s.entries.push({ transaction_id: id, category_id: "food", amount }, { transaction_id: id, account_id: "chk", amount: -amount }); };
  spend("a", "2026-10-10", 100000);                  // before the 15th: the earlier cutoff
  spend("b", "2026-10-16", 400000);                  // first cutoff (15th to the 30th)
  spend("c", "2026-10-20", 50000, "draft");          // a draft is not spending yet
  spend("d", "2026-10-31", 300000);                  // second cutoff (the last day to Nov 14)
  spend("e", "2026-11-14", 20000);                   // still the second cutoff
  spend("f", "2026-11-15", 999999);                  // the next month's first cutoff
  tx("p", "2026-10-15"); s.entries.push({ transaction_id: "p", account_id: "chk", amount: 1200000 }, { transaction_id: "p", category_id: "pay", amount: -1200000 });
  const prog = M.paydayProgress(s, SET, MONTH);
  assert.deepEqual(prog.map((p) => [p.start, p.end]), [["2026-10-15", "2026-10-30"], ["2026-10-31", "2026-11-14"]]);
  assert.deepEqual(prog.map((p) => p.spent.food), [400000, 320000], "verified spending in each payday's own dates, nothing from the neighbours");
  assert.deepEqual(prog.map((p) => p.received), [1200000, 0], "the pay that really arrived, in the payday it came in");
  assert.deepEqual(M.paydayProgress(s, {}, MONTH), [], "with no paydays there is no cutoff");
  const withBudget = M.budgetPlan(budget(s, "food", 500000), SET, MONTH);
  assert.equal(withBudget.perPayday[0].rows.find((r) => r.key === "food").amount - prog[0].spent.food, 200000 - 400000, "the share less the spent is what the screen says: 1,419.36 style over, here 2,000.00 over");
});

test("the screen keeps Record pay received and the spent-so-far line on every category of a payday", () => {
  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
  const view = app.slice(app.indexOf("function viewBudget()"), app.indexOf("const rowWhy"));
  assert.ok(view.includes('${per === "week" ? "" : `<button class="act" data-action="open-income">Record pay received</button>`}'), "pay received is recorded from Budget, in Month and Per payday (a compact button beside Add to savings, owner's marks Nov 11)");
  assert.match(app, /M\.paydayProgress\(S\(\), set, month, \{ categoryMaps: S\(\)\.categoryMaps \}\)/);
  assert.match(app, /Spent \$\{peso\(sp\)\} \\u00b7 \$\{d >= 0 \? peso\(d\) \+ " left" : peso\(-d\) \+ " over"\}/);
});

test("EXPECTED, RECEIVED, DIFFERENCE: each payday header and the month say what was expected and what pay was logged; Received stays blank until pay is logged", () => {
  const s = ledger(), TSX = "2026-10-01T09:00:00.000+08:00";
  assert.deepEqual(M.payHeader(1200000, 0, 0), { expected: 1200000, received: null, difference: null }, "no pay logged: Received and Difference are blank");
  assert.deepEqual(M.payHeader(1200000, 1000000, 1), { expected: 1200000, received: 1000000, difference: -200000 }, "10,000.00 against 12,000.00 expected: 2,000.00 less");
  assert.equal(M.payHeader(1200000, 1250000, 2).difference, 50000, "more than expected is a positive difference");
  const pay = (id, date, amount, status = "verified") => { s.transactions.push({ id, date, payee: "", memo: "", status, source: "manual", created_at: TSX, ...(status === "verified" ? { verified_at: TSX } : {}) }); s.entries.push({ transaction_id: id, account_id: "chk", amount }, { transaction_id: id, category_id: "pay", amount: -amount }); };
  assert.deepEqual(M.monthPay(s, MONTH), { received: 0, count: 0 });
  pay("p1", "2026-10-15", 1000000);        // the first payday's pay
  pay("p2", "2026-10-31", 1800000);        // the second payday's pay, on the last day
  pay("p3", "2026-10-20", 500000, "draft");    // a draft is not pay yet
  pay("p4", "2026-09-30", 777700);         // last month's pay
  assert.deepEqual(M.monthPay(s, MONTH), { received: 2800000, count: 2 }, "the month's logged pay: 28,000.00 (the draft and September's pay are not in it)");
  const prog = M.paydayProgress(s, SET, MONTH);
  assert.deepEqual(prog.map((p) => [p.received, p.count]), [[1000000, 1], [1800000, 1]], "each payday's pay by its own dates (the last day's pay belongs to the second payday)");
  const v = M.budgetPlan(s, SET, MONTH);
  assert.deepEqual(M.payHeader(v.perPayday[0].income, prog[0].received, prog[0].count), { expected: 1200000, received: 1000000, difference: -200000 }, "the first payday: expected 12,000.00, received 10,000.00, 2,000.00 less");
  assert.deepEqual(M.payHeader(v.monthView.income, 2800000, 2), { expected: 3000000, received: 2800000, difference: -200000 }, "the month: expected 30,000.00, received 28,000.00");
  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8"), view = app.slice(app.indexOf("function viewBudget()"), app.indexOf("const rowWhy"));
  assert.match(view, /Expected \$\{peso\(payHead\.expected\)\} \\u00b7 Received \$\{payHead\.received === null \? "\\u2013" : peso\(payHead\.received\)\} \\u00b7 Difference/);
});

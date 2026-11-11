import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { splitSavings, placeSurplus, parseShares, shareableGoals, monthlyNeed, UNPLACED_NAME, suggestBudgets, shares, savedRows } from "../src/model/index.js";
import { UNLOGGED_CATEGORY_ID } from "../src/model/seed.js";
import { makeState, account } from "./fixtures.js";

// Invented numbers only. 100 centavos = 1 peso.
const g = (id, o = {}) => ({ id, name: id.toUpperCase(), ...o });
const prog = (id, { target = null, balance = 0 } = {}) => [id, { goal_id: id, balance, target, remaining: target == null ? null : Math.max(0, target - balance), reached: target != null && balance >= target }];
const split = (goals, p, o = {}) => splitSavings({ goals, progress: new Map(p), month: "2026-10", total: 100000, ...o });
const by = (r) => Object.fromEntries(r.parts.map((x) => [x.goal_id ?? x.name, x.amount]));
const sum = (r) => r.parts.reduce((n, x) => n + x.amount, 0);

test("with no goal at all nothing is placed: the whole amount stays Left, not assigned", () => {
  const r = split([], []);
  assert.deepEqual(r.parts, []); assert.equal(r.leftover, 100000);
});

test("goals with no target have no need: they get nothing by themselves, and the money stays Left", () => {
  const r = split([g("a"), g("b"), g("c")], [prog("a"), prog("b"), prog("c")], { total: 100001 });
  assert.deepEqual(by(r), { a: 0, b: 0, c: 0 }); assert.equal(r.leftover, 100001);
  assert.equal(sum(r) + r.leftover, 100001, "the parts and what is left add up to the money, exactly");
});

test("the percentages are NOT used when the money is split: what covers every need is paid, and the rest stays Left", () => {
  const goals = [g("a"), g("b")], p = [prog("a", { target: 120000 }), prog("b", { target: 240000 })];   // needs 10,000 and 20,000
  const r = split(goals, p, { shares: { a: 7000, b: 3000 } });
  assert.deepEqual(by(r), { a: 10000, b: 20000 }); assert.equal(r.leftover, 70000);
});

test("a typed amount pins: that goal gets exactly it, out of the total first", () => {
  const goals = [g("a"), g("b"), g("c")], p = [prog("a"), prog("b", { target: 120000 }), prog("c", { target: 240000 })];
  const r = split(goals, p, { pins: { a: 40000 } });   // 60,000 left; needs 10,000 and 20,000
  assert.deepEqual(by(r), { a: 40000, b: 10000, c: 20000 }); assert.equal(r.parts.find((x) => x.goal_id === "a").pinned, true); assert.equal(r.leftover, 30000);
  const more = split([g("a"), g("b")], [prog("a"), prog("b", { target: 120000 })], { pins: { a: 150000 } });
  assert.deepEqual(by(more), { a: 150000, b: 0 }, "typing more than the total is the owner's doing; the others get nothing");
  assert.equal(sum(more), 150000); assert.equal(more.leftover, 0);
  const reached = split([g("a"), g("b")], [prog("a", { target: 1000, balance: 1000 }), prog("b", { target: 120000 })], { pins: { a: 20000 } });
  assert.deepEqual(by(reached), { a: 20000, b: 10000 }, "a typed amount counts even for a goal at its target");
  assert.equal(split([g("a")], [prog("a")], { pins: { a: 0 } }).parts[0].amount, 0, "typing 0 is a typed amount");
});

test("a goal with a finish date is sized to make it, and never takes more than what is left", () => {
  const goals = [g("trip", { deadline: "2027-01-31" }), g("b")];
  const p = [prog("trip", { target: 120000, balance: 0 }), prog("b")];
  const r = split(goals, p);   // from 2026-10 to 2027-01 is 3 months: 40000 a month
  assert.deepEqual(by(r), { trip: 40000, b: 0 }); assert.equal(r.leftover, 60000);
  const tight = split(goals, p, { total: 25000 });
  assert.deepEqual(by(tight), { trip: 25000, b: 0 }); assert.equal(tight.leftover, 0);
});

test("the emergency fund's need is its gap over 12 months; the rest of the money stays Left; no target means no need", () => {
  const goals = [g("b"), g("ef", { role: "emergency" })];
  const r = split(goals, [prog("b"), prog("ef", { target: 130000, balance: 100000 })]);   // gap 30,000 / 12 = 2,500
  assert.deepEqual(by(r), { ef: 2500, b: 0 }); assert.equal(r.leftover, 97500);
  const open = split(goals, [prog("b"), prog("ef")]);
  assert.deepEqual(by(open), { ef: 0, b: 0 }, "no target at all: it has no need, and nothing is placed by itself"); assert.equal(open.leftover, 100000);
  const full = split(goals, [prog("b"), prog("ef", { target: 130000, balance: 130000 })]);
  assert.deepEqual(by(full), { b: 0 }, "a goal at its target gets nothing");
  const formula = split(goals, [prog("b"), prog("ef")], { emergencyTarget: 240000 });   // the formula target stands in when none is typed: 240,000 / 12 = 20,000
  assert.deepEqual(by(formula), { ef: 20000, b: 0 });
  const typedWins = split(goals, [prog("b"), prog("ef", { target: 120000 })], { emergencyTarget: 240000 });
  assert.deepEqual(by(typedWins), { ef: 10000, b: 0 }, "a typed target wins over the formula");
});

test("the monthly need: a finish date sizes it, no finish date is the gap over 12 months, no target or a reached goal needs nothing", () => {
  const dated = monthlyNeed({ id: "t", deadline: "2027-01-31" }, { target: 120000, balance: 0, remaining: 120000 }, "2026-10");
  assert.deepEqual([dated.need, dated.basis], [40000, "date"]);
  const open = monthlyNeed({ id: "o" }, { target: 100000, balance: 1, remaining: 99999 }, "2026-10");
  assert.deepEqual([open.need, open.basis], [8334, "twelve"], "99,999 / 12 = 8,333.25, rounded up");
  assert.equal(monthlyNeed({ id: "n" }, { target: null, balance: 5, remaining: null }, "2026-10").need, 0);
  assert.equal(monthlyNeed({ id: "d" }, { target: 100, balance: 100, remaining: 0 }, "2026-10").need, 0);
});

test("when the money cannot cover every need: the emergency fund first, then the rest pro rata to need, exactly", () => {
  const goals = [g("a"), g("b"), g("ef", { role: "emergency" })];
  const p = [prog("a", { target: 120000 }), prog("b", { target: 360000 }), prog("ef", { target: 600000 })];   // needs 10,000, 30,000 and 50,000 (a month of 12)
  const enough = split(goals, p, { total: 90000 });
  assert.deepEqual(by(enough), { a: 10000, b: 30000, ef: 50000 }); assert.equal(enough.leftover, 0);
  const short = split(goals, p, { total: 70000 });   // the fund takes its 50,000; 20,000 is shared 1 to 3
  assert.deepEqual(by(short), { ef: 50000, a: 5000, b: 15000 });
  const odd = split(goals, p, { total: 70001 });   // 20,001 shared 1 to 3: 5,000 and 15,000, the odd centavo to the biggest need
  assert.equal(sum(odd), 70001); assert.deepEqual(by(odd), { ef: 50000, a: 5000, b: 15001 });
  const tiny = split(goals, p, { total: 30000 });   // the fund's need is more than the money: it takes everything, the others get nothing
  assert.deepEqual(by(tiny), { ef: 30000, a: 0, b: 0 });
  assert.match(short.parts.find((x) => x.goal_id === "ef").why, /comes first/);
  const none = split([g("a"), g("b")], [prog("a", { target: 120000 }), prog("b", { target: 360000 })], { total: 20000 });   // no emergency fund: pro rata to need
  assert.deepEqual(by(none), { a: 5000, b: 15000 });
});

test("a typed amount is paid before any need, and a goal with a date counts its need the same way", () => {
  const goals = [g("a"), g("trip", { deadline: "2026-12-31" }), g("ef", { role: "emergency" })];
  const p = [prog("a"), prog("trip", { target: 100000 }), prog("ef", { target: 1200000 })];   // trip needs 50,000 (2 months), the fund 100,000
  const r = split(goals, p, { total: 200000, pins: { a: 60000 } });   // 140,000 left, the needs are 150,000: the fund is paid first, the trip gets the rest
  assert.deepEqual(by(r), { a: 60000, ef: 100000, trip: 40000 });
  assert.equal(sum(r) + r.leftover, 200000);
});

test("a goal the ledger cannot show is left out", () => {
  const r = split([g("a"), g("ghost")], [prog("a", { target: 120000 })]);
  assert.deepEqual(by(r), { a: 10000 });
});

// ---- the offer "Add to savings": the owner taps it; never automatic ----
const offer = (goals, p, o = {}) => placeSurplus({ goals, progress: new Map(p), left: 100000, ...o });
test("Add to savings: the emergency fund first up to its gap, then the other goals by the owner's percentages, each up to its gap", () => {
  const goals = [g("a"), g("b"), g("ef", { role: "emergency" })];
  const p = [prog("a", { target: 500000 }), prog("b", { target: 500000 }), prog("ef", { target: 130000, balance: 100000 })];   // the fund can take 30,000
  const r = offer(goals, p, { shares: { a: 7000, b: 3000 } });
  assert.deepEqual(r.add, { ef: 30000, a: 49000, b: 21000 }); assert.equal(r.total, 100000); assert.equal(r.left, 0);
  const equal = offer(goals, p);
  assert.deepEqual(equal.add, { ef: 30000, a: 35000, b: 35000 }, "equal parts when no percentage is set");
});

test("Add to savings never gives a goal more than its gap, counts what it already has each month, and leaves the rest Left", () => {
  const goals = [g("a"), g("ef", { role: "emergency" })];
  const p = [prog("a", { target: 20000 }), prog("ef", { target: 130000, balance: 100000 })];
  const r = offer(goals, p, { monthly: { a: 5000, ef: 10000 } });   // the fund has 10,000 a month already: 20,000 more fits; a has 5,000: 15,000 more fits
  assert.deepEqual(r.add, { ef: 20000, a: 15000 }); assert.equal(r.total, 35000); assert.equal(r.left, 65000);
  assert.equal(offer([g("a")], [prog("a")]).total, 0, "a goal with no target has no gap: no offer");
  assert.equal(offer([], []).total, 0);
  assert.equal(offer([g("a")], [prog("a", { target: 100, balance: 100 })]).total, 0, "a reached goal takes nothing");
  assert.deepEqual(offer([g("ef", { role: "emergency" })], [prog("ef")], { emergencyTarget: 150000 }).add, { ef: 100000 }, "the formula target gives the fund a gap when none is typed");
});

test("percentages: whole numbers that add to exactly 100", () => {
  assert.deepEqual(parseShares(["a", "b"], { a: "70", b: "30" }), { ok: true, shares: { a: 7000, b: 3000 } });
  assert.match(parseShares(["a", "b"], { a: "70", b: "20" }).message, /add up to 100.*90/);
  assert.equal(parseShares(["a", "b"], { a: "70", b: "40" }).ok, false);
  assert.equal(parseShares(["a", "b"], { a: "70.5", b: "29.5" }).ok, false);
  assert.equal(parseShares(["a", "b"], { a: "x", b: "100" }).ok, false);
  assert.equal(parseShares(["a"], { a: "100" }).ok, true);
});

test("the goals the percentages are for: no finish date, not the emergency fund, not full", () => {
  const goals = [g("a"), g("b", { deadline: "2027-01-31" }), g("ef", { role: "emergency" }), g("full"), g("ghost")];
  const p = new Map([prog("a"), prog("b"), prog("ef"), prog("full", { target: 10, balance: 10 })]);
  assert.deepEqual(shareableGoals(goals, p).map((x) => x.id), ["a"]);
});

test("Saved counts goals only: the buffer is its own figure and still comes out of the income", () => {
  assert.deepEqual(shares(2500000, 1000000, 500000, 100000), { spending: 400, saved: 200, buffer: 40, unallocated: 900000 });
  assert.equal(shares(2500000, 1000000, 500000).buffer, 0);
});

// ---- through the budget suggestion ----
const TODAY = "2026-10-05", MONTH = "2026-10";
function state() {
  const s = makeState();
  s.accounts = [account({ id: "chk", name: "Test Checking", class: "asset", opening_balance: 100000000 }), account({ id: "p1", name: "Pocket One", class: "asset", opening_balance: 0 }), account({ id: "p2", name: "Pocket Two", class: "asset", opening_balance: 0 })];
  s.categories = [{ id: "rent", name: "Rent", kind: "expense", role: "rent" }, { id: "food", name: "Food", kind: "expense", role: "food" }, { id: UNLOGGED_CATEGORY_ID, name: "Unlogged", kind: "expense" }, { id: "pay", name: "Pay", kind: "income" }];
  s.payslips = []; s.payslipLines = []; s.subscriptions = []; s.rules = [];
  s.goals = [{ id: "ga", name: "Alpha", account_id: "p1", hidden_by_default: true }, { id: "gb", name: "Beta", account_id: "p2", hidden_by_default: true }];
  return s;
}
const sug = (o) => suggestBudgets({ state: state(), today: TODAY, month: MONTH, pin: 10000000, rent: 2000000, ...o });

const withTargets = (o = {}) => { const s = state(); s.goals = [{ ...s.goals[0], target: 2400000 }, { ...s.goals[1], target: 1200000 }]; return suggestBudgets({ state: s, today: TODAY, month: MONTH, pin: 10000000, rent: 2000000, ...o }); };

test("the suggestion gives each goal its monthly need, carries the goal ids and the need, keeps the buffer apart, and places nothing else", () => {
  const r = withTargets();
  assert.equal(r.ok, true);
  const goals = r.saved.filter((x) => x.kind === "goal");
  assert.deepEqual(goals.map((x) => x.goal_id).sort(), ["ga", "gb"]);
  const amount = (id) => r.saved.find((x) => x.goal_id === id).amount;
  assert.deepEqual([amount("ga"), amount("gb")], [200000, 100000], "2,400,000 / 12 and 1,200,000 / 12");
  assert.deepEqual(goals.map((x) => x.need).sort(), [100000, 200000]);
  assert.ok(r.saved.some((x) => x.kind === "buffer" && !x.goal_id));
  assert.deepEqual(savedRows({ plan: null, suggestion: r }).filter((x) => x.kind === "goal").map((x) => x.goal_id).sort(), ["ga", "gb"]);
  const none = sug({});   // goals with no target have no need: no goal line at all, and the savings stay Left
  assert.equal(none.saved.filter((x) => x.kind === "goal").length, 0);
});

test("a typed monthly amount reaches the suggestion; the percentages no longer spread anything", () => {
  const base = withTargets(), amount = (r, id) => r.saved.find((x) => x.goal_id === id).amount;
  const pinned = withTargets({ goalPins: { ga: 123400 } });
  assert.equal(amount(pinned, "ga"), 123400, "typed, so it is not rounded");
  assert.ok(pinned.saved.find((x) => x.goal_id === "ga").pinned);
  assert.equal(amount(pinned, "gb"), amount(base, "gb"), "the other goal still gets its need");
  const weighted = withTargets({ goalShares: { ga: 8000, gb: 2000 } });
  assert.deepEqual([amount(weighted, "ga"), amount(weighted, "gb")], [amount(base, "ga"), amount(base, "gb")], "percentages are used only by the offer Add to savings, which the owner taps");
});

test("the screens read the settings and the rule is the same everywhere", () => {
  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8"), sw = readFileSync(new URL("../app/sw.js", import.meta.url), "utf8"), eng = readFileSync(new URL("../src/model/suggest.js", import.meta.url), "utf8");
  assert.match(sw, /savings\.js/);
  assert.match(eng, /splitSavings\(\{ goals, progress, month, total: saving, pins: input\.goalPins \?\? \{\}, shares: input\.goalShares \?\? \{\}, emergencyTarget: input\.emergencyTarget \?\? null \}\)/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fixedMap, withFixed, fixedWhy, emergencyFund, emergencyFormula, formulaWords, addSchedule, budgetPlan, suggestBudgets, bucketRows, UNLOGGED_CATEGORY_ID } from "../src/model/index.js";
import { makeState, account } from "./fixtures.js";

// P0-6 PR 4 (owner's answers, Nov 8). Invented numbers only; 100 centavos = 1 peso. Hand-worked below.
const MONTH = "2026-10", TODAY = "2026-10-05";
const cat = (id, name, o = {}) => ({ id, name, kind: "expense", ...o });
const rule = (id, amount) => ({ id: "r-" + id, kind: "budget", subject_id: id, amount, effective_from: "2026-01-01", created_at: "2026-01-01T00:00:00+08:00" });
function state(extra = {}) {
  const s = makeState();
  s.accounts = [account({ id: "chk", name: "Test Checking", class: "asset", opening_balance: 100000000 }), account({ id: "ef", name: "Test Cushion Pot", class: "asset", opening_balance: 600000 })];
  s.categories = [cat("rent", "Rent", { role: "rent" }), cat("subs", "Streaming", { role: "subscription" }), cat("food", "Food", { role: "food" }), cat("fun", "Fun"), cat("misc", "Misc things"),
    cat("loan", "Zork plan"), cat(UNLOGGED_CATEGORY_ID, "Unlogged"), { id: "pay", name: "Pay", kind: "income" }];
  s.rules = [rule("rent", 2000000), rule("subs", 50000), rule("food", 800000), rule("fun", 300000), rule("misc", 100000), rule("loan", 150000)];
  s.payslips = []; s.payslipLines = []; s.subscriptions = []; s.schedules = [];
  s.goals = [{ id: "ef", name: "Cushion", account_id: "ef", hidden_by_default: false, role: "emergency" }];
  return Object.assign(s, extra);
}
const ids = (m) => [...m.keys()].sort();

test("Fixed: the rent and subscription roles, and what the owner turns on; Other and Uncategorized never", () => {
  const m = fixedMap(state(), {}, TODAY);
  assert.deepEqual(ids(m), ["rent", "subs"], "rent and subscription (even \"Streaming\", a name nobody has read: its role is the owner's word) are Fixed; Food (a need), Fun, Misc (Other) and Zork plan (Other) are not");
  assert.equal(m.get("rent"), "role");
  const you = fixedMap(state(), { fixed_overrides: { food: true } }, TODAY);
  assert.equal(you.get("food"), "you");
  const off = fixedMap(state(), { fixed_overrides: { rent: false } }, TODAY);
  assert.deepEqual(ids(off), ["subs"], "the owner can turn a role off");
  assert.equal(fixedMap(state(), { fixed_overrides: { [UNLOGGED_CATEGORY_ID]: true } }, TODAY).has(UNLOGGED_CATEGORY_ID), false);
});

test("Fixed: a category in Other is never Fixed, even with a schedule or when turned on; once its bucket is answered it can be", () => {
  let s = state();
  s = addSchedule(s, { id: "s1", kind: "repeating", name: "Zork plan", category_id: "loan", account_id: "chk", start: "2026-09-01", amount: 150000, day: 10 }).state;
  assert.equal(fixedMap(s, {}, TODAY).has("loan"), false, "its name reads as nothing: it sits in Other");
  assert.equal(fixedMap(s, { fixed_overrides: { misc: true } }, TODAY).has("misc"), false);
  const refused = withFixed(s, {}, "misc", true);
  assert.equal(refused.ok, false); assert.match(refused.message, /Other is never Fixed/);
  const answered = fixedMap(s, { bucket_overrides: { loan: "need" } }, TODAY);
  // Before Nov 13: answered as a need, its schedule made it Fixed ("schedule"). Now a schedule never makes a category Fixed (L3): it stays a need.
  assert.equal(answered.has("loan"), false, "answered as a need, it stays a need: a schedule never makes it Fixed");
  assert.equal(fixedMap(s, { bucket_overrides: { loan: "need" }, fixed_overrides: { loan: true } }, TODAY).get("loan"), "you", "the owner can still turn it on");
  assert.equal(withFixed(s, { bucket_overrides: { misc: "want" } }, "misc", true).ok, true);
});

// Before Nov 13 this test checked that a schedule MADE a category Fixed while a payment was to come; now it checks that it never does (L3, owner's rule).
test("Fixed: an installment, a scheduled payment or a loan repayment never makes its category Fixed, while a payment is to come or after", () => {
  let s = state();
  s.categories.push(cat("fam", "Family support")); s.rules.push(rule("fam", 500000));   // a scheduled family send
  s = addSchedule(s, { id: "s2", kind: "repeating", name: "Monthly send", category_id: "fam", account_id: "chk", start: "2026-09-01", amount: 500000, day: 12 }).state;
  s = addSchedule(s, { id: "s3", kind: "installment", name: "Phone", category_id: "fun", account_id: "chk", start: "2026-05-01", total: 600000, count: 6, made: 6 }).state;
  const m = fixedMap(s, { bucket_overrides: { fam: "need" } }, TODAY);
  assert.equal(m.has("fam"), false, "a scheduled family send stays in its bucket (a need)");
  assert.equal(m.has("fun"), false, "an installment with every payment made has nothing to come");
  s = addSchedule(s, { id: "s4", kind: "installment", name: "Laptop", category_id: "fun", account_id: "chk", start: "2026-08-01", total: 600000, count: 6, made: 1 }).state;
  assert.equal(fixedMap(s, {}, TODAY).has("fun"), false, "an installment still to pay does not make Fun Fixed");
});

test("withFixed: on, off, and back to what the role says; nothing else changes", () => {
  const s = state(), set = { goal_monthly: { x: 1 } };
  const on = withFixed(s, set, "food", true).settings; assert.deepEqual(on.fixed_overrides, { food: true }); assert.deepEqual(on.goal_monthly, { x: 1 });
  const off = withFixed(s, on, "food", false).settings; assert.deepEqual(off.fixed_overrides, { food: false });
  assert.deepEqual(withFixed(s, off, "food", null).settings.fixed_overrides, {});
  assert.equal(withFixed(s, set, "nope", true).ok, false);
  assert.match(fixedWhy("role"), /rent or a subscription/); assert.equal(fixedWhy(undefined), "");
});

test("the Budget lists Fixed first as its own group; the other groups and every amount are unchanged", () => {
  const v = budgetPlan(state(), {}, MONTH, TODAY), group = (id) => v.lines.find((l) => l.id === id).group;
  assert.deepEqual([group("rent"), group("subs"), group("food"), group("fun"), group("misc")], ["Fixed", "Fixed", "Needs", "Wants", "Other"]);
  assert.equal(v.monthView.placed, 2000000 + 50000 + 800000 + 300000 + 100000 + 150000, "the same figures");
  const mine = budgetPlan(state(), { fixed_overrides: { rent: false } }, MONTH, TODAY);
  assert.equal(mine.lines.find((l) => l.id === "rent").group, "Needs", "turned off, rent goes back to its bucket");
});

// ---- the one Emergency target ----
test("the formula: 3 x the monthly budgets of the Fixed and Needs categories, shown with its parts; a want, Other, hidden and no-budget categories are left out", () => {
  const f = emergencyFormula(state(), {}, MONTH, TODAY);
  // Fixed: Rent 20,000.00 and Streaming 500.00; Needs: Food 8,000.00; Fun (want) 3,000, Misc (other) 1,000 and Gadget payments (other) 1,500 are not in it
  assert.deepEqual(f.parts.map((p) => [p.name, p.amount, p.fixed]), [["Rent", 2000000, true], ["Streaming", 50000, true], ["Food", 800000, false]]);
  assert.equal(f.monthly, 2850000); assert.equal(f.target, 8550000); assert.equal(f.months, 3);
  const words = formulaWords(f, (c) => String(c / 100));
  assert.equal(words, "3 × (Rent 20000 + Streaming 500 + Food 8000) = 3 × 28500");
  assert.equal(emergencyFormula(state(), { hidden_categories: ["food"] }, MONTH, TODAY).monthly, 2050000, "a hidden category is in no figure");
  assert.equal(emergencyFormula(state({ rules: [] }), {}, MONTH, TODAY), null, "no budgets, no formula");
  assert.equal(emergencyFormula(state(), { fixed_overrides: { fun: true } }, MONTH, TODAY).monthly, 3150000, "a category the owner made Fixed joins it");
});

test("a typed target wins everywhere and is the owner's figure; otherwise the formula; the balance, the percent and the months follow", () => {
  const s = state(), goal = s.goals[0];
  const f = emergencyFund(s, { goal_monthly: { ef: 100000 } }, goal, { month: MONTH, today: TODAY });
  assert.deepEqual([f.source, f.yours, f.target, f.balance, f.remaining, f.percent, f.reached], ["formula", false, 8550000, 600000, 7950000, 7, false]);
  assert.equal(f.monthly, 100000); assert.equal(f.monthsToTarget, 80, "7,950,000 / 100,000 = 79.5, rounded up");
  const typed = emergencyFund(state(), {}, { ...goal, target: 3000000 }, { month: MONTH, today: TODAY });
  assert.deepEqual([typed.source, typed.yours, typed.target, typed.percent], ["typed", true, 3000000, 20]);
  assert.equal(typed.formula.target, 8550000, "the formula is still worked out so the screen can say what it would give");
  assert.equal(emergencyFund(state(), {}, { ...goal, target: 0 }, { month: MONTH, today: TODAY }).source, "formula", "0 is not a figure");
  assert.equal(emergencyFund(state({ rules: [] }), {}, goal, { month: MONTH, today: TODAY }), null, "no typed figure and no formula: nothing to show");
  assert.equal(emergencyFund(state({ rules: [] }), {}, { ...goal, target: 500000 }, { month: MONTH, today: TODAY }).target, 500000, "a typed figure needs no budgets");
  const reached = emergencyFund(state(), {}, { ...goal, target: 500000 }, { month: MONTH, today: TODAY });
  assert.deepEqual([reached.reached, reached.remaining, reached.monthsToTarget], [true, 0, 0]);
  assert.equal(emergencyFund(s, {}, null, { month: MONTH }), null);
});

test("the suggestion's savings split reads the same target: the formula sizes the emergency fund's monthly need", () => {
  const s = state({ rules: [rule("rent", 2000000), rule("food", 800000)] });   // formula 3 x 28,000.00 = 8,400,000; balance 6,000: gap 8,394,000 / 12 = 699,500
  const r = suggestBudgets({ state: s, today: TODAY, month: MONTH, pin: 10000000, rent: 2000000 });
  assert.equal(r.ok, true);
  const ef = r.saved.find((x) => x.goal_id === "ef");
  assert.ok(ef, "the emergency fund has a line");
  const typed = suggestBudgets({ state: { ...s, goals: [{ ...s.goals[0], target: 1200000 }] }, today: TODAY, month: MONTH, pin: 10000000, rent: 2000000 }).saved.find((x) => x.goal_id === "ef");
  assert.notEqual(typed.amount, ef.amount, "a typed target changes the need: it wins over the formula");
});

test("no screen reads the old plan-based emergency status any more, and the new files are wired in", () => {
  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8"), sw = readFileSync(new URL("../app/sw.js", import.meta.url), "utf8");
  assert.doesNotMatch(app, /emergencyFundStatus|emergencyFundFromBudgets/);
  assert.match(sw, /fixed\.js/); assert.match(sw, /emergency\.js/);
});

// ---- owner's defaults, Nov 8 ----
test("a role the owner stored always wins: Fixed whatever the name reads as or the bucket says; a role only guessed from the name does not beat Other", () => {
  const s = state();
  s.categories.push(cat("nf", "Netflix"), cat("nfr", "Netflix again", { role: "subscription" }));
  assert.equal(fixedMap(s, {}, TODAY).get("nf"), "name", "no stored role: the name says subscription, and the bucket is not Other");
  const other = { bucket_overrides: { nf: "other", nfr: "other", subs: "other" } };
  assert.equal(fixedMap(s, other, TODAY).has("nf"), false, "a guessed role does not beat Keep in Other");
  assert.equal(fixedMap(s, other, TODAY).get("nfr"), "role", "a stored role does");
  assert.equal(fixedMap(s, other, TODAY).get("subs"), "role", "Streaming (stored role) stays Fixed in Other");
  assert.equal(fixedMap(s, { ...other, fixed_overrides: { subs: false } }, TODAY).has("subs"), false, "the owner's own switch Off still wins");
});

test("Fixed is counted inside the 50: the Needs part holds rent and a Fixed subscription; an owner's own split is never changed", () => {
  const s = state(), budgets = { rent: 2000000, subs: 50000, food: 800000, fun: 300000 };
  const rowOf = (r, b) => r.rows.find((x) => x.bucket === b).amount;
  const plain = bucketRows({ categories: s.categories, overrides: {}, targets: undefined, budgets, income: 10000000 });
  assert.equal(rowOf(plain, "need"), 2800000, "without Fixed: rent and food");
  const fixed = bucketRows({ categories: s.categories, overrides: {}, targets: undefined, budgets, income: 10000000, fixedIds: new Set(fixedMap(s, {}, TODAY).keys()) });
  assert.equal(rowOf(fixed, "need"), 2850000, "with Fixed: rent, the subscription and food, all inside the Needs part");
  assert.equal(fixed.rows.find((x) => x.bucket === "want")?.amount ?? 0, 300000, "the subscription is no longer in Wants");
  assert.deepEqual([fixed.targets.need, fixed.targets.want, fixed.targets.savings], [5000, 3000, 2000], "50 / 30 / 20 stays the default");
  const mine = bucketRows({ categories: s.categories, overrides: {}, targets: { need: 6000, want: 2000, savings: 2000 }, budgets, income: 10000000, fixedIds: new Set(["rent"]) });
  assert.deepEqual([mine.targets.need, mine.targets.want, mine.targets.savings], [6000, 2000, 2000], "an owner's own split is never changed");
});

test("the starter suggestion takes Fixed subscriptions out of the needs part, not the wants part", () => {
  const run = (subs) => { const s = state(); s.categories = s.categories.filter((c) => c.id !== "subs"); s.categories.push(cat("fun2", "Fun stuff")); s.subscriptions = subs; return suggestBudgets({ state: s, today: TODAY, month: MONTH, pin: 10000000, rent: 2000000 }); };
  const none = run([]), withSub = run([{ id: "sb", name: "Streaming plan", amount: 100000, renewal_day: 5 }]);
  const amount = (r, id) => r.rows.find((x) => x.category_id === id).amount;
  assert.equal(amount(withSub, "fun2"), amount(none, "fun2"), "Wants are untouched by a Fixed subscription");
  assert.ok(Math.abs(amount(none, "food") - amount(withSub, "food") - 100000) <= 5000, "Food, a need, pays for it (give or take rounding to 50 pesos)");
});

test("the Budget offers Add to savings from Left: a tap, never automatic", () => {
  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(app, /Add .* to savings/); assert.match(app, /case "add-left-to-savings"/);
  assert.doesNotMatch(app, /placeSurplus[^;]*\n[^\n]*commit\([^\n]*\n[^\n]*render/, "the offer is only ever run by its own action");
});

test("Help says the emergency target leaves Wants out, and how to count a payment that cannot be stopped (owner's words, Nov 13)", async () => {
  const { TOPICS: HELP_TOPICS } = await import("../src/model/help.js");
  const goals = HELP_TOPICS.find((t) => t.tab === "goals"), at = goals.lines.findIndex((l) => l.startsWith("The emergency fund target is"));
  assert.equal(goals.lines[at + 1], "Wants are not counted. If a payment cannot be stopped, set its category to Fixed.", "right under the line that gives the formula");
});

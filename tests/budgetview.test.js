import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { baseIncome, shares, tenths, showTenths, incomeChanged, savedRows, suggestBudgets, budgetChangesFromDraft, netsByKind, NO_INCOME_PROMPT, budgetFor, renameCategory, suggestPlan, parsePlan, fixedMap, bucketMap } from "../src/model/index.js";
import { UNLOGGED_CATEGORY_ID } from "../src/model/seed.js";
import { makeState, account } from "./fixtures.js";

// Invented numbers only. Whole centavos: 100000 is 1,000 pesos.
const TS = "2026-01-01T09:00:00.000+08:00", TODAY = "2026-10-05", MONTH = "2026-10";
const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");

function base() {
  const s = makeState();
  s.accounts = [account({ id: "chk", name: "Test Checking", class: "asset", opening_balance: 100000000 })];
  s.categories = [{ id: "food", name: "Food", kind: "expense", role: "food" }, { id: "rent", name: "Rent", kind: "expense", role: "rent" }, { id: "fun", name: "Fun", kind: "expense" },
    { id: UNLOGGED_CATEGORY_ID, name: "Unlogged", kind: "expense" }, { id: "pay", name: "Pay", kind: "income" }];
  s.payslips = []; s.payslipLines = []; s.subscriptions = []; s.goals = []; s.rules = [];
  return s;
}
let n = 0;
function spend(s, date, cat, amount) {
  const id = "t" + ++n;
  s.transactions.push({ id, date, payee: "", memo: "", status: "verified", source: "manual", created_at: TS, verified_at: TS });
  s.entries.push({ transaction_id: id, category_id: cat, amount }, { transaction_id: id, account_id: "chk", amount: -amount });
}
function slip(s, date, deposit, overtime = 0) {
  const id = "p" + ++n;
  s.payslips.push({ id, employer: "Test Co", period_from: date, period_to: date, pay_date: date, account_id: "chk", transaction_id: "x" + n, printed_gross: deposit, printed_net: deposit, deposit });
  s.payslipLines.push({ payslip_id: id, side: "earning", kind: "basic", amount: deposit - overtime });
  if (overtime) s.payslipLines.push({ payslip_id: id, side: "earning", kind: "overtime", amount: overtime });
}
function logMonth(s, month, { food = 600000, rent = 800000, fun = 300000 } = {}) {
  for (let i = 0; i < 12; i++) spend(s, `${month}-${String(2 + i).padStart(2, "0")}`, "food", food / 12);
  spend(s, `${month}-01`, "rent", rent);
  for (let i = 0; i < 3; i++) spend(s, `${month}-20`, "fun", fun / 3);
}
const M6 = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
// Monthly pay: one payslip a month on the 30th (2,500 pesos... in centavos 2,500,000 is 25,000 pesos)
function monthly(extra) { const s = base(); for (const m of M6) { slip(s, m + "-28", 2500000); logMonth(s, m); } extra?.(s); return s; }
function twice() { const s = base(); for (const m of M6) { slip(s, m + "-15", 1000000); slip(s, m + "-30", 2000000); logMonth(s, m); } return s; }
const sug = (s, o = {}) => suggestBudgets({ state: s, today: TODAY, month: MONTH, ...o });

test("Budget lists its parts as the owner placed them: Wants before the Buffer (owner's marks, Nov 11); the funding order in the model is unchanged", () => {
  assert.match(app, /const BUDGET_GROUPS = \["Fixed", "Needs", "Savings", "Wants", "Buffer", "Other"\];/);
  assert.match(readFileSync(new URL("../src/model/suggest.js", import.meta.url), "utf8"), /Lowered: it comes after Fixed, Needs and your savings minimum\./, "the engine still funds the buffer before Wants");
});

test("Budget is ONE screen: the three views, no old switch, no Setup page for it (a saved setting is left alone, never deleted)", () => {
  assert.match(app, /function viewBudget\(\) \{\n  const month = M\.monthOf\(today\(\)\), set = ledger\.settings, v = M\.budgetPlan\(S\(\), set, month, today\(\)\)/, "the Budget screen reads the one model");
  for (const w of ["Month", "Per payday", "Per week"]) assert.ok(app.includes(`"${w}"]`) || app.includes(`, "${w}"]`), w);
  assert.ok(!app.includes("function viewBudgetOld") && !app.includes("toggle-new-budget") && !app.includes("Try the new Budget") && !app.includes("Budget options"), "no old screen, no switch, no Setup page for it");
  assert.ok(!/try_new_budget/.test(app), "the app no longer reads the old setting; an old ledger that has it keeps it, unused");
  assert.ok(!/try_new_budget/.test(readFileSync(new URL("../src/model/seed.js", import.meta.url), "utf8")), "no setting is switched on by default");
});

test("the summary: Spending and Saved are plainly rounded to a tenth of a percent, Unallocated is in pesos (centavos), and nothing forces the shares to add to 100.0%", () => {
  assert.deepEqual(shares(2500000, 1000000, 500000), { spending: 400, saved: 200, buffer: 0, unallocated: 1000000 });
  assert.equal(showTenths(400), "40.0%");
  assert.equal(tenths(1000000, 2500000), 400); assert.equal(tenths(1, 3), 333); assert.equal(tenths(2, 3), 667, "rounded to the nearest tenth");
  // 79.96% and 19.96% are shown as 80.0% and 20.0%, the unallocated 0.08% is a few pesos: the three are not made to add up
  const s = shares(10000000, 7996000, 1996000);
  assert.deepEqual([s.spending, s.saved, s.unallocated], [800, 200, 8000 * 1], "80.0%, 20.0% and 80.00 pesos left");
  assert.equal(tenths(799, 1000) + tenths(199, 1000), 998 + 0, "each row is its own rounding");
  const o = shares(1000000, 700000, 500000);
  assert.equal(o.unallocated, -200000, "over the income is a negative amount, never hidden");
  for (const [inc, a, b] of [[1000003, 333333, 166667], [7, 3, 3], [999999, 1, 2], [1000000, 0, 0]]) assert.equal(shares(inc, a, b).unallocated, inc - a - b, `exact centavos for ${inc}`);
  assert.equal(shares(1000000, 333333, 333333).spending, 333, "33.3333% is 33.3%");
});

test("overtime does not change the income basis, and the base is the median of the last 3 nets", () => {
  const a = base(), b = base();
  for (const [d, v, ot] of [["2026-06-28", 2400000, 0], ["2026-07-28", 2500000, 0], ["2026-08-28", 2600000, 0], ["2026-09-28", 2500000, 0]]) { slip(a, d, v); slip(b, d, v + 900000, 900000); }
  const x = baseIncome(a), y = baseIncome(b);
  assert.equal(x.amount, 2500000); assert.equal(y.amount, x.amount, "900,000 of overtime on every payslip changes nothing");
  assert.equal(x.text, "Last 3 payslips, extra pay left out. 1 payday a month, worked out from your pay dates."); assert.equal(x.source, "payslips");
  const old = base(); slip(old, "2026-06-28", 100000); slip(old, "2026-07-28", 2800000); slip(old, "2026-08-28", 2000000); slip(old, "2026-09-28", 2200000);
  assert.equal(baseIncome(old).amount, 2200000, "only the last 3 count (2.8M, 2.0M, 2.2M): the small old payslip is left out");
  const two = base(); slip(two, "2026-08-28", 2000000); slip(two, "2026-09-28", 2400000);
  assert.equal(baseIncome(two).amount, 2000000, "with two, the lower: never plan on more pay than usually arrives");
  const wobble = base(); slip(wobble, "2026-07-28", 2500000); slip(wobble, "2026-08-30", 2500000); slip(wobble, "2026-09-31".replace("31", "30"), 2500000);
  assert.equal(netsByKind(wobble.payslips.map((p) => ({ date: p.pay_date, base: p.deposit }))).length, 1, "pay dates a few days apart are still one monthly payday");
  assert.equal(baseIncome(wobble).amount, 2500000);
});

test("the owner's figure wins, then the payslips, then a loaded plan's expected income (and says so); with none, the prompt (P0-6: one income)", () => {
  const s = monthly();
  const pinned = baseIncome(s, { pin: 3000000 });
  assert.deepEqual({ amount: pinned.amount, source: pinned.source, text: pinned.text }, { amount: 3000000, source: "pinned", text: "Your own figure" });
  assert.equal(pinned.other.source, "payslips", "the payslips' figure is kept to be shown beside the typed one");
  const plan = parsePlan(JSON.stringify({ schema_version: 1, unit: "PHP_whole_pesos", effective_from: "2026-10-01", paydays: [{ day: 15, expected_income: 1000 }, { day: "last", expected_income: 2000 }],
    lines: [{ name: "Food", kind: "expense", first: 1000, second: 2000 }] })).plan;
  assert.equal(baseIncome(s, { plan }).source, "payslips", "payslips beat a plan's expected income: one income everywhere");
  const p = baseIncome(base(), { plan });
  assert.equal(p.amount, 300000); assert.equal(p.source, "plan"); assert.match(p.text, /pay plan/);
  assert.equal(baseIncome(s, { plan, pin: 3000000 }).source, "pinned");
  const none = baseIncome(base());
  assert.equal(none.amount, null); assert.equal(none.text, "Add a payslip or your pay to get a suggested budget."); assert.equal(NO_INCOME_PROMPT, none.text);
  const r = sug(base());
  assert.equal(r.ok, false); assert.equal(r.message, NO_INCOME_PROMPT);
  assert.equal(baseIncome(base(), { pin: 1500000 }).amount, 1500000, "a typed figure is enough, even with no payslip");
});

test("a once-a-month income works: one payday kind, the median of 3, and a suggestion for the month", () => {
  const s = monthly();
  assert.equal(netsByKind(suggestPlanSlips(s)).length, 1);
  assert.equal(baseIncome(s).amount, 2500000);
  const r = sug(s);
  assert.equal(r.ok, true); assert.equal(r.income.amount, 2500000);
  const food = r.rows.find((x) => x.category_id === "food");
  assert.equal(food.suggested, 600000); assert.match(food.reason, /Median of the last 6 usable months/); assert.doesNotMatch(food.reason, /days covered/, "no payday wording in a monthly budget");
  assert.equal(r.rows.find((x) => x.category_id === "rent").suggested, 800000);
  assert.equal(r.history.used, "history");
  const total = r.rows.reduce((a, x) => a + x.amount, 0) + r.saved.reduce((a, x) => a + x.amount, 0) + r.unallocated - r.short;
  assert.equal(total, 2500000, "spending + saved + unallocated is the whole income");
});
function suggestPlanSlips(s) { return s.payslips.map((p) => ({ date: p.pay_date, base: p.deposit })); }

test("two paydays a month: the base income is the sum of each kind's median", () => {
  const s = twice();
  assert.equal(netsByKind(suggestPlanSlips(s)).length, 2);
  assert.equal(baseIncome(s).amount, 3000000);
  assert.equal(sug(s).ok, true);
});

test("with no usable history the suggestion is starter shares and says so; a plan-less ledger still gets Saved rows, labelled not saved", () => {
  const s = base(); slip(s, "2026-09-28", 2500000); logMonth(s, "2026-09");
  const r = sug(s, { rent: 800000 });
  assert.equal(r.ok, true); assert.equal(r.history.used, "starter");
  assert.ok(r.rows.some((x) => x.source === "starter" && /rule of thumb/.test(x.reason)));
  const rows = savedRows({ plan: null, suggestion: r });
  assert.ok(rows.length >= 1 && rows.every((x) => x.label === "Suggested, not saved"));
  assert.ok(rows.some((x) => x.kind === "buffer"));
});

test("with a plan loaded the Saved rows are the plan's goal and buffer lines, monthly, labelled from the plan", () => {
  const plan = { lines: [{ name: "Food", kind: "expense", first: 100, second: 100 }, { name: "Cushion", kind: "goal", first: 40000, second: 60000 }, { name: "Spare", kind: "buffer", first: 1000, second: 1000 }] };
  const rows = savedRows({ plan, suggestion: null });
  assert.deepEqual(rows.map((r) => [r.name, r.amount, r.label]), [["Cushion", 100000, "From your plan"], ["Spare", 2000, "From your plan"]]);
});

test("a pinned line survives a re-suggest: it stays the owner's figure and the suggestion is kept beside it", () => {
  const s = monthly();
  const free = sug(s), pinned = sug(s, { pins: { food: 123400 } });
  const f = pinned.rows.find((x) => x.category_id === "food"), g = free.rows.find((x) => x.category_id === "food");
  assert.equal(f.pinned, true); assert.equal(f.amount, 123400); assert.equal(f.suggested, g.suggested, "the engine's own figure is still shown as the suggestion");
  assert.equal(sug(s, { pins: { food: 123400 } }).rows.find((x) => x.category_id === "food").amount, 123400, "and again");
  assert.equal(pinned.rows.find((x) => x.category_id === "rent").pinned, false);
  const ignored = sug(s, { pins: { nope: 5 } });
  assert.equal(ignored.ok, true, "a pin on a category that is gone is ignored");
});

test("a category rename does not break the suggestion: lines and pins follow the id, never the name", () => {
  const s = monthly();
  const renamed = renameCategory(s, "food", "Groceries");
  assert.equal(renamed.ok, true);
  const r = sug(renamed.state, { pins: { food: 55500 } });
  const f = r.rows.find((x) => x.category_id === "food");
  assert.equal(f.name, "Groceries"); assert.equal(f.amount, 55500); assert.equal(f.pinned, true);
  const free = sug(renamed.state);
  assert.equal(free.rows.find((x) => x.category_id === "food").suggested, 600000, "the history is still found");
  // the engine itself: a line carries its category id, and a pin by id works even when the pinned name is something else
  const e = suggestPlan({ state: renamed.state, paydays: [{ day: 1 }], income: [2500000], today: TODAY, month: MONTH, pinned: [{ category_id: "food", name: "anything", first: 1000, second: 0 }] });
  const line = e.paydays[0].lines.find((l) => l.category_id === "food");
  assert.deepEqual([line.name, line.amount, line.pinned], ["Groceries", 1000, true]);
});

test("every spending category gets a row (even one with nothing to suggest), and the Unlogged category never does", () => {
  const r = sug(monthly());
  assert.deepEqual(r.rows.map((x) => x.category_id).sort(), ["food", "fun", "rent"]);
  const none = base(); slip(none, "2026-09-28", 2500000); for (const m of M6) logMonth(none, m, { fun: 0 });
  assert.equal(sug(none).rows.find((x) => x.category_id === "fun").suggested, 0);
});

test("no data version bump is needed: the new settings keys are additive, a ledger with or without them loads and passes the self-check", async () => {
  const { parseLedger, selfCheck, LEDGER_VERSION, upgradeLedger } = await import("../src/model/index.js");
  const s = monthly();
  const plain = { v: LEDGER_VERSION, rev: 1, saved_at: TS, state: Object.fromEntries(Object.entries(s).filter(([, v]) => Array.isArray(v))), settings: {} };
  const keyed = { ...plain, settings: { try_new_budget: true, income_base_pin: 2500000, budget_pins: { food: 600000 }, budget_income_seen: 2500000 } };
  for (const l of [plain, keyed]) { assert.equal(parseLedger(JSON.stringify(l)).ok, true); assert.deepEqual(selfCheck(l), []); }
  const r = upgradeLedger({ ...plain, v: LEDGER_VERSION - 1, settings: { notice_seen_at: TS } });
  assert.equal(r.ok, true); assert.equal(r.ledger.settings.try_new_budget, undefined, "an upgraded ledger never gets the switch turned on");
});

// ----- rounding to the nearest 50 pesos, and how saving is worked out -----
import { toNearest50, savingsExplained, SUGGEST_DEFAULTS as DEFAULTS } from "../src/model/index.js";
test("suggestions are rounded to the nearest 50 pesos, halves up; a typed (pinned) figure is kept exactly", () => {
  assert.equal(toNearest50(12600), 15000, "126 becomes 150"); assert.equal(toNearest50(12400), 10000, "124 becomes 100"); assert.equal(toNearest50(12500), 15000, "125 goes up");
  assert.equal(toNearest50(0), 0); assert.equal(toNearest50(2499), 0); assert.equal(toNearest50(521548), 520000, "5,215.48 becomes 5,200"); assert.equal(toNearest50(325967), 325000);
  const s = base(); slip(s, "2026-09-28", 3277737); logMonth(s, "2026-09");
  const r = sug(s, { rent: 335000, pins: { fun: 123456 } });
  for (const x of r.rows.filter((y) => !y.pinned)) { assert.equal(x.suggested % 5000, 0, x.name + " suggested is a multiple of 50 pesos"); assert.equal(x.amount, x.suggested); }
  for (const x of r.saved) assert.equal(x.amount % 5000, 0, x.name);
  const fun = r.rows.find((x) => x.category_id === "fun");
  assert.equal(fun.amount, 123456, "the owner's own figure is not rounded"); assert.equal(fun.suggested % 5000, 0, "but the suggestion shown beside it is");
});
// ----- rounding must never cause "Short" -----
import { fitToIncome } from "../src/model/index.js";
const roles = new Map([["rent", "rent"], ["food", "food"], ["ess", "essentials"], ["fun", "fun-not-a-role"]]);
const row = (id, name, amount, pinned = false) => ({ category_id: id, name, amount, suggested: amount, pinned, reason: "R." });
const total = (f, others = [], saved = []) => f.rows.reduce((n, r) => n + r.amount, 0) + others.reduce((n, o) => n + o.amount, 0) + saved.reduce((n, o) => n + o.amount, 0);

test("when rounding up pushes the total past income, the excess comes off the largest want in 50-peso steps, and what is left is Unallocated", () => {
  // income 10,000.00; rent 4,000, food 3,000, fun 2,000, shopping 1,000, saved 100 = 10,100 after rounding: 100.00 too much
  const rows = [row("rent", "Rent", 400000), row("food", "Food", 300000), row("fun", "Fun", 200000), row("shop", "Shopping", 100000)];
  const f = fitToIncome({ rows, saved: [{ amount: 10000 }], income: 1000000, roles });
  assert.equal(f.rows.find((r) => r.category_id === "fun").amount, 190000, "Fun is the largest want: 100 pesos off, in two 50-peso steps");
  assert.deepEqual(f.rows.filter((r) => r.category_id !== "fun").map((r) => r.amount), [400000, 300000, 100000], "nothing else is touched");
  assert.deepEqual(f.trimmed, [{ category_id: "fun", name: "Fun", by: 10000 }]);
  assert.equal(f.short, 0); assert.equal(f.unallocated, 0);
  assert.equal(f.rows.find((r) => r.category_id === "fun").suggested, 190000, '"Use this" would use the lowered figure');
  assert.match(f.rows.find((r) => r.category_id === "fun").reason, /Lowered by ₱100\.00 so the total fits your income\./);
  // an excess of 30 pesos still takes a whole 50, and the 20 left over shows as Unallocated
  const g = fitToIncome({ rows, saved: [{ amount: 3000 }], income: 1000000, roles: new Map(roles) });
  assert.equal(g.rows.find((r) => r.category_id === "fun").amount, 195000); assert.equal(g.unallocated, 2000); assert.equal(g.short, 0);
  // already fitting: nothing is changed
  const h = fitToIncome({ rows, income: 1100000, roles }); assert.deepEqual(h.rows, rows); assert.deepEqual(h.trimmed, []); assert.equal(h.unallocated, 100000);
});

test("a pinned line is never touched, nor the rent, nor a saved line, nor a fixed payment", () => {
  const rows = [row("rent", "Rent", 500000), row("fun", "Fun", 400000, true), row("shop", "Shopping", 100000)];
  const f = fitToIncome({ rows, others: [{ amount: 50000 }], saved: [{ amount: 100000 }], income: 1100000, roles });
  // total 1,150,000: 500 pesos too much; Fun is the biggest want but typed, so Shopping (1,000) gives
  assert.equal(f.rows.find((r) => r.category_id === "fun").amount, 400000); assert.equal(f.rows.find((r) => r.category_id === "rent").amount, 500000);
  assert.equal(f.rows.find((r) => r.category_id === "shop").amount, 50000, "the excess of 500 pesos came off Shopping");
  assert.equal(f.short, 0);
  // the owner's own figures alone are more than the income: that, and only that, is Short, and nothing is cut to hide it
  const over = fitToIncome({ rows: [row("rent", "Rent", 700000), row("fun", "Fun", 600000, true)], saved: [{ amount: 100000 }], income: 1000000, roles });
  assert.equal(over.short, 400000); assert.equal(over.unallocated, -400000); assert.deepEqual(over.trimmed, []); assert.deepEqual(over.rows.map((r) => r.amount), [700000, 600000]);
});

test("with no want line the excess comes off the largest unpinned spending line, and a want is always preferred to a need", () => {
  const needsOnly = [row("rent", "Rent", 300000), row("food", "Food", 400000), row("ess", "Essentials", 250000)];
  const f = fitToIncome({ rows: needsOnly, income: 940000, roles });
  assert.equal(f.rows.find((r) => r.category_id === "food").amount, 390000, "Food is the largest unpinned line: 100 pesos off"); assert.equal(f.rows.find((r) => r.category_id === "rent").amount, 300000);
  assert.equal(f.short, 0);
  const both = fitToIncome({ rows: [row("food", "Food", 900000), row("fun", "Fun", 200000)], income: 1050000, roles });
  assert.equal(both.rows.find((r) => r.category_id === "fun").amount, 150000, "Fun is a want, so it gives even though Food is bigger"); assert.equal(both.rows.find((r) => r.category_id === "food").amount, 900000);
  // wants run out: the rest comes off the largest need, never the rent
  const run = fitToIncome({ rows: [row("rent", "Rent", 500000), row("food", "Food", 400000), row("fun", "Fun", 50000)], income: 800000, roles });
  assert.equal(run.rows.find((r) => r.category_id === "fun").amount, 0); assert.equal(run.rows.find((r) => r.category_id === "food").amount, 300000, "50 from Fun, the other 100 from Food"); assert.equal(run.rows.find((r) => r.category_id === "rent").amount, 500000);
  assert.equal(run.short, 0); assert.equal(total(run), 800000);
  // rent plus fixed payments more than income, nothing else to cut: Short, and the rent is not touched
  const rentOnly = fitToIncome({ rows: [row("rent", "Rent", 900000)], others: [{ amount: 300000 }], income: 1000000, roles });
  assert.equal(rentOnly.short, 200000); assert.equal(rentOnly.rows[0].amount, 900000);
});

test("end to end: suggestions that round up past the income are brought back under it, so Short never comes from rounding", () => {
  // a ledger whose six spending lines all round UP: income is just above the exact total
  let found = 0;
  for (let income = 3000100; income < 3000100 + 50000 && found < 3; income += 997) {
    const s = base(); s.categories.push({ id: "shop", name: "Shopping", kind: "expense" }, { id: "tr", name: "Transpo", kind: "expense", role: "transport" }, { id: "hl", name: "Health", kind: "expense", role: "health" }, { id: "ess", name: "Essentials", kind: "expense", role: "essentials" });
    s.goals = [{ id: "g1", name: "Cushion", hidden_by_default: false, role: "emergency", target: 9000000 }];   // a goal whose monthly need (9,000,000 / 12 = 750,000) is more than the savings figure, so the savings are placed and rounding can bind
    slip(s, "2026-09-28", income);
    const r = sug(s, { rent: 333333 });
    assert.equal(r.ok, true);
    const t = r.rows.reduce((a, x) => a + x.amount, 0) + r.others.reduce((a, x) => a + x.amount, 0) + r.saved.reduce((a, x) => a + x.amount, 0);
    assert.ok(t <= income, `total ${t} is within income ${income}`); assert.equal(r.short, 0); assert.equal(r.unallocated, income - t);
    for (const x of r.rows.filter((y) => !y.pinned)) assert.equal(x.amount % 5000, 0, "still multiples of 50 pesos");
    if (r.trimmed.length) found++;
  }
  assert.ok(found >= 1, "at least one of these incomes needed the fix");
});

// Invented: pay of 12,000 a month, 6,000 on food and 8,000 rent every month. The needs alone pass the income, so the suggestion is SHORT.
// Before this fix the trim meant for rounding cut Food and Fun until the shortage disappeared and called it rounding.
test("a real shortage stays Short: only what rounding added is trimmed, never a need cut to hide it", () => {
  const s = base();
  for (const m of M6) { slip(s, m + "-28", 1200000); logMonth(s, m); }
  const r = sug(s);
  assert.equal(r.ok, true);
  const plan = suggestPlan({ state: s, paydays: [{ id: "month", label: "Month", day: 1 }], income: [1200000], today: TODAY, month: MONTH }).paydays[0];
  const engine = new Map(plan.lines.filter((l) => l.category_id).map((l) => [l.category_id, l.amount]));
  assert.ok(plan.short > 0, "the engine itself says the lines pass the income");
  for (const x of r.rows.filter((y) => engine.has(y.category_id))) assert.ok(x.amount >= engine.get(x.category_id) - 2500, `${x.name} keeps the engine's figure (within rounding)`);
  assert.ok(r.short >= plan.short - 2500 * (r.rows.length + r.saved.length), "the shortage is shown, not hidden");
  const t = r.rows.reduce((a, x) => a + x.amount, 0) + r.others.reduce((a, x) => a + x.amount, 0) + r.saved.reduce((a, x) => a + x.amount, 0);
  assert.equal(t + r.unallocated, 1200000, "the lines and Unallocated (negative when short) are the income exactly");
  assert.equal(r.short, t - 1200000, "Short is exactly how far the lines pass the income");
  for (const x of r.trimmed) assert.ok(x.by <= 5000 * r.rows.length, `${x.name} is only trimmed by rounding`);
});

// ---- THE BUFFER LINE (overhaul A5, L4, L5; owner's marks Nov 11): one buffer figure for Budget and Suggest, set from its own row
test("one buffer: Suggest a budget proposes exactly the monthly buffer Budget shows", async () => {
  const { suggestSettingsOf, budgetPlan } = await import("../src/model/index.js");
  const s = monthly(), set = { buffer_monthly: 250000, suggest_settings: { nudge_bps: 1000 } };
  assert.deepEqual(suggestSettingsOf(set), { nudge_bps: 1000, buffer_amount: 250000 });
  assert.equal(suggestSettingsOf({ suggest_settings: { nudge_bps: 1000 } }).buffer_amount, undefined, "none set: Suggest keeps its own starter buffer");
  assert.equal(suggestSettingsOf({}), undefined);
  const r = sug(s, { settings: suggestSettingsOf(set) });
  assert.equal(r.ok, true);
  const shown = budgetPlan(s, set, MONTH, TODAY).lines.find((l) => l.kind === "buffer")?.amount;
  assert.equal(shown, 250000, "Budget shows 2,500.00");
  assert.equal(r.saved.find((x) => x.kind === "buffer")?.amount, shown, "and Suggest proposes the same 2,500.00 (it used to propose its own figure)");
  assert.match(app, /settings: M\.suggestSettingsOf\(set\),/, "the app's Suggest reads it through the one rule");
});

test("the Buffer row: named the same everywhere, set and cleared from its own window, offered empty when none is set", () => {
  assert.match(app, /const BUFFER_NAME = "Buffer", BUFFER_SUB = "For overspending; not savings";/);
  assert.match(app, /fig: "Not set", pct: null \}\]\) : "";/, "Month shows an empty Buffer row to tap when none is set");
  assert.ok(app.includes('r.kind === "buffer" ? { action: "open-buffer-monthly", id: "buffer" }'), "the row opens the buffer window");
  assert.match(app, /case "save-buffer-monthly": \{ const a = M\.parsePesos\(ui\.form\.amount \?\? ""\); if \(!a\.ok \|\| a\.centavos < 0\) break; ui\.sheet = null; renderSheet\(\); await commit\(S\(\), \{ \.\.\.ledger\.settings, buffer_monthly: a\.centavos \}\);/);
  assert.match(app, /case "clear-buffer-monthly": \{ const \{ buffer_monthly, \.\.\.rest \} = ledger\.settings;/, "No buffer removes the setting; no entry is touched");
  assert.ok(app.includes('<p class="note">Money kept for when a category goes over its budget. It is never counted as savings.</p>'));
});

// ---- L3 (Nov 13): Suggest a budget reads the scheduled payments. A payment sets its category's suggested AMOUNT (at least the scheduled total for the
// month); it never changes the category's GROUP and never makes it Fixed (owner, Nov 13).
const withPlan = (s, amount, cat = "fun") => { s.schedules = [{ id: "sc1", kind: "repeating", name: "Test Plan", category_id: cat, account_id: "chk", start: "2026-01-10", amount, day: 10, created_at: TS }]; return s; };
test("L3: with history, a category already costing more than its scheduled payment keeps its usual figure, and the payment is not a loose line", () => {
  const s = withPlan(monthly(), 50000);
  const r = sug(s);
  assert.equal(r.ok, true);
  const fun = r.rows.find((x) => x.category_id === "fun");
  assert.equal(fun.suggested, 300000, "Fun usually costs 3,000.00 a month, the 500.00 plan included: the suggestion is 3,000.00, not 3,500.00 or 2,500.00");
  assert.equal(fun.reason, "Median of the last 6 usable months. At least its scheduled payments (Test Plan).");
  assert.ok(!r.others.some((x) => x.name === "Test Plan"), "the payment is not a line of its own");
  assert.equal(sug(s, { scheduled: [] }).rows.find((x) => x.category_id === "fun").suggested, 300000, "a caller can still pass its own list");
});
test("L3: with history, a scheduled payment bigger than the usual spending raises the suggestion to the payment", () => {
  const r = sug(withPlan(monthly(), 450000));
  const fun = r.rows.find((x) => x.category_id === "fun");
  assert.equal(fun.suggested, 450000, "Fun usually costs 3,000.00, but 4,500.00 is scheduled: at least 4,500.00");
  assert.match(fun.reason, /Raised: at least its scheduled payments \(Test Plan\)\./);
});
test("L3: with no history, a category that carries a scheduled payment is suggested at least that payment", () => {
  const s = withPlan(base(), 150000);
  const r = sug(s, { pin: 2500000, rent: 0 });
  assert.equal(r.ok, true);
  const fun = r.rows.find((x) => x.category_id === "fun");
  assert.ok(fun.suggested >= 150000, "at least the 1,500.00 plan");
  assert.match(fun.reason, /At least its scheduled payments \(Test Plan\)\./);
  assert.doesNotMatch(sug(s, { pin: 2500000, rent: 0, scheduled: [] }).rows.find((x) => x.category_id === "fun").reason, /scheduled/, "before L3 the engine never saw the schedule");
});
test("L3: a payment that has ended, or an installment paid off, is not suggested", () => {
  const s = withPlan(base(), 150000);
  s.scheduleChanges = [{ id: "e1", schedule_id: "sc1", kind: "end", effective_from: "2026-09-30", created_at: TS }];
  const r = sug(s, { pin: 2500000, rent: 0 });
  assert.doesNotMatch(r.rows.find((x) => x.category_id === "fun").reason, /scheduled/);
});
test("L3 (owner's rule): a scheduled Streaming in Wants stays in Wants, and its suggestion is at least the scheduled amount", () => {
  const s = withPlan(base(), 120000, "stream");
  s.categories.push({ id: "stream", name: "Streaming", kind: "expense" });   // no role: the owner put it in Wants
  const set = { bucket_overrides: { stream: "want" } };
  assert.equal(fixedMap(s, set, "2026-10-05").has("stream"), false, "the schedule does not make it Fixed");
  assert.equal(bucketMap(s.categories, set.bucket_overrides).get("stream"), "want", "its bucket is still the owner's: Wants");
  const r = sug(s, { pin: 2500000, rent: 0, overrides: set.bucket_overrides });
  assert.equal(r.ok, true);
  const row = r.rows.find((x) => x.category_id === "stream");
  assert.ok(row.suggested >= 120000, "at least the 1,200.00 scheduled");
  assert.ok(r.funding.wants >= 120000, "funded with the wants, not as Fixed");
  // a ROLE the owner set still wins: as a subscription it is Fixed, whatever the schedule
  s.categories.find((c) => c.id === "stream").role = "subscription";
  assert.equal(fixedMap(s, set, "2026-10-05").get("stream"), "role");
});
test("L3: the wants cap never lowers a want below its scheduled payments, and that minimum is funded before the buffer", () => {
  const s = withPlan(monthly(), 100000);   // Fun usually costs 3,000.00; 1,000.00 of it is scheduled. Income typed as 6,000.00: the wants get nothing past what is promised
  const r = sug(s, { pin: 600000 });
  assert.equal(r.ok, true);
  const fun = r.rows.find((x) => x.category_id === "fun"), f = r.funding;
  assert.equal(fun.suggested, 100000, "lowered to fit, but never below the 1,000.00 scheduled");
  assert.match(fun.reason, /Lowered to fit/);
  assert.equal(f.shortBy, Math.max(0, f.fixed + f.needs + f.floor + 100000 - f.income), "the scheduled minimum counts with what must be paid");
});
test("L3: the wants cap never lowers a want below its scheduled payments", () => {
  const s = withPlan(base(), 1000000);   // 10,000.00 scheduled on Fun, a want, against a 25,000.00 income (cap 30% = 7,500.00)
  const r = sug(s, { pin: 2500000, rent: 0 });
  assert.equal(r.ok, true);
  assert.ok(r.rows.find((x) => x.category_id === "fun").suggested >= 1000000, "never below the 10,000.00 scheduled");
});

// ---- SOME MONTHS ONLY (owner, Nov 13): a median of 0 with spending in the usable months suggests the monthly average; nothing spent stays 0 ----
const withUp = (s) => { s.categories.push({ id: "up", name: "Upskill", kind: "expense" }); return s; };
test("a need paid in 2 of 6 months (4,500.00 each) is suggested its average, 1,500.00, not 0; the reason says why", () => {
  const s = withUp(monthly((x) => { for (const [i, m] of M6.entries()) if (i % 3 === 0) spend(x, m + "-12", "up", 450000); }));
  const up = sug(s, { overrides: { up: "need" } }).rows.find((x) => x.category_id === "up");
  assert.equal(up.suggested, 150000, "9,000.00 over 6 months");
  assert.equal(up.reason, "Average of the last 6 usable months (paid only in some months).");
});
test("a category paid every month keeps its median (one big month does not lift it), and one with no spending at all stays 0", () => {
  const s = withUp(monthly((x) => { for (const [i, m] of M6.entries()) spend(x, m + "-12", "up", i === 5 ? 900000 : 150000); }));
  const up = sug(s, { overrides: { up: "need" } }).rows.find((x) => x.category_id === "up");
  assert.equal(up.suggested, 150000, "the median of 1,500.00 x 5 and 9,000.00 x 1 is 1,500.00, not the average 2,750.00");
  assert.match(up.reason, /^Median of the last 6 usable months/);
  const none = sug(withUp(monthly()), { overrides: { up: "need" } }).rows.find((x) => x.category_id === "up");
  assert.equal(none.suggested, 0, "nothing spent: the owner types a figure for a known future cost");
});
test("Suggest a budget shows ONE order (Fixed and Needs, Savings, Wants, Buffer, Other) and rows in the owner's Setup order", () => {
  assert.match(app, /const SUG_TOP = \["need", "savings", "want"\];/);
  assert.match(app, /\.\.\.\[\.\.\.bk\.rows\]\.filter\(\(b\) => b\.bucket !== "other"\)\.sort\(\(p, q\) => SUG_TOP\.indexOf\(p\.bucket\) - SUG_TOP\.indexOf\(q\.bucket\)\)/, "the top card in the groups' order");
  assert.ok(app.includes("const setupAt = new Map(orderedCats(S().categories).map((c, i) => [c.id, i]));") && app.includes("r.rows.sort((p, q) => (setupAt.get(p.category_id) ?? 1e9) - (setupAt.get(q.category_id) ?? 1e9));"), "rows in the Setup order");
});

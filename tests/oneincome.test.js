import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { baseIncome, sharePerPayday, suggestBudgets, suggestPlan, planFormSuggestion, planFormFill, newPlanForm } from "../src/model/index.js";
import { UNLOGGED_CATEGORY_ID } from "../src/model/seed.js";
import { makeState, account } from "./fixtures.js";

// P0-6, PR 1: ONE income for Suggest, Pay plan and Buckets, and hidden categories left out of every suggestion.
// Invented numbers only, worked by hand. Whole centavos: 100000 is 1,000.00.
const TS = "2026-01-01T09:00:00.000+08:00", TODAY = "2026-10-05", MONTH = "2026-10";
const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
let n = 0;
function ledger({ slips = true, games = true } = {}) {
  const s = makeState();
  s.accounts = [account({ id: "chk", name: "Test Checking", class: "asset", opening_balance: 100000000 })];
  s.categories = [{ id: "food", name: "Food", kind: "expense", role: "food" }, { id: "rent", name: "Rent", kind: "expense", role: "rent" }, { id: "fun", name: "Fun", kind: "expense" },
    ...(games ? [{ id: "games", name: "Games", kind: "expense" }] : []), { id: UNLOGGED_CATEGORY_ID, name: "Uncategorized", kind: "expense" }, { id: "pay", name: "Pay", kind: "income" }];
  s.payslips = []; s.payslipLines = []; s.subscriptions = []; s.goals = []; s.rules = [];
  const spend = (date, cat, amount) => { const id = "t" + ++n; s.transactions.push({ id, date, payee: "", memo: "", status: "verified", source: "manual", created_at: TS, verified_at: TS }); s.entries.push({ transaction_id: id, category_id: cat, amount }, { transaction_id: id, account_id: "chk", amount: -amount }); };
  const slip = (date, deposit) => { const id = "p" + ++n; s.payslips.push({ id, employer: "Test Co", period_from: date, period_to: date, pay_date: date, account_id: "chk", transaction_id: "x" + n, printed_gross: deposit, printed_net: deposit, deposit }); s.payslipLines.push({ payslip_id: id, side: "earning", kind: "basic", amount: deposit }); };
  for (const m of ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]) {
    if (slips) { slip(m + "-15", 1400000); slip(m + "-30", 1800000); }   // 14,000.00 and 18,000.00
    for (let i = 0; i < 12; i++) spend(`${m}-${String(2 + i).padStart(2, "0")}`, "food", 50000);
    spend(`${m}-01`, "rent", 600000);
    for (let i = 0; i < 3; i++) spend(`${m}-20`, "fun", 100000);
    if (games) for (let i = 0; i < 3; i++) spend(`${m}-21`, "games", 100000);
  }
  return s;
}
const PIN = 3000000;   // the owner types 30,000.00 a month; the payslips say 14,000.00 + 18,000.00 = 32,000.00

test("a typed 30,000.00 against payslips of 14,000.00 and 18,000.00: Suggest and the Pay plan show the same income and name its source", () => {
  const s = ledger();
  const b = baseIncome(s, { pin: PIN });
  assert.equal(b.amount, PIN); assert.equal(b.source, "pinned"); assert.equal(b.other.amount, 3200000, "the payslips' own figure is kept, to be shown beside the typed one");
  const sug = suggestBudgets({ state: s, pin: PIN, today: TODAY, month: MONTH, rent: 0 });
  assert.equal(sug.income.amount, PIN, "Suggest uses the typed figure");
  const pf = planFormSuggestion(s, newPlanForm(TODAY), { today: TODAY, settings: { income_base_pin: PIN, starter_rent: 0 } });
  assert.equal(pf.pay.reduce((a, c) => a + c, 0), PIN, "the Pay plan's paydays add up to the SAME 30,000.00, not 32,000.00");
  assert.deepEqual(pf.pay, [1312500, 1687500], "shared by what each payday brings in: 14,000 : 18,000, rounded down, the last takes the rest");
  assert.equal(pf.incomeSource.source, "pinned"); assert.equal(pf.incomeSource.other.amount, 3200000);
  const form = planFormFill(s, newPlanForm(TODAY), { today: TODAY, settings: { income_base_pin: PIN, starter_rent: 0 } }).form;
  assert.equal(form.p1, "13125"); assert.equal(form.p2, "16875", "the form opens with the typed income shared out");
});

test("with no typed figure every screen reads the payslips: the same 32,000.00 in Suggest, the Pay plan and baseIncome", () => {
  const s = ledger();
  const b = baseIncome(s);
  assert.equal(b.amount, 3200000); assert.equal(b.source, "payslips"); assert.equal(b.other, null);
  assert.equal(suggestBudgets({ state: s, today: TODAY, month: MONTH, rent: 0 }).income.amount, 3200000);
  const pf = planFormSuggestion(s, newPlanForm(TODAY), { today: TODAY, settings: { starter_rent: 0 } });
  assert.deepEqual(pf.pay, [1400000, 1800000]); assert.equal(pf.pay.reduce((a, c) => a + c, 0), b.amount);
  assert.equal(pf.incomeSource.source, "payslips");
});

test("a typed monthly figure with no payslip is shared by the days each payday covers, to the centavo", () => {
  const s = ledger({ slips: false });
  const pf = planFormSuggestion(s, newPlanForm(TODAY), { today: TODAY, settings: { income_base_pin: PIN } });
  assert.deepEqual(pf.pay, [1548387, 1451613], "the 15th to the last day covers 16 days, the last day to the next 15th covers 15: 30,000.00 x 16/31 rounded down, the rest to the second");
  assert.equal(pf.pay[0] + pf.pay[1], PIN);
  assert.deepEqual(sharePerPayday(PIN, [1]), [PIN]); assert.deepEqual(sharePerPayday(7, [1, 1]), [3, 4], "an odd centavo is never lost");
  assert.deepEqual(sharePerPayday(100, [0, 0]), [100, 0], "no weights: it all goes to the first payday rather than vanish");
});

test("a hidden category gets 0 and no line anywhere in the suggestions (Suggest, the engine, the Pay plan form)", () => {
  const s = ledger(), hidden = ["games"];
  const shown = (r) => r.rows.map((x) => x.category_id);
  assert.ok(shown(suggestBudgets({ state: s, today: TODAY, month: MONTH, rent: 0 })).includes("games"), "control: without hiding, Games has a suggestion");
  const sug = suggestBudgets({ state: s, today: TODAY, month: MONTH, rent: 0, hidden });
  assert.ok(!shown(sug).includes("games"), "no row for the hidden category");
  assert.ok(![...sug.others, ...sug.saved].some((x) => /games/i.test(x.name)));
  const eng = suggestPlan({ state: s, paydays: [{ day: 15 }, { day: "last" }], income: [1400000, 1800000], today: TODAY, month: MONTH, hidden });
  assert.ok(eng.paydays.every((p) => p.lines.every((l) => !/games/i.test(l.name))), "the engine makes no line for it on either payday");
  const withIt = suggestPlan({ state: s, paydays: [{ day: 15 }, { day: "last" }], income: [1400000, 1800000], today: TODAY, month: MONTH });
  assert.ok(withIt.paydays.some((p) => p.lines.some((l) => /games/i.test(l.name))), "control: the engine does make one when it is not hidden");
  const pf = planFormSuggestion(s, newPlanForm(TODAY), { today: TODAY, settings: { starter_rent: 0, hidden_categories: hidden } });
  assert.ok(!("games" in pf.rows), "the Pay plan form has no suggestion for it");
  for (const p of eng.paydays) assert.equal(p.lines.reduce((a, l) => a + l.amount, 0) + p.unallocated - p.short, p.income, "the lines still add up to each payday's income");
});

test("the screens read these: the Suggest window passes the hidden list and shows the figure that is not used", () => {
  assert.match(app, /hidden: M\.hiddenCategoryIds\(set\) \}\); \};/, "Suggest passes the hidden categories");
  assert.match(app, /"Your payslips say"/, "both figures are shown when a typed one differs");
  assert.match(app, /Your payslips say \$\{peso\(inc\.other\.amount\)\}; your own figure is used\./, "the Pay plan says which one is used");
});

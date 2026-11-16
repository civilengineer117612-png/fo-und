// A10 (overhaul, Nov 16; no visible change, data version unchanged): the old Pay plan screens are removed. Since the Pay plan moved into Budget
// (P0-6 PR 2) nothing could open them: the screen (`viewPlan`) had no route and the only "Type in a pay plan" button lived on that screen, so the
// form window, its 15 actions, "Your plan and your budgets agree" and its "Make the budgets match" button were dead code. What STAYS: the model code
// (the form, the suggestion behind it, `planWithBudgets`, `parsePlan`), every saved plan in settings, and every place that still reads a saved plan
// (the plan moving into Budget once, the Emergency Fund status, Scheduled's "Maybe add", the base income when nothing else is known).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import * as M from "../src/model/index.js";

const appDir = new URL("../app/", import.meta.url);
const code = readdirSync(appDir).filter((f) => /\.(js|html)$/.test(f)).map((f) => [f, readFileSync(new URL(f, appDir), "utf8")]);
const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");

test("nothing of the old Pay plan screens is left in the app", () => {
  const gone = ["viewPlan", "planBody(", "planAgreeHtml", "planformBody", "openPlanForm", "planDraft", '"planform"', '"open-planform"', '"save-planform"', '"plan-cancel"',
    '"plan-once"', '"plan-twice"', '"sync-plan-budgets"', '"pf-', "pfSug", "pfMemo", "pfDayNotes", "pp-row", "pp-pay", "pp-big", "pp-left", "plan-agree", "plan-differ", "paydaysLine"];
  for (const [f, text] of code) for (const g of gone) assert.ok(!text.includes(g), `${f} still holds ${g}`);
});

test("what stays: the model code, the saved plans and every reader of them", () => {
  for (const f of ["planFormFill", "planFormSuggestion", "planWithBudgets", "parsePlan", "planTextFromForm", "formFromPlan", "planInEffect", "planMigrationReview", "applyPlanMigration"])
    assert.equal(typeof M[f], "function", f + " is still in the model");
  assert.match(app, /const plansOf = \(\) => ledger\.settings\.plans \?\? \[\];/, "saved plans are still read from settings, never deleted");
  for (const reader of ["M.planMigrationReview(S(), set, thisMonth)", "M.applyPlanMigration(S(), ledger.settings", "M.scheduleHints(S(), t, planOf()", "M.baseIncome(S(), { plan: planOf()"])
    assert.ok(app.includes(reader), "still reads a saved plan: " + reader);
  assert.ok(app.includes('<div class="pp-whole"'), "Budget's own bar keeps its style (it shares the old name)");
  const css = readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
  assert.ok(css.includes(".pp-whole{") && css.includes(".pp-whole span{"), "and that style is still there");
});

test("a saved plan still moves into Budget the same way (invented figures)", () => {
  const plan = { effective_from: "2026-10-01", paydays: [{ day: 15, expected_income: 1000000 }, { day: "last", expected_income: 1000000 }],
    lines: [{ name: "Food", kind: "expense", first: 300000, second: 300000 }] };
  const s = M.emptyState(); s.categories = M.defaultCategories();
  const rv = M.planMigrationReview(s, { plans: [plan] }, "2026-11");
  const food = rv.rows.find((r) => r.name === "Food");
  assert.ok(food && food.plan === 600000, "Food: its two payday amounts added, 6,000.00 a month");
});

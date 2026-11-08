// ONE EMERGENCY TARGET (owner, Nov 8, P0-6 PR 4). The Goals tab, the goal window, the Log card and the savings split all read this one function.
//   - A target the owner TYPED on the emergency fund wins everywhere and is labelled "your figure".
//   - Otherwise the target is the FORMULA: 3 x the monthly budgets of the Fixed and Needs categories this month (hidden categories are in no figure). The
//     formula is shown with its parts, never hidden.
// Nothing is stored: the target changes when the budgets do, until the owner types a figure. The old plan-based status (plan.js) is no longer read by any screen.
import { budgetFor } from "./budget.js";
import { goalSlices } from "./goals.js";
import { fixedMap } from "./fixed.js";
import { bucketOf } from "./buckets.js";
import { UNLOGGED_CATEGORY_ID } from "./seed.js";

export const EF_MONTHS = 3;
const whole = (n) => Number.isSafeInteger(n) && n >= 0;

// The formula alone: {months, parts: [{id, name, amount, fixed}], monthly, target} or null when no Fixed or Needs category has a budget this month.
export function emergencyFormula(state, settings, month, today = month + "-01") {
  const hidden = new Set(settings?.hidden_categories ?? []), fixed = fixedMap(state, settings, today), overrides = settings?.bucket_overrides ?? {};
  const parts = [];
  for (const c of state.categories) {
    if (c.kind !== "expense" || c.id === UNLOGGED_CATEGORY_ID || hidden.has(c.id)) continue;
    const isFixed = fixed.has(c.id);
    if (!isFixed && bucketOf(c, overrides) !== "need") continue;
    const amount = budgetFor(state.rules ?? [], c.id, month) ?? 0;
    if (amount > 0) parts.push({ id: c.id, name: c.name, amount, fixed: isFixed });
  }
  if (!parts.length) return null;
  const monthly = parts.reduce((n, p) => n + p.amount, 0);
  return { months: EF_MONTHS, parts, monthly, target: EF_MONTHS * monthly };
}

// The status of the emergency fund goal: {source: "typed" | "formula", yours, target, formula, balance, remaining, percent, reached, monthly, monthsToTarget} or null
// (no typed figure and no formula yet). `monthly` is what the owner typed for the goal each month (goal_monthly), 0 when none.
export function emergencyFund(state, settings, goal, { month, today } = {}) {
  if (!goal) return null;
  const formula = emergencyFormula(state, settings, month, today), typed = whole(goal.target) && goal.target > 0 ? goal.target : null;
  if (typed === null && !formula) return null;
  const target = typed ?? formula.target, account = state.accounts.find((a) => a.id === goal.account_id);
  const balance = account ? (goalSlices(state, account, goal).get(goal.id)?.balance ?? 0) : 0, remaining = Math.max(0, target - balance);
  const monthly = whole(settings?.goal_monthly?.[goal.id]) ? settings.goal_monthly[goal.id] : 0;
  return { source: typed !== null ? "typed" : "formula", yours: typed !== null, target, formula, balance, remaining, percent: target ? Math.min(100, Math.floor((balance * 100) / target)) : 0, reached: balance >= target,
    monthly, monthsToTarget: remaining === 0 ? 0 : monthly > 0 ? Math.ceil(remaining / monthly) : null };
}

// The words of the formula, for the goal window: "3 x (Rent 20,000 + Food 8,000) = 3 x 28,000".
export const formulaWords = (f, peso) => `${f.months} × (${f.parts.map((p) => `${p.name} ${peso(p.amount)}`).join(" + ")}) = ${f.months} × ${peso(f.monthly)}`;

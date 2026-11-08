// How the money set aside each month is shared between the Goals. Each savings category IS a Goal, so there is no second copy of anything: the
// owner's typed monthly amounts (settings `goal_monthly`, by goal id) and the shares (settings `goal_shares`, whole percents by goal id) are the only inputs
// besides the Goals themselves. Pure functions; the same rule is used by the suggestion engine and by the Budget screen.
//
// SPLIT BY MONTHLY NEED (owner, Nov 8, P0-6 PR 4). Every open goal has a monthly NEED:
//   - with a finish date: what it must receive each month to make the date (the gap over the months left, rounded up);
//   - with no finish date: its gap spread over 12 months (gap / 12, rounded up);
//   - a goal with no target, or one that has reached it, has no need (the emergency fund's target is the owner's typed figure, else 3 x (Fixed + Needs), emergency.js).
// ORDER: 1. a typed amount pins: that goal gets exactly what was typed, out of the total first. 2. When the money covers every need, each goal gets its need and
// what is left over is shared by the percentages the owner set (equally when none are set) between the open goals with no finish date; the emergency fund with
// NO known target is open-ended and takes the surplus first. 3. When the money cannot cover every need: the emergency fund comes FIRST (up to its need), and the
// rest is shared pro rata to need. Every share is a whole number of centavos and the shares add up to the money exactly (the odd centavos go to the biggest need).
// Whatever no goal can take is shown as "Savings" (not placed yet).
import { requiredPerMonth } from "./goals.js";

export const UNPLACED_NAME = "Savings";
export const NEED_MONTHS = 12;   // a goal with no finish date: its gap over this many months
const whole = (n) => Number.isSafeInteger(n) && n >= 0;

// The monthly need of one goal: {need, target, remaining, basis}. basis: "date" | "twelve" | null (no need).
export function monthlyNeed(goal, p, month, emergencyTarget = null) {
  const target = goal.role === "emergency" && p.target == null && emergencyTarget != null ? emergencyTarget : p.target;
  if (target == null) return { need: 0, target: null, remaining: null, basis: null };
  const remaining = Math.max(0, target - p.balance);
  if (!remaining) return { need: 0, target, remaining: 0, basis: null };
  if (goal.deadline) { const n = requiredPerMonth({ remaining }, goal.deadline.slice(0, 7), month); return { need: n.perMonth, target, remaining, basis: "date" }; }
  return { need: Math.ceil(remaining / NEED_MONTHS), target, remaining, basis: "twelve" };
}

// Pro rata: `pool` shared by weights, each rounded down, the odd centavos to the first biggest weight, so the parts add up to the pool exactly.
export function proRata(pool, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  if (!(total > 0) || pool <= 0) return weights.map(() => 0);
  const out = weights.map((w) => Math.floor((pool * w) / total)), big = weights.indexOf(Math.max(...weights));
  out[big] += pool - out.reduce((a, b) => a + b, 0);
  return out;
}

// goals: [{id, name, role?, deadline?}]; progress: Map(goal_id -> goalProgress or null); total: centavos to set aside this month; month: "YYYY-MM".
// emergencyTarget: the emergency fund's target when the owner typed none (the formula), centavos or null.
// Returns {parts: [{goal_id?, name, amount, why, pinned?, need?}], pinnedTotal, needs}. The parts add up to max(total, pinned amounts), exactly.
export function splitSavings({ goals, progress, month, total, pins = {}, shares = {}, emergencyTarget = null }) {
  const known = goals.filter((g) => progress.get(g.id));
  const parts = [];
  const pinned = known.filter((g) => whole(pins[g.id]));
  for (const g of pinned) parts.push({ goal_id: g.id, name: g.name, amount: pins[g.id], why: "The amount you typed, so it is not changed.", pinned: true });
  const pinnedTotal = pinned.reduce((n, g) => n + pins[g.id], 0);
  let pool = Math.max(0, total - pinnedTotal);
  const free = known.filter((g) => !pinned.includes(g) && !(progress.get(g.id).reached));
  const needOf = new Map(free.map((g) => [g.id, monthlyNeed(g, progress.get(g.id), month, emergencyTarget)]));
  const efFree = free.find((g) => g.role === "emergency"), needy = free.filter((g) => needOf.get(g.id).need > 0);
  const totalNeed = needy.reduce((n, g) => n + needOf.get(g.id).need, 0);
  const amount = new Map(free.map((g) => [g.id, 0])), why = new Map();
  const needWhy = (g) => (needOf.get(g.id).basis === "date" ? "What it needs each month to reach its finish date." : `Its gap spread over ${NEED_MONTHS} months.`);
  if (pool >= totalNeed) {
    for (const g of needy) { amount.set(g.id, needOf.get(g.id).need); why.set(g.id, needWhy(g)); }
    pool -= totalNeed;
    // what is left over: an emergency fund with no known target is open-ended and takes it first; else the percentages (equal when none are set)
    if (pool > 0 && efFree && needOf.get(efFree.id).target == null) { amount.set(efFree.id, amount.get(efFree.id) + pool); why.set(efFree.id, "The emergency fund comes first; it has no target yet."); pool = 0; }
    const rest = free.filter((g) => !g.deadline && g.role !== "emergency");
    if (pool > 0 && rest.length) {
      const set = rest.some((g) => whole(shares[g.id]));
      let w = rest.map((g) => (set ? (whole(shares[g.id]) ? shares[g.id] : 0) : 1));
      if (w.every((x) => x === 0)) w = w.map(() => 1);   // every share typed as 0: share equally rather than lose the money
      const out = proRata(pool, w);
      rest.forEach((g, i) => { amount.set(g.id, amount.get(g.id) + out[i]); why.set(g.id, (why.has(g.id) ? why.get(g.id) + " Plus " : "") + (set ? "Shared by the percentages you set." : "Shared equally; set your own percentages in Budget.")); });
      pool = 0;
    }
  } else {
    // the money cannot cover every need: the emergency fund first, then the rest pro rata to need
    const ef = needy.find((g) => g.role === "emergency");
    if (ef) { const give = Math.min(pool, needOf.get(ef.id).need); amount.set(ef.id, give); why.set(ef.id, "The emergency fund comes first when the money does not cover every need."); pool -= give; }
    const others = needy.filter((g) => g !== ef), out = proRata(pool, others.map((g) => needOf.get(g.id).need));
    others.forEach((g, i) => { amount.set(g.id, out[i]); why.set(g.id, ef ? "Shared by need with the other goals; the emergency fund is paid first." : "Shared by need: the money does not cover every need."); });
    pool = 0;
  }
  for (const g of free) parts.push({ goal_id: g.id, name: g.name, amount: amount.get(g.id), why: why.get(g.id) ?? (needOf.get(g.id).need > 0 ? needWhy(g) : "Nothing left to share."), need: needOf.get(g.id).need });
  if (pool > 0) parts.push({ name: UNPLACED_NAME, amount: pool, why: known.length ? "No open goal can take it yet. Add a savings category." : "You have no goal yet. Add a savings category to hold it." });
  return { parts, pinnedTotal, needs: Object.fromEntries(free.map((g) => [g.id, needOf.get(g.id)])) };
}

// Whole percents typed by the owner -> basis points by goal id, or a plain message. The goals shown must add up to exactly 100.
export function parseShares(goalIds, typed) {
  const p = goalIds.map((id) => Number(String(typed[id] ?? "").trim()));
  if (!p.every((n) => Number.isInteger(n) && n >= 0 && n <= 100)) return { ok: false, message: "Use whole numbers from 0 to 100." };
  const sum = p.reduce((a, b) => a + b, 0);
  if (sum !== 100) return { ok: false, message: `The percentages must add up to 100. They add up to ${sum}.` };
  return { ok: true, shares: Object.fromEntries(goalIds.map((id, i) => [id, p[i] * 100])) };
}

// The goals that share the remainder (no finish date, not the emergency fund, not reached): the ones the percentages are for.
export const shareableGoals = (goals, progress) => goals.filter((g) => !g.deadline && g.role !== "emergency" && progress.get(g.id) && !progress.get(g.id).reached);

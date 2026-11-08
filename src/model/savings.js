// How the money set aside each month is shared between the Goals. Each savings category IS a Goal, so there is no second copy of anything: the
// owner's typed monthly amounts (settings `goal_monthly`, by goal id) and the shares (settings `goal_shares`, whole percents by goal id) are the only inputs
// besides the Goals themselves. Pure functions; the same rule is used by the suggestion engine and by the Budget screen.
//
// SPLIT BY MONTHLY NEED (owner, Nov 8, P0-6 PR 4). Every open goal has a monthly NEED:
//   - with a finish date: what it must receive each month to make the date (the gap over the months left, rounded up);
//   - with no finish date: its gap spread over 12 months (gap / 12, rounded up);
//   - a goal with no target, or one that has reached it, has no need (the emergency fund's target is the owner's typed figure, else 3 x (Fixed + Needs), emergency.js).
// ORDER: 1. a typed amount pins: that goal gets exactly what was typed, out of the total first. 2. When the money covers every need, each goal gets its need and
// NOTHING MORE (owner, Nov 8): what is left over is NOT spread by percentages and is never placed by itself: it stays "Left: X, not assigned" and the Budget offers
// "Add to savings" (placeSurplus below), which the owner taps. 3. When the money cannot cover every need: the emergency fund comes FIRST (up to its need), and the
// rest is shared pro rata to need. Every share is a whole number of centavos and the shares add up to the money exactly (the odd centavos go to the biggest need).
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
// Returns {parts: [{goal_id, name, amount, why, pinned?, need}], pinnedTotal, leftover, needs}. The parts and `leftover` add up to max(total, pinned amounts), exactly.
// THE OFFER "Add to savings" (owner, Nov 8): what is Left over after every need can be put on the goals that still have a gap, ONLY when the owner taps. The
// emergency fund comes first (up to its gap), then the other goals by the percentages the owner set (equal when none are set), each up to its gap. Never more than
// a goal can still take; what no goal can take stays Left. goals/progress/emergencyTarget as in splitSavings; `monthly` = {goal_id: centavos} what each goal already
// has a month. Returns {add: {goal_id: centavos}, total, left} (total 0 when no goal can take any: no offer).
export function placeSurplus({ goals, progress, left, monthly = {}, shares = {}, emergencyTarget = null }) {
  const room = new Map();
  for (const g of goals) {
    const p = progress.get(g.id); if (!p || p.reached) continue;
    const target = g.role === "emergency" && p.target == null && emergencyTarget != null ? emergencyTarget : p.target;
    if (target == null) continue;   // a goal with no target has no gap to fill
    const gap = Math.max(0, target - p.balance - (whole(monthly[g.id]) ? monthly[g.id] : 0));
    if (gap > 0) room.set(g.id, gap);
  }
  const add = {};
  let pool = Math.max(0, left);
  const ef = goals.find((g) => g.role === "emergency" && room.has(g.id));
  if (ef) { const give = Math.min(pool, room.get(ef.id)); if (give > 0) { add[ef.id] = give; pool -= give; room.set(ef.id, room.get(ef.id) - give); } }
  const rest = goals.filter((g) => g !== ef && room.get(g.id) > 0);
  if (rest.length && pool > 0) {
    const set = rest.some((g) => whole(shares[g.id]));
    let w = rest.map((g) => (set ? (whole(shares[g.id]) ? shares[g.id] : 0) : 1));
    if (w.every((x) => x === 0)) w = w.map(() => 1);
    const out = proRata(pool, w);
    rest.forEach((g, i) => { const give = Math.min(out[i], room.get(g.id)); if (give > 0) { add[g.id] = (add[g.id] ?? 0) + give; pool -= give; } });
  }
  const total = Object.values(add).reduce((a, b) => a + b, 0);
  return { add, total, left: Math.max(0, left) - total };
}

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
    pool -= totalNeed;   // the rest stays unplaced: the Budget says "Left" and offers "Add to savings"
  } else {
    // the money cannot cover every need: the emergency fund first, then the rest pro rata to need
    const ef = needy.find((g) => g.role === "emergency");
    if (ef) { const give = Math.min(pool, needOf.get(ef.id).need); amount.set(ef.id, give); why.set(ef.id, "The emergency fund comes first when the money does not cover every need."); pool -= give; }
    const others = needy.filter((g) => g !== ef), out = proRata(pool, others.map((g) => needOf.get(g.id).need));
    others.forEach((g, i) => { amount.set(g.id, out[i]); why.set(g.id, ef ? "Shared by need with the other goals; the emergency fund is paid first." : "Shared by need: the money does not cover every need."); });
    pool = 0;
  }
  for (const g of free) parts.push({ goal_id: g.id, name: g.name, amount: amount.get(g.id), why: why.get(g.id) ?? (needOf.get(g.id).need > 0 ? needWhy(g) : "It has no monthly need."), need: needOf.get(g.id).need });
  return { parts, pinnedTotal, leftover: pool, needs: Object.fromEntries(free.map((g) => [g.id, needOf.get(g.id)])) };
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

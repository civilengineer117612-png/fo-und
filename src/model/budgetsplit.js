// ONE BUDGET (P0-6 PR 2): a single stored figure per category per month (the budget rules, budget.js), shown three ways: the whole Month, each payday's
// share of it, and a Per week guide. Changing the view never changes the monthly figure; only editing an amount does. Pure functions, nothing stored here:
// the screen saves the results through the existing append-only budget change and the settings below.
//
// Settings added (all optional, absent is valid; data version unchanged):
//   pay_schedule   {days: [15, "last"]}                         the paydays of a month (PR 3 gives the owner more ways to set it); until it is set the
//                                                              paydays are read from the newest saved Pay plan.
//   budget_split   {key: {amounts: [centavos per payday], for: monthly figure}}   a split the owner moved by hand; used only while it still adds up to
//                                                              the monthly figure it was made for, so a changed budget never leaves a stale split.
//   payday_pins    {key: payday index}                          the whole amount on one payday (rent on the last-day payday).
//   goal_monthly   {goal_id: centavos}  (existing)              the monthly amount of a goal.   buffer_monthly: centavos, the overrun buffer a month.
// `key` is the category id, "goal:<id>" for a goal, "buffer" for the buffer.
//
// THE RULE: for every line, its payday shares add up to its monthly figure EXACTLY (centavos). Nothing is rounded away: what rounding leaves out of the
// Per week guide is stated, and what is not placed on a payday is shown as "Left".
import { budgetFor, planBudgetChange } from "./budget.js";
import { baseIncome, sharePerPayday } from "./budgetview.js";
import { planBudgetRows } from "./planwrite.js";
import { netPerPayday } from "./income.js";
import { payBase } from "./stablepay.js";
import { median, paydayDays, nearestPayday } from "./suggest.js";
import { ordinal } from "./planform.js";
import { cutoffFor, dayIn } from "./plan.js";
import { reportingCategory } from "./rules.js";
import { heldIds } from "./held.js";
import { bucketOf, BUCKET_LABELS } from "./buckets.js";
import { UNLOGGED_CATEGORY_ID } from "./seed.js";

const whole = (n) => Number.isSafeInteger(n) && n >= 0;
const sum = (list) => list.reduce((a, b) => a + b, 0);

// ---------- Per week: a guide ----------
export const weekFigure = (centavos) => Math.floor((centavos * 12) / 52);

// ---------- the paydays ----------
const newestPlan = (settings) => [...(settings.plans ?? [])].sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1)).at(-1) ?? null;
export function paydaysFor(settings) {
  const days = settings.pay_schedule?.days ?? newestPlan(settings)?.paydays?.map((p) => p.day) ?? [];
  const label = (d) => (d === "last" ? "Last day" : ordinal(Number(d)));
  return days.slice(0, 2).map((day, i) => ({ id: i === 0 ? "first" : "second", day, label: days.length === 1 ? "Payday" : label(day) }));
}

// The one monthly income shared out over the paydays: by what each payday brings in from the payslips when every payday has one, else by the days each covers.
export function paydayIncomes(state, settings, month) {
  const paydays = paydaysFor(settings), income = baseIncome(state, { pin: Number.isSafeInteger(settings.income_base_pin) ? settings.income_base_pin : null });
  if (!paydays.length || !income.amount) return { paydays, income, incomes: paydays.map(() => 0), total: income.amount ?? 0 };
  const slips = payBase(netPerPayday(state)).rows, nets = paydays.map(() => []);
  for (const r of slips) nets[nearestPayday(paydays, r.date)].push(r.stable);
  const days = paydayDays(paydays, month), byDays = paydays.length === 1 ? [1] : [days.days1, days.days2];
  const weights = nets.every((l) => l.length) ? nets.map((l) => median(l.slice(-3), "low")) : byDays;
  return { paydays, income, incomes: sharePerPayday(income.amount, weights), total: income.amount };
}

// ---------- the lines of a month ----------
// Every line with a monthly figure: spending categories (not Uncategorized, not hidden), goals with a monthly amount, the buffer. Hidden categories are listed
// apart and never take part in a payday or a total.
export function budgetLines(state, settings, month) {
  const hiddenIds = new Set(settings.hidden_categories ?? []), overrides = settings.bucket_overrides ?? {}, lines = [], hidden = [];
  for (const c of state.categories) {
    if (c.kind !== "expense" || c.id === UNLOGGED_CATEGORY_ID) continue;
    const amount = budgetFor(state.rules ?? [], c.id, month) ?? 0;
    if (!(amount > 0)) continue;
    if (hiddenIds.has(c.id)) { hidden.push({ key: c.id, id: c.id, name: c.name, amount }); continue; }
    lines.push({ key: c.id, kind: "category", id: c.id, name: c.name, group: BUCKET_LABELS[bucketOf(c, overrides)] ?? "Other", amount });
  }
  for (const g of state.goals ?? []) { const amount = settings.goal_monthly?.[g.id]; if (whole(amount) && amount > 0) lines.push({ key: "goal:" + g.id, kind: "goal", id: g.id, name: g.name, group: "Savings", amount }); }
  if (whole(settings.buffer_monthly) && settings.buffer_monthly > 0) lines.push({ key: "buffer", kind: "buffer", id: "buffer", name: "Buffer", group: "Buffer", amount: settings.buffer_monthly });
  return { lines, hidden };
}

// ---------- a line's shares over the paydays ----------
// In order: a split the owner moved by hand (while it still adds up), the whole amount on one payday (a pin), else by the paydays' income.
export function paydayShares(settings, line, incomes) {
  const n = incomes.length;
  if (n <= 1) return [line.amount];
  const moved = settings.budget_split?.[line.key];
  if (moved && moved.for === line.amount && moved.amounts?.length === n && moved.amounts.every(whole) && sum(moved.amounts) === line.amount) return moved.amounts;
  const pin = settings.payday_pins?.[line.key];
  if (Number.isInteger(pin) && pin >= 0 && pin < n) return incomes.map((_, i) => (i === pin ? line.amount : 0));
  return sharePerPayday(line.amount, incomes);
}

// The whole Budget of a month in its three views.
export function budgetPlan(state, settings, month) {
  const { lines, hidden } = budgetLines(state, settings, month), { paydays, income, incomes, total } = paydayIncomes(state, settings, month);
  const placed = sum(lines.map((l) => l.amount));
  const perPayday = paydays.map((p, i) => {
    const rows = lines.map((l) => ({ ...l, amount: paydayShares(settings, l, incomes)[i] })), p_ = sum(rows.map((r) => r.amount));
    return { ...p, income: incomes[i], rows, placed: p_, left: incomes[i] - p_ };
  });
  const weeks = lines.map((l) => ({ ...l, amount: weekFigure(l.amount) })), weekPlaced = sum(weeks.map((r) => r.amount));
  const weekIncome = weekFigure(total);
  // what rounding down leaves out of the guide, per month: (monthly - weekly x 52 / 12), in whole centavos rounded down
  const roundedAway = Math.floor((placed * 12 - sum(weeks.map((r) => r.amount)) * 52) / 12);
  return { month, income, lines, hidden, paydays,
    monthView: { income: total, rows: lines, placed, left: total - placed },
    perPayday,
    perWeek: { income: weekIncome, rows: weeks, placed: weekPlaced, left: weekIncome - weekPlaced, roundedAway } };
}

// ---------- editing ----------
const withSplit = (settings, key, amounts, forAmount) => ({ ...settings, budget_split: { ...(settings.budget_split ?? {}), [key]: { amounts, for: forAmount } } });
const withoutKey = (obj, key) => { if (!obj || !(key in obj)) return obj; const { [key]: _gone, ...rest } = obj; return rest; };

// Moves `amount` of one line from one payday to another. The month's figure stays what it was; the shares still add up to it.
export function movePayday(settings, line, incomes, from, to, amount) {
  const now = paydayShares(settings, line, incomes), n = incomes.length;
  if (!whole(amount) || amount === 0) return { ok: false, message: "Type an amount to move." };
  if (!(Number.isInteger(from) && Number.isInteger(to) && from !== to && from >= 0 && to >= 0 && from < n && to < n)) return { ok: false, message: "Choose two different paydays." };
  if (amount > now[from]) return { ok: false, message: "That payday holds only a smaller amount of this line." };
  const next = [...now]; next[from] -= amount; next[to] += amount;
  return { ok: true, settings: withSplit({ ...settings, payday_pins: withoutKey(settings.payday_pins, line.key) }, line.key, next, line.amount), amounts: next };
}

// The whole amount of a line on one payday (index), or back to sharing it by income (null). A split made by hand is dropped: the pin is the owner's newer word.
export function pinPayday(settings, key, index) {
  const base = { ...settings, budget_split: withoutKey(settings.budget_split, key) };
  return index === null ? { ...base, payday_pins: withoutKey(settings.payday_pins, key) } : { ...base, payday_pins: { ...(settings.payday_pins ?? {}), [key]: index } };
}

// The owner types the amounts of a line, one per payday. When they still add up to the monthly figure it is only a move; when they do not, the monthly
// figure becomes their total (editing a payday edits the month). A category's budget starts this month (append-only, budget.js); a goal's and the buffer's
// monthly amounts are settings.
export function setPaydayAmounts(state, settings, line, incomes, amounts, { newId, now = new Date(), month }) {
  if (!Array.isArray(amounts) || amounts.length !== incomes.length || !amounts.every(whole)) return { ok: false, message: "Amounts must be whole centavos, one for each payday." };
  const total = sum(amounts);
  let st = state, set = settings;
  if (total !== line.amount) {
    if (line.kind === "category") {
      if (total === 0) return { ok: false, message: "Zero on every payday removes the budget: change it from its own window." };
      const r = planBudgetChange(state, { id: newId(), category_id: line.id, amount: total, from_month: month }, now);
      if (!r.ok) return { ok: false, message: r.violations[0].message };
      st = r.state;
    } else if (line.kind === "goal") set = { ...set, goal_monthly: { ...(set.goal_monthly ?? {}), [line.id]: total } };
    else set = { ...set, buffer_monthly: total };
  }
  return { ok: true, state: st, settings: withSplit({ ...set, payday_pins: withoutKey(set.payday_pins, line.key) }, line.key, amounts, total), total };
}
export function setPaydayAmount(state, settings, line, incomes, index, amount, ctx) {
  if (!whole(amount)) return { ok: false, message: "Amounts must be whole centavos." };
  return setPaydayAmounts(state, settings, line, incomes, paydayShares(settings, line, incomes).map((s, i) => (i === index ? amount : s)), ctx);
}

// ---------- cutoff progress and pay received (kept from the old Pay plan screen) ----------
// For each payday of `month`: its cutoff (from that payday to the day before the next one; the last payday runs into next month's first), what was
// VERIFIED-spent in each category inside it (a held count gap and the entry that cancels it are not spending), and the pay that really arrived in it
// (verified income entries). Nothing is stored. The result is keyed by payday index; `spent` by category id.
export function paydayProgress(state, settings, month, { categoryMaps = [] } = {}) {
  const paydays = paydaysFor(settings);
  if (!paydays.length) return [];
  const [y, m] = month.split("-").map(Number), pseudo = { paydays: paydays.map((p) => ({ day: p.day })) };
  const expense = new Set(state.categories.filter((c) => c.kind === "expense").map((c) => c.id)), income = new Set(state.categories.filter((c) => c.kind === "income").map((c) => c.id));
  const txById = new Map(state.transactions.map((t) => [t.id, t])), held = heldIds(state);
  return paydays.map((p) => {
    const date = month + "-" + String(dayIn(p.day, y, m)).padStart(2, "0"), period = cutoffFor(pseudo, date), spent = {};
    let received = 0, count = 0;
    for (const e of state.entries) {
      if (e.category_id == null) continue;
      const t = txById.get(e.transaction_id);
      if (!t || t.status !== "verified" || held.has(t.id) || t.date < period.start || t.date > period.end) continue;
      if (expense.has(e.category_id)) { const id = reportingCategory(categoryMaps, e.category_id, date); spent[id] = (spent[id] ?? 0) + e.amount; }
      else if (income.has(e.category_id)) { received -= e.amount; count++; }   // income is a credit, stored negative
    }
    return { ...p, start: period.start, end: period.end, spent, received, count };
  });
}

// Expected, Received and Difference for a header (a payday or the month): `received` is null until pay has been logged in those dates, so the screen leaves it
// blank; the difference is received less expected (positive: more came in than expected).
export function payHeader(expected, received, count) {
  if (!count) return { expected, received: null, difference: null };
  return { expected, received, difference: received - expected };
}

// Pay that was really logged in a calendar month (verified income entries; a held gap is not pay): {received, count}.
export function monthPay(state, month) {
  const income = new Set(state.categories.filter((c) => c.kind === "income").map((c) => c.id)), txById = new Map(state.transactions.map((t) => [t.id, t])), held = heldIds(state);
  let received = 0, count = 0;
  for (const e of state.entries) {
    if (e.category_id == null || !income.has(e.category_id)) continue;
    const t = txById.get(e.transaction_id);
    if (!t || t.status !== "verified" || held.has(t.id) || !t.date.startsWith(month + "-")) continue;
    received -= e.amount; count++;
  }
  return { received, count };
}

// ---------- the Pay plan moves into Budget ----------
// The newest saved Pay plan in force: for each of its spending lines that matches a category (by the plan's own names), the monthly figure is the sum of its
// two payday amounts and the shares keep the old amounts. Where the bucket (the budget now) and the plan disagree, the BUCKET wins by default (a plan saved
// by an older version could hold a figure copied on each payday); the owner confirms or switches each one. With no budget the plan's figure is used: there is
// nothing for the bucket to win. Goal lines become the goal's monthly amount and the buffer line the buffer, only where the owner has not typed one.
export function planMigrationReview(state, settings, month) {
  if (settings.plan_moved) return { done: true, rows: [], goals: [], buffer: null, agree: 0, plan: null };
  const plan = newestPlan(settings);
  if (!plan) return { done: false, rows: [], goals: [], buffer: null, agree: 0, plan: null };
  const { rows: planRows } = planBudgetRows(state, plan), rows = [], byName = new Map(plan.lines.map((l) => [l.name.trim().toLowerCase(), l]));
  let agree = 0;
  for (const r of planRows) {
    const line = byName.get(r.name.trim().toLowerCase()), budget = budgetFor(state.rules ?? [], r.category_id, month), shares = [line.first, line.second].slice(0, plan.paydays.length);
    if ((budget ?? 0) === r.amount) { agree++; continue; }
    rows.push({ category_id: r.category_id, name: r.name, plan: r.amount, budget, shares, default: budget ? "bucket" : "plan" });
  }
  const goals = plan.lines.filter((l) => l.kind === "goal").map((l) => ({ name: l.name, amount: l.first + l.second, goal_id: (state.goals ?? []).find((g) => g.name.trim().toLowerCase() === l.name.trim().toLowerCase())?.id ?? null }))
    .filter((g) => g.goal_id && !whole(settings.goal_monthly?.[g.goal_id]) && g.amount > 0);
  const bufferLine = plan.lines.find((l) => l.kind === "buffer"), buffer = bufferLine && !whole(settings.buffer_monthly) && bufferLine.first + bufferLine.second > 0 ? bufferLine.first + bufferLine.second : null;
  const anything = rows.length || agree || goals.length || buffer;
  return { done: false, rows, goals, buffer, agree, plan, nothing: !anything };
}

// choices: {category_id: "bucket" | "plan"}; a row not named takes its default. Returns {ok, state, settings, changes} or {ok: false, message}.
// The old plans stay where they are (nothing is deleted); the move is recorded by `plan_moved` (the month). Budget changes start in `month`; earlier months
// keep the budgets they had.
export function applyPlanMigration(state, settings, choices, { newId, now = new Date(), month }) {
  const review = planMigrationReview(state, settings, month);
  if (review.done || !review.plan) return { ok: false, message: "There is no Pay plan to move." };
  let st = state, set = { ...settings, budget_split: { ...(settings.budget_split ?? {}) } };
  const changes = [], plan = review.plan, n = plan.paydays.length;
  const agreed = planBudgetRows(state, plan).rows.filter((r) => !review.rows.some((x) => x.category_id === r.category_id));
  for (const r of agreed) {
    const line = plan.lines.find((l) => l.name.trim().toLowerCase() === r.name.trim().toLowerCase()), shares = [line.first, line.second].slice(0, n);
    if (n > 1 && sum(shares) === r.amount) set.budget_split[r.category_id] = { amounts: shares, for: r.amount };
  }
  for (const r of review.rows) {
    const choice = choices?.[r.category_id] ?? r.default;
    if (choice === "plan") {
      const x = planBudgetChange(st, { id: newId(), category_id: r.category_id, amount: r.plan, from_month: month }, now);
      if (!x.ok) return { ok: false, message: x.violations[0].message };
      st = x.state; changes.push({ category_id: r.category_id, name: r.name, from: r.budget, to: r.plan });
      if (n > 1) set.budget_split[r.category_id] = { amounts: r.shares, for: r.plan };
    } else changes.push({ category_id: r.category_id, name: r.name, from: r.budget, to: r.budget });   // the bucket stays; its payday shares follow the income
  }
  if (review.goals.length) set.goal_monthly = { ...(set.goal_monthly ?? {}), ...Object.fromEntries(review.goals.map((g) => [g.goal_id, g.amount])) };
  if (review.buffer) set.buffer_monthly = review.buffer;
  if (!set.pay_schedule) set.pay_schedule = { days: plan.paydays.map((p) => p.day) };
  set.plan_moved = month;
  return { ok: true, state: st, settings: set, changes };
}

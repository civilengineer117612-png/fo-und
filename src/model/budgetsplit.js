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
import { dayIn } from "./plan.js";
import { reportingCategory } from "./rules.js";
import { heldIds } from "./held.js";
import { bucketOf, BUCKET_LABELS } from "./buckets.js";
import { UNLOGGED_CATEGORY_ID } from "./seed.js";
import { fixedMap, FIXED_LABEL } from "./fixed.js";

const whole = (n) => Number.isSafeInteger(n) && n >= 0;
const sum = (list) => list.reduce((a, b) => a + b, 0);

// ---------- Per week: a guide ----------
export const weekFigure = (centavos) => Math.floor((centavos * 12) / 52);

// ---------- the paydays ----------
// The owner's pay schedule (settings `pay_schedule`, P0-6 PR 3), one of:
//   {kind: "twice", days: [d1, d2]}   any two days of the month (a day is 1 to 28 or "last")
//   {kind: "monthly", days: [d]}      one day a month
//   {kind: "biweekly", start: "YYYY-MM-DD"}   every two weeks from one known payday; a THIRD payday in a month is an EXTRA payday (stablepay.js): it shows,
//                                     with its own pay, but no line is shared onto it and its pay is not in the month's income
//   {kind: "weekly", weekday: 0-6}    every week on that weekday (0 is Sunday); a month has four or five
// An older {days} (from the Pay plan move) is "twice" with two days and "monthly" with one. With no schedule the paydays of the newest saved Pay plan stand in.
const newestPlan = (settings) => [...(settings.plans ?? [])].sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1)).at(-1) ?? null;
const DAY = 86400000, iso = (ms) => new Date(ms).toISOString().slice(0, 10), ms = (d) => Date.parse(d + "T00:00:00Z");
const nextMonth = (month) => { const [y, m] = month.split("-").map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; };
export function scheduleOf(settings) {
  const s = settings.pay_schedule;
  if (s?.kind === "biweekly" && /^\d{4}-\d{2}-\d{2}$/.test(s.start ?? "")) return { kind: "biweekly", start: s.start };
  if (s?.kind === "weekly" && Number.isInteger(s.weekday) && s.weekday >= 0 && s.weekday <= 6) return { kind: "weekly", weekday: s.weekday };
  const days = s?.days ?? newestPlan(settings)?.paydays?.map((p) => p.day) ?? [];
  if (!days.length) return null;
  return days.length === 1 ? { kind: "monthly", days: [days[0]] } : { kind: "twice", days: days.slice(0, 2) };
}
// Every payday of a month, oldest first: [{date, day}] ("day" is the schedule's own day for twice and monthly, the day of the month otherwise).
export function payDatesIn(schedule, month) {
  if (!schedule) return [];
  const [y, m] = month.split("-").map(Number), first = `${month}-01`, last = `${month}-${String(dayIn("last", y, m)).padStart(2, "0")}`;
  if (schedule.kind === "twice" || schedule.kind === "monthly") return schedule.days.map((d) => ({ date: `${month}-${String(dayIn(d, y, m)).padStart(2, "0")}`, day: d })).sort((a, b) => (a.date < b.date ? -1 : 1));
  let t;
  if (schedule.kind === "biweekly") { const k = Math.floor((ms(first) - ms(schedule.start)) / (14 * DAY)); t = ms(schedule.start) + k * 14 * DAY; while (t < ms(first)) t += 14 * DAY; }
  else { t = ms(first); while (new Date(t).getUTCDay() !== schedule.weekday) t += DAY; }
  const out = [];
  for (; t <= ms(last); t += (schedule.kind === "biweekly" ? 14 : 7) * DAY) out.push({ date: iso(t), day: Number(iso(t).slice(8)) });
  return out;
}
// The paydays of a month as the screen shows them: [{id, label, day, date, extra?}]. Two-a-month ones keep their labels ("15th", "Last day"); the others are
// named by their day of the month; a third bi-weekly payday is marked extra.
export function paydaysFor(settings, month) {
  const sc = scheduleOf(settings);
  if (!sc) return [];
  if (!month) return (sc.days ?? []).map((day, i) => ({ id: i === 0 ? "first" : "second", day, label: sc.days.length === 1 ? "Payday" : day === "last" ? "Last day" : ordinal(Number(day)) }));
  const dates = payDatesIn(sc, month);
  return dates.map((d, i) => {
    if (sc.kind === "twice" || sc.kind === "monthly") return { id: i === 0 ? "first" : "second", day: d.day, date: d.date, label: sc.kind === "monthly" ? "Payday" : d.day === "last" ? "Last day" : ordinal(Number(d.day)) };
    const extra = sc.kind === "biweekly" && i >= 2;
    return { id: "p" + i, day: d.day, date: d.date, label: ordinal(d.day) + (extra ? " (extra)" : ""), ...(extra ? { extra: true } : {}) };
  });
}
// What the payslips suggest, to fill the Paydays window in: {schedule, label} or null. Bi-weekly starts from the newest payslip's pay date; semi-monthly
// takes the days of the last two pay dates (a day after the 28th is "last"); monthly the day of the newest. `label` is the payslip's own words ("Bi-Week").
export function scheduleFromPayslips(state) {
  const rows = payBase(netPerPayday(state)).rows, f = payBase(netPerPayday(state)).frequency;
  if (!f || !rows.length) return null;
  const dates = rows.map((r) => r.date).sort(), newest = dates.at(-1), d = (x) => { const n = Number(x.slice(8)); return n > 28 ? "last" : n; };
  if (f.kind === "biweekly") return { schedule: { kind: "biweekly", start: newest }, label: f.label ?? null };
  if (f.kind === "monthly") return { schedule: { kind: "monthly", days: [d(newest)] }, label: f.label ?? null };
  const two = [...new Set(dates.slice(-2).map(d))].sort((a, b) => (a === "last" ? 1 : b === "last" ? -1 : a - b));
  return two.length === 2 ? { schedule: { kind: "twice", days: two }, label: f.label ?? null } : null;
}

// The one monthly income shared out over the REGULAR paydays: by what each brings in from the payslips when every payday has one (twice a month), else by the
// days each covers (twice a month), else equally (every two weeks, every week, once a month). An extra payday is shown with its own pay (the per-payday
// figure the payslips give, else the month shared by the regular paydays) and is NOT part of the month's income.
export function paydayIncomes(state, settings, month) {
  const paydays = paydaysFor(settings, month), sc = scheduleOf(settings), income = baseIncome(state, { pin: Number.isSafeInteger(settings.income_base_pin) ? settings.income_base_pin : null });
  const regular = paydays.filter((p) => !p.extra);
  if (!paydays.length || !income.amount) return { paydays, income, incomes: paydays.map(() => 0), regularIncomes: regular.map(() => 0), total: income.amount ?? 0 };
  let weights = regular.map(() => 1);
  if (sc.kind === "twice") {
    const slips = payBase(netPerPayday(state)).rows, nets = regular.map(() => []);
    for (const r of slips) nets[nearestPayday(regular, r.date)].push(r.stable);
    const days = paydayDays(regular, month);
    weights = nets.every((l) => l.length) ? nets.map((l) => median(l.slice(-3), "low")) : [days.days1, days.days2];
  }
  const regularIncomes = sharePerPayday(income.amount, weights), each = income.perPayday ?? Math.floor(income.amount / regular.length);
  let r = 0;
  return { paydays, income, incomes: paydays.map((p) => (p.extra ? each : regularIncomes[r++])), regularIncomes, total: income.amount };
}

// ---------- the lines of a month ----------
// Every line with a monthly figure: spending categories (not Uncategorized, not hidden), goals with a monthly amount, the buffer. Hidden categories are listed
// apart and never take part in a payday or a total.
// A Fixed category (fixed.js: rent or a subscription, a scheduled payment, or one the owner chose) is listed in its own group, "Fixed", ahead of the buckets.
export function budgetLines(state, settings, month, today = month + "-01") {
  const hiddenIds = new Set(settings.hidden_categories ?? []), overrides = settings.bucket_overrides ?? {}, lines = [], hidden = [], fixed = fixedMap(state, settings, today);
  for (const c of state.categories) {
    if (c.kind !== "expense" || c.id === UNLOGGED_CATEGORY_ID) continue;
    const amount = budgetFor(state.rules ?? [], c.id, month) ?? 0;
    if (!(amount > 0)) continue;
    if (hiddenIds.has(c.id)) { hidden.push({ key: c.id, id: c.id, name: c.name, amount }); continue; }
    lines.push({ key: c.id, kind: "category", id: c.id, name: c.name, group: fixed.has(c.id) ? FIXED_LABEL : BUCKET_LABELS[bucketOf(c, overrides)] ?? "Other", ...(fixed.has(c.id) ? { fixed: fixed.get(c.id) } : {}), amount });
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
export function budgetPlan(state, settings, month, today = month + "-01") {
  const { lines, hidden } = budgetLines(state, settings, month, today), { paydays, income, incomes, regularIncomes, total } = paydayIncomes(state, settings, month);
  const placed = sum(lines.map((l) => l.amount)), shares = new Map(lines.map((l) => [l.key, paydayShares(settings, l, regularIncomes)]));
  let reg = 0;
  const perPayday = paydays.map((p, i) => {
    const at = p.extra ? null : reg++;   // an extra payday takes no share of any line
    const rows = lines.map((l) => ({ ...l, amount: at === null ? 0 : shares.get(l.key)[at] })), p_ = sum(rows.map((r) => r.amount));
    return { ...p, reg: at, income: incomes[i], rows, placed: p_, left: incomes[i] - p_ };
  });
  const weeks = lines.map((l) => ({ ...l, amount: weekFigure(l.amount) })), weekPlaced = sum(weeks.map((r) => r.amount));
  const weekIncome = weekFigure(total);
  // what rounding down leaves out of the guide, per month: (monthly - weekly x 52 / 12), in whole centavos rounded down
  const roundedAway = Math.floor((placed * 12 - sum(weeks.map((r) => r.amount)) * 52) / 12);
  return { month, income, lines, hidden, paydays, regularIncomes,
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
  const paydays = paydaysFor(settings, month);
  if (!paydays.length) return [];
  const after = payDatesIn(scheduleOf(settings), nextMonth(month))[0]?.date ?? null;
  const expense = new Set(state.categories.filter((c) => c.kind === "expense").map((c) => c.id)), income = new Set(state.categories.filter((c) => c.kind === "income").map((c) => c.id));
  const txById = new Map(state.transactions.map((t) => [t.id, t])), held = heldIds(state);
  return paydays.map((p, i) => {
    const nextDate = paydays[i + 1]?.date ?? after, start = p.date, end = nextDate ? iso(ms(nextDate) - DAY) : `${month}-${String(dayIn("last", ...month.split("-").map((x) => Number(x)))).padStart(2, "0")}`, spent = {};
    let received = 0, count = 0;
    for (const e of state.entries) {
      if (e.category_id == null) continue;
      const t = txById.get(e.transaction_id);
      if (!t || t.status !== "verified" || held.has(t.id) || t.date < start || t.date > end) continue;
      if (expense.has(e.category_id)) { const id = reportingCategory(categoryMaps, e.category_id, p.date); spent[id] = (spent[id] ?? 0) + e.amount; }
      else if (income.has(e.category_id)) { received -= e.amount; count++; }   // income is a credit, stored negative
    }
    return { ...p, start, end, spent, received, count };
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
  if (!set.pay_schedule) set.pay_schedule = plan.paydays.length === 1 ? { kind: "monthly", days: [plan.paydays[0].day] } : { kind: "twice", days: plan.paydays.map((p) => p.day) };
  set.plan_moved = month;
  return { ok: true, state: st, settings: set, changes };
}

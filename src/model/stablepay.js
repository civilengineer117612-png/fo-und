// Stable pay (owner, Oct 31; no saved-data change): the budget's base income is what a payday reliably brings, so the variable parts of a payslip are left out of it.
// Stable pay of a payslip = what arrived (the deposit) minus its VARIABLE earnings lines: Overtime (confirmed), Holiday and night pay, Bonus and 13th month,
// and any line flagged back pay ("Retro ..."). A payslip saved before every printed line was kept has no lines to read, so only its confirmed overtime
// is left out, as before. The deposit itself is never changed: this only decides what the BUDGET may count on.
// A third payday in a month (a bi-weekly employee gets one now and then) is an "Extra payday": counted as income, never in the base.
// Pure functions. No colour, no screen.

export const VARIABLE_CATEGORIES = ["overtime", "holiday_night", "bonus"];
const WHY = { overtime: "Overtime", holiday_night: "Holiday and night pay", bonus: "Bonus and 13th month", back_pay: "Back pay", one_off: "One-off earnings" };

export const labelKey = (label) => String(label ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// A line with no category the owner chose counts as pay you can rely on only when the same label was on at least 2 of the last 3 payslips from that employer
// (this one included). `recurring` is that test for one label; without it (no history to look at) an uncategorised line is left in the base, as before.
export const RECURRENCE_MIN = 2, RECURRENCE_WINDOW = 3;
export function recurringLabels(window) {
  const seen = new Map();
  for (const items of window) for (const k of new Set((items ?? []).filter((i) => i.section === "earning").map((i) => labelKey(i.label)))) seen.set(k, (seen.get(k) ?? 0) + 1);
  return (label) => (seen.get(labelKey(label)) ?? 0) >= RECURRENCE_MIN;
}

// The variable earnings lines of a payslip's printed items: [{label, amount, why}]. A 0.00 line adds nothing, so it is not listed.
// The owner's category decides when there is one (Allowances stay in, Bonus stays out); only a line with none asks `recurring`.
export function variableParts(items, recurring) {
  return (items ?? []).filter((i) => i.section === "earning" && i.amount > 0).flatMap((i) => {
    const uncategorised = !i.category || i.category === "other_earning";
    const why = i.back_pay === true ? "back_pay" : i.overtime === true ? "overtime" : VARIABLE_CATEGORIES.includes(i.category) ? i.category : recurring && uncategorised && !recurring(i.label) ? "one_off" : null;
    return why ? [{ label: i.label, amount: i.amount, why, name: WHY[why] }] : [];
  });
}

// {stable, variable, parts, source}: `source` is "items" when the printed lines were read, "lines" for an old payslip (only its overtime is known).
// The variable part never goes above what arrived, so stable pay is never negative.
export function stableOf({ deposit, items, lines, recurring }) {
  if ((items ?? []).length) {
    const parts = variableParts(items, recurring), variable = Math.min(parts.reduce((n, p) => n + p.amount, 0), deposit);
    return { stable: deposit - variable, variable, parts, source: "items" };
  }
  const ot = (lines ?? []).filter((l) => l.side === "earning" && l.kind === "overtime").reduce((n, l) => n + l.amount, 0), variable = Math.min(ot, deposit);
  return { stable: deposit - variable, variable, parts: variable ? [{ label: "Overtime", amount: variable, why: "overtime", name: WHY.overtime }] : [], source: "lines" };
}

// ---------- how often this employer pays ----------
// From the payslip's own period type, as printed ("Bi-Week", "Semi-Monthly", "Monthly"); a word we do not know says nothing.
export function periodKind(text) {
  const s = String(text ?? "").toLowerCase().replace(/[^a-z]+/g, " ").trim();
  if (!s) return null;
  if (/\bbi ?week(?:ly)?\b|\bfortnight/.test(s)) return "biweekly";
  if (/\bsemi ?monthly\b|\btwice\b|\bhalf ?month/.test(s)) return "semimonthly";
  if (/\bmonthly\b|\bmonth\b/.test(s)) return "monthly";
  return null;
}
const DAY = 86400000, dayNo = (d) => Math.round(Date.parse(d + "T00:00:00Z") / DAY);
// Worked out from the pay dates when no payslip says: dates a fixed 14 days apart = bi-weekly; ONE cluster of days of the month = monthly; TWO fixed days
// = semi-monthly. Fewer than 3 payslips, or no clear pattern, says nothing.
export function inferKind(dates) {
  const sorted = [...new Set(dates)].sort();
  if (sorted.length < 3) return null;
  const gaps = sorted.slice(1).map((d, i) => dayNo(d) - dayNo(sorted[i]));
  if (gaps.every((g) => g >= 12 && g <= 16) && gaps.filter((g) => g === 14).length * 2 >= gaps.length) return "biweekly";   // a fixed fortnight; a semi-monthly gap is 15 or 16 days, never 14
  const days = [...new Set(sorted.map((d) => Number(d.slice(8))))].sort((a, b) => a - b), clusters = [];
  for (const d of days) { const last = clusters[clusters.length - 1]; if (last && d - last[last.length - 1] <= 3) last.push(d); else clusters.push([d]); }
  if (clusters.length === 1) return "monthly";
  if (clusters.length === 2 && clusters[1][0] - clusters[0][clusters[0].length - 1] >= 10) return "semimonthly";
  return null;
}
// {kind, from, label}: `from` is "period_type" (the newest payslip that has one says) or "pay dates" (worked out); null when neither can say.
export function payFrequency(rows) {
  const typed = rows.slice().reverse().find((r) => periodKind(r.period_type));
  if (typed) return { kind: periodKind(typed.period_type), from: "period_type", label: String(typed.period_type).trim() };
  const kind = inferKind(rows.map((r) => r.date));
  return kind ? { kind, from: "pay dates", label: "" } : null;
}
export const PAYDAYS_A_MONTH = { biweekly: 2, semimonthly: 2, monthly: 1 };

// A bi-weekly employer pays a third time in some months: within one calendar month (by pay date), every payslip of one employer after the second is an extra payday.
export function extraPaydays(rows, frequency) {
  const extra = new Set();
  if (frequency?.kind !== "biweekly") return extra;
  const seen = new Map();
  for (const r of rows.slice().sort((a, b) => a.date.localeCompare(b.date) || a.payslip_id.localeCompare(b.payslip_id))) {
    const key = r.employer.trim().toLowerCase() + "|" + r.date.slice(0, 7), n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n > 2) extra.add(r.payslip_id);
  }
  return extra;
}

// What the budget may count on: the frequency, the extra paydays and the rows left after them (oldest first).
export function payBase(rows) {
  const frequency = payFrequency(rows), extra = extraPaydays(rows, frequency);
  return { frequency, extra: rows.filter((r) => extra.has(r.payslip_id)), rows: rows.filter((r) => !extra.has(r.payslip_id)) };
}

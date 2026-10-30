// Income: where every peso of pay comes from. A payslip is copied from paper as lines (earnings and deductions). The app
// COMPARES what is printed with what the lines add up to and with what really arrived, and says so; it never corrects anything.
// Only plain facts are kept: no employee id, tax id or account number. Pure functions over the state.
import { validateShape } from "./schema.js";
import { isPhDate, phTimestamp } from "./util.js";
import { checkTransactionSave } from "./index.js";
import { planOvertimeTransfer, splitOvertime } from "./goals.js";
import { wordsToCentavos } from "./scan.js";
import { monthOf } from "./reports.js";
import { storedItems, checkItems, linesFromItems, itemsOf, categoryOf, categoryName, FALLBACK, EARNING_CATEGORIES, DEDUCTION_CATEGORIES } from "./payslipitems.js";

export const EARNINGS = [["basic", "Basic salary"], ["rice", "Rice subsidy"], ["skills", "Skills allowance"], ["clothing", "Clothing allowance"],
  ["transport", "Transportation allowance"], ["overtime", "Overtime"], ["thirteenth", "13th month"], ["bonus", "Bonus"], ["other", "Other earnings"]];
export const DEDUCTIONS = [["tax", "Withholding tax"], ["sss", "SSS"], ["philhealth", "PhilHealth"], ["pagibig", "Pag-IBIG"],
  ["absences", "Absences"], ["lates", "Lates / undertime"], ["loan", "Loans"], ["other", "Other deductions"]];
export const GOVERNMENT = ["tax", "sss", "gsis", "philhealth", "pagibig"];   // what went to government
export const LOST = ["absences", "lates"];   // pay lost to missed time
export const OVERTIME_SHARE = { num: 3, den: 5 };   // 60% of overtime goes to the Emergency Fund, 40% is free to spend

const peso = (c) => "₱" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sum = (rows) => rows.reduce((n, r) => n + r.amount, 0);
const fail = (code, message) => ({ ok: false, violations: [{ code, severity: "error", message }], state: undefined });

const sameEmployer = (a, b) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
// Bump when a fix changes what a saved payslip should hold. A payslip saved under an older version may carry wrong figures until it is saved again.
export const PAYSLIP_VERSION = 2;
// A payslip kept as a DRAFT (its checks did not pass, owner Oct 29) is not income yet: every figure below counts only payslips whose pay entry is verified.
export const liveSlips = (state) => {
  const draft = new Set(state.transactions.filter((t) => t.status === "draft").map((t) => t.id));
  return (state.payslips ?? []).filter((p) => !draft.has(p.transaction_id));
};
export const linesOf = (state, payslipId) => (state.payslipLines ?? []).filter((l) => l.payslip_id === payslipId);
export const payslipTotals = (lines) => {
  const earn = lines.filter((l) => l.side === "earning"), ded = lines.filter((l) => l.side === "deduction");
  const gross = sum(earn), deductions = sum(ded), overtime = sum(earn.filter((l) => l.kind === "overtime"));
  return { gross, deductions, net: gross - deductions, overtime, base: gross - overtime };
};

// The four checks. Each returns a flag in plain words when something does not match; nothing is changed.
export function payslipChecks(payslip, lines) {
  const t = payslipTotals(lines), flags = [];
  if (payslip.printed_gross !== t.gross) {
    const noOvertime = t.overtime > 0 && payslip.printed_gross === t.gross - t.overtime;
    flags.push({ code: "GROSS", message: noOvertime
      ? `The printed gross ${peso(payslip.printed_gross)} leaves out the overtime ${peso(t.overtime)}. All earnings add to ${peso(t.gross)}.`
      : `The printed gross is ${peso(payslip.printed_gross)} but the earnings lines add to ${peso(t.gross)}.` });
  }
  if (payslip.printed_net !== t.net) flags.push({ code: "NET", message: `The printed net is ${peso(payslip.printed_net)} but gross minus deductions is ${peso(t.net)}.` });
  if (payslip.deposit !== payslip.printed_net) flags.push({ code: "DEPOSIT", message: `The account received ${peso(payslip.deposit)} but the payslip says net ${peso(payslip.printed_net)}.` });
  if (payslip.net_words) {
    const w = wordsToCentavos(payslip.net_words);
    if (w === null) flags.push({ code: "WORDS", message: "I could not read the amount in words." });
    else if (w !== payslip.printed_net) flags.push({ code: "WORDS", message: `The words say ${peso(w)} but the figures say ${peso(payslip.printed_net)}.` });
  }
  return flags;
}

// Everything that does not add up on a payslip, as flags, plus the gap in centavos for the one plain question "The figures differ by X".
// The four checks above, and the printed deductions total against the lines. Empty means every figure is proven by the arithmetic.
export function payslipProblems(payslip, lines) {
  const flags = payslipChecks(payslip, lines), t = payslipTotals(lines);
  if (payslip.printed_deductions > 0 && payslip.printed_deductions !== t.deductions) flags.push({ code: "DEDUCTIONS", message: `The printed deductions are ${peso(payslip.printed_deductions)} but the deduction lines add to ${peso(t.deductions)}.` });
  const gaps = [payslip.printed_gross - t.gross, payslip.printed_net - t.net, payslip.deposit - payslip.printed_net, payslip.printed_deductions > 0 ? payslip.printed_deductions - t.deductions : 0];
  return { flags, gap: Math.abs(gaps.find((g) => g !== 0) ?? 0) };
}
// A payslip kept as a draft cannot become verified income while its figures still do not add up, unless the owner says "Verify anyway" (then the deposit is the money in and the paper's difference stays as a note).
export function payslipDraftBlock(state, transactionId) {
  const p = (state.payslips ?? []).find((x) => x.transaction_id === transactionId);
  if (!p) return null;
  const { flags, gap } = payslipProblems(p, linesOf(state, p.id));
  return flags.length ? { gap, message: "The payslip itself differs" + (gap ? " by " + peso(gap) : "") + "." } : null;
}

// Saves a payslip and the pay it brought: ONE verified entry for what arrived (copying a figure off paper is itself the
// careful look), split between the Overtime and Salary income categories so the Income screen can show them apart.
// input: {id, transaction_id, employer, period_from, period_to, pay_date, account_id, printed_gross, printed_net, deposit,
//         net_words?, earnings:[{kind, amount, earned_month?}], deductions:[{kind, amount}]}
// Flags never block saving: a payslip that does not add up is exactly what the owner wants to record and see.
export function planPayslip(state, input, now = new Date()) {
  const employer = (input.employer ?? "").trim();
  if (!employer) return fail("BAD_EMPLOYER", "give the employer's name");
  if (!isPhDate(input.pay_date) || !isPhDate(input.period_from) || !isPhDate(input.period_to)) return fail("BAD_DATE", "dates must be like 2026-10-15");
  const account = state.accounts.find((a) => a.id === input.account_id);
  if (!account || account.class !== "asset") return fail("UNKNOWN_ACCOUNT", "choose the account the pay landed in");
  if ((state.payslips ?? []).some((p) => p.id === input.id)) return fail("DUPLICATE_ID", "that payslip is already saved");
  // The same payslip scanned or typed twice would be counted twice: the same employer, period and net pay means it is already here.
  if ((state.payslips ?? []).some((p) => sameEmployer(p.employer, employer) && p.period_from === input.period_from && p.period_to === input.period_to && p.printed_net === input.printed_net)) return fail("DUPLICATE_PAYSLIP", "Duplicate payslip: you already saved one for " + employer + ", " + input.period_from + " to " + input.period_to + " with the same net pay (" + peso(input.printed_net) + "). To fix it, open it in Income, Payslips and use Change this payslip. If this is a different payslip, change its dates or net pay.");
  // A NEW payslip is given its printed lines as `items` (label, section, amount, category, flags): they are the source, and the payslip's lines are generated from them here,
  // in the same save, so items (without the employer share) and lines always give the same earnings, deductions and net. `overtime_month` is the month overtime was earned.
  let items = null;
  if (Array.isArray(input.items)) {
    const why = checkItems(input.items);
    if (why) return fail("BAD_ITEM", why);
    items = storedItems(input.id, input.items);
    const month = input.overtime_month ?? input.period_to.slice(0, 7), made = linesFromItems(items, month);
    input = { ...input, earnings: made.filter((l) => l.side === "earning").map(({ side, ...l }) => l), deductions: made.filter((l) => l.side === "deduction").map(({ side, ...l }) => l) };
  }
  if (!(input.earnings ?? []).length) return fail("NO_EARNINGS", "add at least one earnings line");
  const cats = new Map(state.categories.map((c) => [c.id, c]));
  if (cats.get("cat-salary")?.kind !== "income" || cats.get("cat-overtime")?.kind !== "income") return fail("NO_CATEGORY", "the Salary and Overtime income categories are missing");

  const lines = [
    ...input.earnings.map((l) => ({ payslip_id: input.id, side: "earning", kind: l.kind, amount: l.amount, ...(l.kind === "overtime" ? { earned_month: l.earned_month } : {}) })),
    ...(input.deductions ?? []).map((l) => ({ payslip_id: input.id, side: "deduction", kind: l.kind, amount: l.amount })),
  ];
  const payslip = { id: input.id, employer, period_from: input.period_from, period_to: input.period_to, pay_date: input.pay_date, account_id: account.id,
    transaction_id: input.transaction_id, printed_gross: input.printed_gross, printed_net: input.printed_net, deposit: input.deposit,
    ...(input.net_words ? { net_words: input.net_words } : {}), ...(input.printed_deductions > 0 ? { printed_deductions: input.printed_deductions } : {}), version: PAYSLIP_VERSION,
    ...(input.pay_rate ? { pay_rate: String(input.pay_rate).trim() } : {}), ...(input.pay_basis ? { pay_basis: String(input.pay_basis).trim() } : {}), ...(input.period_type ? { period_type: String(input.period_type).trim() } : {}) };
  for (const row of lines) { const v = validateShape("PayslipLine", row); if (v.length) return fail("BAD_LINE", v[0].message); }
  const bad = validateShape("Payslip", payslip);
  if (bad.length) return fail("BAD_PAYSLIP", bad[0].message ?? "the payslip is not complete");

  const stamp = phTimestamp(now), t = payslipTotals(lines);
  const overtime = Math.min(t.overtime, input.deposit);
  // Verified only when asked: a payslip whose checks fail is kept as a DRAFT (input.status "draft"), which waits in Verify and counts as no income yet.
  const draft = input.status === "draft";
  const transaction = { id: input.transaction_id, date: input.pay_date, payee: employer, memo: "Payslip " + input.period_from + " to " + input.period_to, status: draft ? "draft" : "verified", source: "manual", created_at: stamp, ...(draft ? {} : { verified_at: stamp }) };
  const entries = [
    { transaction_id: transaction.id, account_id: account.id, amount: input.deposit },
    ...(overtime > 0 ? [{ transaction_id: transaction.id, category_id: "cat-overtime", amount: -overtime }] : []),
    ...(input.deposit - overtime > 0 ? [{ transaction_id: transaction.id, category_id: "cat-salary", amount: -(input.deposit - overtime) }] : []),
  ];
  const result = checkTransactionSave(state, { transaction, entries });
  if (!result.ok) return { ok: false, violations: result.violations, state: undefined };
  return {
    ok: true, violations: result.violations, flags: payslipChecks(payslip, lines), payslip, lines, transaction, entries, ...(items ? { items } : {}),
    state: { ...state, transactions: [...state.transactions, transaction], entries: [...state.entries, ...entries], payslips: [...(state.payslips ?? []), payslip], payslipLines: [...(state.payslipLines ?? []), ...lines], ...(items ? { payslipItems: [...(state.payslipItems ?? []), ...items] } : {}) },
  };
}

// A payslip with overtime: 60% goes to the Emergency Fund as a DRAFT transfer for Verify (the other 40% stays free to spend).
// input: {transaction_id, emergency_account_id}. Returns null when the payslip has no overtime.
export function overtimeDraft(state, payslipId, input, now = new Date()) {
  const p = (state.payslips ?? []).find((x) => x.id === payslipId);
  if (!p) return fail("UNKNOWN_PAYSLIP", "no payslip " + payslipId);
  const overtime = payslipTotals(linesOf(state, payslipId)).overtime;
  if (overtime <= 0) return null;
  return planOvertimeTransfer(state, { transaction_id: input.transaction_id, date: p.pay_date, overtime_amount: overtime, source_account_id: p.account_id, emergency_account_id: input.emergency_account_id, share: OVERTIME_SHARE }, now);
}

// The other 40% stays in the account where the pay landed unless the owner chooses somewhere else for it. Then it is
// a DRAFT transfer for Verify. input: {transaction_id, to_account_id}. Returns null when there is no overtime.
export function overtimeFreeDraft(state, payslipId, input, now = new Date()) {
  const p = (state.payslips ?? []).find((x) => x.id === payslipId);
  if (!p) return fail("UNKNOWN_PAYSLIP", "no payslip " + payslipId);
  const overtime = payslipTotals(linesOf(state, payslipId)).overtime;
  if (overtime <= 0) return null;
  if (input.to_account_id === p.account_id) return fail("SAME_ACCOUNT", "that is where the pay landed, so the money already stays there");
  const to = state.accounts.find((a) => a.id === input.to_account_id);
  if (!to || to.class !== "asset") return fail("UNKNOWN_ACCOUNT", "choose an account you hold money in");
  const { free } = splitOvertime(overtime, OVERTIME_SHARE);
  if (free <= 0) return null;
  const transaction = { id: input.transaction_id, date: p.pay_date, payee: "Overtime free to spend", memo: "", status: "draft", source: "template", created_at: phTimestamp(now) };
  const entries = [{ transaction_id: transaction.id, account_id: to.id, amount: free }, { transaction_id: transaction.id, account_id: p.account_id, amount: -free }];
  return { ...checkTransactionSave(state, { transaction, entries }), transaction, entries };
}

// ---------- the views ----------
// A payslip belongs to the month of the period it pays for, not the day it was received: "June 16-30" received on July 2 is June's.
export const slipDate = (p) => p.period_to || p.pay_date;
// A range for the views below: a year ("2026"), {from, to} dates, or null for everything.
const inRange = (range, p) => range === null || range === undefined ? true : typeof range === "string" ? slipDate(p).startsWith(range + "-") : slipDate(p) >= range.from && slipDate(p) <= range.to;
const SOURCE_OF = { "cat-salary": "base", "cat-overtime": "overtime", "cat-interest": "interest", "cat-refund": "refunds" };
export const SOURCES = [["base", "Base pay"], ["overtime", "Overtime"], ["interest", "Interest"], ["refunds", "Refunds"], ["other", "Other"]];

// Income by source for a month (YYYY-MM) or any range: everything verified that came in under an income category.
export function incomeBySource(state, { from, to }) {
  const income = new Set(state.categories.filter((c) => c.kind === "income").map((c) => c.id));
  const txById = new Map(state.transactions.map((t) => [t.id, t]));
  const periodOf = new Map((state.payslips ?? []).map((p) => [p.transaction_id, slipDate(p)]));   // pay from a payslip counts on its period
  const out = { base: 0, overtime: 0, interest: 0, refunds: 0, other: 0 };
  for (const e of state.entries) {
    if (e.category_id == null || !income.has(e.category_id)) continue;
    const t = txById.get(e.transaction_id);
    const day = t ? periodOf.get(t.id) ?? t.date : null;
    if (!t || t.status !== "verified" || day < from || day > to) continue;
    out[SOURCE_OF[e.category_id] ?? "other"] -= e.amount;   // income is a credit, stored negative
  }
  return { ...out, total: Object.values(out).reduce((a, b) => a + b, 0) };
}
// Where a range's income came from, line by line: each kind of earning on the payslips (basic salary, rice subsidy, each allowance,
// overtime...), income that is not pay (interest, refunds, other), the deductions, and what is left over. `unmatched` is whatever the
// received total holds that the payslip lines do not explain (pay added without a payslip, or a payslip whose lines do not add up), so the
// lines always reconcile with `total`: lines + other - deductions + unmatched = total.
export function incomeBreakdown(state, { from, to }) {
  const sources = incomeBySource(state, { from, to }), earn = new Map();
  let deductions = 0;
  for (const p of liveSlips(state)) {
    if (slipDate(p) < from || slipDate(p) > to) continue;
    for (const l of linesOf(state, p.id)) { if (l.side === "earning") earn.set(l.kind, (earn.get(l.kind) ?? 0) + l.amount); else deductions += l.amount; }
  }
  const lines = EARNINGS.filter(([k]) => earn.has(k)).map(([kind, label]) => ({ kind, label, amount: earn.get(kind) }));
  const other = sources.interest + sources.refunds + sources.other, earned = lines.reduce((n, l) => n + l.amount, 0);
  return { lines, other, deductions, unmatched: sources.total - other - (earned - deductions), total: sources.total, earned: sources.total + deductions };   // earned: everything earned before the deductions came off
}
// The months of any range (clamped at its ends), each by source, plus the total for the whole range.
export function incomeMonths(state, { from, to }) {
  const months = [];
  for (let m = monthOf(from); m <= monthOf(to); m = monthOf(new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5)), 1)).toISOString().slice(0, 10))) {
    const a = m + "-01" > from ? m + "-01" : from, b = m + "-31" < to ? m + "-31" : to;
    months.push({ month: m, ...incomeBySource(state, { from: a, to: b }), breakdown: incomeBreakdown(state, { from: a, to: b }) });
  }
  return { months, ytd: { ...incomeBySource(state, { from, to }), breakdown: incomeBreakdown(state, { from, to }) } };
}
// Twelve months of one year, plus the year to date.
export function incomeByMonth(state, year) {
  const months = Array.from({ length: 12 }, (_, i) => { const m = `${year}-${String(i + 1).padStart(2, "0")}`; return { month: m, ...incomeBySource(state, { from: m + "-01", to: m + "-31" }) }; });
  return { months, ytd: incomeBySource(state, { from: year + "-01-01", to: year + "-12-31" }) };
}

// One row per payslip in the year, oldest first: what arrived, split into base and overtime.
export function netPerPayday(state, range) {
  return liveSlips(state).filter((p) => inRange(range, p)).sort((a, b) => a.pay_date.localeCompare(b.pay_date) || a.id.localeCompare(b.id)).map((p) => {
    const t = payslipTotals(linesOf(state, p.id)), overtime = Math.min(t.overtime, p.deposit);
    return { payslip_id: p.id, date: p.pay_date, employer: p.employer, net: p.deposit, overtime, base: p.deposit - overtime };
  });
}

// Income by the category of each PRINTED line (data version 11): earnings, deductions and the employer share, each category with its total and the printed lines in it.
// A line with no category counts under "Other earnings" / "Other deductions" until the owner chooses one. A payslip saved before every line was kept has no lines to
// group: it is counted apart (`original`) and the screens say "Original wording not kept". Drafts are not income yet and are left out, like every other figure here.
export function incomeByCategory(state, range) {
  const slips = liveSlips(state).filter((p) => inRange(range, p)), out = { earning: new Map(), deduction: new Map(), employer: new Map(), original: { count: 0, gross: 0, deductions: 0 } };
  for (const p of slips) {
    const items = itemsOf(state, p.id);
    if (!items.length) { const t = payslipTotals(linesOf(state, p.id)); out.original.count += 1; out.original.gross += t.gross; out.original.deductions += t.deductions; continue; }
    for (const i of items) {
      const id = categoryOf(i), g = out[i.section].get(id) ?? { category: id, name: categoryName(i.section, id), total: 0, items: [] };
      g.total += i.amount; g.items.push({ id: i.id, payslip_id: p.id, employer: p.employer, pay_date: p.pay_date, label: i.label, amount: i.amount, section: i.section, back_pay: i.back_pay === true, tax: i.tax ?? null, overtime: i.overtime === true, hours: i.hours ?? null });
      out[i.section].set(id, g);
    }
  }
  const sorted = (m) => [...m.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return { earning: sorted(out.earning), deduction: sorted(out.deduction), employer: sorted(out.employer), original: out.original };
}

// Basic pay over time: each payslip's basic salary, and the change from the one before it.
// With a year, only that year's payslips are listed, but each change is still measured against the payslip before it (even from an earlier year).
export function raiseHistory(state, year = null) {
  const rows = liveSlips(state).slice().sort((a, b) => a.pay_date.localeCompare(b.pay_date) || a.id.localeCompare(b.id))
    .map((p) => ({ date: p.pay_date, slip: slipDate(p), employer: p.employer, basic: sum(linesOf(state, p.id).filter((l) => l.side === "earning" && l.kind === "basic")) }))
    .filter((r) => r.basic > 0);
  return rows.map((r, i) => ({ ...r, change: i === 0 ? null : r.basic - rows[i - 1].basic, raised: i > 0 && r.basic > rows[i - 1].basic })).filter((r) => inRange(year, { period_to: r.slip }));
}

// Deductions by month of pay date and for the year to date: government (tax, SSS, PhilHealth, Pag-IBIG), pay lost (absences,
// lates), and loans.
export function deductionsByMonth(state, range) {
  const zero = () => ({ tax: 0, sss: 0, gsis: 0, philhealth: 0, pagibig: 0, absences: 0, lates: 0, loan: 0, other: 0 });
  const by = new Map();
  for (const p of liveSlips(state)) {
    if (!inRange(range, p)) continue;
    const m = by.get(monthOf(slipDate(p))) ?? zero();
    for (const l of linesOf(state, p.id)) if (l.side === "deduction") m[l.kind] += l.amount;
    by.set(monthOf(slipDate(p)), m);
  }
  const shape = (m) => ({ ...m, government: GOVERNMENT.reduce((n, k) => n + m[k], 0), lost: LOST.reduce((n, k) => n + m[k], 0), total: Object.keys(zero()).reduce((n, k) => n + m[k], 0) });   // total: every deduction line
  const months = [...by].sort(([a], [b]) => a.localeCompare(b)).map(([month, m]) => ({ month, ...shape(m) }));
  const ytd = shape(months.reduce((acc, m) => { for (const k of Object.keys(zero())) acc[k] += m[k]; return acc; }, zero()));
  return { months, ytd };
}

// Employers in the order they were worked for: first and last pay date, and how many payslips.
export function employerHistory(state, range = null) {
  const by = new Map();
  for (const p of liveSlips(state)) {
    if (!inRange(range, p)) continue;
    const e = by.get(p.employer) ?? { employer: p.employer, first: p.pay_date, last: p.pay_date, payslips: 0 };
    e.first = e.first < p.pay_date ? e.first : p.pay_date; e.last = e.last > p.pay_date ? e.last : p.pay_date; e.payslips += 1;
    by.set(p.employer, e);
  }
  return [...by.values()].sort((a, b) => a.first.localeCompare(b.first));
}

// Changes a saved payslip: the same figures a new one takes, saved over the old. The payslip and its pay keep their ids (so the photo stays
// with it) and are replaced together, so the ledger never holds half of the old and half of the new. An overtime transfer still waiting
// as a draft is dropped because its amount may have changed (make it again); a verified one stays, as when a payslip is removed.
// Returns what planPayslip returns, plus {draftsRemoved, photoIds} (picture files of removed drafts, for the caller to delete).
export function updatePayslip(state, id, input, now = new Date()) {
  const p = (state.payslips ?? []).find((x) => x.id === id);
  if (!p) return fail("UNKNOWN_PAYSLIP", "That payslip is no longer there.");
  const side = ["ot-" + id, "otf-" + id], drafts = new Set(state.transactions.filter((t) => side.includes(t.id) && t.status === "draft").map((t) => t.id));
  const gone = new Set([p.transaction_id, ...drafts]), dropped = new Set(drafts);
  const without = { ...state, payslips: state.payslips.filter((x) => x.id !== id), payslipLines: (state.payslipLines ?? []).filter((l) => l.payslip_id !== id),
    ...(state.payslipItems ? { payslipItems: state.payslipItems.filter((x) => x.payslip_id !== id) } : {}),
    transactions: state.transactions.filter((t) => !gone.has(t.id)), entries: state.entries.filter((e) => !gone.has(e.transaction_id)),
    attachments: (state.attachments ?? []).filter((a) => !dropped.has(a.transaction_id)) };
  const old = state.transactions.find((t) => t.id === p.transaction_id);
  const r = planPayslip(without, { ...input, id, transaction_id: p.transaction_id }, now);
  if (!r.ok) return r;
  const transaction = old ? { ...r.transaction, created_at: old.created_at } : r.transaction;
  // Remember the old figures when the new save really changes them (saving the same figures again leaves no entry).
  const oldLines = linesOf(state, id).map(({ side, kind, amount, earned_month }) => ({ side, kind, amount, ...(earned_month ? { earned_month } : {}) }));
  const figures = (x, lines) => JSON.stringify([x.employer, x.period_from, x.period_to, x.pay_date, x.printed_gross, x.printed_net, x.deposit, x.printed_deductions ?? null,
    lines.map((l) => [l.side, l.kind, l.amount, l.earned_month ?? null]).sort()]);
  const oldItems = itemsOf(state, id), itemFigures = (xs) => JSON.stringify(xs.map(({ id: _i, payslip_id: _p, ...x }) => x));
  const changed = figures(p, oldLines) !== figures(r.payslip, r.lines) || itemFigures(oldItems) !== itemFigures(r.items ?? []) || ["pay_rate", "pay_basis", "period_type"].some((k) => (p[k] ?? "") !== (r.payslip[k] ?? ""));
  const n = (state.payslipRevisions ?? []).filter((x) => x.payslip_id === id).length + 1;
  const revision = { id: id + "-r" + n, payslip_id: id, changed_on: phTimestamp(now).slice(0, 10), employer: p.employer, period_from: p.period_from, period_to: p.period_to, pay_date: p.pay_date,
    printed_gross: p.printed_gross, printed_net: p.printed_net, deposit: p.deposit, ...(p.printed_deductions ? { printed_deductions: p.printed_deductions } : {}), lines: oldLines,
    ...(oldItems.length ? { items: oldItems } : {}) };
  const bad = changed ? validateShape("PayslipRevision", revision) : [];
  if (bad.length) return fail("BAD_REVISION", bad[0].message);
  return { ...r, transaction, draftsRemoved: drafts.size, photoIds: (state.attachments ?? []).filter((a) => dropped.has(a.transaction_id)).map((a) => a.id),
    state: { ...r.state, transactions: r.state.transactions.map((t) => (t.id === transaction.id ? transaction : t)), ...(changed ? { payslipRevisions: [...(state.payslipRevisions ?? []), revision] } : {}) } };
}

// "Earlier figures": what a payslip held before each change, newest change first.
export const revisionsOf = (state, payslipId) => (state.payslipRevisions ?? []).filter((x) => x.payslip_id === payslipId).slice().reverse();

// An old payslip (saved before every printed line was kept) has no items: the screens say "Original wording not kept" instead of inventing lines.
export const wordingKept = (state, p) => itemsOf(state, p.id).length > 0;
export const ORIGINAL_NOT_KEPT = "Original wording not kept";

// One plain line each, only when it applies (no colour, no new checks): a payslip saved before the fixes, a pay date long after the period
// ended, and the printed deductions total against the lines.
export function payslipNotes(state, p) {
  const out = [], gap = Math.round((Date.parse(p.pay_date + "T00:00:00Z") - Date.parse(p.period_to + "T00:00:00Z")) / 86400000);
  if (gap > 7) out.push("Pay date is " + gap + " days after period end.");
  const paper = payslipProblems(p, linesOf(state, p.id));   // a payslip whose paper does not add up keeps this note for good, even after "Verify anyway"
  if (paper.flags.some((f) => f.code !== "DEDUCTIONS")) out.push("Paper differs by " + (paper.gap ? peso(paper.gap) : "the amount in words") + ".");   // a deductions-only difference has its own line below
  if (p.printed_deductions > 0) {
    const diff = p.printed_deductions - payslipTotals(linesOf(state, p.id)).deductions;
    out.push(diff === 0 ? "Lines match paper." : "Lines differ from paper by " + peso(Math.abs(diff)) + ".");
  }
  if (!(p.version >= PAYSLIP_VERSION)) out.push("Saved before the fix, may be wrong.");
  return out;
}

// Pay periods with no payslip. Pay is read as twice a month (the 1st to 15th and the 16th to month end), and only when the payslips show that
// (some month holds two). A period counts from the first payslip on, and only once it ended more than a week ago (pay arrives after the period).
// A payslip belongs to the half of its period end. Returns [{from, to}] oldest first, limited to `range` (see inRange).
export function missingPayPeriods(state, range, today) {
  const slips = liveSlips(state), half = (d) => monthOf(d) + (Number(d.slice(8)) <= 15 ? "-a" : "-b");
  const have = new Set(slips.map((p) => half(slipDate(p))));
  const twice = slips.some((p) => have.has(monthOf(slipDate(p)) + "-a") && have.has(monthOf(slipDate(p)) + "-b"));
  if (!slips.length || !twice) return [];
  const first = slips.map(slipDate).sort()[0], limit = new Date(Date.parse(today + "T00:00:00Z") - 8 * 86400000).toISOString().slice(0, 10), out = [];
  for (let y = Number(first.slice(0, 4)), m = Number(first.slice(5, 7)); ; m = m === 12 ? (y++, 1) : m + 1) {
    const mm = String(m).padStart(2, "0"), end = new Date(Date.UTC(y, m, 0)).getUTCDate();
    for (const [h, a, b] of [["a", 1, 15], ["b", 16, end]]) {
      const from = `${y}-${mm}-${String(a).padStart(2, "0")}`, to = `${y}-${mm}-${String(b).padStart(2, "0")}`;
      if (to > limit) return out;
      if (to >= first && !have.has(`${y}-${mm}-${h}`) && inRange(range, { period_to: to })) out.push({ from, to });
    }
  }
}

// Income that arrived WITHOUT a payslip behind it (a payslip photo once saved as plain "pay received", interest, a refund): verified entries
// under an income category, by the day they arrived, one row per transaction. They count in every Income total, so they are listed to be seen.
export function incomeWithoutPayslip(state, { from, to }) {
  const income = new Set(state.categories.filter((c) => c.kind === "income").map((c) => c.id));
  const slipTx = new Set((state.payslips ?? []).map((p) => p.transaction_id));
  const rows = [];
  for (const t of state.transactions) {
    if (t.status !== "verified" || slipTx.has(t.id) || t.date < from || t.date > to) continue;
    const mine = state.entries.filter((e) => e.transaction_id === t.id), amount = -mine.filter((e) => e.category_id != null && income.has(e.category_id)).reduce((n, e) => n + e.amount, 0);
    if (amount === 0) continue;
    rows.push({ transaction_id: t.id, date: t.date, payee: t.payee, amount, account_id: mine.find((e) => e.account_id != null)?.account_id ?? null });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.transaction_id.localeCompare(b.transaction_id));
}

// Removes one income entry that has no payslip (a stray or double one): the transaction, its entries and its photo link. The money also
// leaves the account it was added to. A payslip's own pay, or anything that is not plain income, is refused (use the payslip's Remove).
// Returns {ok, state, photoIds} or {ok: false, error}.
export function removeIncomeEntry(state, id) {
  const t = state.transactions.find((x) => x.id === id);
  if (!t) return { ok: false, error: "That entry is no longer there." };
  if ((state.payslips ?? []).some((p) => p.transaction_id === id)) return { ok: false, error: "That is a payslip's pay. Remove the payslip instead." };
  const income = new Set(state.categories.filter((c) => c.kind === "income").map((c) => c.id)), mine = state.entries.filter((e) => e.transaction_id === id);
  if (!mine.some((e) => e.category_id != null && income.has(e.category_id)) || mine.some((e) => e.category_id != null && !income.has(e.category_id))) return { ok: false, error: "That is not a plain income entry." };
  return { ok: true, photoIds: (state.attachments ?? []).filter((a) => a.transaction_id === id).map((a) => a.id),
    state: { ...state, transactions: state.transactions.filter((x) => x.id !== id), entries: state.entries.filter((e) => e.transaction_id !== id), attachments: (state.attachments ?? []).filter((a) => a.transaction_id !== id) } };
}

// Removes a payslip: its lines, the pay it recorded (the transaction, its entries and its photo link), and any overtime transfer still
// waiting as a draft. An overtime transfer already verified stays (it is real money that moved); `keptTransfers` says how many.
// Returns {ok, state, photoIds, keptTransfers}; photoIds are the picture files the caller deletes.
export function deletePayslip(state, id) {
  const p = (state.payslips ?? []).find((x) => x.id === id);
  if (!p) return { ok: false, error: "That payslip is no longer there." };
  const side = ["ot-" + id, "otf-" + id], drafts = new Set(state.transactions.filter((t) => side.includes(t.id) && t.status === "draft").map((t) => t.id));
  const gone = new Set([p.transaction_id, ...drafts]);
  return {
    ok: true,
    photoIds: (state.attachments ?? []).filter((a) => gone.has(a.transaction_id)).map((a) => a.id),
    keptTransfers: state.transactions.filter((t) => side.includes(t.id) && t.status !== "draft").length,
    state: { ...state, payslips: state.payslips.filter((x) => x.id !== id), payslipLines: (state.payslipLines ?? []).filter((l) => l.payslip_id !== id),
      ...(state.payslipRevisions ? { payslipRevisions: state.payslipRevisions.filter((x) => x.payslip_id !== id) } : {}),
      ...(state.payslipItems ? { payslipItems: state.payslipItems.filter((x) => x.payslip_id !== id) } : {}), ...(state.payslipItemChanges ? { payslipItemChanges: state.payslipItemChanges.filter((x) => x.payslip_id !== id) } : {}),
      transactions: state.transactions.filter((t) => !gone.has(t.id)), entries: state.entries.filter((e) => !gone.has(e.transaction_id)), attachments: (state.attachments ?? []).filter((a) => !gone.has(a.transaction_id)) },
  };
}

// Payslips from the SAME employer for the SAME period as `input` (another employer's payslip for those days is a second source of income, not a repeat).
// Used for a soft warning while the window is open: it never blocks saving. `exceptId` leaves out the payslip being changed.
export const samePeriodPayslips = (state, input, exceptId = null) => (state.payslips ?? []).filter((p) => p.id !== exceptId && sameEmployer(p.employer, input.employer) && p.period_from === input.period_from && p.period_to === input.period_to);

// The owner compared a payslip saved under older rules with the paper and it is right: it carries the current version without being retyped.
export function markPayslipChecked(state, id) {
  const p = (state.payslips ?? []).find((x) => x.id === id);
  if (!p) return { ok: false, error: "That payslip is no longer there." };
  return { ok: true, state: { ...state, payslips: state.payslips.map((x) => (x.id === id ? { ...x, version: PAYSLIP_VERSION } : x)) } };
}

// What each change altered, newest change first: [{revision, changes: ["Basic salary ₱9,000.00 to ₱8,900.00", ...]}]. A change is measured
// from the figures a revision holds to the figures that followed it (the next revision, or the payslip as it is now).
export function revisionChanges(state, payslipId) {
  const p = (state.payslips ?? []).find((x) => x.id === payslipId);
  if (!p) return [];
  const revs = (state.payslipRevisions ?? []).filter((x) => x.payslip_id === payslipId), now = { ...p, lines: linesOf(state, payslipId) };
  const day = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const NAME = Object.fromEntries([...EARNINGS, ...DEDUCTIONS, ["gsis", "GSIS"]]);
  const fields = [["employer", "Employer", (v) => v], ["period_from", "Period start", day], ["period_to", "Period end", day], ["pay_date", "Pay date", day],
    ["printed_gross", "Printed gross", peso], ["printed_net", "Printed net", peso], ["printed_deductions", "Printed deductions total", peso], ["deposit", "Received", peso]];
  const diff = (a, b) => {
    const out = [];
    for (const [k, label, show] of fields) if ((a[k] ?? null) !== (b[k] ?? null)) out.push(a[k] == null ? `${label} added ${show(b[k])}` : b[k] == null ? `${label} removed (was ${show(a[k])})` : `${label} ${show(a[k])} to ${show(b[k])}`);
    const key = (l) => l.side + ":" + l.kind, fold = (ls) => { const m = new Map(); for (const l of ls) m.set(key(l), m.has(key(l)) ? { ...m.get(key(l)), amount: m.get(key(l)).amount + l.amount } : l); return m; }, A = fold(a.lines), B = fold(b.lines);   // several lines of one kind (two loans) are compared by their sum
    for (const [k, l] of A) {
      const m = B.get(k), name = NAME[l.kind] ?? l.kind;
      if (!m) out.push(`${name} removed (was ${peso(l.amount)})`);
      else if (m.amount !== l.amount) out.push(`${name} ${peso(l.amount)} to ${peso(m.amount)}`);
      else if ((m.earned_month ?? null) !== (l.earned_month ?? null)) out.push(`${name} counted in ${l.earned_month} to ${m.earned_month}`);
    }
    for (const [k, l] of B) if (!A.has(k)) out.push(`${NAME[l.kind] ?? l.kind} added ${peso(l.amount)}`);
    return out;
  };
  return revs.map((r, i) => ({ revision: r, changes: diff(r, revs[i + 1] ?? now) })).reverse();
}

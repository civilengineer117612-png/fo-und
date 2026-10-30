// Payslip items (owner, Oct 30; data version 11): EVERY line printed on a payslip is kept, as printed: the label, the section, the amount in centavos (0.00 stays),
// its place on the page, a reporting category and a few plain flags. The SECTION decides the direction, never the label: an "employer" line is shown and
// never reduces net. For a NEW payslip the items are the source and the payslip's lines (income.js) are generated from them in the same save, so the two
// always give the same earnings, deductions and net. An old payslip has no items ("Original wording not kept") and is never rewritten.
// Pure functions. No colour, no screen.
import { validateShape } from "./schema.js";
import { phTimestamp } from "./util.js";

export const SECTIONS = [["earning", "Earnings"], ["deduction", "Deductions"], ["employer", "Employer share"]];

// Reporting categories. A line without one counts under the last of its list ("Other earnings", "Other deductions") until the owner chooses.
// "Holiday and night pay" is NOT "Basic pay", so a salary trend never shows a raise that was only holiday or night differential pay.
export const EARNING_CATEGORIES = [["salary", "Basic pay"], ["allowance", "Allowances"], ["overtime", "Overtime"], ["holiday_night", "Holiday and night pay"],
  ["bonus", "Bonus and 13th month"], ["other_earning", "Other earnings"]];
export const DEDUCTION_CATEGORIES = [["sss", "SSS"], ["gsis", "GSIS"], ["philhealth", "PhilHealth"], ["pagibig", "Pag-IBIG"], ["tax", "Withholding tax"],
  ["loans", "Loan repayments"], ["other_deduction", "Other deductions"]];   // an employer line uses the same list (SSS ER is SSS)
export const FALLBACK = { earning: "other_earning", deduction: "other_deduction", employer: "other_deduction" };
export const categoriesFor = (section) => (section === "earning" ? EARNING_CATEGORIES : DEDUCTION_CATEGORIES);
export const validCategory = (section, id) => id === "" || id == null || categoriesFor(section).some(([k]) => k === id);
export const categoryName = (section, id) => categoriesFor(section).find(([k]) => k === id)?.[1] ?? "";

// "+ Add a line" offers these; any label can still be typed. Choosing one is the owner's own choice, so its category is set too.
export const QUICK_LABELS = {
  earning: [["Basic salary", "salary"], ["Overtime", null], ["Holiday and night pay", "holiday_night"], ["Rice subsidy", "allowance"], ["Allowance", "allowance"]],
  deduction: [["SSS", "sss"], ["PhilHealth", "philhealth"], ["Pag-IBIG", "pagibig"], ["Withholding tax", "tax"], ["Loan", "loans"]],
  employer: [["SSS ER", "sss"], ["PhilHealth ER", "philhealth"], ["Pag-IBIG ER", "pagibig"]],
};

const squash = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// ---------- what a label tells us ----------
// Flags come from the label's own words: "Retro ..." is back pay; "Non Taxable" / "Taxable" is the line's tax flag (a flag per LINE, never per category, so a
// non-taxable and a taxable meal allowance can share one category with opposite flags).
export const itemFlags = (label) => ({
  back_pay: /^\s*retro\b/i.test(label ?? ""),
  tax: /\bnon[\s-]*tax(?:able)?\b/i.test(label ?? "") ? "non_taxable" : /\btaxable\b/i.test(label ?? "") ? "taxable" : undefined,
});
// The reader may pre-select Overtime ONLY for the exact whole label "Overtime" or "OT"; saving the payslip confirms it. "OT Premium" and "Hot meal" never do.
export const suggestOvertime = (label) => /^\s*(?:overtime|ot)\s*$/i.test(label ?? "");
// Likewise "Basic Salary" and "Basic Pay" are shown as "Basic pay (suggested)". Nothing else is suggested.
export const suggestBasic = (label) => /^\s*basic\s+(?:salary|pay)\s*$/i.test(label ?? "");
// A category chosen without a tap, only for a strong match on a deduction or employer line. A loan, advance or amortization is a loan repayment first.
export function strongCategory(section, label) {
  if (section === "earning") return null;
  const l = String(label ?? "");
  if (/\bloans?\b|\badvances?\b|\bamortization\b/i.test(l)) return "loans";
  if (/\bgsis\b/i.test(l)) return "gsis";
  if (/\bsss\b/i.test(l)) return "sss";
  if (/phil\s*-?\s*health|\bphic\b/i.test(l)) return "philhealth";
  if (/pag\s*-?\s*ibig|\bhdmf\b/i.test(l)) return "pagibig";
  if (/with\s*holding|\bw\/?\s*tax\b|\bwtax\b/i.test(l)) return "tax";
  return null;
}

// ---------- remembered choices: this phone, per employer + section + label ----------
export const memoryKey = (employer, section, label) => [squash(employer), section, squash(label)].join("|");
export const rememberedCategory = (settings, employer, section, label) => {
  const c = settings?.payslip_categories?.[memoryKey(employer, section, label)];
  return c && validCategory(section, c) ? c : null;
};
// The settings after saving: every line whose category the OWNER chose (item.chosen) is remembered. A guess the owner never touched is not.
export function rememberChoices(settings, employer, items) {
  const add = {};
  for (const i of items) if (i.chosen === true && i.category && validCategory(i.section, i.category)) add[memoryKey(employer, i.section, i.label)] = i.category;
  return Object.keys(add).length ? { ...settings, payslip_categories: { ...(settings?.payslip_categories ?? {}), ...add } } : settings;
}

// A line as the review form holds it: what the reader (or the owner) gave, plus the guesses. `via` says where its category came from (form only, never saved).
export function draftItem({ section, label, amount, hours, employer, settings }) {
  const flags = itemFlags(label);
  const item = { section, label, amount, ...(hours ? { hours } : {}), ...(flags.back_pay ? { back_pay: true } : {}), ...(flags.tax ? { tax: flags.tax } : {}) };
  const remembered = rememberedCategory(settings, employer, section, label);
  if (remembered) { item.category = remembered; item.via = "remembered"; }
  else if (section === "earning" && suggestBasic(label)) { item.category = "salary"; item.via = "suggested"; }
  else { const strong = strongCategory(section, label); if (strong) { item.category = strong; item.via = "auto"; } }
  if (section === "earning" && suggestOvertime(label)) { item.overtime = true; item.via_overtime = "suggested"; }
  return item;
}

// ---------- what is saved ----------
const STORED = ["section", "label", "amount", "category", "overtime", "back_pay", "tax", "hours"];
// A line that already exists keeps its id when the payslip is changed (`item_id` on the draft), so the record of a category change still names the same line; a new line gets the next free one.
export function storedItems(payslipId, drafts) {
  const mine = new RegExp("^" + payslipId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "-i(\\d+)$"), used = new Set();
  let next = 1 + Math.max(0, ...drafts.map((d) => Number(mine.exec(d.item_id ?? "")?.[1] ?? 0)));
  return drafts.map((d, n) => {
    const keep = typeof d.item_id === "string" && mine.test(d.item_id) && !used.has(d.item_id) ? d.item_id : null, id = keep ?? `${payslipId}-i${next++}`;
    used.add(id);
    const row = { id, payslip_id: payslipId, position: n };
    for (const k of STORED) if (d[k] !== undefined && d[k] !== null && d[k] !== "" && !(k === "overtime" && d[k] !== true) && !(k === "back_pay" && d[k] !== true)) row[k] = d[k];
    return row;
  });
}
export function checkItems(drafts) {
  for (const d of drafts) {
    if (!["earning", "deduction", "employer"].includes(d.section)) return "a line needs its section";
    if (!validCategory(d.section, d.category)) return "that category does not belong in " + (d.section === "earning" ? "earnings" : "deductions");
    const v = validateShape("PayslipItem", { id: "x", payslip_id: "x", position: 0, section: d.section, label: d.label, amount: d.amount, ...(d.category ? { category: d.category } : {}), ...(d.overtime === true ? { overtime: true } : {}), ...(d.tax ? { tax: d.tax } : {}) });
    if (v.length) return v[0].message;
  }
  return null;
}

export const itemsOf = (state, payslipId) => (state.payslipItems ?? []).filter((i) => i.payslip_id === payslipId).slice().sort((a, b) => a.position - b.position);
export const categoryOf = (item) => item.category || (item.overtime === true ? "overtime" : FALLBACK[item.section]);

// Employer lines never count. Overtime is only what the owner confirmed.
export function itemTotals(items) {
  const sum = (rows) => rows.reduce((n, r) => n + r.amount, 0);
  const earn = items.filter((i) => i.section === "earning"), ded = items.filter((i) => i.section === "deduction");
  const earnings = sum(earn), deductions = sum(ded);
  return { earnings, deductions, net: earnings - deductions, employer: sum(items.filter((i) => i.section === "employer")), overtime: sum(earn.filter((i) => i.overtime === true)) };
}

// ---------- the payslip lines, generated from the items in the same save ----------
export function lineKindOf(item) {
  const label = String(item.label ?? "").toLowerCase();
  if (item.section === "earning") {
    if (item.overtime === true) return "overtime";
    switch (item.category) {
      case "salary": return "basic";
      case "allowance": return /rice/.test(label) ? "rice" : /cloth|uniform/.test(label) ? "clothing" : /transport|fare/.test(label) ? "transport" : /skill/.test(label) ? "skills" : "other";
      case "bonus": return /13\s*th|thirteenth/.test(label) ? "thirteenth" : "bonus";
      default: return "other";   // holiday and night pay, uncategorised and "Other earnings" stay out of basic pay
    }
  }
  switch (item.category) {
    case "tax": return "tax"; case "sss": return "sss"; case "gsis": return "gsis"; case "philhealth": return "philhealth"; case "pagibig": return "pagibig"; case "loans": return "loan";
    default: return /a[bh]sen|half\s*-?\s*day|1\/2\s*day/.test(label) ? "absences" : /\blates?\b|undertime|tardi/.test(label) ? "lates" : "other";
  }
}
// A line must be more than zero, so a 0.00 item has no line (it adds nothing, so the totals are the same); an employer item has none either.
export function linesFromItems(items, earnedMonth) {
  return items.filter((i) => i.section !== "employer" && i.amount > 0).map((i) => {
    const kind = lineKindOf(i);
    return { side: i.section, kind, amount: i.amount, ...(kind === "overtime" ? { earned_month: earnedMonth } : {}) };
  });
}

// ---------- changing a past line's category ----------
// One line at a time, with a visible record. It changes the category and nothing else: no amount, no entry, no transfer, no line.
export function setItemCategory(state, itemId, category, now = new Date()) {
  const item = (state.payslipItems ?? []).find((i) => i.id === itemId);
  const fail = (code, message) => ({ ok: false, violations: [{ code, severity: "error", message }], state });
  if (!item) return fail("UNKNOWN_ITEM", "That line is no longer there.");
  const to = category ?? "";
  if (!validCategory(item.section, to)) return fail("BAD_CATEGORY", "That category does not belong in " + (item.section === "earning" ? "earnings" : "deductions") + ".");
  if ((item.category ?? "") === to) return { ok: true, violations: [], state, unchanged: true };
  const n = (state.payslipItemChanges ?? []).filter((c) => c.item_id === itemId).length + 1;
  const change = { id: `${itemId}-c${n}`, item_id: itemId, payslip_id: item.payslip_id, from: item.category ?? "", to, changed_on: phTimestamp(now).slice(0, 10) };
  const bad = validateShape("PayslipItemChange", change);
  if (bad.length) return fail("BAD_CHANGE", bad[0].message);
  const payslipItems = state.payslipItems.map((i) => { if (i.id !== itemId) return i; const { category: _old, ...rest } = i; return to ? { ...rest, category: to } : rest; });
  return { ok: true, violations: [], state: { ...state, payslipItems, payslipItemChanges: [...(state.payslipItemChanges ?? []), change] } };
}
export const changesOf = (state, itemId) => (state.payslipItemChanges ?? []).filter((c) => c.item_id === itemId);

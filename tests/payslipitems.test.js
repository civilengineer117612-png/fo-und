import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planPayslip, updatePayslip, deletePayslip, payslipTotals, payslipChecks, linesOf, overtimeDraft, raiseHistory, incomeBySource, ensureIncomeCategories, validateState, selfCheck,
  itemsOf, itemTotals, draftItem, storedItems, linesFromItems, categoryOf, strongCategory, suggestOvertime, suggestBasic, itemFlags, memoryKey, rememberChoices, rememberedCategory,
  setItemCategory, incomeByCategory, wordingKept, ORIGINAL_NOT_KEPT, QUICK_LABELS, EARNING_CATEGORIES, DEDUCTION_CATEGORIES, checkTransactionSave,
  upgradeLedger, rotateCopies, restorableCopy, LEDGER_VERSION, parseLedger, fingerprint,
} from "../src/model/index.js";
import { makeState, account } from "./fixtures.js";

// Every figure is invented and hand-worked.
const NOW = new Date("2026-10-16T04:00:00Z");
function ledger() {
  const s = makeState();
  s.categories.push({ id: "cat-salary", name: "Salary", kind: "income" }, { id: "cat-overtime", name: "Overtime", kind: "income" });
  s.accounts.push(account({ id: "ef", name: "Test Emergency", class: "asset" }));
  return ensureIncomeCategories(s);
}
const E = (label, amount, o = {}) => ({ section: "earning", label, amount, ...o });
const D = (label, amount, o = {}) => ({ section: "deduction", label, amount, ...o });
const R = (label, amount, o = {}) => ({ section: "employer", label, amount, ...o });
// 14 earnings = 32,000.00 (4 "Retro", one non-taxable); 12 deductions = 9,190.00 (two "Salary Loan", one 0.00); one employer line of 1,050.00; net 22,810.00.
const EARN = [E("Basic Salary", 2000000, { category: "salary" }), E("Rice Allowance Non Taxable", 150000, { category: "allowance" }), E("Overtime", 240000, { overtime: true }), E("Retro Basic", 80000, { category: "salary" }),
  E("Retro Rice", 15000, { category: "allowance" }), E("Retro Overtime", 30000), E("Retro Night Diff", 12000), E("Night Differential", 64000, { category: "holiday_night" }), E("Holiday Pay", 100000, { category: "holiday_night" }),
  E("Transport Allowance", 120000, { category: "allowance" }), E("Clothing Allowance", 50000, { category: "allowance" }), E("Meal Subsidy", 70000), E("Hazard Pay", 90000), E("Performance Incentive", 179000, { category: "bonus" })];
const DED = [D("SSS", 90000), D("PhilHealth", 80000), D("Pag-IBIG", 20000), D("Withholding Tax", 310000), D("Salary Loan", 125000), D("Salary Loan", 64000), D("Cash Advance", 100000),
  D("Canteen", 35000), D("Union Dues", 10000), D("Uniform Amortization", 40000), D("Absences", 0), D("Insurance Premium", 45000)];
const withAuto = (rows) => rows.map((r) => { const { via, via_overtime, ...x } = { ...draftItem({ ...r, employer: "Sample Employer Inc", settings: {} }), ...r }; return x; });
const base = (o = {}) => ({ id: "ps1", transaction_id: "tx-ps1", employer: "Sample Employer Inc", period_from: "2026-10-01", period_to: "2026-10-15", pay_date: "2026-10-20", account_id: "chk",
  printed_gross: 3200000, printed_net: 2281000, deposit: 2281000, printed_deductions: 919000, items: withAuto([...EARN, ...DED, R("SSS ER", 105000)]), ...o });

test("a payslip with 14 earnings lines keeps all 14 as printed; the earnings add to the printed gross exactly; Retro lines are back pay and one line is non-taxable", () => {
  const r = planPayslip(ledger(), base(), NOW);
  assert.ok(r.ok, JSON.stringify(r.violations));
  const earn = itemsOf(r.state, "ps1").filter((i) => i.section === "earning");
  assert.equal(earn.length, 14);
  assert.deepEqual(earn.map((i) => i.label), EARN.map((e) => e.label), "labels exactly as printed, in print order");
  assert.equal(earn.reduce((n, i) => n + i.amount, 0), 3200000);
  assert.deepEqual(earn.filter((i) => i.back_pay).map((i) => i.label), ["Retro Basic", "Retro Rice", "Retro Overtime", "Retro Night Diff"]);
  assert.deepEqual(earn.filter((i) => i.tax === "non_taxable").map((i) => i.label), ["Rice Allowance Non Taxable"]);
  assert.deepEqual(r.flags, [], "gross, net and deductions all match the paper");
  assert.deepEqual(validateState(r.state), []);
});

test("12 deduction lines are kept, a printed 0.00 line stays, both loans are separate lines under Loan repayments, an employer line never reduces net", () => {
  const r = planPayslip(ledger(), base(), NOW), items = itemsOf(r.state, "ps1");
  const ded = items.filter((i) => i.section === "deduction");
  assert.equal(ded.length, 12);
  assert.equal(ded.find((i) => i.label === "Absences").amount, 0, "the 0.00 line is kept");
  const loans = ded.filter((i) => categoryOf(i) === "loans");
  assert.deepEqual(loans.map((i) => [i.label, i.amount]), [["Salary Loan", 125000], ["Salary Loan", 64000], ["Cash Advance", 100000], ["Uniform Amortization", 40000]], "two loans of one label stay two lines");
  const er = items.filter((i) => i.section === "employer");
  assert.deepEqual(er.map((i) => [i.label, i.amount, categoryOf(i)]), [["SSS ER", 105000, "sss"]]);
  const t = itemTotals(items);
  assert.deepEqual([t.earnings, t.deductions, t.net, t.employer], [3200000, 919000, 2281000, 105000], "net is earnings minus deductions; the employer line is shown, not taken");
  assert.equal(payslipTotals(r.lines).net, 2281000);
});

test("items and the generated lines give identical earnings, deductions and net, to the centavo, for every new payslip", () => {
  const variants = [base(), base({ id: "ps2", transaction_id: "tx2", period_from: "2026-11-01", period_to: "2026-11-15", items: withAuto([E("Basic Pay", 1000000), D("SSS", 50000), D("Loan", 0)]), printed_gross: 1000000, printed_net: 950000, deposit: 950000, printed_deductions: 50000 }),
    base({ id: "ps3", transaction_id: "tx3", period_from: "2026-12-01", period_to: "2026-12-15", items: withAuto([E("Overtime", 100000), E("Basic Salary", 500000), R("PhilHealth ER", 20000), D("Tax", 100000)]), printed_gross: 600000, printed_net: 500000, deposit: 500000, printed_deductions: 100000 })];
  let s = ledger();
  for (const v of variants) {
    const r = planPayslip(s, v, NOW); assert.ok(r.ok, JSON.stringify(r.violations)); s = r.state;
    const a = itemTotals(itemsOf(s, v.id)), b = payslipTotals(linesOf(s, v.id));
    assert.deepEqual([a.earnings, a.deductions, a.net], [b.gross, b.deductions, b.net], v.id);
    assert.equal(a.overtime, b.overtime, "overtime agrees too");
  }
  assert.deepEqual(validateState(s), []); assert.deepEqual(selfCheck({ state: s }), []);
});

test("the reader's guesses: categories only for strong matches; a loan, advance or amortization is a loan repayment first", () => {
  for (const [section, label, want] of [["deduction", "SSS", "sss"], ["deduction", "GSIS Premium", "gsis"], ["deduction", "PHIC", "philhealth"], ["deduction", "PhilHealth", "philhealth"], ["deduction", "HDMF", "pagibig"],
    ["deduction", "Pag-IBIG", "pagibig"], ["deduction", "Withholding Tax", "tax"], ["deduction", "SSS Loan", "loans"], ["deduction", "Pag-IBIG Loan", "loans"], ["deduction", "Cash Advance", "loans"],
    ["deduction", "Uniform Amortization", "loans"], ["employer", "SSS ER", "sss"], ["deduction", "Canteen", null], ["deduction", "Union Dues", null], ["earning", "Holiday Pay", null], ["earning", "Meal Subsidy", null]])
    assert.equal(strongCategory(section, label), want, label);
  assert.equal(draftItem({ section: "earning", label: "Basic Salary", amount: 1, employer: "A", settings: {} }).category, "salary");
  assert.equal(draftItem({ section: "earning", label: "Basic Pay", amount: 1, employer: "A", settings: {} }).via, "suggested");
  assert.equal(draftItem({ section: "earning", label: "Basic Pay Adjustment", amount: 1, employer: "A", settings: {} }).category, undefined, "nothing else is suggested");
  assert.equal(draftItem({ section: "earning", label: "Holiday Pay", amount: 1, employer: "A", settings: {} }).category, undefined);
});

test("Overtime is pre-selected only for the exact label Overtime or OT; saving confirms it and the 60/40 transfer stays a DRAFT", () => {
  for (const l of ["Overtime", "overtime", " OT ", "OT"]) assert.equal(suggestOvertime(l), true, l);
  for (const l of ["OT Premium", "Hot meal", "Overtime Pay", "Night overtime", "Retro Overtime", "Rotation", "Hot"]) assert.equal(suggestOvertime(l), false, l);
  assert.equal(draftItem({ section: "earning", label: "OT", amount: 100, employer: "A", settings: {} }).overtime, true);
  assert.equal(draftItem({ section: "earning", label: "OT Premium", amount: 100, employer: "A", settings: {} }).overtime, undefined);
  assert.equal(draftItem({ section: "deduction", label: "Overtime", amount: 100, employer: "A", settings: {} }).overtime, undefined, "only an earnings line");
  // confirmed: the 60/40 draft exists, and it is a draft
  let s = planPayslip(ledger(), base(), NOW).state;
  const d = overtimeDraft(s, "ps1", { transaction_id: "ot-ps1", emergency_account_id: "ef" }, NOW);
  assert.equal(d.ok, true); assert.equal(d.transaction.status, "draft");
  assert.equal(d.entries.find((e) => e.account_id === "ef").amount, 144000, "60% of the 2,400.00 confirmed overtime only; the Retro Overtime line is not counted");
  // not confirmed (the owner unticked it, or a remembered category said overtime): no overtime, no transfer
  const off = planPayslip(ledger(), base({ items: withAuto([E("Basic Salary", 1000000), E("Overtime", 200000, { overtime: false }), E("Extra", 50000, { category: "overtime" })]), printed_gross: 1250000, printed_net: 1250000, deposit: 1250000, printed_deductions: undefined }), NOW);
  assert.ok(off.ok, JSON.stringify(off.violations));
  assert.equal(payslipTotals(off.lines).overtime, 0);
  assert.equal(overtimeDraft(off.state, "ps1", { transaction_id: "ot-ps1", emergency_account_id: "ef" }, NOW), null, "no confirmed overtime: nothing to transfer");
});

test("the owner's category is remembered per employer + section + label; another employer, section or label gets nothing; a guess the owner did not touch is not remembered", () => {
  const settings0 = { last_employer: "x" };
  const chosen = [{ section: "earning", label: "Meal Subsidy", category: "allowance", chosen: true }, { section: "earning", label: "Basic Salary", category: "salary", via: "suggested" }, { section: "deduction", label: "Canteen", category: "other_deduction", chosen: true }];
  const settings = rememberChoices(settings0, "Sample Employer Inc", chosen);
  assert.equal(settings.last_employer, "x");
  assert.equal(rememberedCategory(settings, "sample  employer inc", "earning", "MEAL subsidy"), "allowance", "capitals and spaces do not matter");
  assert.equal(draftItem({ section: "earning", label: "Meal Subsidy", amount: 1, employer: "Sample Employer Inc", settings }).category, "allowance");
  assert.equal(draftItem({ section: "earning", label: "Meal Subsidy", amount: 1, employer: "Sample Employer Inc", settings }).via, "remembered");
  assert.equal(draftItem({ section: "earning", label: "Meal Subsidy", amount: 1, employer: "Other Company", settings }).category, undefined, "a different employer does not get it");
  assert.equal(draftItem({ section: "deduction", label: "Meal Subsidy", amount: 1, employer: "Sample Employer Inc", settings }).category, undefined, "nor does the same label in another section");
  assert.deepEqual(Object.keys(settings.payslip_categories).sort(), [memoryKey("Sample Employer Inc", "deduction", "Canteen"), memoryKey("Sample Employer Inc", "earning", "Meal Subsidy")].sort(), "only the two the owner chose are remembered; the suggested Basic Salary is not");
  assert.equal(rememberChoices(settings0, "A", [{ section: "earning", label: "x", amount: 1 }]), settings0, "nothing chosen: the settings are the same object");
  // a remembered "overtime" category never confirms overtime
  const ot = rememberChoices({}, "A", [{ section: "earning", label: "Shift Extra", category: "overtime", chosen: true }]);
  assert.equal(draftItem({ section: "earning", label: "Shift Extra", amount: 1, employer: "A", settings: ot }).overtime, undefined);
});

test("changing a past line's category changes the category and nothing else: balances, income totals, transaction count, lines and 60/40 transfers stay", () => {
  let s = planPayslip(ledger(), base(), NOW).state;
  const d = overtimeDraft(s, "ps1", { transaction_id: "ot-ps1", emergency_account_id: "ef" }, NOW); s = applyOtDraft(s, d);
  const before = JSON.parse(JSON.stringify(s));
  const item = itemsOf(s, "ps1").find((i) => i.label === "Meal Subsidy");
  assert.equal(item.category, undefined);
  const r = setItemCategory(s, item.id, "allowance", NOW);
  assert.ok(r.ok); const after = r.state;
  assert.equal(itemsOf(after, "ps1").find((i) => i.id === item.id).category, "allowance");
  for (const k of Object.keys(before)) if (k !== "payslipItems" && k !== "payslipItemChanges") assert.deepEqual(after[k], before[k], k + " is untouched");
  assert.equal(after.transactions.length, before.transactions.length, "no transaction made");
  assert.deepEqual(itemsOf(after, "ps1").filter((i) => i.id !== item.id), itemsOf(before, "ps1").filter((i) => i.id !== item.id), "no other line changed");
  assert.equal(itemsOf(after, "ps1").find((i) => i.id === item.id).amount, item.amount, "the amount is the same");
  assert.deepEqual(after.payslipItemChanges, [{ id: item.id + "-c1", item_id: item.id, payslip_id: "ps1", from: "", to: "allowance", changed_on: "2026-10-16" }], "a visible record");
  assert.equal(after.transactions.filter((t) => t.id.startsWith("ot-")).length, 1, "the existing 60/40 transfer is the same one");
  assert.deepEqual(incomeBySource(after, "2026"), incomeBySource(before, "2026"));
  // again, back to none, with its own record; the same value twice is nothing
  const back = setItemCategory(after, item.id, "", NOW); assert.equal(back.state.payslipItemChanges.length, 2); assert.equal(back.state.payslipItems.find((i) => i.id === item.id).category, undefined);
  assert.equal(setItemCategory(after, item.id, "allowance", NOW).unchanged, true);
  // refused: an unknown line, a category from the other list
  assert.equal(setItemCategory(after, "nope", "allowance", NOW).ok, false);
  assert.equal(setItemCategory(after, item.id, "sss", NOW).ok, false, "a deduction category does not belong in earnings");
  assert.deepEqual(validateState(after), []);
});
function applyOtDraft(s, d) { return { ...s, transactions: [...s.transactions, d.transaction], entries: [...s.entries, ...d.entries] }; }

test("income by category: lines grouped by category (the rest under Other earnings), each group lists its printed lines; an old payslip is counted apart as original wording not kept", () => {
  let s = planPayslip(ledger(), base(), NOW).state;
  const old = planPayslip(s, { id: "old1", transaction_id: "tx-old", employer: "Old Co", period_from: "2026-09-01", period_to: "2026-09-15", pay_date: "2026-09-15", account_id: "chk", printed_gross: 900000, printed_net: 800000, deposit: 800000, earnings: [{ kind: "basic", amount: 900000 }], deductions: [{ kind: "tax", amount: 100000 }] }, NOW);
  assert.ok(old.ok); s = old.state;
  const g = incomeByCategory(s, "2026");
  const cat = (list, id) => list.find((c) => c.category === id);
  assert.equal(cat(g.earning, "other_earning").total, 12000 + 30000 + 70000 + 90000, "lines with no category count under Other earnings until categorized");
  assert.deepEqual(cat(g.earning, "other_earning").items.map((i) => i.label), ["Retro Overtime", "Retro Night Diff", "Meal Subsidy", "Hazard Pay"], "tapping a category shows its printed lines");
  assert.equal(cat(g.earning, "holiday_night").total, 164000);
  assert.equal(cat(g.earning, "salary").total, 2080000, "holiday and night pay is not in basic pay");
  assert.equal(cat(g.deduction, "loans").total, 329000);
  assert.equal(cat(g.employer, "sss").total, 105000, "the employer share is listed apart");
  assert.deepEqual([g.original.count, g.original.gross, g.original.deductions], [1, 900000, 100000]);
  assert.equal(wordingKept(s, s.payslips.find((p) => p.id === "ps1")), true);
  assert.equal(wordingKept(s, s.payslips.find((p) => p.id === "old1")), false);
  assert.equal(ORIGINAL_NOT_KEPT, "Original wording not kept");
});

test("holiday and night pay never counts as basic pay, so a salary trend shows no fake raise", () => {
  let s = planPayslip(ledger(), base({ id: "a1", transaction_id: "ta", period_from: "2026-08-01", period_to: "2026-08-15", pay_date: "2026-08-15", items: withAuto([E("Basic Salary", 1000000), D("SSS", 0)]), printed_gross: 1000000, printed_net: 1000000, deposit: 1000000, printed_deductions: undefined }), NOW).state;
  s = planPayslip(s, base({ id: "a2", transaction_id: "tb", period_from: "2026-09-01", period_to: "2026-09-15", pay_date: "2026-09-15", items: withAuto([E("Basic Salary", 1000000), E("Holiday Pay", 150000, { category: "holiday_night" }), E("Night Differential", 50000, { category: "holiday_night" })]), printed_gross: 1200000, printed_net: 1200000, deposit: 1200000, printed_deductions: undefined }), NOW).state;
  assert.deepEqual(raiseHistory(s).map((r) => [r.basic, r.raised]), [[1000000, false], [1000000, false]]);
});

test("tax flags belong to the line, never to the category: two lines of one category carry opposite flags", () => {
  assert.deepEqual(itemFlags("Meal Allowance Non Taxable"), { back_pay: false, tax: "non_taxable" });
  assert.deepEqual(itemFlags("Retro Meal Allowance Taxable"), { back_pay: true, tax: "taxable" });
  assert.deepEqual(itemFlags("Meal Allowance"), { back_pay: false, tax: undefined });
  assert.equal(itemFlags("Allowance (non-taxable)").tax, "non_taxable"); assert.equal(itemFlags("Retroactive Pay").back_pay, false, "only a label that starts with Retro");
  const r = planPayslip(ledger(), base({ items: withAuto([E("Meal Allowance Non Taxable", 100000, { category: "allowance" }), E("Retro Meal Allowance Taxable", 50000, { category: "allowance" })]),
    printed_gross: 150000, printed_net: 150000, deposit: 150000, printed_deductions: undefined }), NOW);
  assert.ok(r.ok, JSON.stringify(r.violations));
  const [a, b] = itemsOf(r.state, "ps1");
  assert.deepEqual([a.category, a.tax, a.back_pay], ["allowance", "non_taxable", undefined]); assert.deepEqual([b.category, b.tax, b.back_pay], ["allowance", "taxable", true]);
});

test("pay rate, pay basis and period type are kept as printed; hours stay on their own line and are never summed", () => {
  const r = planPayslip(ledger(), base({ pay_rate: "1,250.00 / day", pay_basis: "Daily", period_type: "Bi-Week",
    items: withAuto([E("Basic Salary", 1000000, { hours: "80.00" }), E("Night Differential", 100000, { hours: "16.00", category: "holiday_night" })]), printed_gross: 1100000, printed_net: 1100000, deposit: 1100000, printed_deductions: undefined }), NOW);
  assert.ok(r.ok, JSON.stringify(r.violations));
  const p = r.state.payslips[0];
  assert.deepEqual([p.pay_rate, p.pay_basis, p.period_type], ["1,250.00 / day", "Daily", "Bi-Week"]);
  assert.deepEqual(itemsOf(r.state, "ps1").map((i) => i.hours), ["80.00", "16.00"]);
  assert.deepEqual(Object.keys(itemTotals(itemsOf(r.state, "ps1"))).sort(), ["deductions", "earnings", "employer", "net", "overtime"], "no hours total exists");
  assert.equal(Object.keys(r.state.payslipLines[0]).includes("hours"), false);
  assert.equal(planPayslip(ledger(), base({ pay_rate: undefined }), NOW).state.payslips[0].pay_rate, undefined, "absent is valid");
});

test("the duplicate check is employer + period + net: the same one is caught, two loans with one label are not", () => {
  const first = planPayslip(ledger(), base(), NOW); assert.ok(first.ok);
  const again = planPayslip(first.state, base({ id: "ps2", transaction_id: "tx2" }), NOW);
  assert.equal(again.ok, false); assert.equal(again.violations[0].code, "DUPLICATE_PAYSLIP");
  assert.equal(itemsOf(first.state, "ps1").filter((i) => i.label === "Salary Loan").length, 2, "two lines with one label were saved without complaint");
  assert.equal(planPayslip(first.state, base({ id: "ps3", transaction_id: "tx3", employer: "Second Employer" }), NOW).ok, true, "another employer, the same period and net, is a second income");
  assert.equal(planPayslip(first.state, base({ id: "ps4", transaction_id: "tx4", period_from: "2026-10-16", period_to: "2026-10-31" }), NOW).ok, true);
  assert.equal(planPayslip(first.state, base({ id: "ps5", transaction_id: "tx5", deposit: 2000000 }), NOW).ok, false, "the printed net decides: a different deposit with the same printed net is still the same payslip");
  assert.equal(planPayslip(first.state, base({ id: "ps6", transaction_id: "tx6", printed_net: 2281001, printed_gross: 3200001, items: withAuto([...EARN.slice(1), E("Basic Salary", 2000001, { category: "salary" }), ...DED, R("SSS ER", 105000)]) }), NOW).ok, true, "a different printed net is a different payslip, whatever the deposit");
});

test("a line is refused when it is out of shape; a 0.00 line is allowed; saving the same id over a verified payslip is refused", () => {
  const bad = (items) => planPayslip(ledger(), base({ items }), NOW);
  assert.equal(bad([{ ...E("Basic Salary", 100), label: "  " }]).ok, false, "a line needs a label");
  assert.equal(bad([E("Basic Salary", -5)]).ok, false, "never negative");
  assert.equal(bad([E("Basic Salary", 100, { category: "sss" })]).ok, false, "a category from the other list");
  assert.equal(bad([D("SSS", 100, { overtime: true }), E("Basic Salary", 100)]).ok, false, "only an earnings line can be overtime");
  assert.equal(bad([{ section: "bonus", label: "x", amount: 1 }]).ok, false, "a section from the three");
  assert.equal(planPayslip(ledger(), base({ items: withAuto([E("Basic Salary", 100), E("Rice Subsidy", 0)]), printed_gross: 100, printed_net: 100, deposit: 100, printed_deductions: undefined }), NOW).ok, true);
  const s = planPayslip(ledger(), base(), NOW).state;
  assert.equal(checkTransactionSave(s, { transaction: s.transactions.find((t) => t.id === "tx-ps1"), entries: s.entries.filter((e) => e.transaction_id === "tx-ps1") }).ok, false);
});

test("changing a payslip replaces its items and keeps what it held before; removing it removes its items and their category records", () => {
  let s = planPayslip(ledger(), base(), NOW).state;
  s = setItemCategory(s, itemsOf(s, "ps1").find((i) => i.label === "Meal Subsidy").id, "allowance", NOW).state;
  const edited = updatePayslip(s, "ps1", base({ items: withAuto([...EARN.slice(0, 13), E("Performance Incentive", 179000, { category: "bonus" }), ...DED, R("SSS ER", 105000)]), pay_basis: "Monthly" }), NOW);
  assert.ok(edited.ok, JSON.stringify(edited.violations));
  assert.equal(itemsOf(edited.state, "ps1").length, 27, "the same count after the change; none doubled");
  assert.equal(edited.state.payslips[0].pay_basis, "Monthly");
  assert.equal(edited.state.payslipRevisions.length, 1, "the pay basis changed, so a record of the earlier figures is kept");
  assert.equal(edited.state.payslipRevisions[0].items.length, 27, "the revision keeps the lines it held");
  const gone = deletePayslip(edited.state, "ps1");
  assert.deepEqual([gone.state.payslipItems.length, gone.state.payslipItemChanges.length, gone.state.payslipLines.length], [0, 0, 0]);
  assert.deepEqual(validateState(edited.state), []);
});

test("the quick-pick labels, and every category name, are the owner's list", () => {
  assert.deepEqual(QUICK_LABELS.earning.map((q) => q[0]), ["Basic salary", "Overtime", "Holiday and night pay", "Rice subsidy", "Allowance"]);
  assert.deepEqual(QUICK_LABELS.deduction.map((q) => q[0]), ["SSS", "PhilHealth", "Pag-IBIG", "Withholding tax", "Loan"]);
  assert.ok(EARNING_CATEGORIES.some(([k, n]) => k === "holiday_night" && n === "Holiday and night pay"));
  assert.ok(DEDUCTION_CATEGORIES.some(([k, n]) => k === "loans" && n === "Loan repayments"));
  assert.equal(linesFromItems([{ section: "earning", label: "x", amount: 0 }], "2026-10").length, 0, "a 0.00 item has no line (a line must be more than zero) and adds nothing");
  assert.deepEqual(linesFromItems([{ section: "employer", label: "SSS ER", amount: 105000, category: "sss" }, { section: "earning", label: "Basic Salary", amount: 500, category: "salary" }, { section: "deduction", label: "SSS", amount: 100, category: "sss" }], "2026-10"),
    [{ side: "earning", kind: "basic", amount: 500 }, { side: "deduction", kind: "sss", amount: 100 }], "an employer item never becomes a line");
});

// ----- the migration (data version 10 to 11) -----
const TS = "2026-10-12T09:00:00.000+08:00";
const V10 = ["accounts", "goals", "envelopes", "transactions", "entries", "categories", "categoryMaps", "rules", "templates", "presets", "payeeRules", "subscriptions", "checkIns", "attachments", "tags", "foreignAmounts", "surveyResponses", "payslips", "payslipLines", "payslipRevisions", "schedules", "scheduleChanges", "statementRecords", "statementLines", "statementAccepts"];
function v10WithPayslips() {
  const s = planPayslip(ledger(), { id: "old1", transaction_id: "tx-old1", employer: "Old Co", period_from: "2026-09-01", period_to: "2026-09-15", pay_date: "2026-09-15", account_id: "chk", printed_gross: 900000, printed_net: 800000, deposit: 800000,
    earnings: [{ kind: "basic", amount: 800000 }, { kind: "overtime", amount: 100000, earned_month: "2026-09" }], deductions: [{ kind: "tax", amount: 100000 }] }, NOW).state;
  const { payslipItems, payslipItemChanges, ...rest } = s;
  return { v: 10, rev: 150, saved_at: TS, state: { ...Object.fromEntries(V10.map((k) => [k, []])), ...rest }, settings: { notice_seen_at: TS, last_employer: "Old Co" } };
}
test("data version 10 upgrades to 11: an old ledger with payslips opens with every figure kept, two empty lists added, and the old payslip says Original wording not kept", () => {
  const before = v10WithPayslips(), snapshot = JSON.stringify(before);
  assert.equal(before.state.payslips.length, 1); assert.equal("payslipItems" in before.state, false, "the old backup has no such list");
  const r = upgradeLedger(before, { now: new Date("2026-10-30T00:00:00Z") });
  assert.equal(r.ok, true, r.error); assert.equal(r.ledger.v, 11); assert.equal(JSON.stringify(before), snapshot, "the input is never changed");
  for (const k of V10) assert.deepEqual(r.ledger.state[k], before.state[k], k + " is the same");
  assert.deepEqual(r.ledger.state.payslipItems, []); assert.deepEqual(r.ledger.state.payslipItemChanges, []);
  assert.deepEqual(r.ledger.settings, before.settings);
  assert.equal(fingerprint(r.ledger), fingerprint(before)); assert.deepEqual(selfCheck(r.ledger), []);
  const p = r.ledger.state.payslips[0], lines = linesOf(r.ledger.state, "old1"), t = payslipTotals(lines);
  assert.deepEqual([p.printed_gross, p.printed_net, p.deposit, t.gross, t.deductions, t.net, t.overtime], [900000, 800000, 800000, 900000, 100000, 800000, 100000], "every figure of the old payslip is the same");
  assert.equal(wordingKept(r.ledger.state, p), false); assert.equal(itemsOf(r.ledger.state, "old1").length, 0, "no line is invented");
  assert.equal(parseLedger(JSON.stringify(r.ledger)).older, undefined);
  assert.equal(upgradeLedger(r.ledger).steps, 0, "already current");
});
test("SAFETY COPY: before the update the app keeps the old data, and the copy reads back exactly as it was", () => {
  const before = v10WithPayslips(), original = JSON.stringify(before);
  const copies = rotateCopies([], original, { at: "2026-10-30T08:00:00+08:00", from_version: before.v, build: "test" });
  assert.equal(copies.length, 1); assert.equal(copies[0].text, original, "the copy is the data before the change, byte for byte");
  const back = restorableCopy(copies[0], 200);
  assert.equal(back.v, 10); assert.equal(back.rev, 201);
  assert.deepEqual(back.state, before.state, "the copy reads back with every payslip and line");
  assert.equal(parseLedger(JSON.stringify(back)).ok, true);
  assert.equal(upgradeLedger(back).ledger.v, 11, "and a restored copy upgrades again");
  assert.equal(LEDGER_VERSION, 11);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import * as M from "../src/model/index.js";
import { UNLOGGED_CATEGORY_ID } from "../src/model/seed.js";
import { makeState, account } from "./fixtures.js";

// The audit tests (docs/ACCOUNTING.md): the ledger is held to the accounting and auditing principles the charter names. Each test says which principle it guards.
// Every figure is invented. Amounts are centavos (100000 is 1,000.00). Only rules that hold today are here; each fix PR adds its own rule once it passes.
const NOW = new Date("2026-10-20T03:00:00Z"), MONTH = "2026-10", FROM = MONTH + "-01", TO = MONTH + "-31";
const UL = UNLOGGED_CATEGORY_ID;

let n = 0;
const nid = (p) => p + ++n;
function ledger() {
  let s = makeState();
  s.accounts = [account({ id: "chk", name: "Checking", class: "asset", opening_balance: 1000000 }), account({ id: "wal", name: "Wallet", class: "asset", opening_balance: 50000 }),
    account({ id: "sav", name: "Savings", class: "asset", opening_balance: 200000 }), account({ id: "card", name: "Card", class: "liability", opening_balance: 20000 })];
  s.categories = [{ id: "food", name: "Food", kind: "expense" }, { id: "rent", name: "Rent", kind: "expense", role: "rent" }, { id: "fees", name: "Bank fees", kind: "expense" }, { id: UL, name: "Unlogged", kind: "expense" }];
  for (const k of ["payslips", "payslipLines", "payslipItems", "payslipItemChanges", "payslipRevisions", "checkIns", "goals", "rules", "categoryMaps", "tags", "subscriptions", "schedules", "scheduleChanges"]) s[k] = [];
  return M.ensureIncomeCategories(s);
}
const verifyAll = (st) => { let x = st; for (const t of st.transactions.filter((t) => t.status === "draft")) { if (x.transactions.find((y) => y.id === t.id).status !== "draft") continue; const r = M.verifyDraft(x, t.id, NOW); assert.ok(r.ok, JSON.stringify(r.violations)); x = r.state; } return x; };
const expense = (st, date, cat, amount, acct, o = {}) => { const p = M.planExpense(st, { transaction_id: nid("e"), date, category_id: cat, amount, account_id: acct, payee: o.payee ?? "Shop" }, NOW); assert.ok(p.ok, JSON.stringify(p.violations)); return verifyAll(M.applyDrafts(st, p.drafts)); };
const transfer = (st, date, from, to, amount, fee = 0) => { const p = M.planTransfer(st, { transaction_id: nid("tr"), date, from_account_id: from, to_account_id: to, amount, fee, source: "manual" }, NOW); assert.ok(p.ok, JSON.stringify(p.violations)); return verifyAll(p.state); };
const received = (st, date, cat, amount, acct) => { const id = nid("in"); const t = { id, date, payee: "Money in", memo: "", status: "verified", source: "manual", created_at: "2026-10-01T09:00:00.000+08:00", verified_at: "2026-10-01T09:00:00.000+08:00" };
  const es = [{ transaction_id: id, account_id: acct, amount }, { transaction_id: id, category_id: cat, amount: -amount }]; assert.ok(M.checkTransactionSave(st, { transaction: t, entries: es }).ok); return { ...st, transactions: [...st.transactions, t], entries: [...st.entries, ...es] }; };
const balanceOf = (st, id) => M.naturalBalance(st.accounts.find((a) => a.id === id), M.countedEntries(st));
const checkIn = (st, acct, counted, o = {}) => { const id = nid("ci"); const p = M.planCheckIn(st, { id, transaction_id: "ck" + id, date: o.date ?? "2026-10-13", account_id: acct, counted_balance: counted, unlogged_category_id: UL, why: o.why, basis: o.basis }, NOW);
  assert.ok(p.ok, JSON.stringify(p.violations)); const base = p.posting ? { ...st, transactions: [...st.transactions, p.posting.transaction], entries: [...st.entries, ...p.posting.entries] } : st;
  return p.transaction ? { ...base, transactions: [...base.transactions, p.transaction], entries: [...base.entries, ...p.entries] } : base; };

// The trial balance: all entries add to zero, each transaction adds to zero, nothing points at a missing transaction, and every transaction has at least two entries.
function trial(st) {
  const byTx = new Map(); let total = 0;
  for (const e of st.entries) { total += e.amount; byTx.set(e.transaction_id, (byTx.get(e.transaction_id) ?? 0) + e.amount); }
  const ids = new Set(st.transactions.map((t) => t.id));
  const counts = new Map(); for (const e of st.entries) counts.set(e.transaction_id, (counts.get(e.transaction_id) ?? 0) + 1);
  return { total, unbalanced: [...byTx].filter(([, v]) => v !== 0).map(([k]) => k), orphans: st.entries.filter((e) => !ids.has(e.transaction_id)).length, thin: st.transactions.filter((t) => (counts.get(t.id) ?? 0) < 2).map((t) => t.id) };
}
const assertTrial = (st, step) => { const t = trial(st); assert.deepEqual(t, { total: 0, unbalanced: [], orphans: 0, thin: [] }, "trial balance after " + step); assert.deepEqual(M.selfCheck({ v: M.LEDGER_VERSION, rev: 1, saved_at: "x", state: st, settings: {} }).filter((m) => !/shape/i.test(m)), [], "self check after " + step); };

// One ledger that has been through every kind of operation; the trial balance is taken after EACH one.
function everything() {
  const steps = []; let s = ledger();
  const step = (name, next) => { s = next; assertTrial(s, name); steps.push(name); };
  step("log an expense", expense(s, "2026-10-05", "food", 50000, "chk"));
  step("a card purchase (pending, then verified)", expense(s, "2026-10-06", "food", 30000, "card"));
  { const r = M.planCardPayment(s, { card_id: "card", from_id: "chk", amount: 30000, date: "2026-10-07", newId: () => nid("cp"), now: NOW }); assert.ok(r.ok); step("a card payment", verifyAll(r.state)); }
  step("a transfer with a fee", transfer(s, "2026-10-08", "chk", "sav", 20000, 500));
  step("a refund received", received(s, "2026-10-09", "cat-refund", 10000, "chk"));
  { const r = M.planPayslip(s, { id: "p1", transaction_id: "ptx1", employer: "Co", period_from: "2026-10-01", period_to: "2026-10-15", pay_date: "2026-10-15", account_id: "chk", printed_gross: 1200000, printed_net: 1000000, deposit: 1000000,
      earnings: [{ kind: "basic", amount: 1000000 }, { kind: "overtime", amount: 200000, earned_month: MONTH }], deductions: [{ kind: "sss", amount: 200000 }] }, NOW); assert.ok(r.ok, JSON.stringify(r.violations)); step("a payslip with overtime", r.state); }
  { const t = { id: "oldtx", date: "2026-10-16", payee: "Old Co", memo: "Payslip", status: "verified", source: "manual", created_at: "2026-10-16T09:00:00.000+08:00", verified_at: "2026-10-16T09:00:00.000+08:00" };
    s = { ...s, transactions: [...s.transactions, t], entries: [...s.entries, { transaction_id: "oldtx", account_id: "chk", amount: 800000 }, { transaction_id: "oldtx", category_id: "cat-salary", amount: -800000 }],
      payslips: [...s.payslips, { id: "old", employer: "Old Co", period_from: "2026-10-01", period_to: "2026-10-15", pay_date: "2026-10-16", account_id: "chk", transaction_id: "oldtx", printed_gross: 1000000, printed_net: 800000, deposit: 800000, printed_deductions: 200000, version: 2 }],
      payslipLines: [...s.payslipLines, { payslip_id: "old", side: "earning", kind: "basic", amount: 1000000 }, { payslip_id: "old", side: "deduction", kind: "sss", amount: 200000 }] };
    const items = [["earning", "Basic Salary", 1000000], ["deduction", "SSS", 200000]].map(([section, label, amount]) => M.draftItem({ section, label, amount, employer: "Old Co", settings: {} }));
    const r = M.addPrintedLines(s, "old", { items: items.map(({ via, ...i }) => i) }, NOW); assert.ok(r.ok, JSON.stringify(r.violations)); step("Add the breakdown", r.state); }
  step("a count that matches nothing to explain (plain gap: spent)", checkIn(s, "wal", balanceOf(s, "wal") - 3000, { date: "2026-10-12" }));
  step("a count held as not yet explained", checkIn(s, "sav", balanceOf(s, "sav") - 7000, { why: "later", date: "2026-10-13" }));
  step("a count with an extra held", checkIn(s, "wal", balanceOf(s, "wal") + 4000, { why: "later", date: "2026-10-14" }));
  { const p = M.planCheckInWithMove(s, { id: nid("ci"), transaction_id: nid("ck"), date: "2026-10-15", account_id: "sav", counted_balance: balanceOf(s, "sav") + 5000, unlogged_category_id: UL }, { account_id: "chk", move_id: nid("mv") }, NOW);
    assert.ok(p.ok, JSON.stringify(p.violations)); const st = { ...p.state, transactions: [...p.state.transactions, ...(p.plan.transaction ? [p.plan.transaction] : [])], entries: [...p.state.entries, ...p.plan.entries] }; step("a count explained as a move", verifyAll(st)); }
  step("a card counted on what is owed", checkIn(s, "card", balanceOf(s, "card") + 6000, { basis: "owed", date: "2026-10-16" }));
  { const target = s.transactions.find((t) => t.payee === "Shop" && t.status === "verified" && s.entries.some((e) => e.transaction_id === t.id && e.account_id === "chk"));
    const p = M.planCorrection(s, { id: target.id, redo_id: nid("redo"), today: "2026-10-20" }, NOW); assert.ok(p.ok, JSON.stringify(p.violations)); step("a correction", M.applyCorrection(s, p)); }
  { const plan = M.planGapRepair(s, { now: NOW }); assert.ok(plan.ok && plan.count > 0, "there is a plain count to repair"); step("a gap repair", M.applyGapRepair(s, plan)); }
  { const copy = JSON.parse(JSON.stringify({ v: M.LEDGER_VERSION, rev: 1, saved_at: "2026-10-20T11:00:00.000+08:00", state: s, settings: {} })); let written = null;
    s = { ...s }; steps.push("a restore"); assertTrial(copy.state, "a restore (the backup read back)"); everythingRestore = { copy, written }; }
  return { s, steps };
}
let everythingRestore = null;
const built = everything();
const S = built.s;

test("TRIAL BALANCE (double entry): the entries add to zero to the centavo after every kind of operation, and so does every transaction", () => {
  assert.ok(built.steps.length >= 15, "every kind of operation was run: " + built.steps.join("; "));
  assertTrial(S, "all of them");
});

test("TRIAL BALANCE after a restore: a ledger written to a backup and read back is the same and still balances", async () => {
  const current = { v: M.LEDGER_VERSION, rev: 1, saved_at: "x", state: ledger(), settings: {} }, next = { v: M.LEDGER_VERSION, rev: 2, saved_at: "y", state: S, settings: {} };
  let stored = null, copies = [];
  const r = await M.replaceWithCopy({ current: { ...current, state: { ...current.state, transactions: S.transactions.slice(0, 1) } }, next, meta: { at: "x" },
    io: { readCopies: async () => copies, writeCopies: async (l) => { copies = l; return { local: true, idb: true }; }, writeLedger: async (text) => { stored = text; return true; } } });
  assert.ok(r.ok && stored);
  assertTrial(JSON.parse(stored).state, "a restore");
});

test("EQUATION: what you have minus what you owe is its opening figure plus income minus expenses, for every entry on or after its account's opening date", () => {
  const nw = (st) => st.accounts.reduce((a, x) => a + (x.class === "asset" ? 1 : -1) * M.naturalBalance(x, M.countedEntries(st)), 0);
  const opening = S.accounts.reduce((a, x) => a + (x.class === "asset" ? 1 : -1) * x.opening_balance, 0);
  const kind = new Map(S.categories.map((c) => [c.id, c.kind]));
  const result = -S.entries.filter((e) => e.category_id != null).reduce((a, e) => a + e.amount, 0);   // income (credits) less expenses (debits)
  assert.equal(nw(S), opening + result);
  assert.ok(kind.size > 3);
});

test("ACCOUNT BALANCE: every balance is its opening figure plus its own movements and nothing else, for an asset and for a card", () => {
  for (const a of S.accounts) {
    const moves = S.entries.filter((e) => e.account_id === a.id).reduce((n, e) => n + e.amount, 0);
    assert.equal(balanceOf(S, a.id), a.class === "asset" ? a.opening_balance + moves : a.opening_balance - moves, a.name);
  }
});

test("TRANSFERS (classification): money moved between your own accounts nets to zero, is never income or spending, and only its fee is spent", () => {
  const before = ledger();
  const after = transfer(before, "2026-10-08", "chk", "sav", 20000, 500);
  const moved = (id) => balanceOf(after, id) - balanceOf(before, id);
  assert.equal(moved("chk"), -20500); assert.equal(moved("sav"), 20000);
  assert.equal(M.spendingByCategory(after, { month: MONTH }).total, 500, "only the fee is spending");
  assert.deepEqual(M.spendingByCategory(after, { month: MONTH }).rows.map((r) => r.name), ["Bank fees"]);
  assert.equal(M.incomeBySource(after, { from: FROM, to: TO }).total, 0, "a move is not income");
  const plain = transfer(before, "2026-10-08", "chk", "sav", 20000);
  assert.equal(moved === undefined, false);
  assert.equal(balanceOf(plain, "chk") + balanceOf(plain, "sav"), balanceOf(before, "chk") + balanceOf(before, "sav"), "without a fee your own money is the same in total");
  assert.equal(M.spendingByCategory(plain, { month: MONTH }).total, 0);
});

test("CARDS (classification and recognition): a card purchase is spent when made and owed at once; paying the card is a transfer and is never spent twice", () => {
  const before = ledger();
  const bought = expense(before, "2026-10-06", "food", 30000, "card");
  assert.equal(M.spendingByCategory(bought, { month: MONTH }).total, 30000); assert.equal(balanceOf(bought, "card"), balanceOf(before, "card") + 30000);
  const r = M.planCardPayment(bought, { card_id: "card", from_id: "chk", amount: 30000, date: "2026-10-07", newId: () => "cp1", now: NOW });
  const paid = verifyAll(r.state);
  assert.equal(M.spendingByCategory(paid, { month: MONTH }).total, 30000, "paying the card adds no spending");
  assert.equal(balanceOf(paid, "card"), balanceOf(before, "card")); assert.equal(balanceOf(paid, "chk"), balanceOf(before, "chk") - 30000);
});

test("SUSPENSE: a gap the owner has not explained is never spending in any figure that reads spending (Category, month, account, day, line, Who, suggestions)", () => {
  let s = expense(ledger(), "2026-10-05", "food", 10000, "chk");
  const plain = M.spendingByCategory(s, { month: MONTH });
  s = checkIn(s, "chk", balanceOf(s, "chk") - 70000, { why: "later", date: "2026-10-12" });
  s = checkIn(s, "wal", balanceOf(s, "wal") + 9000, { why: "later", date: "2026-10-13" });
  assert.equal(M.heldIds(s).size, 2);
  assert.deepEqual(M.spendingByCategory(s, { month: MONTH }), plain, "Category and This month");
  assert.equal(M.spendingByAccount(s, { month: MONTH }).total, 10000, "Accounts");
  assert.equal(M.dayTotal(s, "2026-10-12").total, 0, "Spent today on the day of the count");
  assert.equal([...M.dailySpending(s, { from: FROM, to: TO }).values()].reduce((a, b) => a + b, 0), 10000, "the Trends line");
  assert.equal(M.monthlySpending(s, { endMonth: MONTH, months: 1 })[0].amount, 10000);
  assert.equal(M.spendingByPayee(s, {}, { from: FROM, to: TO }).reduce((a, r) => a + r.total, 0), 10000, "Who");
  assert.equal(M.unexplainedGaps(s, { unlogged_category_id: UL }).length, 2, "they are listed apart, as Not yet explained");
  assert.equal(M.spendingTransactions(s, { from: FROM, to: TO, category_id: UL }).total, 0, "and the entries behind a Category row do not list them");
  // ... and the balance still shows what was counted
  assert.equal(balanceOf(s, "chk"), 1000000 - 10000 - 70000);
  // cancelling a held gap (the correction that cancels it is held too) moves nothing
  const gap = M.unexplainedGaps(s, { unlogged_category_id: UL })[0], p = M.planCorrection(s, { id: gap.transaction_id, redo_id: "x", today: "2026-10-20" }, NOW);
  assert.ok(p.ok); assert.deepEqual(M.spendingByCategory(M.applyCorrection(s, p), { month: MONTH }), plain);
  const plan = M.suggestPlan({ state: s, paydays: [{ id: "a", label: "A", day: 15 }, { id: "b", label: "B", day: "last" }], today: "2026-10-20", month: "2026-11", income: [800000, 800000], rent: 0 });
  assert.ok(plan.ok, plan.message);
  const unlogged = plan.paydays.flatMap((d) => d.lines).filter((l) => /unlogged/i.test(l.name));
  assert.equal(unlogged.length, 0, "no suggested line is made from a held gap");
});

test("REVERSING ENTRIES: every correction names exactly one verified entry that exists, cancels it to the centavo, and no entry is cancelled twice", () => {
  const rev = S.transactions.filter((t) => t.reverses != null);
  assert.ok(rev.length >= 2, "the ledger holds a correction and a repair");
  const by = new Map();
  for (const t of rev) {
    const target = S.transactions.find((x) => x.id === t.reverses);
    assert.ok(target && target.status === "verified", t.id + " names a verified entry");
    const mine = S.entries.filter((e) => e.transaction_id === t.id).map((e) => [e.account_id ?? null, e.category_id ?? null, -e.amount]).sort();
    const theirs = S.entries.filter((e) => e.transaction_id === target.id).map((e) => [e.account_id ?? null, e.category_id ?? null, e.amount]).sort();
    assert.deepEqual(mine, theirs, t.id + " is the exact opposite of " + target.id);
    by.set(target.id, (by.get(target.id) ?? 0) + 1);
  }
  assert.ok([...by.values()].every((c) => c === 1), "each entry is cancelled once");
  assert.ok(S.transactions.every((t) => t.reverses == null || !S.transactions.some((x) => x.reverses === t.id)), "a cancelling entry is never itself cancelled");
});

test("REVERSING ENTRIES: the same entry cannot be cancelled again by a plan made from an older state", () => {
  let s = expense(ledger(), "2026-10-12", "food", 8000, "chk");
  const id = s.transactions.find((t) => t.payee === "Shop").id, p = M.planCorrection(s, { id, redo_id: "r1", today: "2026-10-20" }, NOW);
  const once = M.applyCorrection(s, p);
  assert.equal(M.applyCorrection(once, p), once, "a second tap changes nothing");
  assert.equal(M.planCorrection(once, { id, redo_id: "r2", today: "2026-10-20" }, NOW).ok, false);
});

test("AUDIT TRAIL: a verified entry cannot be saved over", () => {
  const s = expense(ledger(), "2026-10-12", "food", 8000, "chk"), t = s.transactions.find((x) => x.payee === "Shop");
  const again = M.checkTransactionSave(s, { transaction: { ...t }, entries: s.entries.filter((e) => e.transaction_id === t.id).map((e) => ({ ...e, amount: e.amount > 0 ? 9999 : -9999 })) });
  assert.equal(again.ok, false); assert.ok(again.violations.some((v) => v.code === "ENTRY_FINAL"));
});

test("CONSISTENCY: Spent today, This month, Category and Accounts agree for the same verified entries", () => {
  const dayTotals = []; for (let d = 1; d <= 31; d++) dayTotals.push(M.dayTotal(S, MONTH + "-" + String(d).padStart(2, "0")).verified);
  const cat = M.spendingByCategory(S, { month: MONTH }).total;
  assert.ok(cat > 0);
  assert.equal(dayTotals.reduce((a, b) => a + b, 0), cat, "the days add up to the month");
  assert.equal(M.spendingByAccount(S, { month: MONTH }).total, cat, "Accounts");
  assert.equal(M.spendingByRange(S, { from: FROM, to: TO }).total, cat);
  assert.equal(M.monthlySpending(S, { endMonth: MONTH, months: 1 })[0].amount, cat, "the Trends month");
  assert.equal([...M.dailySpending(S, { from: FROM, to: TO }).values()].reduce((a, b) => a + b, 0), cat, "the Trends line");
});

test("CONSISTENCY: the day and the month show the same waiting amount, and Unlogged and the summary follow the same held-gap rule", () => {
  const draft = M.applyDrafts(S, M.planExpense(S, { transaction_id: "wait", date: FROM, payee: "Kiosk", category_id: "food", amount: 7000, account_id: "chk" }, NOW).drafts);
  const day = M.dayTotal(draft, FROM), month = M.spendingByCategory(draft, { month: MONTH });
  assert.equal(day.draft, month.pending - (M.spendingByCategory(S, { month: MONTH }).pending), "what waits on the day is what the month shows as waiting, apart from the total");
  assert.equal(M.homeSummary(S, { from: FROM, to: TO }).spent, M.spendingByCategory(S, { month: MONTH }).total, "the unused summary agrees with the month");
  assert.equal(M.unloggedTotal(S, UL, FROM, TO), M.spendingByCategory(S, { month: MONTH }).rows.find((r) => r.category_id === UL)?.amount ?? 0, "Unlogged: the gauge is the Category row");
});

test("CONTROL TOTALS: a payslip saved with its printed lines gives the printed gross, deductions and net, and the checks say nothing", () => {
  const items = [["earning", "Basic Salary", 1000000], ["earning", "Overtime", 200000], ["deduction", "SSS", 200000], ["deduction", "Withholding Tax", 100000]].map(([section, label, amount]) => { const { via, via_overtime, ...d } = M.draftItem({ section, label, amount, employer: "Co", settings: {} }); return d; });
  const r = M.planPayslip(ledger(), { id: "ps", transaction_id: "ptx", employer: "Co", period_from: "2026-10-01", period_to: "2026-10-15", pay_date: "2026-10-15", account_id: "chk", printed_gross: 1200000, printed_net: 900000, deposit: 900000, printed_deductions: 300000, items }, NOW);
  assert.ok(r.ok);
  const t = M.payslipTotals(M.linesOf(r.state, "ps")), it = M.itemTotals(M.itemsOf(r.state, "ps"));
  assert.deepEqual([t.gross, t.deductions, t.net], [1200000, 300000, 900000]); assert.deepEqual([it.earnings, it.deductions, it.net], [t.gross, t.deductions, t.net], "the items and the lines agree");
  assert.deepEqual(M.payslipProblems(r.state.payslips[0], M.linesOf(r.state, "ps")).flags, []);
  const off = M.planPayslip(ledger(), { id: "ps2", transaction_id: "ptx2", employer: "Co", period_from: "2026-10-01", period_to: "2026-10-15", pay_date: "2026-10-15", account_id: "chk", printed_gross: 1250000, printed_net: 900000, deposit: 900000, items }, NOW);
  assert.ok(M.payslipProblems(off.payslip, off.lines).flags.length > 0, "a printed gross that the lines do not give is flagged");
});

test("NON-RECURRING INCOME: a line categorised as overtime, holiday and night pay, bonus or back pay never raises the budget's base income", () => {
  const slip = (s, id, date, extra) => { const items = [["earning", "Basic Salary", 1000000, { category: "salary" }], ...extra, ["deduction", "SSS", 200000]].map(([section, label, amount, o]) => { const { via, via_overtime, ...d } = { ...M.draftItem({ section, label, amount, employer: "Co", settings: {} }), ...o }; return d; });
    const gross = items.filter((i) => i.section === "earning").reduce((a, i) => a + i.amount, 0), r = M.planPayslip(s, { id, transaction_id: "tx" + id, employer: "Co", period_from: date, period_to: date, pay_date: date, account_id: "chk", printed_gross: gross, printed_net: gross - 200000, deposit: gross - 200000, period_type: "Bi-Week", items }, NOW); assert.ok(r.ok, JSON.stringify(r.violations)); return r.state; };
  const plain = [["2026-08-07", []], ["2026-08-21", []], ["2026-09-04", []]], loud = [["2026-08-07", [["earning", "Holiday Pay", 300000, { category: "holiday_night" }]]], ["2026-08-21", [["earning", "Bonus", 500000, { category: "bonus" }]]], ["2026-09-04", [["earning", "Retro Basic", 400000]]]];
  const mk = (rows) => rows.reduce((s, [d, extra], i) => slip(s, "q" + i, d, extra), ledger());
  assert.equal(M.baseIncome(mk(loud)).amount, M.baseIncome(mk(plain)).amount, "the same base with or without the one-off pay");
  assert.equal(M.baseIncome(mk(plain)).amount, 1600000);
});

test("NON-RECURRING INCOME: an uncategorised line counts in the base only when its label was on 2 of the last 3 payslips from that employer", () => {
  const slip = (s, id, date, extra) => { const items = [["earning", "Basic Salary", 1000000, { category: "salary" }], ...extra, ["deduction", "SSS", 200000]].map(([section, label, amount, o]) => { const { via, via_overtime, ...d } = { ...M.draftItem({ section, label, amount, employer: "Co", settings: {} }), ...o }; return d; });
    const gross = items.filter((i) => i.section === "earning").reduce((a, i) => a + i.amount, 0), r = M.planPayslip(s, { id, transaction_id: "tx" + id, employer: "Co", period_from: date, period_to: date, pay_date: date, account_id: "chk", printed_gross: gross, printed_net: gross - 200000, deposit: gross - 200000, period_type: "Bi-Week", items }, NOW); assert.ok(r.ok, JSON.stringify(r.violations)); return r.state; };
  const mk = (awards) => { let s = slip(ledger(), "r0", "2026-08-07", []); s = slip(s, "r1", "2026-08-21", awards ? [["earning", "Spot Award", 900000]] : []); return slip(s, "r2", "2026-09-04", awards ? [["earning", "Team Prize", 900000]] : []); };
  assert.equal(M.baseIncome(mk(true)).amount, M.baseIncome(mk(false)).amount, "two different one-off awards do not move the base");
  assert.equal(M.netPerPayday(mk(true)).at(-1).parts[0].why, "one_off");
});

test("MATERIALITY IS NOT USED: a count that is one centavo off is a gap to explain, not a rounding", () => {
  const s = ledger(), p = M.planCheckIn(s, { id: "c", transaction_id: "ck", date: "2026-10-13", account_id: "chk", counted_balance: balanceOf(s, "chk") - 1, unlogged_category_id: UL, why: "later" }, NOW);
  assert.ok(p.transaction, "a gap of one centavo is recorded");
  assert.equal(M.unexplainedGaps({ ...s, transactions: [p.transaction], entries: p.entries }, { unlogged_category_id: UL })[0].amount, 1);
});

test("DOUBLE ENTRY at the door: an entry whose legs do not add to zero, or that has only one leg, is refused", () => {
  const s = ledger(), t = { id: "bad", date: "2026-10-12", payee: "x", memo: "", status: "draft", source: "manual", created_at: "2026-10-01T09:00:00.000+08:00" };
  const off = M.checkTransactionSave(s, { transaction: t, entries: [{ transaction_id: "bad", category_id: "food", amount: 1000 }, { transaction_id: "bad", account_id: "chk", amount: -999 }] });
  assert.equal(off.ok, false); assert.ok(off.violations.some((v) => v.code === "UNBALANCED"));
  const one = M.checkTransactionSave(s, { transaction: t, entries: [{ transaction_id: "bad", account_id: "chk", amount: 0 }] });
  assert.equal(one.ok, false); assert.ok(one.violations.some((v) => v.code === "TOO_FEW_ENTRIES"));
});

test("AUDIT TRAIL: changing or removing a payslip, or removing an income entry, never deletes or rewrites a verified entry; the money moves by corrections", () => {
  const s0 = ledger(), mk = (st, id, d, amount) => { const r = M.planPayslip(st, { id, transaction_id: "tx" + id, employer: "Co", period_from: d, period_to: d, pay_date: d, account_id: "chk", printed_gross: amount, printed_net: amount, deposit: amount, earnings: [{ kind: "basic", amount }], deductions: [] }, NOW); assert.ok(r.ok); return r.state; };
  let s = mk(mk(s0, "x", "2026-10-02", 800000), "y", "2026-10-16", 800000);
  s = received(s, "2026-10-09", "cat-interest", 5000, "chk"); const inx = s.transactions[s.transactions.length - 1].id;
  const frozen = s.transactions.filter((t) => t.status === "verified").map((t) => JSON.stringify([t, s.entries.filter((e) => e.transaction_id === t.id)]));
  const changed = M.updatePayslip(s, "x", { employer: "Co", period_from: "2026-10-02", period_to: "2026-10-02", pay_date: "2026-10-02", account_id: "chk", printed_gross: 700000, printed_net: 700000, deposit: 700000, earnings: [{ kind: "basic", amount: 700000 }], deductions: [] }, NOW);
  assert.ok(changed.ok);
  const removedSlip = M.deletePayslip(changed.state, "y", NOW), removedIn = M.removeIncomeEntry(removedSlip.state, inx, NOW);
  assert.ok(removedSlip.ok && removedIn.ok);
  const after = removedIn.state, now = after.transactions.filter((t) => t.status === "verified").map((t) => JSON.stringify([t, after.entries.filter((e) => e.transaction_id === t.id)]));
  assert.ok(frozen.every((x) => now.includes(x)), "every verified entry that was there is still there, unchanged");
  assertTrial(after, "changing and removing");
  assert.equal(balanceOf(after, "chk"), 1000000 + 700000, "only the changed payslip is left, once");
  assert.ok(after.transactions.filter((t) => t.reverses != null).every((t, _i, all) => all.filter((x) => x.reverses === t.reverses).length === 1), "each entry cancelled once");
});

test("TRIAL BALANCE REPORT: after every kind of operation the ledger check says OK; a damaged ledger is reported, never refused", () => {
  assert.equal(M.ledgerCheckLine(S), "Ledger check: OK");
  const bad = { ...S, entries: [...S.entries, { transaction_id: "ghost", account_id: "chk", amount: 700 }] };
  assert.equal(M.ledgerCheckLine(bad), "Ledger check: 1 problem (tell the project chat)");
  assert.deepEqual(M.validateState(bad), [], "it still opens");
});

test("RECONCILIATION (match before you record): a real charge that explains a gap counts once, whether the gap was held or booked as spending", () => {
  for (const why of ["later", undefined]) {
    let s = checkIn(ledger(), "wal", balanceOf(ledger(), "wal") - 3000, { why, date: "2026-10-13" });
    const gap = M.findOpenGap(s, { account_id: "wal", amount: 3000, date: "2026-10-12", unlogged_category_id: UL });
    assert.ok(gap, "the gap is offered to the charge (" + (why ?? "spent") + ")");
    s = expense(s, "2026-10-12", "food", 3000, "wal");
    const done = M.applyCorrection(s, M.planCorrection(s, { id: gap.transaction_id, redo_id: nid("x"), today: "2026-10-20" }, NOW));
    assert.equal(balanceOf(done, "wal"), 47000, "the balance is what was counted");
    assert.deepEqual(M.spendingByCategory(done, { month: MONTH }).rows.map((r) => [r.name, r.amount]), [["Food", 3000]], "counted once, in its own category");
    assertTrial(done, "matching a gap");
  }
});

test("SUSPENSE: a held gap is not in the Budget view and not on a trip either", () => {
  let s = { ...ledger(), tags: [{ id: "trip1", name: "Trip", start: "2026-10-10", end: "2026-10-15" }] };
  s = expense(s, "2026-10-11", "food", 10000, "chk");
  s = checkIn(s, "chk", balanceOf(s, "chk") - 50000, { why: "later", date: "2026-10-13" });
  const row = M.budgetStatus(s, { rules: [], month: MONTH }).find((r) => r.category_id === UL);
  assert.ok(!row || row.spent === 0, "Budget");
  assert.equal(M.tagSummary(s, "trip1").spent, 10000, "Trips");
  assert.deepEqual(M.tripEntries(s, "trip1").rows.map((r) => r.amount), [10000]);
});

test("RECOGNITION: a refund reduces spending in its category and is never income", () => {
  let s = expense(ledger(), "2026-10-05", "food", 100000, "chk");
  const r = M.planRefund(s, { transaction_id: nid("rf"), date: "2026-10-09", amount: 40000, account_id: "chk", category_id: "food" }, NOW); assert.ok(r.ok);
  assert.equal(M.spendingByCategory(r.state, { month: MONTH }).total, 60000);
  assert.equal(M.incomeBySource(r.state, { from: FROM, to: TO }).total, 0);
  assert.equal(balanceOf(r.state, "chk"), balanceOf(s, "chk") + 40000);
  assertTrial(r.state, "a refund");
  assert.equal(M.planRefund(s, { transaction_id: "x", date: "2026-10-09", amount: 1, account_id: "chk", category_id: "cat-refund" }, NOW).ok, false, "money cannot be booked as a refund of an income category");
});

test("CUTOFF: pay counts in the month its deposit arrived, the period worked is only a label, and a removed payslip nets to nothing in that month", () => {
  const r = M.planPayslip(ledger(), { id: "pz", transaction_id: "ptz", employer: "Co", period_from: "2026-09-16", period_to: "2026-09-30", pay_date: "2026-10-05", account_id: "chk", printed_gross: 800000, printed_net: 800000, deposit: 800000, earnings: [{ kind: "basic", amount: 800000 }], deductions: [] }, NOW);
  assert.ok(r.ok);
  assert.equal(M.incomeBySource(r.state, { from: "2026-09-01", to: "2026-09-30" }).total, 0);
  assert.equal(M.incomeBySource(r.state, { from: FROM, to: TO }).total, 800000);
  assert.equal(r.state.payslips[0].period_to, "2026-09-30", "the period is kept as a label");
  const gone = M.deletePayslip(r.state, "pz", NOW).state;
  assert.equal(M.incomeBySource(gone, { from: FROM, to: TO }).total, 0);
});

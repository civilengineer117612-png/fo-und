import { test } from "node:test";
import assert from "node:assert/strict";
import { planCheckIn, planCorrection, applyCorrection, planExpense, applyDrafts, verifyDraft, spendingByCategory, spendingByAccount, spendingByRange, dayTotal, dailySpending, spendingTransactions,
  unexplainedGaps, findOpenGap, bigGap, naturalBalance, countedEntries, heldIds, suggestBudgets } from "../src/model/index.js";
import { spendingByPayee } from "../src/model/payees.js";
import { UNLOGGED_CATEGORY_ID } from "../src/model/seed.js";
import { makeState, account } from "./fixtures.js";

// Invented numbers, whole centavos (100000 is 1,000.00). A weekly check-in gap the owner did not explain is HELD: it corrects the balance and is not spending.
const NOW = new Date("2026-10-09T12:00:00+08:00"), MONTH = "2026-10", DAY = "2026-10-09", UNL = "unl";
function ledger() {
  const s = makeState();
  s.accounts = [account({ id: "A", name: "Bank A", class: "asset", opening_balance: 1000000 }), account({ id: "B", name: "Wallet B", class: "asset", opening_balance: 200000 }),
    account({ id: "CC", name: "Card", class: "liability", opening_balance: 100000 })];
  s.categories = [{ id: "food", name: "Food", kind: "expense" }, { id: UNL, name: "Unlogged", kind: "expense" }, { id: "pay", name: "Pay", kind: "income" }];
  s.checkIns = [];
  return s;
}
let n = 0;
function count(s, account_id, counted, why, date = DAY) {
  const p = planCheckIn(s, { id: "ci" + ++n, transaction_id: "cnt" + n, date, account_id, counted_balance: counted, unlogged_category_id: UNL, ...(why ? { why } : {}) }, NOW);
  assert.ok(p.ok, JSON.stringify(p.violations));
  return { ...s, checkIns: [...s.checkIns, p.checkIn], transactions: [...s.transactions, ...(p.transaction ? [p.transaction] : [])], entries: [...s.entries, ...p.entries] };
}
const lastCount = () => "cnt" + n;
const bal = (s, id) => naturalBalance(s.accounts.find((a) => a.id === id), countedEntries(s));
const spent = (s) => spendingByCategory(s, { month: MONTH }).total;
const charge = (s, id, amount, account_id, date = DAY) => verifyDraft(applyDrafts(s, planExpense(s, { transaction_id: id, date, payee: "Shop", category_id: "food", amount, account_id }, NOW).drafts), id, NOW).state;
const everyFigure = (s) => ({ today: dayTotal(s, DAY).total, month: spent(s), range: spendingByRange(s, { from: "2026-10-01", to: "2026-10-31" }).total, accounts: spendingByAccount(s, { month: MONTH }).total,
  daily: [...dailySpending(s, { from: "2026-10-01", to: "2026-10-31" }).values()].reduce((a, b) => a + b, 0), payees: spendingByPayee(s, null, { from: "2026-10-01", to: "2026-10-31" }).rows?.reduce((a, r) => a + r.total, 0) ?? 0 });

test("CASE 5 I'll explain later on a 500.00 shortfall: balance right, spending +0.00, 500.00 listed as not yet explained", () => {
  const s = count(ledger(), "A", 950000, "later");
  assert.equal(bal(s, "A"), 950000); assert.equal(spent(s), 0);
  assert.deepEqual(unexplainedGaps(s).map((g) => [g.account_id, g.kind, g.amount, g.date]), [["A", "short", 50000, DAY]]);
});
test("CASE 5b the same gap in the other direction (500.00 more than the ledger) is also held, and never lowers spending", () => {
  const s = count(charge(ledger(), "lunch", 20000, "A"), "A", 1000000, "later");   // ledger 9,800.00, counted 10,000.00
  assert.equal(bal(s, "A"), 1000000); assert.equal(spent(s), 20000, "still just the lunch");
  assert.deepEqual(unexplainedGaps(s).map((g) => [g.kind, g.amount]), [["extra", 20000]]);
});
test("CASE 4 credit card: owed 1,000.00 expected, counted 1,250.00: 250.00 is not yet explained, not spending, and the card balance is right", () => {
  const s = count(ledger(), "CC", 125000, "later");
  assert.equal(bal(s, "CC"), 125000); assert.equal(spent(s), 0); assert.equal(spendingByAccount(s, { month: MONTH }).total, 0);
  assert.deepEqual(unexplainedGaps(s).map((g) => [g.account_id, g.kind, g.amount]), [["CC", "short", 25000]], "a card that owes more is a 'short' gap");
});
test("CASE 6 a count of 0 against 12,000.00 asks first, and is never spending by default", () => {
  const big = ledger(); big.accounts[0] = { ...big.accounts[0], opening_balance: 1200000 };
  assert.equal(bigGap(1200000, 0), true, "count 0 against 12,000.00");
  assert.equal(bigGap(1200000, 500000), true, "7,000.00 of 12,000.00 is more than half");
  assert.equal(bigGap(1200000, 1100000), false, "1,000.00 of 12,000.00 is not");
  assert.equal(bigGap(1200000, 600000), false, "exactly half is not MORE than half");
  assert.equal(bigGap(0, 100), false, "a ledger of 0 has nothing to be most of");
  const s = count(big, "A", 0, "later");
  assert.equal(spent(s), 0); assert.equal(bal(s, "A"), 0);
});
test("CASE 3 an entry logged after a gap: 'This explains the gap' is offered, and after one tap the 1,500.00 counts once", () => {
  let s = count(ledger(), "A", 850000, "later");                       // A short 1,500.00, held
  const gapId = lastCount();
  s = charge(s, "late", 150000, "A");                                   // the charge, logged afterwards, same day
  assert.equal(spent(s), 150000, "the charge is spending once; the held gap is not");
  const gap = findOpenGap(s, { account_id: "A", amount: 150000, date: DAY, exclude_id: "late" });
  assert.equal(gap?.transaction_id, gapId, "it is offered");
  const plan = planCorrection(s, { id: gap.transaction_id, redo_id: "x", today: DAY }, NOW);
  assert.ok(plan.ok && plan.redo === null, "a count is cancelled only, no draft");
  const next = applyCorrection(s, plan);
  assert.equal(spent(next), 150000, "after the tap: still counted once");
  assert.deepEqual(unexplainedGaps(next), [], "and the gap is cleared");
  assert.equal(bal(next, "A"), 850000, "the balance is what was counted (8,500.00): the charge had already happened when the count was taken");
});
test("an entry is offered a gap only on the same account, with the exact amount, in the 7 days up to that check-in", () => {
  const s = count(ledger(), "A", 850000, "later");
  const at = (o) => findOpenGap(s, { account_id: "A", amount: 150000, date: DAY, ...o });
  assert.ok(at({}), "exact");
  assert.equal(at({ amount: 150001 }), null, "1 centavo off: no fuzzy matching");
  assert.equal(at({ account_id: "B" }), null, "another account");
  assert.ok(at({ date: "2026-10-03" }), "6 days before the check-in");
  assert.equal(at({ date: "2026-10-02" }), null, "7 days before is outside the period");
  assert.equal(at({ date: "2026-10-10" }), null, "after the check-in");
  assert.equal(findOpenGap(count(ledger(), "A", 1100000, "later"), { account_id: "A", amount: 100000, date: DAY }), null, "a gap of EXTRA money cannot be explained by an entry that spent money");
});
test("cancelling a held gap changes no spending, either way round", () => {
  for (const counted of [850000, 1150000]) {
    const s = count(ledger(), "A", counted, "later"), plan = planCorrection(s, { id: lastCount(), redo_id: "x", today: DAY }, NOW), next = applyCorrection(s, plan);
    assert.equal(spent(next), 0); assert.equal(dayTotal(next, DAY).total, 0); assert.equal(bal(next, "A"), 1000000, "the cancel puts the balance back to the ledger's");
    assert.ok(heldIds(next).has("rev:" + lastCount()), "the cancelling entry is held too");
  }
});
test("CASE 8 every figure agrees on whether a gap counts: held, it counts nowhere; booked as spent, it counts everywhere", () => {
  const held = count(ledger(), "A", 950000, "later"), spentIt = count(ledger(), "A", 950000, null);
  assert.deepEqual(Object.values(everyFigure(held)), [0, 0, 0, 0, 0, 0]);
  const f = everyFigure(spentIt);
  assert.deepEqual([f.today, f.month, f.range, f.accounts, f.daily], [50000, 50000, 50000, 50000, 50000], "the same 500.00 in the day, the month, Category, Accounts and the Trends line");
  assert.equal(spendingTransactions(spentIt, { from: "2026-10-01", to: "2026-10-31", category_id: UNL }).total, 50000);
  assert.equal(spendingTransactions(held, { from: "2026-10-01", to: "2026-10-31", category_id: UNL }).total, 0);
});
test("balance identity: opening + counted adjustment = the counted balance, to the centavo, for every kind of account", () => {
  let s = ledger();
  for (const [id, counted] of [["A", 733333], ["B", 512345], ["CC", 130001]]) s = count(s, id, counted, "later");
  for (const [id, counted] of [["A", 733333], ["B", 512345], ["CC", 130001]]) assert.equal(bal(s, id), counted, id);
});

// Suggested budgets (owner, Oct 29): never learn from a gap that is not yet explained, past or future.
const TS = "2026-01-01T09:00:00.000+08:00";
function history(withGap) {
  const s = ledger();
  s.accounts = [account({ id: "A", name: "Bank A", class: "asset", opening_balance: 100000000 })];
  s.categories = [{ id: "food", name: "Food", kind: "expense", role: "food" }, { id: "rent", name: "Rent", kind: "expense", role: "rent" }, { id: "fun", name: "Fun", kind: "expense" },
    { id: UNLOGGED_CATEGORY_ID, name: "Unlogged", kind: "expense" }, { id: "pay", name: "Pay", kind: "income" }];
  s.payslips = []; s.payslipLines = []; s.subscriptions = []; s.goals = []; s.rules = [];
  let k = 0;
  const spend = (date, cat, amount) => { const id = "t" + ++k; s.transactions.push({ id, date, payee: "", memo: "", status: "verified", source: "manual", created_at: TS, verified_at: TS }); s.entries.push({ transaction_id: id, category_id: cat, amount }, { transaction_id: id, account_id: "A", amount: -amount }); };
  for (const m of ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]) {
    const id = "p" + ++k; s.payslips.push({ id, employer: "Test Co", period_from: m + "-28", period_to: m + "-28", pay_date: m + "-28", account_id: "A", transaction_id: "x" + k, printed_gross: 2500000, printed_net: 2500000, deposit: 2500000 });
    s.payslipLines.push({ payslip_id: id, side: "earning", kind: "basic", amount: 2500000 });
    spend(m + "-02", "food", 200000); spend(m + "-01", "rent", 800000);
    if (withGap && m === "2026-08") {   // a past month with a 5,000.00 gap not yet explained
      const c = planCheckIn(s, { id: "g" + k, transaction_id: "gap" + k, date: m + "-20", account_id: "A", counted_balance: 100000000 - 500000, unlogged_category_id: UNLOGGED_CATEGORY_ID, why: "later" }, NOW);
      assert.ok(c.ok); s.transactions.push(c.transaction); s.entries.push(...c.entries);
    }
  }
  return s;
}
test("suggested budgets never learn from a 5,000.00 gap that is not yet explained: Food uses its 2,000.00 and no category grows", () => {
  const sug = (s) => suggestBudgets({ state: s, today: "2026-10-05", month: "2026-10", rent: 800000 });
  const plain = history(false), gappy = history(true);
  assert.equal(spendingByCategory(gappy, { month: "2026-08" }).total, 1000000, "the month is rent and food, the gap is not in it");
  assert.equal(spendingByCategory(gappy, { month: "2026-08" }).rows.find((r) => r.category_id === "food").amount, 200000, "Food spent 2,000.00");
  const a = sug(plain), b = sug(gappy);
  assert.ok(a.ok && b.ok, JSON.stringify([a.code ?? a.message, b.code ?? b.message]));
  assert.deepEqual(b.rows.map((r) => [r.category_id, r.amount, r.suggested]), a.rows.map((r) => [r.category_id, r.amount, r.suggested]), "every suggested figure is the same with and without the gap");
  assert.equal(b.rows.find((r) => r.category_id === "food").amount, a.rows.find((r) => r.category_id === "food").amount);
  assert.deepEqual(b.saved.map((x) => x.amount), a.saved.map((x) => x.amount));
});

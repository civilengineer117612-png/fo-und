import { test } from "node:test";
import assert from "node:assert/strict";
import * as M from "../src/model/index.js";
import { UNLOGGED_CATEGORY_ID } from "../src/model/seed.js";
import { account } from "./fixtures.js";

// SPLIT AND "OWED TO ME" (A4, data version 12). Every name and figure is invented; amounts are centavos (100000 is 1,000.00). Each case is worked by hand in its comment.
const NOW = new Date("2026-11-08T03:00:00Z"), MONTH = "2026-11", UL = UNLOGGED_CATEGORY_ID;
function ledger() {
  const s = M.emptyState();
  s.accounts = [account({ id: "chk", name: "Sample Checking", class: "asset", opening_balance: 9000000, last4: "" }), account({ id: "wal", name: "Sample Wallet", class: "asset", opening_balance: 100000, last4: "" }),
    account({ id: "card", name: "Sample Card", class: "liability", opening_balance: 0, last4: "" }), account({ id: "res", name: "Sample Reserve", class: "asset", opening_balance: 500000, reserve_for: "card", last4: "" })];
  s.categories = [{ id: "food", name: "Food", kind: "expense" }, { id: "fun", name: "Fun", kind: "expense" }, { id: UL, name: "Uncategorized", kind: "expense" }];
  return M.ensureIncomeCategories(s);
}
const balance = (st, id) => M.naturalBalance(st.accounts.find((a) => a.id === id), M.countedEntries(st));
const verify = (st, id) => { const r = M.verifyDraft(st, id, NOW); assert.ok(r.ok, JSON.stringify(r.violations)); return r.state; };
const split = (st, o) => { const p = M.planSharedExpense(st, { transaction_id: o.id, date: o.date ?? "2026-11-08", payee: o.payee ?? "Dinner", category_id: o.cat ?? "food", amount: o.amount, account_id: o.from ?? "chk",
  shares: o.shares, ids: { account: "owed", people: o.people ?? ["p1", "p2", "p3"] }, ...(o.extra ?? {}) }, NOW); assert.ok(p.ok, JSON.stringify(p.violations)); return M.applyDrafts(p.state, p.drafts); };
const spentIn = (st, cat) => M.spendingByCategory(st, { month: MONTH }).rows.find((r) => r.category_id === cat)?.amount ?? 0;
const dinner = () => split(ledger(), { id: "t1", amount: 300000, shares: [{ name: "Ana", amount: 100000 }, { name: "Ben", amount: 100000 }] });   // 3,000.00 paid, three people, 1,000.00 each

test("a split: the whole amount leaves the account, your share is the spending, the rest is owed to you per person", () => {
  let s = dinner();
  assert.deepEqual(s.entries.filter((e) => e.transaction_id === "t1"), [
    { transaction_id: "t1", category_id: "food", amount: 100000 }, { transaction_id: "t1", account_id: "chk", amount: -300000 },
    { transaction_id: "t1", account_id: "owed", person_id: "p1", amount: 100000 }, { transaction_id: "t1", account_id: "owed", person_id: "p2", amount: 100000 }]);
  assert.equal(s.transactions.find((t) => t.id === "t1").status, "draft", "typed: it waits in Verify");
  assert.equal(balance(s, "chk"), 9000000 - 300000, "3,000.00 left the account");
  assert.deepEqual(s.people, [{ id: "p1", name: "Ana" }, { id: "p2", name: "Ben" }]);
  assert.deepEqual(M.validateState(s), []);
  s = verify(s, "t1");
  assert.equal(spentIn(s, "food"), 100000, "only 1,000.00 is Food");
  assert.equal(M.spendingByCategory(s, { month: MONTH }).total, 100000);
  assert.equal(M.dayTotal(s, "2026-11-08").verified, 100000, "Spent today");
  const sum = M.owedSummary(s);
  assert.deepEqual(sum.people.map((p) => [p.name, p.amount]), [["Ana", 100000], ["Ben", 100000]]);
  assert.deepEqual([sum.total, sum.unassigned], [200000, 0], "what the people owe is the account, to the centavo");
  assert.deepEqual(M.owedKind(s, "t1"), { kind: "shared", total: 300000, yours: 100000, owed: [{ person_id: "p1", name: "Ana", amount: 100000 }, { person_id: "p2", name: "Ben", amount: 100000 }] });
});

test("uneven parts: 1,000.00 paid, Ana owes 333.33 and Ben 333.34, your share is the rest, 333.33", () => {
  const s = verify(split(ledger(), { id: "t1", amount: 100000, shares: [{ name: "Ana", amount: 33333 }, { name: "Ben", amount: 33334 }] }), "t1");
  assert.equal(spentIn(s, "food"), 33333);
  assert.equal(33333 + 33333 + 33334, 100000);
  assert.equal(M.owedSummary(s).total, 66667);
});

test("the Owed to me account is made once, at the first split, and a person is one person however the name is typed", () => {
  let s = ledger();
  assert.equal(M.owedAccount(s), null, "none before the first split");
  s = split(s, { id: "t1", amount: 300000, shares: [{ name: "Ana", amount: 100000 }] });
  s = split(s, { id: "t2", amount: 60000, payee: "Taxi", cat: "fun", shares: [{ name: "  ANA ", amount: 30000 }], people: ["p9"] });
  assert.equal(s.accounts.filter(M.isOwed).length, 1);
  assert.deepEqual(M.owedAccount(s), { id: "owed", name: "Owed to me", class: "asset", role: "owed", hidden_by_default: false, archived: false, opening_balance: 0, opening_date: "2000-01-01", last4: "" });
  assert.deepEqual(s.people, [{ id: "p1", name: "Ana" }], "no second Ana");
  assert.equal(M.owedBy(s, "p1"), 130000);
});

test("what is refused: no person, no name, the same person twice, a part of zero, and a split that leaves you no share", () => {
  const s = ledger(), plan = (shares, amount = 300000) => M.planSharedExpense(s, { transaction_id: "t1", date: "2026-11-08", payee: "Dinner", category_id: "food", amount, account_id: "chk", shares, ids: { account: "owed", people: ["p1", "p2"] } }, NOW);
  const code = (r) => (r.ok ? "ok" : r.violations[0].code);
  assert.equal(code(plan([])), "NO_SHARES");
  assert.equal(code(plan([{ name: "  ", amount: 100000 }])), "NO_NAME");
  assert.equal(code(plan([{ name: "Ana", amount: 100000 }, { name: "ana", amount: 50000 }])), "SAME_PERSON");
  assert.equal(code(plan([{ name: "Ana", amount: 0 }])), "BAD_SHARE");
  assert.equal(code(plan([{ name: "Ana", amount: 300000 }])), "NO_SHARE_LEFT", "all of it owed by others is not a split");
  assert.equal(code(plan([{ name: "Ana", amount: 200000 }, { name: "Ben", amount: 100001 }])), "NO_SHARE_LEFT");
  assert.equal(code(plan([{ name: "Ana", amount: 299999 }])), "ok", "one centavo of your own is a share");
  assert.deepEqual([s.accounts.length, s.people.length], [4, 0], "a refused split leaves nothing behind");
});

test("a pay-back is a move into your account: never income, never less spending, and never more than they owe", () => {
  let s = verify(dinner(), "t1");
  const r = M.planPayBack(s, { transaction_id: "t2", person_id: "p1", amount: 100000, to_account_id: "wal", date: "2026-11-10" }, NOW);
  assert.ok(r.ok, JSON.stringify(r.violations));
  assert.deepEqual(r.entries, [{ transaction_id: "t2", account_id: "wal", amount: 100000 }, { transaction_id: "t2", account_id: "owed", person_id: "p1", amount: -100000 }]);
  assert.equal(r.transaction.status, "draft");
  s = verify(r.state, "t2");
  assert.equal(balance(s, "wal"), 100000 + 100000);
  assert.equal(M.spendingByCategory(s, { month: MONTH }).total, 100000, "spending is still your share of the dinner");
  assert.equal(s.entries.filter((e) => e.transaction_id === "t2" && e.category_id != null).length, 0, "no category line: it is neither income nor a refund");
  assert.deepEqual(M.owedSummary(s).people.map((p) => [p.name, p.amount]), [["Ben", 100000]]);
  assert.deepEqual(M.owedKind(s, "t2"), { kind: "paid", person_id: "p1", name: "Ana", amount: 100000, to_id: "wal" });
  const code = (x) => (x.ok ? "ok" : x.violations[0].code);
  assert.equal(code(M.planPayBack(s, { transaction_id: "t3", person_id: "p2", amount: 100001, to_account_id: "wal", date: "2026-11-10" }, NOW)), "MORE_THAN_OWED");
  assert.equal(code(M.planPayBack(s, { transaction_id: "t3", person_id: "p1", amount: 1, to_account_id: "wal", date: "2026-11-10" }, NOW)), "MORE_THAN_OWED", "Ana owes nothing now");
  assert.equal(code(M.planPayBack(s, { transaction_id: "t3", person_id: "p2", amount: 0, to_account_id: "wal", date: "2026-11-10" }, NOW)), "BAD_AMOUNT");
  assert.equal(code(M.planPayBack(s, { transaction_id: "t3", person_id: "p2", amount: 50000, to_account_id: "card", date: "2026-11-10" }, NOW)), "UNKNOWN_ACCOUNT", "a card does not receive a pay-back");
  assert.equal(code(M.planPayBack(s, { transaction_id: "t3", person_id: "p2", amount: 50000, to_account_id: "owed", date: "2026-11-10" }, NOW)), "UNKNOWN_ACCOUNT");
  assert.equal(code(M.planPayBack(s, { transaction_id: "t3", person_id: "nobody", amount: 50000, to_account_id: "wal", date: "2026-11-10" }, NOW)), "UNKNOWN_PERSON");
});

test("a part pay-back settles the OLDEST debt first, so what is left knows which purchase it came from", () => {
  // Ana owes 1,000.00 for Dinner (Nov 8, Food) and 300.00 for Taxi (Nov 9, Fun). She pays 1,200.00: the dinner is settled, 100.00 of the taxi is left.
  let s = dinner();
  s = split(s, { id: "t2", date: "2026-11-09", amount: 60000, payee: "Taxi", cat: "fun", shares: [{ name: "Ana", amount: 30000 }] });
  const r = M.planPayBack(s, { transaction_id: "t3", person_id: "p1", amount: 120000, to_account_id: "wal", date: "2026-11-12" }, NOW); assert.ok(r.ok); s = r.state;
  assert.deepEqual(M.owedPieces(s, "p1"), [{ transaction_id: "t2", date: "2026-11-09", payee: "Taxi", amount: 10000, category_id: "fun" }]);
  assert.equal(M.owedBy(s, "p1"), 10000);
});

test("a person who will not pay: what they still owe becomes YOUR spending, in the category it came from (three shares, one unpaid: you carry two)", () => {
  let s = verify(dinner(), "t1");
  const back = M.planPayBack(s, { transaction_id: "t2", person_id: "p1", amount: 100000, to_account_id: "wal", date: "2026-11-10" }, NOW); s = verify(back.state, "t2");
  const r = M.planNotPaid(s, { transaction_id: "t3", person_id: "p2", date: "2026-11-20" }, NOW);
  assert.ok(r.ok, JSON.stringify(r.violations));
  assert.deepEqual(r.entries, [{ transaction_id: "t3", category_id: "food", amount: 100000 }, { transaction_id: "t3", account_id: "owed", person_id: "p2", amount: -100000 }]);
  assert.equal(r.transaction.status, "draft", "it waits in Verify like every typed entry");
  assert.equal(spentIn(r.state, "food"), 100000, "a draft is not spending yet");
  s = verify(r.state, "t3");
  assert.equal(spentIn(s, "food"), 200000, "two shares of the 3,000.00 dinner are yours now");
  assert.deepEqual([M.owedSummary(s).total, M.owedSummary(s).people.length], [0, 0], "nobody owes anything");
  assert.equal(balance(s, "chk") + balance(s, "wal"), 9000000 + 100000 - 300000 + 100000, "no money moved: 3,000.00 out, 1,000.00 back");
  assert.deepEqual(M.owedKind(s, "t3"), { kind: "unpaid", person_id: "p2", name: "Ben", amount: 100000 });
  assert.equal(M.planNotPaid(s, { transaction_id: "t4", person_id: "p2", date: "2026-11-21" }, NOW).violations[0].code, "NOTHING_OWED", "not twice");
});

test("will not pay, from two purchases in two categories: each piece goes back to its own category", () => {
  let s = dinner();
  s = split(s, { id: "t2", date: "2026-11-09", amount: 60000, payee: "Taxi", cat: "fun", shares: [{ name: "Ana", amount: 30000 }] });
  const r = M.planNotPaid(s, { transaction_id: "t3", person_id: "p1", date: "2026-11-20" }, NOW); assert.ok(r.ok, JSON.stringify(r.violations));
  assert.deepEqual(r.entries, [{ transaction_id: "t3", category_id: "food", amount: 100000 }, { transaction_id: "t3", category_id: "fun", amount: 30000 }, { transaction_id: "t3", account_id: "owed", person_id: "p1", amount: -130000 }]);
});

test("Owed to me holds no money: it is not in your accounts, not in net worth, and nothing else can be put on it", () => {
  const before = ledger(), s = verify(dinner(), "t1");
  const o = M.accountsOverview(s, { from: "2026-11-01", to: "2026-11-30" });
  assert.deepEqual(o.money.map((m) => m.account_id).sort(), ["chk", "res", "wal"], "not listed with the accounts");
  assert.equal(o.held, 9000000 - 300000 + 100000 + 500000, "in your accounts falls by the whole 3,000.00");
  const today = (st) => M.netWorthSeries(st, { today: "2026-11-08" }).points.at(-1);
  assert.equal(today(s).net, today(before).net - 300000, "net worth: the 2,000.00 owed to you is not counted");
  assert.equal(today(s).net, M.netPosition(o.held, o.owe).free, "today's point is still the Cards figure exactly");
  assert.equal(M.netWorthSeries(s, { today: "2026-11-08", months: "all" }).points[0].date >= "2026-01-31", true, "the account's early start date does not stretch the chart back to 2000");
  const code = (r) => (r.ok ? "ok" : r.violations[0].code);
  assert.equal(code(M.planExpense(s, { transaction_id: "x1", date: "2026-11-09", category_id: "food", amount: 5000, account_id: "owed" }, NOW)), "OWED_NEEDS_PERSON", "it cannot be paid from");
  assert.equal(code(M.planTransfer(s, { transaction_id: "x2", date: "2026-11-09", from_account_id: "chk", to_account_id: "owed", amount: 5000, source: "manual" }, NOW)), "OWED_NEEDS_PERSON", "no plain move into it");
  assert.equal(code(M.planPayReceived(s, { transaction_id: "x3", date: "2026-11-09", amount: 5000, account_id: "owed", category_id: "cat-other-income", payee: "x" }, NOW)), "OWED_NEEDS_PERSON", "no income into it");
  assert.equal(code(M.planCheckIn(s, { id: "c1", transaction_id: "x4", date: "2026-11-09", account_id: "owed", counted_balance: 0, unlogged_category_id: UL }, NOW)), "NOT_COUNTED", "it is never counted");
  assert.equal(code(M.planGoal(s, { id: "g1", name: "Trip", account_id: "owed", hidden_by_default: false })), "UNKNOWN_ACCOUNT", "no goal sits on it");
  const bad = (entries) => M.checkTransactionSave(s, { transaction: { id: "x5", date: "2026-11-09", payee: "", memo: "", status: "draft", source: "manual", created_at: "2026-11-09T09:00:00.000+08:00" }, entries }).violations.map((v) => v.code);
  assert.deepEqual(bad([{ transaction_id: "x5", account_id: "chk", person_id: "p1", amount: 100 }, { transaction_id: "x5", account_id: "wal", amount: -100 }]), ["PERSON_NOT_OWED"], "a person only on Owed to me");
  assert.deepEqual(bad([{ transaction_id: "x5", account_id: "owed", person_id: "ghost", amount: 100 }, { transaction_id: "x5", account_id: "wal", amount: -100 }]), ["UNKNOWN_PERSON"]);
  assert.deepEqual(M.validateShape("Entry", { transaction_id: "x", category_id: "food", person_id: "p1", amount: 1 }).map((v) => v.message), ["person_id requires account_id"]);
});

test("By account: the split shows your share against the account you paid from, so Accounts and Category give the same total", () => {
  let s = verify(dinner(), "t1");
  let by = M.spendingByAccount(s, { month: MONTH });
  assert.deepEqual(by.rows.map((r) => [r.account_id, r.amount]), [["chk", 100000]], "3,000.00 paid less 2,000.00 owed to you");
  assert.equal(by.total, M.spendingByCategory(s, { month: MONTH }).total);
  const np = M.planNotPaid(s, { transaction_id: "t3", person_id: "p2", date: "2026-11-20" }, NOW); s = verify(np.state, "t3");
  by = M.spendingByAccount(s, { month: MONTH });
  assert.deepEqual(by.rows.map((r) => [r.account_id, r.amount]), [["owed", 100000], ["chk", 100000]], "the unpaid share shows under Owed to me, where it came from (equal rows run A to Z)");
  assert.equal(by.total, M.spendingByCategory(s, { month: MONTH }).total, "200000 either way");
  assert.equal(M.spendingTransactions(s, { from: "2026-11-01", to: "2026-11-30", category_id: "food" }).total, 200000);
});

test("paid by card: the card owes the whole amount, the reserve transfer covers the whole amount, and only your share is spending", () => {
  const p = M.planSharedExpense(ledger(), { transaction_id: "t1", date: "2026-11-08", payee: "Dinner", category_id: "food", amount: 300000, account_id: "card", reserve_source_id: "chk",
    shares: [{ name: "Ana", amount: 200000 }], ids: { account: "owed", people: ["p1"] } }, NOW);
  assert.ok(p.ok, JSON.stringify(p.violations));
  let s = M.applyDrafts(p.state, p.drafts);
  assert.deepEqual(p.drafts[0].entries.find((e) => e.account_id === "card"), { transaction_id: "t1", account_id: "card", amount: -300000, card_state: "pending" });
  assert.equal(balance(s, "card"), 300000, "the card is owed all of it");
  assert.equal(balance(s, "res"), 500000 + 300000, "the reserve is topped up by all of it");
  s = verify(s, "t1");
  assert.equal(spentIn(s, "food"), 100000);
  assert.equal(M.owedBy(s, "p1"), 200000);
});

test("a correction of a split cancels the others' parts too, to the centavo", () => {
  let s = verify(dinner(), "t1");
  const c = M.planCorrection(s, { id: "t1", redo_id: "fix1", today: "2026-11-08" }, NOW); assert.ok(c.ok, JSON.stringify(c.violations));
  assert.equal(c.redo, null, "a split is cancelled only: it is entered again by hand");
  s = M.applyCorrection(s, c);
  assert.deepEqual([M.owedSummary(s).total, M.owedSummary(s).people.length, M.owedSummary(s).unassigned], [0, 0, 0]);
  assert.deepEqual(M.owedPieces(s, "p1"), []);
  assert.equal(M.spendingByCategory(s, { month: MONTH }).total, 0);
  assert.equal(M.spendingByAccount(s, { month: MONTH }).total, 0);
  assert.equal(balance(s, "chk"), 9000000);
  assert.deepEqual(M.personHistory(s, "p1").map((h) => [h.transaction_id, h.amount, h.kind]), [["t1", 100000, "cancel"], ["rev:t1", -100000, "cancel"]], "both lines stay in view, marked as a cancelled pair");
});

test("a cancelled split is not a debt: cancelling the LATER of two leaves the earlier one whole, in its own category", () => {
  // Ana owes 1,000.00 for Dinner (Nov 8, Food) and 300.00 for Taxi (Nov 9, Fun). The taxi entry is cancelled. She owes 1,000.00, all of it the dinner
  // (the cancelling lines must not be read as a pay-back, which would settle 300.00 of the dinner and leave the taxi standing).
  let s = verify(dinner(), "t1");
  s = verify(split(s, { id: "t2", date: "2026-11-09", amount: 60000, payee: "Taxi", cat: "fun", shares: [{ name: "Ana", amount: 30000 }] }), "t2");
  const c = M.planCorrection(s, { id: "t2", redo_id: "fix2", today: "2026-11-09" }, NOW); assert.ok(c.ok, JSON.stringify(c.violations));
  s = M.applyCorrection(s, c);
  assert.deepEqual(M.owedPieces(s, "p1"), [{ transaction_id: "t1", date: "2026-11-08", payee: "Dinner", amount: 100000, category_id: "food" }]);
  assert.equal(M.owedBy(s, "p1"), 100000);
});

test("a statement or list line of the WHOLE amount is the split already logged, not a second purchase", () => {
  const s = dinner();
  assert.equal(M.loggedMatch(s, { date: "2026-11-09", name: "Restaurant", amount: 300000, accountId: "chk" })?.id, "t1", "the bank shows 3,000.00 leaving");
  assert.equal(M.loggedMatch(s, { date: "2026-11-09", name: "Restaurant", amount: 100000, accountId: "chk" }), null, "your share alone is not what left the account");
});

test("shareEntries keeps the paying side as it is and refuses a receipt already split in two kinds", () => {
  const paying = [{ transaction_id: "t1", account_id: "wal", envelope_id: "e1", amount: -20000 }, { transaction_id: "t1", account_id: "wal", envelope_id: "e2", amount: -10000 }];
  assert.deepEqual(M.shareEntries([{ transaction_id: "t1", category_id: "food", amount: 30000 }, ...paying], "t1", "owed", [{ person_id: "p1", amount: 12000 }]),
    [{ transaction_id: "t1", category_id: "food", amount: 18000 }, ...paying, { transaction_id: "t1", account_id: "owed", person_id: "p1", amount: 12000 }]);
  assert.equal(M.shareEntries([{ transaction_id: "t1", category_id: "food", amount: 20000 }, { transaction_id: "t1", category_id: "fun", amount: 10000 }, { transaction_id: "t1", account_id: "wal", amount: -30000 }], "t1", "owed", [{ person_id: "p1", amount: 1000 }]), null);
});

test("an entry dated before today's first split still counts on Owed to me (the account starts long before any entry)", () => {
  const s = split(ledger(), { id: "t1", date: "2026-02-03", amount: 300000, shares: [{ name: "Ana", amount: 100000 }] });
  assert.equal(M.owedSummary(s).total, 100000);
  assert.equal(M.beforeAccountStart(s, "owed", "2026-02-03"), false);
});

test("a statement's move is never filed to Owed to me, even when it is passed as the chosen account", () => {
  const s = dinner(), line = { date: "2026-11-09", text: "SAMPLE OWNER", payee: "SAMPLE OWNER", type: "Transfer", amount: 50000, direction: "in", balance: null, meaning: "move", own: true };
  assert.equal(M.statementMoves(s, [line], { account_id: "chk", chosen: { own: "wal" } })[0].to, "wal");
  assert.equal(M.statementMoves(s, [line], { account_id: "chk", chosen: { own: "owed" } })[0].to, null);
});

// ---------- data version 11 to 12 ----------
function v11() {   // a hand-written version 11 ledger: no `people` list, no person on any line
  const TS = "2026-11-01T09:00:00.000+08:00", cur = M.emptyState(); delete cur.people;
  const tx = (id, date, payee, status = "verified") => ({ id, date, payee, memo: "", status, source: "manual", created_at: TS, ...(status === "verified" ? { verified_at: TS } : {}) });
  return { v: 11, rev: 40, saved_at: TS, settings: { notice_seen_at: TS, last_account_id: "chk" }, state: { ...cur,
    accounts: [account({ id: "chk", name: "Sample Checking", class: "asset", opening_balance: 500000, last4: "1234" }), account({ id: "card", name: "Sample Card", class: "liability", opening_balance: 20000, last4: "" })],
    categories: [{ id: "food", name: "Food", kind: "expense", role: "food" }, { id: "cat-salary", name: "Salary", kind: "income" }],
    transactions: [tx("a", "2026-10-05", "Sample Grocer"), tx("b", "2026-10-06", "Dinner out"), tx("c", "2026-10-15", "Pay"), tx("d", "2026-10-20", "Card payment"), tx("e", "2026-11-01", "Lunch", "draft")],
    entries: [{ transaction_id: "a", category_id: "food", amount: 45000 }, { transaction_id: "a", account_id: "chk", amount: -45000 },
      { transaction_id: "b", category_id: "food", amount: 30000 }, { transaction_id: "b", account_id: "card", amount: -30000, card_state: "posted" },
      { transaction_id: "c", account_id: "chk", amount: 250000 }, { transaction_id: "c", category_id: "cat-salary", amount: -250000 },
      { transaction_id: "d", account_id: "card", amount: 30000, card_state: "posted" }, { transaction_id: "d", account_id: "chk", amount: -30000 },
      { transaction_id: "e", category_id: "food", amount: 18500 }, { transaction_id: "e", account_id: "chk", amount: -18500 }] } };
}
test("data version 11 upgrades to 12: one empty list is added, every record and every figure is the same, and no account is made", () => {
  const before = v11(), snapshot = JSON.stringify(before);
  assert.equal(M.parseLedger(snapshot).older, true, "an older ledger");
  const r = M.upgradeLedger(before, { now: NOW });
  assert.equal(r.ok, true, r.error); assert.equal(r.steps, 1); assert.equal(r.ledger.v, 12); assert.equal(M.LEDGER_VERSION, 12);
  assert.equal(JSON.stringify(before), snapshot, "the input is never changed");
  for (const k of Object.keys(before.state)) assert.deepEqual(r.ledger.state[k], before.state[k], k + " is the same");
  assert.deepEqual(r.ledger.state.people, []);
  assert.deepEqual(Object.keys(r.ledger.state).sort(), [...Object.keys(before.state), "people"].sort(), "nothing else is added");
  assert.deepEqual(r.ledger.settings, before.settings);
  assert.equal(M.owedAccount(r.ledger.state), null, "Owed to me is made at the first split, not by the update");
  assert.equal(M.fingerprint(r.ledger), M.fingerprint(before)); assert.deepEqual(M.selfCheck(r.ledger), []);
  assert.deepEqual([balance(r.ledger.state, "chk"), balance(r.ledger.state, "card")], [500000 - 45000 + 250000 - 30000 - 18500, 20000 + 30000 - 30000], "balances as before");
  assert.equal(M.spendingByCategory(r.ledger.state, { month: "2026-10" }).total, 75000, "October spending as before");
  assert.equal(M.parseLedger(JSON.stringify(r.ledger)).older, undefined);
  assert.equal(M.upgradeLedger(r.ledger).steps, 0, "already current");
});
test("SAFETY COPY: before the update to version 12 the app keeps the version 11 data, and the copy reads back exactly as it was", () => {
  const before = v11(), original = JSON.stringify(before);
  const copies = M.rotateCopies([], original, { at: "2026-11-14T08:00:00+08:00", from_version: before.v, build: "test" });
  assert.equal(copies.length, 1); assert.equal(copies[0].text, original, "the copy is the data before the change, byte for byte");
  assert.equal(copies[0].from_version, 11);
  const back = M.restorableCopy(copies[0], 200);
  assert.equal(back.v, 11); assert.equal(back.rev, 201);
  assert.deepEqual(back.state, before.state, "the copy reads back with every record");
  assert.equal("people" in back.state, false, "and is still version 11 data");
  assert.equal(M.parseLedger(JSON.stringify(back)).ok, true);
  assert.equal(M.upgradeLedger(back).ledger.v, 12, "a restored copy upgrades again");
});
test("a version 11 backup file opens, restores, upgrades, and a split made afterwards backs up and opens again", async () => {
  const file = await M.encryptLedgerBackup(v11(), "a long passphrase for tests"), opened = await M.decryptLedgerBackup(file, "a long passphrase for tests");
  assert.equal(opened.v, 11);
  const up = M.upgradeLedger(M.restoreLedger(M.emptyLedger(), opened, NOW), { now: NOW }); assert.ok(up.ok, up.error);
  const s = split(up.ledger.state, { id: "t1", amount: 300000, shares: [{ name: "Ana", amount: 100000 }] });
  const next = M.nextLedger(up.ledger, s, up.ledger.settings, NOW);
  const back = await M.decryptLedgerBackup(await M.encryptLedgerBackup(next, "a long passphrase for tests"), "a long passphrase for tests");
  assert.deepEqual(back.state, s); assert.deepEqual(M.selfCheck(back), []);
  assert.equal(M.owedBy(back.state, "p1"), 100000);
});

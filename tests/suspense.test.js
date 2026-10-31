import { test } from "node:test";
import assert from "node:assert/strict";
import * as M from "../src/model/index.js";
import { UNLOGGED_CATEGORY_ID } from "../src/model/seed.js";
import { makeState, account } from "./fixtures.js";

// P0-5 fix 3 (docs/ACCOUNTING.md, principles 4 and 5): a gap is matched BEFORE it is recorded twice, so the real charge counts once, whichever way the gap was booked;
// and "Not yet explained" is never in the Budget view or in a trip's total. Invented figures, centavos.
const NOW = new Date("2026-10-20T03:00:00Z"), UL = UNLOGGED_CATEGORY_ID;
let n = 0;
function base() {
  const s = makeState();
  s.accounts = [account({ id: "chk", name: "Checking", class: "asset", opening_balance: 1000000 }), account({ id: "wal", name: "Wallet", class: "asset", opening_balance: 50000 })];
  s.categories = [{ id: "food", name: "Food", kind: "expense" }, { id: UL, name: "Unlogged", kind: "expense" }];
  s.tags = []; s.rules = []; s.categoryMaps = [];
  return s;
}
const bal = (s, id) => M.naturalBalance(s.accounts.find((a) => a.id === id), M.countedEntries(s));
const count = (s, acct, counted, o = {}) => { const p = M.planCheckIn(s, { id: "ci" + ++n, transaction_id: "ck" + n, date: o.date ?? "2026-10-13", account_id: acct, counted_balance: counted, unlogged_category_id: UL, why: o.why }, NOW); assert.ok(p.ok);
  return p.transaction ? { ...s, transactions: [...s.transactions, p.transaction], entries: [...s.entries, ...p.entries] } : s; };
const spend = (s, date, cat, amount, acct) => { const p = M.planExpense(s, { transaction_id: "e" + ++n, date, category_id: cat, amount, account_id: acct, payee: "Shop" }, NOW); assert.ok(p.ok); let x = M.applyDrafts(s, p.drafts); return M.verifyDraft(x, p.drafts[0].transaction.id, NOW).state; };
const find = (s, o) => M.findOpenGap(s, { account_id: "wal", amount: 3000, date: "2026-10-12", unlogged_category_id: UL, ...o });

test("a gap booked as 'I spent some of it' is matched by the real charge too, and the money counts once", () => {
  let s = count(base(), "wal", 47000);   // 30.00 short, the owner said they spent it: Unlogged spending
  assert.equal(M.spendingByCategory(s, { month: "2026-10" }).total, 3000);
  const gap = find(s); assert.ok(gap, "the real charge of the same amount, the same account, in that check-in's week is offered the gap");
  s = spend(s, "2026-10-12", "food", 3000, "wal");
  assert.equal(bal(s, "wal"), 44000, "logged on top, the wallet would be 30.00 under what was counted");
  const plan = M.planCorrection(s, { id: gap.transaction_id, redo_id: "x", today: "2026-10-20" }, NOW); assert.ok(plan.ok);
  const done = M.applyCorrection(s, plan);
  assert.equal(bal(done, "wal"), 47000, "the balance is what was counted");
  const by = M.spendingByCategory(done, { month: "2026-10" });
  assert.equal(by.total, 3000, "counted once"); assert.deepEqual(by.rows.map((r) => [r.name, r.amount]), [["Food", 3000]], "in the real category, not Unlogged");
  assert.equal(done.entries.reduce((a, e) => a + e.amount, 0), 0);
});
test("a held gap is still matched as before, and each gap is offered only for what it is", () => {
  const held = count(base(), "wal", 47000, { why: "later" });
  assert.ok(find(held), "held short gap");
  const spent = count(base(), "wal", 47000);
  assert.equal(find(spent, { amount: 2999 }), null, "another amount");
  assert.equal(find(spent, { account_id: "chk" }), null, "another account");
  assert.equal(find(spent, { date: "2026-10-14" }), null, "an entry dated after the check-in");
  assert.equal(find(spent, { date: "2026-10-05" }), null, "an entry more than a week before it");
  const extra = count(base(), "wal", 53000); assert.equal(find(extra, { amount: 3000 }), null, "found money is explained by money in, not by a charge");
  const gap = find(spent), plan = M.planCorrection(spent, { id: gap.transaction_id, redo_id: "x", today: "2026-10-20" }, NOW);
  assert.equal(find(M.applyCorrection(spent, plan)), null, "a gap that was cancelled is not offered again");
  const other = spend(base(), "2026-10-12", "food", 3000, "wal");
  assert.equal(find(other, {}), null, "an ordinary entry is not a gap");
});
test("explainable gaps list the held ones and the spent ones, and only unexplainedGaps (the Not yet explained list) stays held-only", () => {
  let s = count(base(), "wal", 47000); s = count(s, "chk", bal(s, "chk") - 5000, { why: "later", date: "2026-10-14" });
  assert.equal(M.unexplainedGaps(s, { unlogged_category_id: UL }).length, 1, "only the held one is Not yet explained");
  s = count(s, "wal", bal(s, "wal") + 4000, { date: "2026-10-15" });   // money FOUND is explained by money in, never by a charge
  assert.equal(M.explainableGaps(s, { unlogged_category_id: UL }).length, 2);
  assert.deepEqual(M.explainableGaps(s, { unlogged_category_id: UL }).map((g) => g.kind), ["short", "short"]);
});

test("the Budget view never counts a held gap, nor the entry that cancels it", () => {
  let s = spend(base(), "2026-10-05", "food", 10000, "chk");
  s = count(s, "chk", bal(s, "chk") - 50000, { why: "later" });
  const row = (st) => M.budgetStatus(st, { rules: [], month: "2026-10" }).find((r) => r.category_id === UL);
  assert.ok(!row(s) || row(s).spent === 0, "the held gap is not Unlogged spending in the Budget view");
  const gap = M.unexplainedGaps(s, { unlogged_category_id: UL })[0], c = M.applyCorrection(s, M.planCorrection(s, { id: gap.transaction_id, redo_id: "x", today: "2026-10-20" }, NOW));
  assert.ok(!row(c) || row(c).spent === 0, "and neither is the entry that cancels it");
  assert.equal(M.budgetStatus(s, { rules: [], month: "2026-10" }).find((r) => r.category_id === "food").spent, 10000, "real spending is untouched");
  // a gap booked as spending (the owner said so) still counts: it is spending
  const spent = count(spend(base(), "2026-10-05", "food", 10000, "chk"), "chk", 940000);
  assert.equal(M.budgetStatus(spent, { rules: [], month: "2026-10" }).find((r) => r.category_id === UL).spent, 50000);
});
test("a trip's total and its entries never count a held gap dated inside the trip", () => {
  let s = { ...base(), tags: [{ id: "trip1", name: "Trip", start: "2026-10-10", end: "2026-10-15" }] };
  s = spend(s, "2026-10-11", "food", 10000, "chk");
  s = count(s, "chk", bal(s, "chk") - 50000, { why: "later", date: "2026-10-13" });
  assert.equal(M.tagSummary(s, "trip1").spent, 10000);
  assert.deepEqual(M.tripEntries(s, "trip1").rows.map((r) => r.amount), [10000]);
  const gap = M.unexplainedGaps(s, { unlogged_category_id: UL })[0], c = M.applyCorrection(s, M.planCorrection(s, { id: gap.transaction_id, redo_id: "x", today: "2026-10-20" }, NOW));
  assert.equal(M.tagSummary(c, "trip1").spent, 10000, "nor the entry that cancels it");
  assert.deepEqual(M.tripEntries(c, "trip1").rows.map((r) => r.amount), [10000]);
});

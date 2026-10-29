import { test } from "node:test";
import assert from "node:assert/strict";
import { proposeMoves, planProposedMove, planCheckIn, spendingByCategory, naturalBalance, countedEntries, unexplainedGaps } from "../src/model/index.js";
import { makeState, account } from "./fixtures.js";

// Invented numbers, whole centavos (100000 is 1,000.00). Counting every account first, then matching the gaps.
const NOW = new Date("2026-10-09T12:00:00+08:00"), DAY = "2026-10-09";
const acc = (id, o = {}) => account({ id, name: "Test " + id, class: "asset", opening_balance: 0, ...o });
function world(accounts) {
  const s = makeState();
  s.accounts = accounts; s.categories = [{ id: "food", name: "Food", kind: "expense" }, { id: "unl", name: "Unlogged", kind: "expense" }, { id: "pay", name: "Pay", kind: "income" }]; s.checkIns = [];
  return s;
}
const bal = (s, id) => naturalBalance(s.accounts.find((a) => a.id === id), countedEntries(s));
const input = (n, account_id, counted_balance) => ({ id: "ci" + n, transaction_id: "cnt" + n, date: DAY, account_id, counted_balance, unlogged_category_id: "unl" });
const gapOf = (s, id, counted) => ({ account_id: id, gap: counted - bal(s, id) });

test("CASE 1 forgotten move: A 10,000.00 counted 7,000.00, B 2,000.00 counted 5,000.00: one move of 3,000.00, spending +0.00, both balances right", () => {
  const s = world([acc("A", { opening_balance: 1000000 }), acc("B", { opening_balance: 200000 })]);
  const moves = proposeMoves([gapOf(s, "A", 700000), gapOf(s, "B", 500000)], s.accounts);
  assert.deepEqual(moves, [{ from_id: "A", to_id: "B", amount: 300000 }]);
  const r = planProposedMove(s, { move: moves[0], move_id: "mv1", counts: [{ input: input(1, "A", 700000) }, { input: input(2, "B", 500000) }] }, NOW);
  assert.ok(r.ok, JSON.stringify(r.violations));
  assert.equal(bal(r.state, "A"), 700000); assert.equal(bal(r.state, "B"), 500000);
  assert.equal(spendingByCategory(r.state, { month: "2026-10" }).total, 0, "spending +0.00");
  assert.deepEqual(unexplainedGaps(r.state), [], "nothing is left unexplained");
  const mv = r.state.transactions.find((t) => t.id === "mv1");
  assert.equal(mv.status, "draft", "the move waits in Verify");
  assert.deepEqual(r.state.entries.filter((e) => e.transaction_id === "mv1").map((e) => [e.account_id, e.amount]).sort(), [["A", -300000], ["B", 300000]]);
  assert.equal(r.checkIns.length, 2); assert.ok(r.checkIns.every((c) => c.difference === 0), "both counts match once the move is made");
  assert.ok(!r.state.entries.some((e) => e.category_id === "unl"), "no gap entry at all");
});
test("CASE 2 pockets: P1 short 1,000.00 and P2 over 1,000.00 at the same bank are matched first, even with a wallet that is also over 1,000.00", () => {
  const s = world([acc("P1", { role: "pocket", bank: "gotyme", opening_balance: 500000 }), acc("P2", { role: "pocket", bank: "gotyme", opening_balance: 500000 }), acc("AW", { opening_balance: 500000 })]);   // the wallet sorts BEFORE the pockets, so only the rule can prefer them
  const gaps = [gapOf(s, "P1", 400000), gapOf(s, "P2", 600000), gapOf(s, "AW", 600000)];
  assert.deepEqual(proposeMoves(gaps, s.accounts), [{ from_id: "P1", to_id: "P2", amount: 100000 }], "the pockets of one bank first; the wallet's gap stays unmatched");
  const r = planProposedMove(s, { move: { from_id: "P1", to_id: "P2", amount: 100000 }, move_id: "mv1", counts: [{ input: input(1, "P1", 400000) }, { input: input(2, "P2", 600000) }] }, NOW);
  assert.ok(r.ok); assert.equal(spendingByCategory(r.state, { month: "2026-10" }).total, 0);
});
test("pockets of different banks, or a pocket and an account, are still matched (second pass)", () => {
  const s = world([acc("P1", { role: "pocket", bank: "gotyme", opening_balance: 500000 }), acc("P2", { role: "pocket", bank: "gcash", opening_balance: 500000 })]);
  assert.equal(proposeMoves([gapOf(s, "P1", 400000), gapOf(s, "P2", 600000)], s.accounts).length, 1);
});
test("exact amounts only: 1 centavo apart is no match, and nothing is guessed from three accounts", () => {
  const s = world([acc("A", { opening_balance: 1000000 }), acc("B", { opening_balance: 0 }), acc("C", { opening_balance: 0 })]);
  assert.deepEqual(proposeMoves([gapOf(s, "A", 700000), gapOf(s, "B", 299999)], s.accounts), []);
  assert.deepEqual(proposeMoves([gapOf(s, "A", 700000), gapOf(s, "B", 100000), gapOf(s, "C", 200000)], s.accounts), [], "3,000.00 short, 1,000.00 and 2,000.00 over: left for the owner");
});
test("each account is in one proposal at most", () => {
  const s = world([acc("A", { opening_balance: 100000 }), acc("B", { opening_balance: 100000 }), acc("C", { opening_balance: 0 })]);
  const m = proposeMoves([gapOf(s, "A", 0), gapOf(s, "B", 0), gapOf(s, "C", 100000)], s.accounts);
  assert.equal(m.length, 1); assert.equal(m[0].to_id, "C");
});
test("a credit card is never part of a proposal, and a gap of nothing is no gap", () => {
  const s = world([acc("A", { opening_balance: 100000 }), { ...acc("CC"), class: "liability", opening_balance: 0 }, acc("B", { opening_balance: 100000 })]);
  assert.deepEqual(proposeMoves([{ account_id: "A", gap: -50000 }, { account_id: "CC", gap: 50000 }], s.accounts), []);
  assert.deepEqual(proposeMoves([{ account_id: "A", gap: 0 }, { account_id: "B", gap: 0 }], s.accounts), []);
});
test("a proposal that cannot make the counts match is refused, and nothing is changed", () => {
  const s = world([acc("A", { opening_balance: 1000000 }), acc("B", { opening_balance: 200000 })]);
  const r = planProposedMove(s, { move: { from_id: "A", to_id: "B", amount: 300000 }, move_id: "mv1", counts: [{ input: input(1, "A", 600000) }, { input: input(2, "B", 500000) }] }, NOW);
  assert.equal(r.ok, false); assert.equal(r.violations[0].code, "STILL_A_GAP");
  assert.equal(s.transactions.length, 0, "the state that was passed in is untouched");
});

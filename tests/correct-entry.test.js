import { test } from "node:test";
import assert from "node:assert/strict";
import * as M from "../src/model/index.js";
import { makeState } from "./fixtures.js";

// CORRECT THIS ENTRY (A3, owner Nov 15). Invented data. One window: the entry, the fix, and what it does once the fresh draft is verified.
// Checking holds 1,000.00 (fixtures); one verified lunch on Oct 8, typed as 1,850.00 when it was 185.00.
const NOW = new Date("2026-10-08T12:00:00+08:00"), TODAY = "2026-10-10";
function ledger({ amount = 185000, account = "chk" } = {}) {
  let s = makeState();
  s.categories = [...s.categories, { id: "fun", name: "Fun", kind: "expense" }];
  s.accounts = [...s.accounts, { id: "wal", name: "Test Wallet", class: "asset", role: "", hidden_by_default: false, archived: false, opening_balance: 50000, opening_date: "2026-01-01" }];
  const p = M.planExpense(s, { transaction_id: "lunch", date: "2026-10-08", payee: "Lunch", category_id: "food", amount, account_id: account, reserve_source_id: account === "card" ? "chk" : undefined }, NOW);
  s = M.applyDrafts(s, p.drafts);
  return M.verifyDraft(s, "lunch", NOW).state;
}
const plan = (s, changes, id = "lunch") => { const p = M.planCorrection(s, { id, redo_id: "fix", today: TODAY, changes, reserve_source_id: "chk" }, NOW); assert.ok(p.ok, JSON.stringify(p.violations)); return p; };
const rows = (s, p) => M.correctionEffect(s, p).map((r) => [r.kind, r.name, r.month ?? null, r.change]);
const bal = (s, id) => M.naturalBalance(s.accounts.find((a) => a.id === id), M.countedEntries(s));
const spent = (s, cat, month) => M.spendingByCategory(s, { month }).rows.find((r) => r.category_id === cat)?.amount ?? 0;
const verifyAll = (s) => { for (const t of s.transactions.filter((x) => x.status === "draft")) { if (s.transactions.find((x) => x.id === t.id).status !== "draft") continue; const r = M.verifyDraft(s, t.id, NOW); assert.ok(r.ok, JSON.stringify(r.violations)); s = r.state; } return s; };

test("the wrong amount: 1,850.00 should be 185.00. Food in October is 1,665.00 less and Checking 1,665.00 more, once it is verified", () => {
  const s = ledger(), p = plan(s, { amount: 18500 });
  assert.deepEqual(rows(s, p), [["category", "Food", "2026-10", -166500], ["account", "Test Checking", null, 166500]]);
  assert.equal(p.redo[0].transaction.status, "draft", "the corrected entry waits in Verify (owner, Nov 15)");
  assert.equal(p.transactions[0].status, "verified", "the cancelling entry is verified, as a correction always was");
  assert.equal(p.redo[0].transaction.corrects, "lunch");
  assert.deepEqual(p.redo[0].entries.map((e) => e.amount).sort((a, b) => a - b), [-18500, 18500]);
});

test("no change typed is today's behaviour: the same values come back as a draft, and nothing changes once it is verified", () => {
  const s = ledger(), p = plan(s);
  assert.deepEqual(rows(s, p), []);
  assert.deepEqual(p.redo[0].entries, M.planCorrection(s, { id: "lunch", redo_id: "fix", today: TODAY }, NOW).redo[0].entries);
});

test("another category: Food 1,850.00 less and Fun 1,850.00 more; no account changes", () => {
  const s = ledger(), p = plan(s, { category_id: "fun" });
  assert.deepEqual(rows(s, p), [["category", "Food", "2026-10", -185000], ["category", "Fun", "2026-10", 185000]]);
});

test("another account: Checking 1,850.00 more and the wallet 1,850.00 less; no spending changes", () => {
  const s = ledger(), p = plan(s, { account_id: "wal" });
  assert.deepEqual(rows(s, p), [["account", "Test Checking", null, 185000], ["account", "Test Wallet", null, -185000]]);
});

test("another month: October 1,850.00 less, November 1,850.00 more, in the month each belongs to", () => {
  const s = ledger(), p = plan(s, { date: "2026-11-02" });
  assert.deepEqual(rows(s, p), [["category", "Food", "2026-10", -185000], ["category", "Food", "2026-11", 185000]]);
});

test("a card purchase: the card owes less, and its reserve transfer is put right with it", () => {
  const s = ledger({ account: "card" }), p = plan(s, { amount: 18500 });
  assert.ok(s.transactions.some((t) => t.id === "rsv:lunch"), "the purchase came with its reserve transfer from Checking");
  assert.deepEqual(rows(s, p), [["category", "Food", "2026-10", -166500], ["account", "Test Card", null, -166500], ["account", "Test Checking", null, 166500], ["account", "Test Reserve", null, -166500]].sort((a, b) => (a[0] === b[0] ? 0 : a[0] === "category" ? -1 : 1) || Math.abs(b[3]) - Math.abs(a[3]) || a[1].localeCompare(b[1])));
});

test("a move between your own accounts: a new amount and fee; no spending but the fee changes", () => {
  let s = ledger();
  s = M.planTransfer(s, { transaction_id: "mv", date: "2026-10-08", from_account_id: "chk", to_account_id: "wal", amount: 50000, fee: 1500, source: "manual" }, NOW).state;
  s = verifyAll(s);
  const p = plan(s, { amount: 5000, fee: 0 }, "mv");
  const fees = s.categories.find((c) => s.entries.some((e) => e.transaction_id === "fee:mv" && e.category_id === c.id));
  assert.deepEqual(rows(s, p), [["category", fees.name, "2026-10", -1500], ["account", "Test Checking", null, 46500], ["account", "Test Wallet", null, -45000]]);
});

test("an entry that is cancelled only (money in) shows what cancelling it does", () => {
  let s = ledger();
  const r = M.planPayReceived(s, { transaction_id: "pay", date: "2026-10-08", amount: 300000, account_id: "chk", category_id: "pay", payee: "Pay" }, NOW); s = verifyAll(r.state);
  const p = plan(s, {}, "pay");
  assert.equal(p.redo, null);
  assert.deepEqual(rows(s, p), [["category", "Pay", "2026-10", -300000], ["account", "Test Checking", null, -300000]]);
});

test("what the window says is exactly what happens once the corrected entry is verified, in every case", () => {
  const cases = [[ledger(), { amount: 18500 }], [ledger(), { category_id: "fun", amount: 9900 }], [ledger(), { account_id: "wal" }], [ledger(), { date: "2026-11-02", amount: 20000 }], [ledger({ account: "card" }), { amount: 18500 }]];
  for (const [s, changes] of cases) {
    const p = plan(s, changes), after = verifyAll(M.applyCorrection(s, p));
    for (const r of M.correctionEffect(s, p)) {
      if (r.kind === "category") assert.equal(spent(after, r.id, r.month) - spent(s, r.id, r.month), r.change, JSON.stringify([changes, r]));
      else { const a = s.accounts.find((x) => x.id === r.id); assert.equal(bal(after, r.id) - bal(s, r.id), r.change, JSON.stringify([changes, r])); assert.ok(a); }
    }
    for (const a of s.accounts) if (!M.correctionEffect(s, p).some((r) => r.id === a.id)) assert.equal(bal(after, a.id), bal(s, a.id), "an account not listed does not change: " + a.id);
  }
});

test("before the corrected entry is verified, the cancel already counts and the draft does not: the month reads lower by the whole old amount until then", () => {
  const s = ledger(), p = plan(s, { amount: 18500 }), mid = M.applyCorrection(s, p);
  assert.equal(spent(mid, "food", "2026-10"), 0, "1,850.00 cancelled, 185.00 waiting in Verify");
  assert.equal(M.spendingByCategory(mid, { month: "2026-10" }).pending, 18500, "and the 185.00 shows apart, as waiting");
  assert.equal(spent(verifyAll(mid), "food", "2026-10"), 18500, "verified: 185.00");
});

test("a fix the ledger refuses is refused before anything is made: an amount of zero, an unknown category or account", () => {
  const s = ledger();
  for (const changes of [{ amount: 0 }, { category_id: "nope" }, { account_id: "nope" }]) {
    const p = M.planCorrection(s, { id: "lunch", redo_id: "fix", today: TODAY, changes }, NOW);
    assert.equal(p.ok, false, JSON.stringify(changes)); assert.deepEqual([p.transactions, p.entries, p.redo], [[], [], null]);
  }
});

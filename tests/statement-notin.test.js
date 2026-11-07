import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { emptyState, notOnStatement, planExpense, applyDrafts, planTransfer, planCheckIn } from "../src/model/index.js";
import { UNLOGGED_CATEGORY_ID } from "../src/model/seed.js";

// P1-8 fix 7: entries in the ledger on the statement's account, inside its period, that no statement line answers. Read-only. Invented data (centavos).
const NOW = new Date("2026-10-20T09:00:00.000+08:00");
const a = (id, name, extra = {}) => ({ id, name, class: "asset", role: "", hidden_by_default: false, archived: false, opening_balance: 1000000, opening_date: "2026-01-01", ...extra });
const base = () => ({ ...emptyState(), accounts: [a("sav", "Sample Savings"), a("wal", "Sample Wallet"), a("card", "Sample Card", { class: "liability", opening_balance: 0 })],
  categories: [{ id: "cat-food", name: "Food", kind: "expense", role: "food" }, { id: UNLOGGED_CATEGORY_ID, name: "Uncategorized", kind: "expense" }] });
const spend = (s, id, date, payee, amount, account_id) => { const r = planExpense(s, { transaction_id: id, date, payee, category_id: "cat-food", amount, account_id, source: "manual" }, NOW); assert.ok(r.ok, JSON.stringify(r.violations)); return applyDrafts(s, r.drafts); };
const L = (date, amount, direction = "out", text = "line") => ({ date, text, payee: text, amount, direction });
const P = { from: "2026-10-01", to: "2026-10-31" };

test("an entry no statement line answers is listed; answered ones (3 days, same amount, same account) are not", () => {
  let s = spend(base(), "t1", "2026-10-05", "Cafe", 18000, "sav");
  s = spend(s, "t2", "2026-10-09", "Forgot", 7000, "sav");        // not on the statement
  s = spend(s, "t3", "2026-10-12", "Other account", 5000, "wal"); // another account: never listed
  s = spend(s, "t4", "2026-10-20", "Late", 9000, "sav");          // answered by a line 3 days away
  const out = notOnStatement(s, [L("2026-10-07", 18000), L("2026-10-23", 9000)], { account_id: "sav", period: P });
  assert.deepEqual(out.map((x) => [x.id, x.amount]), [["t2", -7000]]);
});

test("one line answers one entry: two equal entries against one line list one", () => {
  let s = spend(base(), "t1", "2026-10-05", "Bus", 5000, "sav"); s = spend(s, "t2", "2026-10-05", "Bus", 5000, "sav");
  assert.equal(notOnStatement(s, [L("2026-10-05", 5000)], { account_id: "sav", period: P }).length, 1);
});

test("an entry outside the period is not listed; with no period the lines' own dates bound it", () => {
  const s = spend(base(), "t1", "2026-09-30", "Before", 5000, "sav");
  assert.equal(notOnStatement(s, [L("2026-10-05", 1)], { account_id: "sav", period: P }).length, 0);
  assert.equal(notOnStatement(spend(base(), "t1", "2026-10-20", "Inside", 5000, "sav"), [L("2026-10-05", 1), L("2026-10-25", 2)], { account_id: "sav" }).length, 1);
});

test("a move is answered by a line of its direction; a card purchase by a card line out", () => {
  let s = base(); const m = planTransfer(s, { transaction_id: "m1", date: "2026-10-10", from_account_id: "sav", to_account_id: "wal", amount: 300000, source: "manual" }, NOW); s = m.state;
  assert.equal(notOnStatement(s, [L("2026-10-10", 300000, "out")], { account_id: "sav", period: P }).length, 0);
  assert.equal(notOnStatement(s, [L("2026-10-10", 300000, "in")], { account_id: "sav", period: P }).length, 1, "money in is not the move out");
  const c = spend(base(), "c1", "2026-10-10", "Shop", 4000, "card");
  assert.equal(notOnStatement(c, [L("2026-10-10", 4000, "out")], { account_id: "card", period: P }).length, 0);
});

test("cancelled entries, their cancelling entries, counts and held gaps are not listed; drafts are", () => {
  let s = spend(base(), "t1", "2026-10-05", "Wrong", 5000, "sav");
  const stamp = "2026-10-06T09:00:00.000+08:00";
  s = { ...s, transactions: s.transactions.map((t) => (t.id === "t1" ? { ...t, status: "verified", verified_at: stamp } : t)) };
  s = { ...s, transactions: [...s.transactions, { id: "rev:t1", date: "2026-10-06", payee: "Wrong", memo: "", status: "verified", source: "correction", reverses: "t1", created_at: stamp, verified_at: stamp }],
    entries: [...s.entries, ...s.entries.filter((e) => e.transaction_id === "t1").map((e) => ({ ...e, transaction_id: "rev:t1", amount: -e.amount }))] };
  assert.equal(notOnStatement(s, [L("2026-10-30", 1)], { account_id: "sav", period: P }).length, 0, "the pair is left out");
  const cnt = planCheckIn(s, { id: "ci1", transaction_id: "ci1t", date: "2026-10-15", account_id: "sav", counted_balance: 5, unlogged_category_id: UNLOGGED_CATEGORY_ID, why: "later" }, NOW);
  assert.ok(cnt.ok);
  const withCount = { ...s, transactions: [...s.transactions, cnt.transaction], entries: [...s.entries, ...cnt.entries], checkIns: [...(s.checkIns ?? []), cnt.checkIn] };
  assert.equal(notOnStatement(withCount, [L("2026-10-30", 1)], { account_id: "sav", period: P }).length, 0, "a held count gap is not a bank event");
  assert.equal(notOnStatement(spend(base(), "d1", "2026-10-05", "Draft", 5000, "sav"), [L("2026-10-30", 1)], { account_id: "sav", period: P })[0].status, "draft");
});

test("it reads, never changes: the state is the same object, and the window lists them", () => {
  const s = spend(base(), "t1", "2026-10-05", "Cafe", 18000, "sav"), before = JSON.stringify(s);
  notOnStatement(s, [L("2026-10-30", 1)], { account_id: "sav", period: P });
  assert.equal(JSON.stringify(s), before);
  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(app, /In your ledger, not on this statement \(\$\{notIn\.length\}\)/);
});

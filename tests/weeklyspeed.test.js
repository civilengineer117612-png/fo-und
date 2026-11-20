// L11 (overhaul, Nov 20): the Weekly review took 1.4 to 1.9 seconds to open on a ledger of 4,000 entries at a phone's speed, most of it in the
// check for amounts that look like a dropped comma, which copied and sorted the rest of each entry's group for every entry. It now sorts each
// group once. These tests keep its answers equal to the plain way (ties, small groups, cancelled and corrected entries) and fail if it is slow
// again. Invented data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { suspectAmounts, AMOUNT_CHECK_TIMES, AMOUNT_CHECK_MIN_OTHERS } from "../src/model/amountcheck.js";
import { payeeKey } from "../src/model/payees.js";

const TS = "2026-01-01T09:00:00.000+08:00";
function ledger(n, groups = 30, seed0 = 7) {
  const st = { categories: [{ id: "food", name: "Food", kind: "expense" }, { id: "fun", name: "Fun", kind: "expense" }, { id: "pay", name: "Pay", kind: "income" }], accounts: [{ id: "a", name: "Sample Wallet" }], transactions: [], entries: [] };
  let seed = seed0; const rnd = (k) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % k; };
  for (let i = 0; i < n; i++) {
    const id = "t" + i, d = `2026-${String(1 + rnd(9)).padStart(2, "0")}-${String(1 + rnd(28)).padStart(2, "0")}`;
    const amount = rnd(12) === 0 ? 100 * (1000 + rnd(50) * 100) : rnd(3) === 0 ? 100 * (50 + rnd(5) * 10) : 1000 + rnd(40) * 125;   // some large, many equal, some with centavos
    const kind = rnd(20) === 0 ? "pay" : rnd(2) ? "food" : "fun";
    st.transactions.push({ id, date: d, payee: rnd(6) === 0 ? "" : "Shop " + rnd(groups), memo: "", status: rnd(3) ? "verified" : "draft", source: rnd(5) ? "manual" : rnd(2) ? "photo" : "reconciliation", created_at: TS, ...(rnd(30) === 0 ? { adjustment: true } : {}) });
    st.entries.push({ transaction_id: id, category_id: kind, amount }, { transaction_id: id, account_id: "a", amount: -amount });
    if (rnd(25) === 0 && i > 0) { const target = "t" + rnd(i); if (!st.transactions.some((t) => t.reverses === target)) st.transactions.push({ id: "rev:" + target, date: d, payee: "", memo: "", status: "verified", source: "correction", reverses: target, created_at: TS }); }
  }
  return st;
}

// The first way it was written, kept as the reference the fast one must agree with.
const median = (list) => { const s = [...list].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]; };
function slowSuspects(state) {
  const cancelled = new Set(state.transactions.filter((t) => t.reverses != null).map((t) => t.reverses));
  const expense = new Set(state.categories.filter((c) => c.kind === "expense").map((c) => c.id));
  const legs = new Map();
  for (const e of state.entries) { if (!e.category_id || !expense.has(e.category_id) || e.amount <= 0) continue; const l = legs.get(e.transaction_id) ?? { amount: 0, category_id: e.category_id }; l.amount += e.amount; legs.set(e.transaction_id, l); }
  const groups = new Map(), rows = [];
  for (const t of state.transactions) {
    const l = legs.get(t.id);
    if (!l || t.reverses != null || t.adjustment || cancelled.has(t.id) || t.source === "correction" || t.source === "reconciliation") continue;
    const key = payeeKey(t.payee) ? "n:" + payeeKey(t.payee) : "c:" + l.category_id, row = { t, amount: l.amount, key };
    rows.push(row); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row);
  }
  const out = [];
  for (const r of rows) {
    if (r.t.source !== "manual" || r.amount % 100 !== 0) continue;
    const others = groups.get(r.key).filter((o) => o !== r).map((o) => o.amount);
    if (others.length < AMOUNT_CHECK_MIN_OTHERS) continue;
    const usual = median(others);
    if (usual <= 0 || r.amount < usual * AMOUNT_CHECK_TIMES) continue;
    out.push({ id: r.t.id, usual, times: Math.floor(r.amount / usual) });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}
const brief = (list) => list.map((r) => ({ id: r.id, usual: r.usual, times: r.times })).sort((a, b) => (a.id < b.id ? -1 : 1));

test("the amount check lists exactly what the plain way lists: many ledgers, big and small groups, ties, cancelled and corrected entries", () => {
  for (const [n, groups, seed] of [[300, 30, 7], [300, 3, 11], [120, 60, 5], [40, 2, 3], [600, 8, 19], [2000, 30, 23]]) {
    const st = ledger(n, groups, seed), fast = brief(suspectAmounts(st)), slow = slowSuspects(st);
    assert.deepEqual(fast, slow, n + " entries, " + groups + " names");
    assert.ok(slow.length > 0 || n < 100, "the case lists something to compare (" + n + ")");
  }
});

test("the lower middle of the others, by hand: [1, 2, 2, 9] without each one", () => {
  // Invented. Each entry is one payee's line; the "others" of a 2 are [1, 2, 9] (middle 2), of the 9 [1, 2, 2] (middle 2), of the 1 [2, 2, 9] (2).
  const st = { categories: [{ id: "food", name: "Food", kind: "expense" }], accounts: [{ id: "a", name: "A" }], transactions: [], entries: [] };
  [100, 200, 200, 9000, 30000].forEach((amount, i) => { st.transactions.push({ id: "h" + i, date: "2026-03-0" + (i + 1), payee: "Sample stall", memo: "", status: "verified", source: "manual", created_at: TS }); st.entries.push({ transaction_id: "h" + i, category_id: "food", amount }, { transaction_id: "h" + i, account_id: "a", amount: -amount }); });
  // others of 30000: [100, 200, 200, 9000] -> lower middle 200 -> 150 times; others of 9000: [100, 200, 200, 30000] -> 200 -> 45 times.
  assert.deepEqual(brief(suspectAmounts(st)), [{ id: "h3", usual: 200, times: 45 }, { id: "h4", usual: 200, times: 150 }]);
});

test("the amount check on a ledger of 4,000 entries is quick: each group sorted once, not once per entry", () => {
  const st = ledger(4000, 30, 7), t0 = performance.now();
  for (let i = 0; i < 5; i++) suspectAmounts(st);
  const ms = performance.now() - t0;
  assert.ok(ms < 400, "5 checks took " + Math.round(ms) + " ms");
});

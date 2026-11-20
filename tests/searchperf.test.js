// L10 (overhaul, Nov 20): the entry search worked out every entry's words again on every key, a pass over all the entries for each transaction,
// so 4,000 entries took about 300 ms a key on a laptop (2 to 4.6 seconds at a phone's speed). It now reads one index per set of lists. These
// tests keep its answers equal to the plain way, show the index follows a changed ledger, and fail if typing is slow again. Invented data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { searchEntries, warmSearch, isReversed } from "../src/model/index.js";
import { formatPesos } from "../src/model/money.js";

const TS = "2026-01-01T09:00:00.000+08:00";
function ledger(n) {
  const st = { categories: [{ id: "food", name: "Food", kind: "expense" }, { id: "fun", name: "Fun", kind: "expense" }], accounts: [{ id: "a", name: "Sample Wallet" }, { id: "b", name: "Sample Bank" }], transactions: [], entries: [] };
  let seed = 7; const rnd = (k) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % k; };
  for (let i = 0; i < n; i++) {
    const id = "t" + i, d = `2026-${String(1 + rnd(9)).padStart(2, "0")}-${String(1 + rnd(28)).padStart(2, "0")}`, amount = 1000 + rnd(40) * 2525;
    st.transactions.push({ id, date: d, payee: "Shop " + rnd(30), memo: rnd(5) ? "" : "note " + rnd(9), status: "verified", source: "manual", created_at: TS });
    st.entries.push({ transaction_id: id, category_id: rnd(2) ? "food" : "fun", amount }, { transaction_id: id, account_id: rnd(2) ? "a" : "b", amount: -amount });
  }
  return st;
}

// The first way it was written (per transaction, a pass over every entry), kept as the reference the fast one must agree with.
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const norm = (s) => String(s ?? "").toLowerCase();
const plain = (s) => String(s).replace(/[^0-9.]/g, "").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
function slowSearch(state, query, { from = "", to = "9999-12-31", limit = 200, skip = () => false } = {}) {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return { rows: [], total: 0 };
  const cat = new Map(state.categories.map((c) => [c.id, c.name])), acct = new Map(state.accounts.map((a) => [a.id, a.name]));
  const partsOf = (t) => {
    const amounts = new Set(), bits = [t.payee, t.memo, t.date, MONTHS[Number(t.date.slice(5, 7)) - 1] + " " + Number(t.date.slice(8)) + " " + t.date.slice(0, 4)];
    for (const e of state.entries.filter((x) => x.transaction_id === t.id)) { if (e.category_id) bits.push(cat.get(e.category_id)); if (e.account_id) bits.push(acct.get(e.account_id)); amounts.add(plain(formatPesos(Math.abs(e.amount)))); }
    return { text: norm(bits.join(" | ")), amounts };
  };
  const hits = state.transactions.filter((t) => t.date >= from && t.date <= to && !skip(t)).filter((t) => { const p = partsOf(t); return words.every((w) => (/^[\d,.]+$/.test(w) && p.amounts.has(plain(w))) || p.text.includes(w)); })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.created_at < b.created_at ? 1 : -1));
  return { rows: hits.slice(0, limit), total: hits.length };
}
const ids = (r) => ({ total: r.total, rows: r.rows.map((t) => t.id) });

test("the search finds exactly what the plain way finds, for words, amounts, dates, a period and a left-out entry", () => {
  const st = ledger(600);
  const queries = ["shop", "shop 1", "food", "sample bank", "fun shop 2", "note", "note 3", "march", "october 2", "2026-04", "25.25", "1,010.00", "10", "shop 99", "wallet food 2026"];
  for (const q of queries) for (const opts of [{}, { from: "2026-03-01", to: "2026-05-31" }, { limit: 5 }, { skip: (t) => t.id.endsWith("7") }]) {
    assert.deepEqual(ids(searchEntries(st, q, opts)), ids(slowSearch(st, q, opts)), q + " " + JSON.stringify(Object.keys(opts)));
  }
});

test("the index follows the ledger: a new entry, a renamed category and a renamed account are found at once", () => {
  const st = ledger(50);
  warmSearch(st);
  assert.equal(searchEntries(st, "zebra").total, 0);
  const added = { ...st, transactions: [...st.transactions, { id: "tz", date: "2026-06-01", payee: "Zebra snacks", memo: "", status: "draft", source: "manual", created_at: TS }],
    entries: [...st.entries, { transaction_id: "tz", category_id: "food", amount: 4200 }, { transaction_id: "tz", account_id: "a", amount: -4200 }] };
  assert.deepEqual(searchEntries(added, "zebra").rows.map((t) => t.id), ["tz"], "a new entry is found");
  assert.equal(searchEntries(added, "42").total, slowSearch(added, "42").total, "by its amount too");
  const renamed = { ...added, categories: added.categories.map((c) => (c.id === "food" ? { ...c, name: "Groceries" } : c)) };
  assert.equal(searchEntries(renamed, "groceries").total, slowSearch(renamed, "groceries").total);
  assert.ok(searchEntries(renamed, "groceries").total > 0 && searchEntries(renamed, "food").total === 0, "the new category name is found and the old one is not");
  const acct = { ...renamed, accounts: renamed.accounts.map((a) => (a.id === "b" ? { ...a, name: "Sample Savings" } : a)) };
  assert.deepEqual(ids(searchEntries(acct, "savings")), ids(slowSearch(acct, "savings")), "a renamed account is found by its new name");
  assert.equal(searchEntries(st, "pushed").total, 0, "the first ledger is searched again, so its index is the one kept");
  st.transactions.push({ id: "tp", date: "2026-06-02", payee: "Pushed in place", memo: "", status: "draft", source: "manual", created_at: TS });   // a list changed in place is noticed by its length
  assert.equal(searchEntries(st, "pushed").total, 1);
});

test("typing a search on a ledger of 4,000 entries is quick: one index, not a pass over every entry for each transaction on every key", () => {
  const st = ledger(4000), keys = "shop 1 food".split("").map((_, i, a) => a.slice(0, i + 1).join(""));
  warmSearch(st);
  const t0 = performance.now();
  for (const q of [...keys, ...keys]) searchEntries(st, q);
  const ms = performance.now() - t0;
  assert.ok(ms < 1000, keys.length * 2 + " keys took " + Math.round(ms) + " ms (about 6 seconds the old way)");
});

test("isReversed follows the ledger: a correction added is seen at once, as the plain way sees it", () => {
  const st = ledger(30), t = st.transactions[3];
  assert.equal(isReversed(st, t.id), false);
  const next = { ...st, transactions: [...st.transactions, { id: "rev:" + t.id, date: t.date, payee: t.payee, memo: "", status: "verified", source: "correction", reverses: t.id, created_at: TS }] };
  assert.equal(isReversed(next, t.id), true);
  assert.equal(isReversed(st, t.id), false, "the earlier ledger still says no");
  for (const x of next.transactions) assert.equal(isReversed(next, x.id), next.transactions.some((y) => y.reverses === x.id), x.id);
});

// The numbers behind the charts: where the money went. Pure functions over the state.
//   - Only VERIFIED transactions count, as everywhere else; drafts are reported separately as pending.
//   - Only expense categories count: income, transfers between your own accounts and card payments
//     are not spending (spec 2.3).
//   - Categories are grouped as of `asOf` (the day the report is run), so a merge regroups history.
//   - Unlogged counts: it is real money that left and was never logged.
import { heldIds } from "./held.js";
import { reportingCategory } from "./rules.js";
import { naturalBalance, countedEntries, isOwed, holdsMoney } from "./balances.js";

export const monthOf = (date) => date.slice(0, 7);

export function addMonths(month, n) {
  const [y, m] = month.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return Math.floor(t / 12) + "-" + String((t % 12) + 1).padStart(2, "0");
}

const NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthLabel = (month) => NAMES[Number(month.slice(5, 7)) - 1] + " " + month.slice(0, 4);

const lastDayOf = (month) => month + "-31";   // string order is date order, so this safely means "the end of the month"

// {total, pending, rows:[{category_id, name, amount, percent}]}, biggest first, for any date range (inclusive, YYYY-MM-DD).
// `total` is net spending (refunds reduce it); `percent` is each positive row's share of it, to 0.1.
export function spendingByRange(state, { from, to, categoryMaps = [], asOf }) {
  const expense = new Map(state.categories.filter((c) => c.kind === "expense").map((c) => [c.id, c]));
  const txById = new Map(state.transactions.map((t) => [t.id, t]));
  const totals = new Map(), held = heldIds(state);
  let pending = 0;
  for (const e of state.entries) {
    if (e.category_id == null || !expense.has(e.category_id)) continue;
    const t = txById.get(e.transaction_id);
    if (!t || held.has(t.id) || t.date < from || t.date > to) continue;   // a count gap that is not yet explained (and the entry that cancels it) is not spending, up or down
    if (t.status !== "verified") { pending += e.amount; continue; }
    const id = reportingCategory(categoryMaps, e.category_id, asOf ?? to);
    totals.set(id, (totals.get(id) ?? 0) + e.amount);
  }
  const rows = [...totals].filter(([, amount]) => amount !== 0)
    .map(([category_id, amount]) => ({ category_id, name: expense.get(category_id)?.name ?? category_id, amount }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
  const total = rows.reduce((n, r) => n + r.amount, 0);
  const pct = sharesOf(rows.map((r) => r.amount), total);
  return { total, pending, rows: rows.map((r, i) => ({ ...r, percent: pct[i] })) };
}

// L14 (overhaul, Nov 13): the shares of a list twin, in percent with one decimal, ADD UP. Each row is rounded to the nearest tenth as before; if the column
// then misses its total by a tenth or two, the difference goes to the LARGEST row (three equal rows read 33.4, 33.3, 33.3, never 33.3 three times = 99.9).
// A column that already adds up is left exactly as it was. Only rows above zero take a share; with no row below zero the column is exactly 100.0.
export function sharesOf(amounts, total) {
  if (!(total > 0)) return amounts.map(() => 0);
  const tenths = amounts.map((a) => (a > 0 ? Math.round((a * 1000) / total) : 0));
  const pos = amounts.filter((a) => a > 0);
  if (!pos.length) return tenths.map(() => 0);
  const target = Math.round((pos.reduce((n, a) => n + a, 0) * 1000) / total);
  let big = -1; amounts.forEach((a, i) => { if (a > 0 && (big < 0 || a > amounts[big])) big = i; });
  tenths[big] += target - tenths.reduce((n, t) => n + t, 0);
  return tenths.map((t) => t / 10);
}

// The same for one month. Categories are grouped as of `asOf` (the day the report is run), so a merge regroups history.
export function spendingByCategory(state, { month, categoryMaps = [], asOf = lastDayOf(month) }) {
  return spendingByRange(state, { from: month + "-01", to: lastDayOf(month), categoryMaps, asOf });
}

// Which account the spending came out of. A card counts as the account the charge was made on.
// {total, rows:[{account_id, name, amount}]}, biggest first.
export function spendingByAccount(state, { month, from, to }) {
  const lo = from ?? month + "-01", hi = to ?? lastDayOf(month);
  const accounts = new Map(state.accounts.map((a) => [a.id, a]));
  const expense = new Set(state.categories.filter((c) => c.kind === "expense").map((c) => c.id));
  const spendingTx = new Set();
  for (const e of state.entries) if (e.category_id != null && expense.has(e.category_id)) spendingTx.add(e.transaction_id);
  const txById = new Map(state.transactions.map((t) => [t.id, t]));
  const totals = new Map(), held = heldIds(state);
  // Split with others (A4): the part the others owe is NOT spending, so it comes off the account that paid (3,000.00 paid, 2,000.00 owed to you: 1,000.00 spent
  // from that account, the same figure as its category). `owedOf` is what each entry put on the Owed to me account, `payer` its biggest paying line.
  const owedOf = new Map(), payer = new Map();
  for (const e of state.entries) {
    if (e.account_id == null || !spendingTx.has(e.transaction_id)) continue;
    const t = txById.get(e.transaction_id);
    if (!t || held.has(t.id) || t.status !== "verified" || t.date < lo || t.date > hi) continue;
    if (isOwed(accounts.get(e.account_id))) { owedOf.set(t.id, (owedOf.get(t.id) ?? 0) + e.amount); continue; }
    totals.set(e.account_id, (totals.get(e.account_id) ?? 0) - e.amount);   // money out = a credit, stored negative
    const p = payer.get(t.id); if (!p || Math.abs(e.amount) > Math.abs(p.amount)) payer.set(t.id, e);
  }
  for (const [id, owed] of owedOf) {
    const p = payer.get(id), to = p ? p.account_id : state.entries.find((e) => e.transaction_id === id && isOwed(accounts.get(e.account_id))).account_id;
    totals.set(to, (totals.get(to) ?? 0) - owed);   // no paying line: a person who will not pay. That spending shows under Owed to me, where it came from.
  }
  const rows = [...totals].filter(([, amount]) => amount !== 0)
    .map(([account_id, amount]) => ({ account_id, name: accounts.get(account_id)?.name ?? account_id, amount }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
  return { total: rows.reduce((n, r) => n + r.amount, 0), rows };
}

// Exact contributions behind one Spending row. Refunds keep their signs;
// splits contribute only the selected category's part. Nothing is saved.
export function spendingTransactions(state, { from, to, category_id, account_id, categoryMaps = [], asOf = to }) {
  if (!category_id && !account_id) return { total: 0, rows: [] };
  const expense = new Set(state.categories.filter((c) => c.kind === "expense").map((c) => c.id));
  const byTx = new Map(), held = heldIds(state);
  for (const e of state.entries) {
    const list = byTx.get(e.transaction_id) ?? [];
    list.push(e); byTx.set(e.transaction_id, list);
  }
  const rows = [];
  for (const transaction of state.transactions) {
    if (held.has(transaction.id) || transaction.status !== "verified" || transaction.date < from || transaction.date > to) continue;
    const entries = byTx.get(transaction.id) ?? [];
    if (!entries.some((e) => expense.has(e.category_id))) continue;
    const amount = entries.reduce((sum, e) => sum + (category_id
      ? expense.has(e.category_id) && reportingCategory(categoryMaps, e.category_id, asOf) === category_id ? e.amount : 0
      : e.account_id === account_id ? -e.amount : 0), 0);
    if (amount !== 0) rows.push({ transaction, amount });
  }
  rows.sort((a, b) => b.transaction.date.localeCompare(a.transaction.date) || b.transaction.created_at.localeCompare(a.transaction.created_at) || a.transaction.id.localeCompare(b.transaction.id));
  return { total: rows.reduce((sum, row) => sum + row.amount, 0), rows };
}

// Each credit card: what was spent on it in the range, what was paid toward it (money moved onto the card with no spending category),
// and what is owed on it now. Only verified entries count for spent and paid.
export function cardsSummary(state, { from, to }) {
  const spent = new Map(spendingByAccount(state, { from, to }).rows.map((r) => [r.account_id, r.amount]));
  const txById = new Map(state.transactions.map((t) => [t.id, t]));
  const expense = new Set(state.categories.filter((c) => c.kind === "expense").map((c) => c.id));
  const spendingTx = new Set(state.entries.filter((e) => e.category_id != null && expense.has(e.category_id)).map((e) => e.transaction_id));
  const cards = state.accounts.filter((a) => a.class === "liability" && !a.archived).map((a) => {
    let paid = 0;
    for (const e of state.entries) {
      if (e.account_id !== a.id || e.amount <= 0 || spendingTx.has(e.transaction_id)) continue;
      const t = txById.get(e.transaction_id);
      if (t && t.status === "verified" && t.date >= from && t.date <= to) paid += e.amount;
    }
    return { account_id: a.id, name: a.name, spent: spent.get(a.id) ?? 0, paid, owe: naturalBalance(a, countedEntries(state)) };
  });
  return { cards, owe: cards.reduce((n, c) => n + c.owe, 0) };
}

// Every account on one page: credit cards (spent, paid, owed now) and the money you hold (debit, savings, wallets, cash: balance and what
// was spent from it in the range). Archived accounts are left out.
export function accountsOverview(state, { from, to }) {
  const { cards, owe } = cardsSummary(state, { from, to });
  const spent = new Map(spendingByAccount(state, { from, to }).rows.map((r) => [r.account_id, r.amount]));
  const money = state.accounts.filter((a) => holdsMoney(a) && !a.archived)   // what people owe you is not in your accounts (A4): the Cards screen lists it apart
    .map((a) => ({ account_id: a.id, name: a.name, balance: naturalBalance(a, countedEntries(state)), spent: spent.get(a.id) ?? 0 }));
  return { cards, money, owe, held: money.reduce((n, m) => n + m.balance, 0) };
}

// Total spending for each of the last `months` months ending at `endMonth`, oldest first.
export function monthlySpending(state, { endMonth, months = 6, categoryMaps = [], asOf }) {
  return Array.from({ length: months }, (_, i) => {
    const month = addMonths(endMonth, i - (months - 1));
    return { month, amount: spendingByCategory(state, { month, categoryMaps, asOf: asOf ?? lastDayOf(month) }).total };
  });
}

// Quick day total (addendum, item 7): what was spent on one date, drafts INCLUDED because on the day you
// log, nothing is verified yet. `verified` and `draft` are reported apart so the screen can say which is which.
// Spending means expense categories only, net of refunds. A check-in's reconciliation is not an expense you made.
export function dayTotal(state, date) {
  const expense = new Set(state.categories.filter((c) => c.kind === "expense").map((c) => c.id));
  const txById = new Map(state.transactions.map((t) => [t.id, t]));
  let verified = 0, draft = 0, drafts = 0;
  // The SAME rule as This month and Category (owner, Oct 29): a count gap that is not yet explained, and the entry that cancels it, are not spending; a gap the owner
  // said was spent ("I spent some of it") is, so a day and its month always agree. (Before, every count was left out of the day and not of the month.)
  const held = heldIds(state), notSpending = (t) => held.has(t.id);
  for (const e of state.entries) {
    if (e.category_id == null || !expense.has(e.category_id)) continue;
    const t = txById.get(e.transaction_id);
    if (!t || t.date !== date || notSpending(t)) continue;
    if (t.status === "verified") verified += e.amount; else { draft += e.amount; drafts += 1; }
  }
  return { total: verified + draft, verified, draft, drafts };
}

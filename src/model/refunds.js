// Refunds (owner, Oct 31, P0-5 fix 4; docs/ACCOUNTING.md, recognition rules): a refund REDUCES SPENDING in the category it came back to. It is never income.
// A refund is money in to an account with its other leg a CREDIT to an expense category (so that category's spending goes down), saved verified like any money received.
// Before this change the refund flow saved a refund as income under the category "Refund"; those past refunds are put right through corrections (each cancelled once by a
// `rev:<id>`, then a new verified entry names it with `corrects`), after the owner confirms each one's category and the app has kept a copy of the ledger. Nothing is edited.
// Pure.
import { checkTransactionSave } from "./index.js";
import { spendingByCategory, monthOf } from "./reports.js";
import { incomeBySource } from "./income.js";
import { phTimestamp, isPhDate } from "./util.js";
import { payeeKey } from "./payees.js";

export const REFUND_CATEGORY_ID = "cat-refund";
const fail = (code, message) => ({ ok: false, violations: [{ code, severity: "error", message }], state: undefined });
const dayMs = 86400000, dayNum = (d) => Math.floor(Date.parse(d + "T00:00:00Z") / dayMs);

// input: {transaction_id, date, amount (centavos), account_id, category_id (an EXPENSE category), payee?, memo?}. Returns {ok, violations, transaction, entries, state}.
export function planRefund(state, input, now = new Date()) {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) return fail("BAD_AMOUNT", "amount must be more than zero");
  const account = state.accounts.find((a) => a.id === input.account_id);
  if (!account || account.class !== "asset") return fail("UNKNOWN_ACCOUNT", "choose the account the refund arrived in");
  const cat = state.categories.find((c) => c.id === input.category_id);
  if (!cat || cat.kind !== "expense") return fail("UNKNOWN_CATEGORY", "choose the spending this refund is for");
  if (!isPhDate(input.date)) return fail("BAD_DATE", "date must be like 2026-10-15");
  const stamp = phTimestamp(now);
  const transaction = { id: input.transaction_id, date: input.date, payee: input.payee || "Refund", memo: input.memo ?? "", status: "verified", source: "manual", created_at: stamp, verified_at: stamp };
  const entries = [{ transaction_id: transaction.id, account_id: account.id, amount: input.amount }, { transaction_id: transaction.id, category_id: cat.id, amount: -input.amount }];
  const result = checkTransactionSave(state, { transaction, entries });
  return { ...result, transaction, entries, state: result.ok ? { ...state, transactions: [...state.transactions, transaction], entries: [...state.entries, ...entries] } : state };
}

// The past refunds saved as income under "Refund": verified, two entries (the account and the Refund category), not cancelled, not a correction. Each carries a GUESS of the
// spending it was for: the most recent verified spending, before the refund and within 90 days, from the same payee (or, with none, of exactly that amount on that account).
// Returns [{transaction_id, date, payee, amount, account_id, guess}] oldest first; `guess` is a category id or null.
export function pastRefunds(state) {
  const cancelled = new Set(state.transactions.filter((t) => t.reverses != null).map((t) => t.reverses));
  const byTx = new Map();
  for (const e of state.entries) { const l = byTx.get(e.transaction_id) ?? []; l.push(e); byTx.set(e.transaction_id, l); }
  const expense = new Set(state.categories.filter((c) => c.kind === "expense").map((c) => c.id));
  const spends = [];
  for (const t of state.transactions) {
    if (t.status !== "verified" || t.reverses != null || cancelled.has(t.id)) continue;
    const es = byTx.get(t.id) ?? [], cat = es.find((e) => e.category_id != null && expense.has(e.category_id) && e.amount > 0), acct = es.find((e) => e.account_id != null);
    if (cat && acct && es.length === 2) spends.push({ date: t.date, key: payeeKey(t.payee), category_id: cat.category_id, amount: cat.amount, account_id: acct.account_id });
  }
  const out = [];
  for (const t of state.transactions) {
    if (t.status !== "verified" || t.reverses != null || t.corrects != null || cancelled.has(t.id)) continue;
    const es = byTx.get(t.id) ?? [];
    if (es.length !== 2) continue;
    const ref = es.find((e) => e.category_id === REFUND_CATEGORY_ID && e.amount < 0), acct = es.find((e) => e.account_id != null && e.amount > 0);
    if (!ref || !acct) continue;
    const amount = acct.amount, before = spends.filter((s) => s.date <= t.date && dayNum(t.date) - dayNum(s.date) <= 90).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const guess = (before.find((s) => s.key && s.key === payeeKey(t.payee) && s.amount >= amount) ?? before.find((s) => s.amount === amount && s.account_id === acct.account_id))?.category_id ?? null;
    out.push({ transaction_id: t.id, date: t.date, payee: t.payee, amount, account_id: acct.account_id, guess });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.transaction_id < b.transaction_id ? -1 : 1));
}

// What the repair would do. choices: {transaction_id: expense category id}; a refund without a choice is left as it is. For each chosen one: the original is cancelled by `rev:<id>`
// and a new verified entry `refund:<id>` (source "correction", `corrects` names the original) puts the same money in the same account and takes it off that category's spending.
// Every balance stays exactly what it is. Returns {ok, violations, transactions, entries, count, months: [{month, spendingBefore, spendingAfter, incomeBefore, incomeAfter}]}.
export function planRefundRepair(state, choices, { now = new Date() } = {}) {
  const rows = pastRefunds(state).filter((r) => choices?.[r.transaction_id]), stamp = phTimestamp(now);
  let probe = state;
  const transactions = [], entries = [];
  for (const r of rows) {
    if (state.transactions.some((t) => t.id === "rev:" + r.transaction_id || t.id === "refund:" + r.transaction_id)) continue;
    const cat = state.categories.find((c) => c.id === choices[r.transaction_id]);
    if (!cat || cat.kind !== "expense") return { ok: false, violations: [{ code: "UNKNOWN_CATEGORY", severity: "error", message: "choose the spending each refund was for" }], transactions: [], entries: [], count: 0, months: [] };
    const orig = state.transactions.find((t) => t.id === r.transaction_id);
    const rev = { id: "rev:" + orig.id, date: orig.date, payee: orig.payee, memo: "Correction of " + (orig.payee || "an entry") + (orig.memo ? " (" + orig.memo + ")" : ""), status: "verified", source: "correction", reverses: orig.id, created_at: stamp, verified_at: stamp };
    const fixed = { id: "refund:" + orig.id, date: orig.date, payee: orig.payee || "Refund", memo: "Refund counted against " + cat.name, status: "verified", source: "correction", corrects: orig.id, created_at: stamp, verified_at: stamp };
    const revEntries = state.entries.filter((e) => e.transaction_id === orig.id).map(({ transaction_id, ...e }) => ({ ...e, transaction_id: rev.id, amount: -e.amount }));
    const newEntries = [{ transaction_id: fixed.id, account_id: r.account_id, amount: r.amount }, { transaction_id: fixed.id, category_id: cat.id, amount: -r.amount }];
    for (const [t, es] of [[rev, revEntries], [fixed, newEntries]]) {
      const check = checkTransactionSave(probe, { transaction: t, entries: es });
      if (!check.ok) return { ok: false, violations: check.violations, transactions: [], entries: [], count: 0, months: [] };
      probe = { ...probe, transactions: [...probe.transactions, t], entries: [...probe.entries, ...es] };
      transactions.push(t); entries.push(...es);
    }
  }
  const months = [...new Set(rows.map((r) => monthOf(r.date)))].sort().map((month) => {
    const a = [month + "-01", month + "-31"];
    return { month, spendingBefore: spendingByCategory(state, { month }).total, spendingAfter: spendingByCategory(probe, { month }).total,
      incomeBefore: incomeBySource(state, { from: a[0], to: a[1] }).total, incomeAfter: incomeBySource(probe, { from: a[0], to: a[1] }).total };
  });
  return { ok: true, violations: [], transactions, entries, count: transactions.length / 2, months };
}

// The state after the repair. The very same state comes back when any of it is already there, so a repeat tap changes nothing.
export function applyRefundRepair(state, plan) {
  if (!plan.transactions.length || plan.transactions.some((t) => state.transactions.some((x) => x.id === t.id))) return state;
  return { ...state, transactions: [...state.transactions, ...plan.transactions], entries: [...state.entries, ...plan.entries] };
}

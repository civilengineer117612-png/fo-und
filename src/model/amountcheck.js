// CHECK THESE AMOUNTS (owner, Nov 12, L2 and P3; read-only, nothing stored but one "seen" mark in settings).
// Until Nov 12 a comma typed anywhere in an amount was dropped: "1,5" was saved as 15.00 and "12,50" as 1,250.00. Such an entry cannot be told apart
// for certain from a real one, so NOTHING is changed by the app (a verified entry is final; the owner corrects it at the Weekly review). This only
// LISTS the entries that look like it: typed by hand, a whole-peso amount (a dropped comma never leaves centavos), and at least ten times what the
// same item usually costs. Pure logic; amounts are centavos.
import { payeeKey } from "./payees.js";

export const AMOUNT_CHECK_TIMES = 10, AMOUNT_CHECK_MIN_OTHERS = 2;
const median = (list) => { const s = [...list].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]; };   // the lower middle: no half centavos

// [{id, date, payee, amount, usual, times}], newest first. `usual` is the median of the OTHER entries of the same item (the same name, or the same
// category when the entry has no name), whatever way they came in; at least two others are needed, or nothing can be said.
export function suspectAmounts(state) {
  const cancelled = new Set(state.transactions.filter((t) => t.reverses != null).map((t) => t.reverses));
  const expense = new Set(state.categories.filter((c) => c.kind === "expense").map((c) => c.id));
  const legs = new Map();   // transaction id -> {amount spent, category}
  for (const e of state.entries) {
    if (!e.category_id || !expense.has(e.category_id) || e.amount <= 0) continue;
    const l = legs.get(e.transaction_id) ?? { amount: 0, category_id: e.category_id, n: 0 };
    l.amount += e.amount; l.n++; legs.set(e.transaction_id, l);
  }
  const groups = new Map(), rows = [];
  for (const t of state.transactions) {
    const l = legs.get(t.id);
    if (!l || t.reverses != null || t.adjustment || cancelled.has(t.id) || t.source === "correction" || t.source === "reconciliation") continue;
    const key = payeeKey(t.payee) ? "n:" + payeeKey(t.payee) : "c:" + l.category_id;
    const row = { t, amount: l.amount, key };
    rows.push(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const out = [];
  for (const r of rows) {
    if (r.t.source !== "manual" || r.amount % 100 !== 0) continue;
    const others = groups.get(r.key).filter((o) => o !== r).map((o) => o.amount);
    if (others.length < AMOUNT_CHECK_MIN_OTHERS) continue;
    const usual = median(others);
    if (usual <= 0 || r.amount < usual * AMOUNT_CHECK_TIMES) continue;
    out.push({ id: r.t.id, date: r.t.date, created_at: r.t.created_at, payee: r.t.payee ?? "", category_id: legs.get(r.t.id).category_id, status: r.t.status, amount: r.amount, usual, times: Math.floor(r.amount / usual) });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? -1 : 1));
}

// KEPT UNTIL RESOLVED (owner, Nov 12): the card stays until every listed entry is either corrected or marked "This amount is right" by the
// owner; the count goes down as each is done. Still read-only: the app changes no entry by itself.
// - corrected: a verified entry put right at the Weekly review is cancelled (and so left out above); a draft edited in Verify to an amount that
//   no longer looks like a dropped comma leaves the list by itself.
// - marked right: its id is in the setting `amount_check_ok` (a list of ids; only the owner's tap adds one).
// Only entries saved before the fix are asked about (`AMOUNT_FIX_BEFORE`, Manila): since then a misplaced comma is refused, so a large amount
// typed later is what the owner meant, and the card would otherwise never end.
export const AMOUNT_FIX_BEFORE = "2026-11-13T00:00:00+08:00";
const instant = (t) => Date.parse(t);
export function openAmountChecks(state, settings = {}) {
  const ok = new Set(Array.isArray(settings?.amount_check_ok) ? settings.amount_check_ok : []);
  const cut = instant(AMOUNT_FIX_BEFORE);
  return suspectAmounts(state).filter((r) => !ok.has(r.id) && !(instant(r.created_at) >= cut));
}
// The owner's tap: one entry's amount is right. Returns new settings; the ledger's entries are untouched.
export function markAmountRight(settings, id) {
  const ok = Array.isArray(settings?.amount_check_ok) ? settings.amount_check_ok : [];
  return ok.includes(id) ? settings : { ...settings, amount_check_ok: [...ok, id] };
}

// "Not yet explained" (owner, Oct 29; data version unchanged): a weekly check-in gap the owner did not explain. The count still corrects the account's
// balance, but the gap is HELD: it is not spending, up or down. It is the same optional `adjustment` flag a matched count that found money already had,
// now used for a gap in either direction and for cards. The count's cancelling entry (a correction that `reverses` it) is held too, so it never moves spending.
// Pure.

// Ids of the transactions that are not spending: held counts, and the corrections that cancel them.
export function heldIds(state) {
  const adjustments = new Set(state.transactions.filter((t) => t.adjustment).map((t) => t.id));
  const held = new Set();
  for (const t of state.transactions) if (t.adjustment || (t.reverses != null && adjustments.has(t.reverses))) held.add(t.id);
  return held;
}

const isCountGap = (t) => t.source === "reconciliation" && String(t.memo ?? "").startsWith("Reconciliation:");

// The gaps still waiting for an explanation: held counts that were not cancelled, verified, with a date, newest first.
// {transaction_id, account_id, date, kind: "short" | "extra", amount} where amount is how much (whole centavos, always positive).
// "short" = money missing from a bank, wallet or cash account, or a card that owes MORE than the ledger says; "extra" = the other way round.
export function unexplainedGaps(state, { from = "0000-01-01", to = "9999-12-31", unlogged_category_id } = {}) {
  const cancelled = new Set(state.transactions.filter((t) => t.reverses != null).map((t) => t.reverses));
  const byTx = new Map();
  for (const e of state.entries) { const l = byTx.get(e.transaction_id) ?? []; l.push(e); byTx.set(e.transaction_id, l); }
  const out = [];
  for (const t of state.transactions) {
    if (!t.adjustment || !isCountGap(t) || t.status !== "verified" || cancelled.has(t.id) || t.date < from || t.date > to) continue;
    const es = byTx.get(t.id) ?? [];
    const side = es.find((e) => e.category_id != null && (unlogged_category_id == null || e.category_id === unlogged_category_id)), acct = es.find((e) => e.account_id != null);
    if (!side || !acct || side.amount === 0) continue;
    out.push({ transaction_id: t.id, account_id: acct.account_id, date: t.date, kind: side.amount > 0 ? "short" : "extra", amount: Math.abs(side.amount) });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.transaction_id < b.transaction_id ? -1 : 1));
}

// A newly logged entry that is exactly an open gap: same account, same amount, dated in the 7 days up to the day of that check-in (the check-in's period).
// Only money that LEFT can be explained by an entry, so only "short" gaps. Returns the gap to offer ("This explains the gap"), the closest date first, or null.
export const GAP_DAYS = 7;
const dayMs = 86400000, dayNum = (d) => Math.floor(Date.parse(d + "T00:00:00Z") / dayMs);
export function findOpenGap(state, { account_id, amount, date, exclude_id, unlogged_category_id }) {
  const gaps = unexplainedGaps(state, { unlogged_category_id }).filter((g) => g.kind === "short" && g.account_id === account_id && g.amount === amount && g.transaction_id !== exclude_id
    && dayNum(date) <= dayNum(g.date) && dayNum(date) > dayNum(g.date) - GAP_DAYS);
  return gaps.sort((a, b) => Math.abs(dayNum(a.date) - dayNum(date)) - Math.abs(dayNum(b.date) - dayNum(date)))[0] ?? null;
}

// A gap that is more than half of what the account was thought to hold, or a count of 0: ask first whether the money moved or the count was mistyped.
export const bigGap = (ledger, counted) => ledger !== 0 && Math.abs(counted - ledger) * 2 > Math.abs(ledger);   // a count of 0 against any balance is always one

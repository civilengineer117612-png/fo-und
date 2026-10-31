// Repairing the PAST weekly counts (owner, Oct 29; data version unchanged). Before this change a count gap the owner did not explain was booked as unlogged
// SPENDING (and found money lowered spending), so past months show more or less spending than really happened. A verified entry is final, so each such count
// is put right the way a bookkeeper does it: a correction CANCELS it and a new verified count of the same gap, flagged `adjustment` (held: "not yet explained"),
// takes its place. Both stay visible. Every account's balance is exactly what it was. Then the held gaps are matched: a short and an equal extra between two of
// the owner's accounts are ONE move, made only on his tap. Pure; nothing here saves anything.
import { checkTransactionSave } from "./index.js";
import { spendingByCategory } from "./reports.js";
import { heldIds, unexplainedGaps } from "./held.js";
import { alreadyCancelled } from "./corrections.js";
import { isPocket } from "./banks.js";
import { planTransfer } from "./transfers.js";
import { phTimestamp } from "./util.js";
import { repeatedIds } from "./invariants.js";

const isCountGap = (t) => t.source === "reconciliation" && String(t.memo ?? "").startsWith("Reconciliation:");
const dayMs = 86400000, dayNum = (d) => Math.floor(Date.parse(d + "T00:00:00Z") / dayMs);

// The past counts booked as spending (or as found money lowering spending): verified, a count's own gap, not held, not already cancelled, not a cancelling entry.
export function repairableGaps(state) {
  const held = heldIds(state), cancelled = new Set(state.transactions.filter((t) => t.reverses != null).map((t) => t.reverses));
  const expense = new Set(state.categories.filter((c) => c.kind === "expense").map((c) => c.id));
  const byTx = new Map();
  for (const e of state.entries) { const l = byTx.get(e.transaction_id) ?? []; l.push(e); byTx.set(e.transaction_id, l); }
  return state.transactions.filter((t) => isCountGap(t) && t.status === "verified" && t.reverses == null && !held.has(t.id) && !cancelled.has(t.id)
    && (byTx.get(t.id) ?? []).some((e) => e.category_id != null && expense.has(e.category_id)) && (byTx.get(t.id) ?? []).some((e) => e.account_id != null));
}

// An entry cancelled MORE THAN ONCE (owner, Oct 31): before the app refused it (#271) a stale screen could add a second cancelling entry, which moves the same money twice. One
// cancelling entry is the right one (the one numbered rev:<id> when there is one, else the first); every other still standing is an extra, unless an entry that `restores` it
// already put it right. Returns [{target, id, date, payee}], one row for each extra still to put right.
export function extraCancellations(state) {
  const by = new Map(), restored = new Map();
  for (const t of state.transactions) {
    if (t.reverses != null) by.set(t.reverses, [...(by.get(t.reverses) ?? []), t]);
    if (t.restores != null) restored.set(t.restores, (restored.get(t.restores) ?? 0) + 1);
  }
  const out = [];
  for (const [target, list] of by) {
    const T = state.transactions.find((t) => t.id === target && t.reverses == null);
    if (!T || T.status !== "verified" || list.length < 2) continue;
    const keep = Math.max(0, list.findIndex((t) => t.id === "rev:" + target)), extras = list.filter((_, i) => i !== keep), open = extras.length - (restored.get(target) ?? 0);
    for (const d of extras.slice(Math.max(0, extras.length - open))) out.push({ target, id: d.id, date: d.date, payee: d.payee });
  }
  return out;
}

// What the repair would do: the cancelling entries and the held copies to add, and for each month the spending before and after.
// A past count booked as spending is cancelled by a correction and counted again as not yet explained. An entry cancelled twice gets its extra cancellation put right: an entry
// that restores it (`restores`) takes the extra away, and the same amount is kept apart as not yet explained. Every balance stays exactly what it was.
// A piece that does not pass the ledger's own checks is SKIPPED and listed in `skipped` ({id, code, message}); the rest is still repaired.
// Returns {ok, violations, transactions, entries, months: [{month, count, before, after, change}], count, gapCount, extraCount, skipped, raised, lowered}.
export function planGapRepair(state, { now = new Date() } = {}) {
  const gaps = repairableGaps(state), extras = extraCancellations(state), held = heldIds(state), stamp = phTimestamp(now);
  let probe = state;
  const transactions = [], entries = [], skipped = [], dates = [];
  // add a group of (transaction, legs) pairs only when every one passes; otherwise none of them and the reason is recorded
  const add = (id, pairs) => {
    let p = probe;
    for (const [t, es] of pairs) {
      const check = checkTransactionSave(p, { transaction: t, entries: es });
      if (!check.ok) { skipped.push({ id, code: check.violations[0].code, message: check.violations[0].message }); return false; }
      p = { ...p, transactions: [...p.transactions, t], entries: [...p.entries, ...es] };
    }
    probe = p; for (const [t, es] of pairs) { transactions.push(t); entries.push(...es); }
    return true;
  };
  let gapCount = 0, extraCount = 0;
  for (const g of gaps) {
    if (state.transactions.some((t) => t.id === "rev:" + g.id || t.id === "held:" + g.id)) continue;
    const mine = state.entries.filter((e) => e.transaction_id === g.id);
    const rev = { id: "rev:" + g.id, date: g.date, payee: g.payee, memo: "Correction of " + (g.payee || "an entry") + (g.memo ? " (" + g.memo + ")" : ""), status: "verified", source: "correction", reverses: g.id, created_at: stamp, verified_at: stamp };
    const heldTx = { id: "held:" + g.id, date: g.date, payee: g.payee, memo: g.memo + " \u00b7 kept apart as not yet explained", status: "verified", source: "reconciliation", adjustment: true, created_at: stamp, verified_at: stamp };
    const revEntries = mine.map(({ transaction_id, ...e }) => ({ ...e, transaction_id: rev.id, amount: -e.amount }));
    const heldEntries = mine.map(({ transaction_id, ...e }) => ({ ...e, transaction_id: heldTx.id }));
    if (add(g.id, [[rev, revEntries], [heldTx, heldEntries]])) { gapCount += 1; dates.push(g.date); }
  }
  const putBack = new Map();
  for (const x of extras) {
    const n = (state.transactions.filter((t) => t.restores === x.target).length) + (putBack.get(x.target) ?? 0) + 1, id = "undo:" + x.target + ":" + n;
    if (state.transactions.some((t) => t.id === id)) continue;
    const mine = state.entries.filter((e) => e.transaction_id === x.target);
    // the extra cancellation holds the entry's opposite legs; putting it right holds the entry's own legs, and the same opposite legs are kept apart as not yet explained
    const undo = { id, date: x.date, payee: x.payee, memo: "Correction of a second cancellation of " + (x.payee || "an entry"), status: "verified", source: "correction", restores: x.target, ...(held.has(x.id) ? { adjustment: true } : {}), created_at: stamp, verified_at: stamp };
    const keep = { id: "held:" + id, date: x.date, payee: x.payee, memo: "Reconciliation: a second cancellation of one entry, kept apart as not yet explained", status: "verified", source: "reconciliation", adjustment: true, created_at: stamp, verified_at: stamp };
    const undoEntries = mine.map(({ transaction_id, ...e }) => ({ ...e, transaction_id: id })), keepEntries = mine.map(({ transaction_id, ...e }) => ({ ...e, transaction_id: keep.id, amount: -e.amount }));
    if (add(x.id, [[undo, undoEntries], [keep, keepEntries]])) { extraCount += 1; putBack.set(x.target, (putBack.get(x.target) ?? 0) + 1); dates.push(x.date); }
  }
  const after = probe, monthsSet = [...new Set(dates.map((d) => d.slice(0, 7)))].sort();
  const months = monthsSet.map((month) => {
    const before = spendingByCategory(state, { month }).total, now2 = spendingByCategory(after, { month }).total;
    return { month, count: dates.filter((d) => d.startsWith(month)).length, before, after: now2, change: now2 - before };
  });
  return { ok: true, violations: [], transactions, entries, months, count: gapCount + extraCount, gapCount, extraCount, skipped,
    raised: months.filter((m) => m.change > 0).reduce((n, m) => n + m.change, 0), lowered: months.filter((m) => m.change < 0).reduce((n, m) => n - m.change, 0) };
}

// What the Weekly review card needs, so it can NEVER hide silently: how many past entries want repairing, how many the repair can do, and, when it can do none, one plain
// sentence for why and one for what to do. `note` is said when only some can be done.
const CAUSE = { UNBALANCED: "one old count does not add up", TOO_FEW_ENTRIES: "one old count has fewer than two sides", ENTRY_FINAL: "one entry number is already used", UNKNOWN_REFERENCE: "one old count names an account or a category that is gone" };
export function repairStatus(state) {
  const gaps = repairableGaps(state).length, extras = extraCancellations(state).length, candidates = gaps + extras, plan = planGapRepair(state, { now: new Date() });
  const cause = plan.skipped[0] ? CAUSE[plan.skipped[0].code] ?? "one old entry does not pass the app's own checks" : "these entries already have a correction but still count as spending";
  const reason = candidates > 0 && plan.count === 0 ? "The repair cannot run: " + cause + "." : null;
  return { gaps, extras, candidates, plan, count: plan.count, skipped: plan.skipped, reason, action: reason ? "Nothing was changed. Tap \"Copy the repair check\" and send it to the project chat." : null,
    note: plan.count > 0 && plan.skipped.length ? plan.skipped.length + " could not be repaired and stay as they are." : null };
}

// Counts only, for the owner to paste: nothing from the ledger (no name, amount, date or account) is in it.
export function repairReport(state) {
  const st = repairStatus(state);
  return ["Repair check (counts only)", "past counts booked as spending: " + st.gaps, "cancelled twice: " + st.extras, "repeated entry numbers: " + repeatedIds(state.transactions),
    "the repair can do: " + st.count, "could not be repaired: " + st.skipped.length, "first reason: " + (st.skipped[0]?.code ?? "none")].join("\n");
}

// The state after the repair. The very same state comes back when any of it is already there, so a repeat tap changes nothing.
export function applyGapRepair(state, plan) {
  if (!plan.transactions.length || plan.transactions.some((t) => state.transactions.some((x) => x.id === t.id)) || alreadyCancelled(state, plan)) return state;
  return { ...state, transactions: [...state.transactions, ...plan.transactions], entries: [...state.entries, ...plan.entries] };
}

// Held gaps that look like ONE move: a short and an extra of exactly the same amount, on two of the owner's accounts (never a card), counted within 3 days of each other.
// Pockets of one bank first, then the closest dates. Returns [{short, extra, amount}] with the two gap rows.
export function matchHeldGaps(state, { days = 3 } = {}) {
  const byId = new Map(state.accounts.map((a) => [a.id, a]));
  const rows = unexplainedGaps(state).filter((g) => byId.get(g.account_id)?.class === "asset");
  const shorts = rows.filter((g) => g.kind === "short").sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.transaction_id < b.transaction_id ? -1 : 1));
  const extras = rows.filter((g) => g.kind === "extra");
  const used = new Set(), out = [];
  const pockets = (s, e) => { const a = byId.get(s.account_id), b = byId.get(e.account_id); return isPocket(a) && isPocket(b) && a.bank != null && a.bank === b.bank; };
  for (const pass of [pockets, () => true]) {
    for (const s of shorts) {
      if (used.has(s.transaction_id)) continue;
      const near = extras.filter((e) => !used.has(e.transaction_id) && e.amount === s.amount && e.account_id !== s.account_id && Math.abs(dayNum(e.date) - dayNum(s.date)) <= days && pass(s, e))
        .sort((a, b) => Math.abs(dayNum(a.date) - dayNum(s.date)) - Math.abs(dayNum(b.date) - dayNum(s.date)) || (a.transaction_id < b.transaction_id ? -1 : 1));
      if (!near[0]) continue;
      used.add(s.transaction_id); used.add(near[0].transaction_id);
      out.push({ short: s, extra: near[0], amount: s.amount });
    }
  }
  return out;
}

// Confirming one match: both held gaps are cancelled (each by a correction) and ONE move from the short account to the extra one is made as a DRAFT in Verify,
// so every balance stays exactly what it was and nothing is counted as spending. Returns {ok, violations, state, move_id}.
export function planGapMove(state, match, { move_id, now = new Date() }) {
  const stamp = phTimestamp(now);
  let next = state;
  for (const g of [match.short, match.extra]) {
    const orig = next.transactions.find((t) => t.id === g.transaction_id);
    if (!orig || next.transactions.some((t) => t.reverses === orig.id)) return { ok: false, violations: [{ code: "ALREADY_CANCELLED", severity: "error", message: "that gap is no longer waiting" }] };
    const rev = { id: "rev:" + orig.id, date: orig.date, payee: orig.payee, memo: "Correction of " + (orig.payee || "an entry") + (orig.memo ? " (" + orig.memo + ")" : ""), status: "verified", source: "correction", reverses: orig.id, created_at: stamp, verified_at: stamp };
    const es = next.entries.filter((e) => e.transaction_id === orig.id).map(({ transaction_id, ...e }) => ({ ...e, transaction_id: rev.id, amount: -e.amount }));
    const check = checkTransactionSave(next, { transaction: rev, entries: es });
    if (!check.ok) return { ok: false, violations: check.violations };
    next = { ...next, transactions: [...next.transactions, rev], entries: [...next.entries, ...es] };
  }
  const moved = planTransfer(next, { transaction_id: move_id, date: match.short.date, from_account_id: match.short.account_id, to_account_id: match.extra.account_id, amount: match.amount, payee: "Moved (found at count)", source: "manual" }, now);
  if (!moved.ok) return { ok: false, violations: moved.violations };
  return { ok: true, violations: [], state: moved.state, move_id };
}

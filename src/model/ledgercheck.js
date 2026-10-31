// The ledger check (owner, Oct 31, P0-5 fix 2; docs/ACCOUNTING.md principle 2, the trial balance): a REPORT of what is wrong with the entries, never a block. A ledger that
// has a problem must still open and still back up, so nothing here changes anything or stops anything: Setup, About this app just says how many problems it found.
// Problems counted, each once: a transaction whose entries do not add to zero, entries that belong to no transaction, a transaction with fewer than two entries, an entry
// that names an account or a category that does not exist, a correction that names an entry that is not there, and an entry cancelled more than once.
// Pure. Returns [{code, message, id}].
export function ledgerProblems(state) {
  const out = [], txs = state?.transactions ?? [], entries = state?.entries ?? [];
  const ids = new Set(txs.map((t) => t.id)), accounts = new Set((state?.accounts ?? []).map((a) => a.id)), categories = new Set((state?.categories ?? []).map((c) => c.id));
  const sums = new Map(), counts = new Map(), orphans = new Set();
  for (const e of entries) {
    sums.set(e.transaction_id, (sums.get(e.transaction_id) ?? 0) + e.amount); counts.set(e.transaction_id, (counts.get(e.transaction_id) ?? 0) + 1);
    if (!ids.has(e.transaction_id)) orphans.add(e.transaction_id);
    if ((e.account_id != null && !accounts.has(e.account_id)) || (e.category_id != null && !categories.has(e.category_id))) out.push({ code: "UNKNOWN_REFERENCE", id: e.transaction_id, message: "An entry points at an account or category that is not there." });
  }
  for (const t of txs) {
    if ((counts.get(t.id) ?? 0) < 2) out.push({ code: "TOO_FEW_ENTRIES", id: t.id, message: "An entry has fewer than two sides." });
    else if ((sums.get(t.id) ?? 0) !== 0) out.push({ code: "UNBALANCED", id: t.id, message: "An entry does not add up to zero." });
  }
  for (const id of orphans) out.push({ code: "ORPHAN_ENTRIES", id, message: "Some amounts belong to no entry." });
  const cancelled = new Map();
  for (const t of txs) {
    if (t.restores != null) cancelled.set(t.restores, (cancelled.get(t.restores) ?? 0) - 1);   // a second cancellation that was put right (the repair) no longer stands
    if (t.reverses == null) continue;
    if (!ids.has(t.reverses)) out.push({ code: "REVERSES_MISSING", id: t.id, message: "A correction names an entry that is not there." });
    cancelled.set(t.reverses, (cancelled.get(t.reverses) ?? 0) + 1);
  }
  for (const [id, n] of cancelled) if (n > 1) out.push({ code: "REVERSED_TWICE", id, message: "An entry was cancelled more than once." });
  return out;
}

// The quiet line for Setup, About this app.
export function ledgerCheckLine(state) {
  const n = ledgerProblems(state).length;
  return "Ledger check: " + (n === 0 ? "OK" : n + (n === 1 ? " problem" : " problems") + " (tell the project chat)");
}

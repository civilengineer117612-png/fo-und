// Counting every account first, then looking at the gaps side by side (owner, Oct 29): when one of the owner's own accounts is SHORT by an amount and another
// is OVER by exactly the same amount, the money most likely moved between them, and ONE move is proposed (one tap confirms). Exact amounts only, no guessing.
// Pockets of one bank are matched with each other first. Cards are never part of a proposal (a card does not hold your money). Pure.
import { isPocket } from "./banks.js";
import { planTransfer } from "./transfers.js";
import { planCheckIn } from "./checkin.js";

// gaps: [{account_id, gap}] with gap = counted - ledger for banks, wallets, cash and pockets (negative: money missing, positive: more than the ledger says).
// Returns [{from_id, to_id, amount}]: the money LEFT `from_id` (the short one) and ARRIVED in `to_id` (the one that is over). Each account is used once.
export function proposeMoves(gaps, accounts) {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const ok = (g) => g.gap !== 0 && byId.get(g.account_id)?.class === "asset";
  const short = gaps.filter((g) => ok(g) && g.gap < 0).sort((a, b) => (a.account_id < b.account_id ? -1 : 1));
  const over = gaps.filter((g) => ok(g) && g.gap > 0).sort((a, b) => (a.account_id < b.account_id ? -1 : 1));
  const used = new Set(), out = [];
  const samePockets = (s, o) => { const a = byId.get(s.account_id), b = byId.get(o.account_id); return isPocket(a) && isPocket(b) && a.bank != null && a.bank === b.bank; };
  for (const pass of [samePockets, () => true]) {
    for (const s of short) {
      if (used.has(s.account_id)) continue;
      const o = over.find((x) => !used.has(x.account_id) && x.gap === -s.gap && pass(s, x));
      if (!o) continue;
      used.add(s.account_id); used.add(o.account_id);
      out.push({ from_id: s.account_id, to_id: o.account_id, amount: o.gap });
    }
  }
  return out;
}

// Confirming ONE proposal: the move is made first (a DRAFT in Verify, as every move), so both counts then match and no gap is recorded for either account.
// counts: [{input}, {input}] the two planCheckIn inputs (one per account of the move); ids: {move_id}. Returns {ok, violations, state, checkIns, move_id}.
export function planProposedMove(state, { move, counts, move_id }, now = new Date()) {
  const moved = planTransfer(state, { transaction_id: move_id, date: counts[0].input.date, from_account_id: move.from_id, to_account_id: move.to_id, amount: move.amount,
    payee: "Moved (found at count)", source: "manual" }, now);
  if (!moved.ok) return { ok: false, violations: moved.violations };
  let next = moved.state; const checkIns = [];
  for (const { input } of counts) {
    const p = planCheckIn(next, { ...input, why: "move" }, now);
    if (!p.ok) return { ok: false, violations: p.violations };
    if (p.checkIn.difference !== 0) return { ok: false, violations: [{ code: "STILL_A_GAP", severity: "error", message: "the move does not make the count match" }] };
    next = { ...next, checkIns: [...(next.checkIns ?? []), p.checkIn] }; checkIns.push(p.checkIn);
  }
  return { ok: true, violations: [], state: next, checkIns, move_id };
}

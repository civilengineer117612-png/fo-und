// P0-7 (owner, Nov 7): ONE RULE FOR EVERY ENTRY PATH. Typing alone makes a DRAFT, which waits in Verify. An entry is verified at the moment it is made ONLY when it
// carries EVIDENCE, or when the owner's confirming tap is what makes it (Verify itself, which needs none). The evidence is written on the entry (`verified_by`):
//   "verified by payslip check"   a payslip whose printed lines match its printed totals
//   "verified by count"           a weekly count, and a move or an explanation confirmed by tap inside the check-in
//   "verified by statement"       a line matched to a statement, a difference kept at import, Accept this month
//   "correction of <entry>"       a correction or repair that cancels a verified entry (the audit trail needs it verified)
// Every creator builds its transaction through `settle`, so no screen and no function sets a status itself; tests/entryrule.test.js scans for that.
export const EVIDENCE = Object.freeze({ payslip: "verified by payslip check", count: "verified by count", statement: "verified by statement" });
export const correctionOf = (label) => "correction of " + (label || "an entry");
export const isEvidence = (s) => typeof s === "string" && (Object.values(EVIDENCE).includes(s) || (s.startsWith("correction of ") && s.length > "correction of ".length));

// The transaction as it is saved: a draft when there is no evidence, verified (at `stamp`, with the evidence noted) when there is.
export function settle(transaction, evidence, stamp) {
  const { status: _s, verified_at: _a, verified_by: _b, ...rest } = transaction;
  if (!evidence) return { ...rest, status: "draft" };
  if (!isEvidence(evidence)) throw new Error("not a kind of evidence: " + evidence);
  return { ...rest, status: "verified", verified_at: stamp, verified_by: evidence };
}

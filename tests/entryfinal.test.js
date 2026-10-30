import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planExpense, applyDrafts, verifyDraft, editDraftFields, checkTransactionSave, planCorrection, applyCorrection, planTransfer, repeatedIds, repeatsLine,
  validateState, selfCheck,
} from "../src/model/index.js";
import { makeState } from "./fixtures.js";

// Invented data. A checking account and one verified lunch.
const NOW = new Date("2026-10-08T12:00:00+08:00"), TODAY = "2026-10-10";
function withLunch() {
  let s = makeState();
  s = applyDrafts(s, planExpense(s, { transaction_id: "lunch", date: "2026-10-08", payee: "Corner Cafe", category_id: "food", amount: 12000, account_id: "chk" }, NOW).drafts);
  return verifyDraft(s, "lunch", NOW).state;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

test("a save whose id belongs to a VERIFIED entry is refused, and the verified entry is unchanged", () => {
  const s = withLunch(), before = JSON.parse(JSON.stringify(s));
  const orig = s.transactions.find((t) => t.id === "lunch"), es = s.entries.filter((e) => e.transaction_id === "lunch");
  for (const status of ["draft", "verified"]) {
    const tx = status === "draft" ? { ...orig, status: "draft", verified_at: undefined } : { ...orig, payee: "Someone else" };
    const r = checkTransactionSave(s, { transaction: tx, entries: es });
    assert.equal(r.ok, false, status);
    assert.ok(r.violations.some((v) => v.code === "ENTRY_FINAL" && v.severity === "error"));
  }
  // through a real save path: logging again with the same id
  const again = planExpense(s, { transaction_id: "lunch", date: "2026-10-09", payee: "Other", category_id: "food", amount: 5000, account_id: "chk" }, NOW);
  assert.equal(again.ok, false);
  assert.ok(again.violations.some((v) => v.code === "ENTRY_FINAL"));
  assert.ok(same(s, before), "nothing was changed");
});

test("a DRAFT still saves again (an edit) and verifies as before", () => {
  let s = makeState();
  s = applyDrafts(s, planExpense(s, { transaction_id: "d1", date: "2026-10-08", payee: "Corner Cafe", category_id: "food", amount: 12000, account_id: "chk" }, NOW).drafts);
  const edited = editDraftFields(s, "d1", { payee: "Corner Cafe 2" }, NOW);
  assert.equal(edited.ok, true, JSON.stringify(edited.violations));
  const dtx = s.transactions.find((t) => t.id === "d1"), des = s.entries.filter((e) => e.transaction_id === "d1");
  assert.equal(checkTransactionSave(s, { transaction: { ...dtx, payee: "again" }, entries: des }).ok, true, "the same draft id saved again is an edit");
  const v = verifyDraft(edited.state, "d1", NOW);
  assert.equal(v.ok, true);
  assert.equal(v.state.transactions.filter((t) => t.id === "d1").length, 1);
});

test("the paths that make new ids still pass over a ledger that has a verified entry", () => {
  let s = withLunch();
  const fresh = planExpense(s, { transaction_id: "tx-2", date: "2026-10-09", payee: "Bakery", category_id: "food", amount: 3000, account_id: "chk" }, NOW);
  assert.equal(fresh.ok, true);
  s = verifyDraft(applyDrafts(s, fresh.drafts), "tx-2", NOW).state;
  const move = planTransfer(s, { transaction_id: "mv-1", date: "2026-10-09", from_account_id: "chk", to_account_id: "res", amount: 1000, payee: "Move" }, NOW);
  assert.equal(move.ok, true, JSON.stringify(move.violations));
  const fix = planCorrection(s, { id: "lunch", redo_id: "redo-1", today: TODAY }, NOW);
  assert.equal(fix.ok, true, JSON.stringify(fix.violations));
  const after = applyCorrection(s, fix);
  assert.equal(repeatedIds(after.transactions), 0);
  assert.deepEqual(validateState(after), []);
  assert.deepEqual(selfCheck({ state: after }), []);
  // cancelling the same entry twice cannot repeat the rev: id
  const second = planCorrection(after, { id: "lunch", redo_id: "redo-2", today: TODAY }, NOW);
  assert.equal(second.ok, false);
});

test("the About line counts repeated ids, read-only, and never blocks", () => {
  const s = withLunch();
  assert.equal(repeatsLine(s), "Repeated entry numbers: none");
  const dup = { ...s, transactions: [...s.transactions, { ...s.transactions.find((t) => t.id === "lunch") }, { ...s.transactions[0] }] };
  assert.equal(repeatedIds(dup.transactions), 2);
  assert.equal(repeatsLine(dup), "Repeated entry numbers: 2 (tell the project chat)");
  assert.deepEqual(validateState(dup), [], "validateState does not refuse a ledger with a repeat (it would lock the owner out)");
  assert.equal(repeatedIds(undefined), 0);
});

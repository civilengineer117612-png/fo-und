import { test } from "node:test";
import assert from "node:assert/strict";
import { ledgerProblems, ledgerCheckLine, validateState } from "../src/model/index.js";
import { makeState } from "./fixtures.js";

// P0-5 fix 2 (docs/ACCOUNTING.md, principle 2): the ledger check REPORTS what is wrong with the entries and never blocks anything. Invented figures.
const TS = "2026-10-01T09:00:00.000+08:00";
const tx = (id, o = {}) => ({ id, date: "2026-10-05", payee: "Shop", memo: "", status: "verified", source: "manual", created_at: TS, verified_at: TS, ...o });
function sound() { const s = makeState(); s.transactions = [tx("a")]; s.entries = [{ transaction_id: "a", category_id: "food", amount: 100 }, { transaction_id: "a", account_id: "chk", amount: -100 }]; return s; }
const codes = (s) => ledgerProblems(s).map((p) => p.code);

test("a sound ledger has no problems and says OK", () => {
  assert.deepEqual(ledgerProblems(sound()), []);
  assert.equal(ledgerCheckLine(sound()), "Ledger check: OK");
  assert.equal(ledgerCheckLine(makeState()), "Ledger check: OK", "an empty ledger is sound");
});
test("an entry that does not add to zero is one problem", () => {
  const s = sound(); s.entries[1] = { ...s.entries[1], amount: -99 };
  assert.deepEqual(codes(s), ["UNBALANCED"]); assert.equal(ledgerCheckLine(s), "Ledger check: 1 problem (tell the project chat)");
});
test("amounts that belong to no entry are one problem for each entry number", () => {
  const s = sound(); s.entries.push({ transaction_id: "ghost", account_id: "chk", amount: 5 }, { transaction_id: "ghost", account_id: "chk", amount: 6 }, { transaction_id: "ghost2", account_id: "chk", amount: 1 });
  assert.deepEqual(codes(s), ["ORPHAN_ENTRIES", "ORPHAN_ENTRIES"]);
});
test("an entry with fewer than two sides is a problem, whether it has none or one", () => {
  const s = sound(); s.transactions.push(tx("none"), tx("one")); s.entries.push({ transaction_id: "one", account_id: "chk", amount: 0 });
  assert.deepEqual(codes(s).sort(), ["TOO_FEW_ENTRIES", "TOO_FEW_ENTRIES"]);
});
test("an entry that names an account or a category that is not there is a problem", () => {
  const s = sound(); s.entries[0] = { ...s.entries[0], category_id: "nope" }; assert.deepEqual(codes(s), ["UNKNOWN_REFERENCE"]);
  const t = sound(); t.entries[1] = { ...t.entries[1], account_id: "nope" }; assert.deepEqual(codes(t), ["UNKNOWN_REFERENCE"]);
});
test("a correction must name an entry that is there, and an entry is cancelled once", () => {
  const rev = (id, target, sign) => [tx(id, { source: "correction", reverses: target }), [{ transaction_id: id, category_id: "food", amount: -100 * sign }, { transaction_id: id, account_id: "chk", amount: 100 * sign }]];
  let s = sound(); const [t1, e1] = rev("r1", "zzz", 1); s.transactions.push(t1); s.entries.push(...e1);
  assert.deepEqual(codes(s), ["REVERSES_MISSING"]);
  s = sound(); for (const id of ["r1", "r2"]) { const [t, e] = rev(id, "a", 1); s.transactions.push(t); s.entries.push(...e); }
  assert.deepEqual(codes(s), ["REVERSED_TWICE"]);
  s = sound(); const [t, e] = rev("r1", "a", 1); s.transactions.push(t); s.entries.push(...e); assert.deepEqual(codes(s), [], "one proper correction is fine");
});
test("the problems add up in the line, and the check is only a report: it changes nothing, never throws, and the data still passes the shape check", () => {
  const s = sound(); s.entries[1] = { ...s.entries[1], amount: -99 }; s.entries.push({ transaction_id: "ghost", account_id: "chk", amount: 7 });
  const copy = JSON.stringify(s);
  assert.equal(ledgerCheckLine(s), "Ledger check: 2 problems (tell the project chat)");
  assert.equal(JSON.stringify(s), copy, "nothing was changed");
  assert.deepEqual(validateState(s), [], "the damaged data still opens: only the report says anything");
  assert.deepEqual(ledgerProblems(undefined), []); assert.deepEqual(ledgerProblems({}), []);
});

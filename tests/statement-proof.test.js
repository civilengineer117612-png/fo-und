import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { emptyState, emptyLedger, nextLedger, replaceWithCopy, copyHolds, statementBalanceProof, planStatementGap, planExpense, applyDrafts, unexplainedGaps, validateState, heldIds, ledgerBalanceFor, countedEntries } from "../src/model/index.js";
import { UNLOGGED_CATEGORY_ID } from "../src/model/seed.js";

// P1-8 fix 8: the statement's closing balance against the ledger (with the import's drafts); the difference may be kept as ONE held count (not yet explained), with the
// safety copy first. Invented data only (centavos).
const NOW = new Date("2026-10-20T09:00:00.000+08:00"), TS = "2026-10-20T09:00:00.000+08:00";
const a = (id, name, extra = {}) => ({ id, name, class: "asset", role: "", hidden_by_default: false, archived: false, opening_balance: 1000000, opening_date: "2026-01-01", ...extra });
const base = () => ({ ...emptyState(), accounts: [a("sav", "Sample Savings"), a("card", "Sample Card", { class: "liability", opening_balance: 0 })],
  categories: [{ id: "cat-food", name: "Food", kind: "expense", role: "food" }, { id: UNLOGGED_CATEGORY_ID, name: "Uncategorized", kind: "expense" }] });
const spend = (s, id, date, amount, account_id) => { const r = planExpense(s, { transaction_id: id, date, payee: "Shop", category_id: "cat-food", amount, account_id, source: "manual" }, NOW); assert.ok(r.ok, JSON.stringify(r.violations)); return applyDrafts(s, r.drafts); };
const P = { from: "2026-10-01", to: "2026-10-31" };
let n = 0; const id = () => "g" + ++n;

test("the proof: ledger as of the statement's last day against its closing; later entries do not count", () => {
  let s = spend(base(), "t1", "2026-10-05", 100000, "sav"); s = spend(s, "t2", "2026-11-05", 50000, "sav");   // t2 is after the statement
  const ok = statementBalanceProof(s, { account_id: "sav", summary: { closing: 900000 }, period: P });
  assert.deepEqual([ok.ok, ok.ledgerBalance, ok.difference], [true, 900000, 0]);
  const hi = statementBalanceProof(s, { account_id: "sav", summary: { closing: 850000 }, period: P });
  assert.equal(hi.difference, 50000, "the ledger holds more than the bank says");
  assert.equal(statementBalanceProof(s, { account_id: "sav", summary: { closing: 950000 }, period: P }).difference, -50000);
});

test("a card statement prints what is owed: the proof turns the ledger the same way", () => {
  const s = spend(base(), "c1", "2026-10-10", 4000, "card");   // owes 4,000
  const pr = statementBalanceProof(s, { account_id: "card", summary: { closing: 4000 }, period: P });
  assert.deepEqual([pr.ok, pr.card, pr.difference], [true, true, 0]);
  assert.equal(statementBalanceProof(s, { account_id: "card", summary: { closing: 3000 }, period: P }).difference, -1000, "owes more than the statement: the ledger is lower");
});

test("no closing, no last day, or a statement whose own lines do not add up: no proof", () => {
  const s = base();
  assert.equal(statementBalanceProof(s, { account_id: "sav", summary: {}, period: P }).ok, false);
  assert.equal(statementBalanceProof(s, { account_id: "sav", summary: { closing: 1 }, period: null }).ok, false);
  assert.equal(statementBalanceProof(s, { account_id: "sav", summary: { closing: 1 }, period: P, checkOk: false }).ok, false);
  assert.equal(statementBalanceProof(s, { account_id: "gone", summary: { closing: 1 }, period: P }).ok, false);
});

test("the gap is kept as ONE held count dated the last day: the balance matches the bank, nothing counts as spending, it is listed under Not yet explained", () => {
  let s = spend(base(), "t1", "2026-10-05", 100000, "sav");
  const proof = statementBalanceProof(s, { account_id: "sav", summary: { closing: 850000 }, period: P });
  const g = planStatementGap(s, proof, { account_id: "sav", newId: id, unlogged_category_id: UNLOGGED_CATEGORY_ID, now: NOW });
  assert.ok(g.ok && g.made, g.message);
  const acc = g.state.accounts.find((x) => x.id === "sav");
  assert.equal(ledgerBalanceFor(acc, countedEntries(g.state)), 850000, "the balance is the bank's");
  const t = g.state.transactions.filter((x) => x.source === "reconciliation");
  assert.equal(t.length, 1); assert.equal(t[0].date, "2026-10-31"); assert.equal(t[0].adjustment, true); assert.equal(t[0].payee, "Statement check");
  assert.ok(heldIds(g.state).has(t[0].id));
  assert.deepEqual(unexplainedGaps(g.state, { unlogged_category_id: UNLOGGED_CATEGORY_ID }).map((x) => [x.kind, x.amount, x.date]), [["short", 50000, "2026-10-31"]]);
  assert.deepEqual(validateState(g.state).filter((v) => v.severity === "error"), []);
  assert.equal(g.state.checkIns.length, 1);
});

test("a gap the other way (the ledger holds less) is kept too; no gap, a card, or no proof: nothing is made", () => {
  const s = spend(base(), "t1", "2026-10-05", 100000, "sav");
  const lo = planStatementGap(s, statementBalanceProof(s, { account_id: "sav", summary: { closing: 950000 }, period: P }), { account_id: "sav", newId: id, unlogged_category_id: UNLOGGED_CATEGORY_ID, now: NOW });
  assert.ok(lo.made); assert.equal(ledgerBalanceFor(lo.state.accounts.find((x) => x.id === "sav"), countedEntries(lo.state)), 950000);
  const none = planStatementGap(s, statementBalanceProof(s, { account_id: "sav", summary: { closing: 900000 }, period: P }), { account_id: "sav", newId: id, unlogged_category_id: UNLOGGED_CATEGORY_ID, now: NOW });
  assert.equal(none.made, false); assert.equal(none.state, s);
  const c = spend(base(), "c1", "2026-10-10", 4000, "card");
  assert.equal(planStatementGap(c, statementBalanceProof(c, { account_id: "card", summary: { closing: 3000 }, period: P }), { account_id: "card", newId: id, unlogged_category_id: UNLOGGED_CATEGORY_ID, now: NOW }).made, false, "a card is left to the weekly count");
  assert.equal(planStatementGap(s, { ok: false }, { account_id: "sav", newId: id, unlogged_category_id: UNLOGGED_CATEGORY_ID, now: NOW }).made, false);
});

// ---- the safety copy: keeping a gap changes the ledger beyond plain drafts, so the whole ledger is copied, read back and checked first ----
function phone(opts = {}) {
  const p = { copies: [], text: null, ledgerWrites: 0, failCopy: false, dropCopy: false, ...opts };
  p.io = { readCopies: async () => p.copies, writeCopies: async (list) => { if (p.failCopy) return { local: false, idb: false }; if (!p.dropCopy) p.copies = list; return { local: true, idb: true }; }, writeLedger: async (text) => { p.ledgerWrites++; p.text = text; return { local: true, idb: true }; } };
  return p;
}
const keepRun = async (p) => {
  const cur = emptyLedger(); cur.rev = 5; cur.saved_at = TS; cur.state = spend(base(), "t1", "2026-10-05", 100000, "sav");
  const proof = statementBalanceProof(cur.state, { account_id: "sav", summary: { closing: 850000 }, period: P }), g = planStatementGap(cur.state, proof, { account_id: "sav", newId: id, unlogged_category_id: UNLOGGED_CATEGORY_ID, now: NOW });
  const next = nextLedger(cur, g.state, cur.settings);
  return { cur, next, r: await replaceWithCopy({ current: cur, next, io: p.io, meta: { at: TS, from_version: cur.v, build: "test", kind: "repair" } }) };
};
test("SAFETY COPY: before the gap is kept the whole ledger is copied and read back, then replaced", async () => {
  const p = phone(), { cur, next, r } = await keepRun(p);
  assert.equal(r.ok, true); assert.equal(r.copied, true); assert.equal(p.copies.length, 1);
  assert.deepEqual(JSON.parse(p.copies[0].text), cur, "the copy is the ledger exactly as it was");
  assert.equal(copyHolds(p.copies[0], cur), true);
  assert.deepEqual(JSON.parse(p.text).state, next.state);
});
test("SAFETY COPY: a copy that cannot be saved, or does not read back, stops it: the ledger is not written", async () => {
  const a2 = phone({ failCopy: true }), { r: r1 } = await keepRun(a2);
  assert.equal(r1.ok, false); assert.equal(a2.ledgerWrites, 0);
  const b = phone({ dropCopy: true }), { r: r2 } = await keepRun(b);
  assert.equal(r2.ok, false); assert.equal(b.ledgerWrites, 0);
});
test("the screen: the gap is kept only through the copy, and the window offers the choice", () => {
  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
  const save = app.slice(app.indexOf('case "save-import": {'), app.indexOf('case "plan-cancel":'));
  assert.match(save, /if \(gapKept\) \{[^]*?M\.replaceWithCopy\(\{ current: ledger, next: nl, io: \{ readCopies, writeCopies, writeLedger[^]*?kind: "repair"[^]*?\} else if \(await commit\(next\)\)/);
  assert.match(app, /data-action="stm-gap" aria-pressed="\$\{keepGap\}">Keep the difference as not yet explained/);
  assert.match(app, /case "stm-gap": form\.keepGap = !\(form\.keepGap \?\? true\)/);
});

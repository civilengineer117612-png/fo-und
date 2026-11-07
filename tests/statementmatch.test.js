import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { emptyState, recordFromParse, previewImport, acceptMonth, monthSummary, onStatementIds, planExpense, applyDrafts, STATEMENT_MATCH_DAYS } from "../src/model/index.js";
import { UNLOGGED_CATEGORY_ID } from "../src/model/seed.js";

// P1-8 fix 1 (owner's rule): a statement line is a logged entry only on the SAME account, the exact amount, dated within 3 days; one line answers one entry;
// a matched entry shows "on statement". Invented accounts, names and amounts only (centavos).
const NOW = new Date("2026-10-20T09:00:00.000+08:00");
const acct = (id, name) => ({ id, name, class: "asset", role: "", hidden_by_default: false, archived: false, opening_balance: 500000, opening_date: "2026-01-01" });
const base = () => ({ ...emptyState(), accounts: [acct("sav", "Sample Savings"), acct("wal", "Sample Wallet")],
  categories: [{ id: "cat-food", name: "Food", kind: "expense", role: "food" }, { id: UNLOGGED_CATEGORY_ID, name: "Uncategorized", kind: "expense" }] });
const spend = (state, id, date, payee, amount, account_id) => { const r = planExpense(state, { transaction_id: id, date, payee, category_id: "cat-food", amount, account_id, source: "manual" }, NOW); assert.ok(r.ok, JSON.stringify(r.violations)); return applyDrafts(state, r.drafts); };
const item = (dateRaw, name, amount, meaning = "spending") => ({ dateRaw, name, amount, meaning });

test("the match window for a statement is 3 days", () => assert.equal(STATEMENT_MATCH_DAYS, 3));

test("a spend of the same amount on ANOTHER account does not hide a statement line", () => {
  const s = spend(base(), "t1", "2026-10-05", "Sample Friend", 150000, "wal");
  const p = previewImport(s, [item("2026-10-05", "Sample Friend", 150000)], "dmy", null, { accountId: "sav" });
  assert.equal(p.lines.length, 1); assert.equal(p.duplicates.length, 0);
  const same = spend(base(), "t1", "2026-10-05", "Sample Friend", 150000, "sav");
  const q = previewImport(same, [item("2026-10-05", "Sample Friend", 150000)], "dmy", null, { accountId: "sav" });
  assert.equal(q.lines.length, 0); assert.equal(q.duplicates.length, 1); assert.equal(q.duplicates[0].match_id, "t1");
});

test("a statement line matches an entry dated 3 days away, not 4", () => {
  const s = spend(base(), "t1", "2026-10-08", "Corner Cafe", 18000, "sav");
  assert.equal(previewImport(s, [item("2026-10-05", "Cafe", 18000)], "dmy", null, { accountId: "sav" }).duplicates.length, 1);
  assert.equal(previewImport(s, [item("2026-10-04", "Cafe", 18000)], "dmy", null, { accountId: "sav" }).duplicates.length, 0);
});

test("one entry answers one line: two equal lines against one entry leave one line to add", () => {
  const s = spend(base(), "t1", "2026-10-05", "Bus", 5000, "sav");
  const p = previewImport(s, [item("2026-10-05", "Bus", 5000), item("2026-10-05", "Bus", 5000)], "dmy", null, { accountId: "sav" });
  assert.equal(p.duplicates.length, 1); assert.equal(p.lines.length, 1);
});

test("a statement with no account chosen yet matches nothing (it never borrows another account's entry)", () => {
  const s = spend(base(), "t1", "2026-10-05", "Bus", 5000, "wal");
  assert.equal(previewImport(s, [item("2026-10-05", "Bus", 5000)], "dmy", null, {}).duplicates.length, 0);
});

test("notes, CSV and spreadsheet lines keep their rule: any account, 2 days", () => {
  const s = spend(base(), "t1", "2026-10-07", "Lunch", 9500, "wal");
  assert.equal(previewImport(s, [{ dateRaw: "2026-10-05", name: "Lunch", amount: 9500 }], "dmy", null, { accountId: "sav" }).duplicates.length, 1);
  assert.equal(previewImport(s, [{ dateRaw: "2026-10-04", name: "Lunch", amount: 9500 }], "dmy", null, { accountId: "sav" }).duplicates.length, 0);
});

const keep = (state, lines) => { const { record, lines: ls } = recordFromParse({ ok: true, style: "credit-debit", bank: "Sample Bank", period: { from: "2026-10-01", to: "2026-10-31" }, summary: { opening: 500000, closing: 500000 - lines.reduce((n, l) => n + l.amount, 0) }, lines, check: { ok: true } }, { account_id: "sav", id: "rec1", now: NOW });
  return { ...state, statementRecords: [...state.statementRecords, record], statementLines: [...state.statementLines, ...ls] }; };
const sline = (date, text, amount, balance) => ({ date, text, payee: text, type: "", amount, direction: "out", balance, meaning: "spending" });

test("a kept statement marks the entries it shows: same account, 3 days, one each; nothing is stored on the entry", () => {
  let s = spend(base(), "t1", "2026-10-08", "Corner Cafe", 18000, "sav");
  s = spend(s, "t2", "2026-10-05", "Sample Friend", 150000, "wal");   // same amount, other account: never marked
  s = spend(s, "t3", "2026-10-20", "Far away", 7000, "sav");          // 10 days from its line: never marked
  const before = JSON.stringify(s.transactions);
  s = keep(s, [sline("2026-10-05", "CAFE", 18000, 482000), sline("2026-10-05", "Sample Friend", 150000, 332000), sline("2026-10-10", "Far away", 7000, 325000)]);
  assert.deepEqual([...onStatementIds(s)], ["t1"]);
  assert.equal(JSON.stringify(s.transactions), before, "no entry is changed by the mark");
  assert.deepEqual([...onStatementIds({ ...s, statementRecords: [], statementLines: [] })], [], "removing the statement removes its marks");
});

test("Accept this month and its window use the same 3-day, same-account rule", () => {
  let s = spend(base(), "t1", "2026-10-08", "Corner Cafe", 18000, "sav");
  s = keep(s, [sline("2026-10-05", "CAFE", 18000, 482000)]);
  const sum = monthSummary(s, "sav", "2026-10"); assert.equal(sum.spend.already, 1);
  let n = 0; const r = acceptMonth(s, "sav", "2026-10", { newId: () => "n" + ++n, now: NOW });
  assert.ok(r.ok, r.message); assert.equal(r.made, 0); assert.equal(r.verified, 1);
});

test("the app passes the statement's account to the import and shows the mark in the account history", () => {
  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(app, /includeRepeats: f\.repeatsIn === true, accountId: f\.account_id \}/);
  assert.match(app, /includeRepeats: form\.repeatsIn === true, accountId \}/);
  assert.match(app, /onStm\.has\(x\.transaction\.id\) \? " · on statement"/);
});

test("two equal lines mark two equal entries, one each", () => {
  let s = spend(base(), "t1", "2026-10-05", "Bus", 5000, "sav");
  s = spend(s, "t2", "2026-10-06", "Bus", 5000, "sav");
  s = keep(s, [sline("2026-10-05", "Bus", 5000, 495000), sline("2026-10-05", "Bus", 5000, 490000)]);
  assert.deepEqual([...onStatementIds(s)].sort(), ["t1", "t2"]);
});

test("money IN on a statement never marks a spend of the same amount", () => {
  let s = spend(base(), "t1", "2026-10-05", "Shop", 5000, "sav");
  s = keep(s, [{ ...sline("2026-10-05", "Refund in", 5000, 505000), direction: "in", meaning: "in" }]);
  assert.deepEqual([...onStatementIds(s)], []);
});

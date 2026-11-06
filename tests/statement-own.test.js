import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { emptyState, statementMoves, planStatementMoves, planTransfer, validateState, recordFromParse, onStatementIds } from "../src/model/index.js";

// P1-8 fix 4: a transfer to or from the statement's own holder is a move. A logged move (same account, exact amount, within 3 days, the right direction, one each)
// is matched; the others become move drafts to or from the ONE other account the owner chooses for them; with no choice they stay left out. Invented data only.
const NOW = new Date("2026-10-20T09:00:00.000+08:00");
const a = (id, name, extra = {}) => ({ id, name, class: "asset", role: "", hidden_by_default: false, archived: false, opening_balance: 1000000, opening_date: "2026-01-01", ...extra });
const base = () => ({ ...emptyState(), accounts: [a("sav", "Sample Savings"), a("wal", "Sample Wallet"), a("pk", "Sample Pocket", { role: "pocket" })] });
const move = (s, id, date, from, to, amount) => { const r = planTransfer(s, { transaction_id: id, date, from_account_id: from, to_account_id: to, amount, source: "manual" }, NOW); assert.ok(r.ok); return r.state; };
const own = (date, amount, direction) => ({ date, text: "SAMPLE PEDRO OWNER", payee: "SAMPLE PEDRO OWNER", type: "Transfer", amount, direction, balance: null, meaning: "move", own: true });
const LINES = [own("2026-10-05", 300000, "in"), own("2026-10-08", 500000, "in"), own("2026-10-15", 400000, "out")];

test("a logged move into the account answers a transfer in from your own name; out answers out; direction matters", () => {
  const s = move(base(), "m1", "2026-10-06", "wal", "sav", 300000);   // logged a day late, from the wallet
  const mv = statementMoves(s, LINES, { account_id: "sav" });
  assert.deepEqual(mv.map((m) => [m.moveTo, m.direction, m.match, m.to]), [["own", "in", "m1", null], ["own", "in", null, null], ["own", "out", null, null]]);
  const wrongWay = move(base(), "m1", "2026-10-05", "sav", "wal", 300000);   // money OUT of savings is not the transfer IN
  assert.equal(statementMoves(wrongWay, LINES.slice(0, 1), { account_id: "sav" })[0].match, null);
});

test("with no account chosen nothing is made; with one, each open transfer is one draft move the right way round", () => {
  const s = move(base(), "m1", "2026-10-06", "wal", "sav", 300000);
  const none = planStatementMoves(s, statementMoves(s, LINES, { account_id: "sav" }), { account_id: "sav", newId: () => "x", now: NOW });
  assert.equal(none.count, 0); assert.equal(none.noTarget, 2); assert.equal(none.state, s);
  let n = 0; const r = planStatementMoves(s, statementMoves(s, LINES, { account_id: "sav", ownAccount: "pk" }), { account_id: "sav", newId: () => "d" + ++n, now: NOW });
  assert.ok(r.ok, r.message); assert.equal(r.count, 2);
  const legs = (id) => r.state.entries.filter((e) => e.transaction_id === id).map((e) => [e.account_id, e.amount]).sort();
  assert.deepEqual(legs("d1"), [["pk", -500000], ["sav", 500000]], "money in came from the pocket");
  assert.deepEqual(legs("d2"), [["pk", 400000], ["sav", -400000]], "money out went to the pocket");
  assert.deepEqual(r.state.transactions.filter((t) => t.id.startsWith("d")).map((t) => [t.payee, t.status, t.source]), [["Transfer from my account", "draft", "statement"], ["Transfer to my account", "draft", "statement"]]);
  assert.deepEqual(validateState(r.state), []);
  assert.equal(statementMoves(r.state, LINES, { account_id: "sav", ownAccount: "pk" }).filter((m) => !m.match).length, 0, "a second import adds nothing");
});

test("the statement's own account, or an account that does not exist, is never the other account", () => {
  assert.equal(statementMoves(base(), LINES, { account_id: "sav", ownAccount: "sav" })[0].to, null);
  assert.equal(statementMoves(base(), LINES, { account_id: "sav", ownAccount: "gone" })[0].to, null);
});

test("never income and never spending: the money counts once, as a move", () => {
  let n = 0; const r = planStatementMoves(base(), statementMoves(base(), LINES, { account_id: "sav", ownAccount: "wal" }), { account_id: "sav", newId: () => "d" + ++n, now: NOW });
  assert.ok(r.state.entries.every((e) => !e.category_id), "no income or spending line");
});

test("the import window asks once, and Add passes the choice", () => {
  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(app, /accountPicker\(accountsFor\(null, true\)\.filter\(\(a\) => a\.id !== f\.account_id\), f\.ownAccount \?\? null, "stm-own-acct"/);
  assert.match(app, /ownAccount: form\.ownAccount \}\), pm = M\.planStatementMoves/);
});

test("a kept statement marks the logged move of a transfer in from your own name on statement", () => {
  let s = move(base(), "m1", "2026-10-06", "wal", "sav", 300000);
  const { record, lines } = recordFromParse({ ok: true, style: "out-in", bank: "Sample Bank", period: { from: "2026-10-01", to: "2026-10-31" }, summary: {}, lines: [LINES[0]], check: { ok: true } }, { account_id: "sav", id: "rec1", now: NOW });
  s = { ...s, statementRecords: [record], statementLines: lines };
  assert.deepEqual([...onStatementIds(s)], ["m1"]);
});

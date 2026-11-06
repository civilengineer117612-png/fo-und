import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { emptyState, classifyLine, statementItems, statementLeftOut, statementMoves, planStatementMoves, moveTarget, loggedMove, planTransfer, recordFromParse, onStatementIds, validateState } from "../src/model/index.js";

// P1-8 fix 3: "Credit Card Bill Repayment" is a payment to the card and "ATM Cash Withdrawal" a move to Cash: never spending. A move already logged (same account,
// exact amount, within 3 days, one each) is matched; one not logged becomes ONE draft move. Invented accounts and amounts only (centavos).
const NOW = new Date("2026-10-20T09:00:00.000+08:00");
const a = (id, name, extra = {}) => ({ id, name, class: "asset", role: "", hidden_by_default: false, archived: false, opening_balance: 1000000, opening_date: "2026-01-01", ...extra });
const base = () => ({ ...emptyState(), accounts: [a("sav", "Sample Savings", { bank: "maribank" }), a("cash", "Cash", { bank: "cash", opening_balance: 0 }), a("card", "Sample Card", { class: "liability", bank: "maribank", opening_balance: 0 })] });
const move = (state, id, date, from, to, amount) => { const r = planTransfer(state, { transaction_id: id, date, from_account_id: from, to_account_id: to, amount, source: "manual" }, NOW); assert.ok(r.ok, JSON.stringify(r.violations)); return r.state; };
const L = (date, text, amount, direction = "out") => ({ date, text, payee: text, type: "", amount, direction, balance: null, ...classifyLine({ text, direction }) });

test("card repayment and ATM withdrawal lines are moves, never spending or unsure", () => {
  for (const t of ["Credit Card Bill Repayment", "Credit Card Payment", "ATM Cash Withdrawal", "Cash Withdrawal"]) assert.equal(classifyLine({ text: t, direction: "out" }).meaning, "move", t);
  assert.equal(classifyLine({ text: "Credit Card Bill Repayment", direction: "out" }).moveTo, "card");
  assert.equal(classifyLine({ text: "ATM Cash Withdrawal", direction: "out" }).moveTo, "cash");
  const lines = [L("2026-10-10", "Credit Card Bill Repayment", 200000), L("2026-10-12", "ATM Cash Withdrawal", 100000), L("2026-10-13", "Sample Shop", 5000)];
  assert.deepEqual(statementItems(lines).map((i) => i.name), ["Sample Shop"], "neither is offered as spending");
  assert.equal(statementLeftOut(lines).cardCash, 2); assert.equal(statementLeftOut(lines).moves, 0);
});

test("a move already logged is matched (same account, exact amount, 3 days, one each); one not logged becomes a draft move", () => {
  let s = move(base(), "m1", "2026-10-13", "sav", "card", 200000);   // the card payment, logged 3 days after the statement's line
  const lines = [L("2026-10-10", "Credit Card Bill Repayment", 200000), L("2026-10-12", "ATM Cash Withdrawal", 100000), L("2026-10-15", "Credit Card Bill Repayment", 200000)];
  const mv = statementMoves(s, lines, { account_id: "sav", bankId: "maribank" });
  assert.deepEqual(mv.map((m) => [m.match, m.to]), [["m1", "card"], [null, "cash"], [null, "card"]]);
  let n = 0; const r = planStatementMoves(s, mv, { account_id: "sav", newId: () => "d" + ++n, now: NOW });
  assert.ok(r.ok, r.message); assert.equal(r.count, 2); assert.equal(r.noTarget, 0);
  const made = r.state.transactions.filter((t) => t.id.startsWith("d"));
  assert.deepEqual(made.map((t) => [t.payee, t.status, t.source, t.date]), [["Cash withdrawal", "draft", "statement", "2026-10-12"], ["Card payment", "draft", "statement", "2026-10-15"]]);
  const legs = (id) => r.state.entries.filter((e) => e.transaction_id === id).map((e) => [e.account_id, e.amount]).sort();
  assert.deepEqual(legs("d1"), [["cash", 100000], ["sav", -100000]]); assert.deepEqual(legs("d2"), [["card", 200000], ["sav", -200000]]);
  assert.deepEqual(validateState(r.state), []);
  assert.equal(statementMoves(r.state, lines, { account_id: "sav", bankId: "maribank" }).filter((m) => !m.match).length, 0, "a second import adds nothing");
});

test("a move 4 days away, or on another account, is not the line", () => {
  const s = move(move(base(), "m1", "2026-10-14", "sav", "card", 200000), "m2", "2026-10-10", "cash", "card", 200000);
  assert.equal(loggedMove(s, { date: "2026-10-10", amount: 200000, accountId: "sav", direction: "out" }), null);
  assert.equal(loggedMove(s, { date: "2026-10-11", amount: 200000, accountId: "sav", direction: "out" })?.id, "m1");
});

test("no Cash account, or more than one card that could be meant: nothing is guessed", () => {
  const s = { ...base(), accounts: [a("sav", "Sample Savings"), a("c1", "Card One", { class: "liability" }), a("c2", "Card Two", { class: "liability" })] };
  assert.equal(moveTarget(s, "cash"), null); assert.equal(moveTarget(s, "card"), null);
  assert.equal(moveTarget(s, "card", "maribank"), null);
  assert.equal(moveTarget({ ...s, accounts: [...s.accounts.slice(0, 2), a("c2", "Card Two", { class: "liability", bank: "maribank" })] }, "card", "maribank"), "c2", "the statement's bank picks its card");
  const mv = statementMoves(s, [L("2026-10-12", "ATM Cash Withdrawal", 100000)], { account_id: "sav" });
  const r = planStatementMoves(s, mv, { account_id: "sav", newId: () => "x", now: NOW });
  assert.equal(r.count, 0); assert.equal(r.noTarget, 1); assert.equal(r.state, s);
});

test("a kept statement marks the logged move on statement", () => {
  let s = move(base(), "m1", "2026-10-11", "sav", "cash", 100000);
  const { record, lines } = recordFromParse({ ok: true, style: "out-in", bank: "Sample Bank", period: { from: "2026-10-01", to: "2026-10-31" }, summary: {}, lines: [{ ...L("2026-10-12", "ATM Cash Withdrawal", 100000), balance: null }], check: { ok: true } }, { account_id: "sav", id: "rec1", now: NOW });
  s = { ...s, statementRecords: [record], statementLines: lines };
  assert.deepEqual([...onStatementIds(s)], ["m1"]);
});

test("the import window says it and makes the move drafts on Add", () => {
  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(app, /id="stm-cardcash"/);
  assert.match(app, /M\.planStatementMoves\(next, mvs, \{ account_id: accountId/);
});

test("two Cash accounts: which one is not guessed; a spend of the same amount is not a logged move", async () => {
  const two = { ...base(), accounts: [...base().accounts, a("cash2", "Cash envelope", { opening_balance: 0 })] };
  assert.equal(moveTarget(two, "cash"), null);
  const { planExpense, applyDrafts } = await import("../src/model/index.js");
  const s0 = { ...base(), categories: [{ id: "cat-food", name: "Food", kind: "expense", role: "food" }] };
  const r = planExpense(s0, { transaction_id: "e1", date: "2026-10-12", payee: "Shop", category_id: "cat-food", amount: 100000, account_id: "sav", source: "manual" }, NOW);
  assert.equal(loggedMove(applyDrafts(s0, r.drafts), { date: "2026-10-12", amount: 100000, accountId: "sav", direction: "out" }), null);
});

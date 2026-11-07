import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as M from "../src/model/index.js";
import { UNLOGGED_CATEGORY_ID } from "../src/model/seed.js";
import { makeState, account } from "./fixtures.js";

// P0-7 (owner, Nov 7): ONE RULE FOR EVERY ENTRY PATH. Typing alone makes a DRAFT that waits in Verify. A new entry is verified at entry ONLY with evidence
// (`verified_by`), and the owner's confirming tap (Verify) needs none. Every figure is invented; amounts are centavos (100000 is 1,000.00).
const NOW = new Date("2026-10-20T03:00:00Z"), MONTH = "2026-10", FROM = MONTH + "-01", TO = MONTH + "-31", TS = "2026-10-01T09:00:00.000+08:00";
const UL = UNLOGGED_CATEGORY_ID;
let n = 0; const nid = (p) => p + ++n;
function ledger() {
  const s = makeState();
  s.accounts = [account({ id: "chk", name: "Checking", class: "asset", opening_balance: 1000000 }), account({ id: "sav", name: "Savings", class: "asset", opening_balance: 200000 }),
    account({ id: "wal", name: "Wallet", class: "asset", opening_balance: 65731 }), account({ id: "card", name: "Card", class: "liability", opening_balance: 20000 })];
  s.categories = [{ id: "food", name: "Food", kind: "expense" }, { id: "fees", name: "Bank fees", kind: "expense" }, { id: UL, name: "Uncategorized", kind: "expense" }];
  s.goals = [{ id: "g1", account_id: "sav", name: "Trip", hidden_by_default: false }];
  for (const k of ["payslips", "payslipLines", "payslipItems", "payslipItemChanges", "payslipRevisions", "checkIns", "rules", "categoryMaps", "tags", "subscriptions", "schedules", "scheduleChanges", "statementRecords", "statementLines", "statementAccepts"]) s[k] = [];
  return M.ensureIncomeCategories(s);
}
const txOf = (r, id) => (r.state ?? r).transactions.find((t) => t.id === id);
const statusOf = (r, id) => { const t = txOf(r, id); return t ? [t.status, t.verified_by ?? null] : null; };
const slip = (o = {}) => ({ id: nid("p"), transaction_id: nid("ptx"), employer: "Co", period_from: "2026-10-01", period_to: "2026-10-15", pay_date: "2026-10-15", account_id: "chk", printed_gross: 1200000, printed_net: 1000000, deposit: 1000000,
  earnings: [{ kind: "basic", amount: 1000000 }, { kind: "overtime", amount: 200000, earned_month: MONTH }], deductions: [{ kind: "sss", amount: 200000 }], ...o });

// ---------- the rule itself ----------
test("settle: no evidence is a draft; evidence is a verified entry that says so; an unknown kind of evidence is refused", () => {
  const base = { id: "a", date: "2026-10-01", payee: "x", memo: "", source: "manual", created_at: TS };
  assert.deepEqual(M.settle(base, null, TS), { ...base, status: "draft" });
  assert.deepEqual(M.settle({ ...base, status: "verified", verified_at: TS, verified_by: "verified by count" }, null, TS), { ...base, status: "draft" }, "old flags never survive a draft");
  assert.deepEqual(M.settle(base, M.EVIDENCE.count, TS), { ...base, status: "verified", verified_at: TS, verified_by: "verified by count" });
  assert.equal(M.settle(base, M.correctionOf("Shop"), TS).verified_by, "correction of Shop");
  for (const bad of ["verified by me", "verified", "correction of ", "typed"]) assert.throws(() => M.settle(base, bad, TS), /not a kind of evidence/);
  assert.deepEqual(Object.values(M.EVIDENCE), ["verified by payslip check", "verified by count", "verified by statement"]);
});

test("the save check refuses a NEW verified entry without evidence, accepts it with evidence, and leaves entries already in the ledger alone", () => {
  const s = ledger(), id = "n1";
  const t = { id, date: "2026-10-05", payee: "Typed", memo: "", status: "verified", source: "manual", created_at: TS, verified_at: TS };
  const es = [{ transaction_id: id, account_id: "chk", amount: 100000 }, { transaction_id: id, category_id: "cat-salary", amount: -100000 }];
  assert.ok(M.checkTransactionSave(s, { transaction: t, entries: es }).violations.some((v) => v.code === "ENTRY_NO_EVIDENCE"), "typing alone cannot make a verified entry");
  assert.ok(M.checkTransactionSave(s, { transaction: { ...t, verified_by: "verified by the owner" }, entries: es }).violations.some((v) => v.code === "ENTRY_NO_EVIDENCE"), "made-up evidence is no evidence");
  assert.equal(M.checkTransactionSave(s, { transaction: { ...t, verified_by: M.EVIDENCE.statement }, entries: es }).ok, true);
  assert.equal(M.checkTransactionSave(s, { transaction: { ...t, status: "draft", verified_at: undefined }, entries: es }).ok, true, "a draft needs none");
  // a draft already in the ledger turning verified (the owner's tap) is the same id: not a new entry, needs no evidence
  const withDraft = M.planPayReceived(s, { transaction_id: id, date: "2026-10-05", amount: 100000, account_id: "chk" }, NOW).state;
  assert.equal(M.checkTransactionSave(withDraft, { transaction: { ...t, verified_by: undefined }, entries: es }).violations.some((v) => v.code === "ENTRY_NO_EVIDENCE"), false);
});

test("the owner's confirming tap verifies a draft with no evidence; a document may add its evidence; made-up evidence is refused", () => {
  const s = M.planPayReceived(ledger(), { transaction_id: "d1", date: "2026-10-05", amount: 100000, account_id: "chk" }, NOW).state;
  const tap = M.verifyDraft(s, "d1", NOW); assert.ok(tap.ok);
  assert.deepEqual(statusOf(tap, "d1"), ["verified", null], "a tap alone leaves no evidence note");
  const doc = M.verifyDraft(s, "d1", NOW, { evidence: M.EVIDENCE.statement }); assert.deepEqual(statusOf(doc, "d1"), ["verified", "verified by statement"]);
  assert.equal(M.verifyDraft(s, "d1", NOW, { evidence: "trust me" }).ok, false);
});

// ---------- every creation path (Step 0), and the status each sets ----------
test("EVERY PATH: typed entries are drafts from every screen; only evidence verifies at entry", () => {
  const s = ledger(), rows = [];
  const add = (name, got, want) => rows.push([name, got, want]);
  const exp = M.planExpense(s, { transaction_id: "e1", date: "2026-10-05", category_id: "food", amount: 20000, account_id: "chk", payee: "Shop" }, NOW); assert.ok(exp.ok);
  add("Log: Add expense, tiles, scan, voice", statusOf({ state: M.applyDrafts(s, exp.drafts) }, "e1"), ["draft", null]);
  add("Income: Add income (Money received)", statusOf(M.planPayReceived(s, { transaction_id: "i1", date: "2026-10-05", amount: 100000, account_id: "chk" }, NOW), "i1"), ["draft", null]);
  add("Money received from a scan", statusOf(M.planPayReceived(s, { transaction_id: "i2", date: "2026-10-05", amount: 100000, account_id: "chk", source: "photo" }, NOW), "i2"), ["draft", null]);
  add("Income: Refund", statusOf(M.planRefund(s, { transaction_id: "r1", date: "2026-10-05", amount: 50000, account_id: "chk", category_id: "food" }, NOW), "r1"), ["draft", null]);
  add("Cards and Move money: a transfer", statusOf(M.planTransfer(s, { transaction_id: "t1", date: "2026-10-05", from_account_id: "chk", to_account_id: "sav", amount: 10000, source: "manual" }, NOW), "t1"), ["draft", null]);
  add("Cards: Pay a card", statusOf(M.planCardPayment(s, { card_id: "card", from_id: "chk", amount: 10000, date: "2026-10-05", newId: () => "cp1", now: NOW }), "cp1"), ["draft", null]);
  add("Goals: put money in", statusOf(M.planGoalDeposit(s, { transaction_id: "gd1", date: "2026-10-05", goal_id: "g1", from_account_id: "chk", amount: 10000 }, NOW), "gd1"), ["draft", null]);
  const bs = ledger(); bs.envelopes = [];
  const setup = M.planEnvelopeSetup(bs, { gcash_account_id: "wal", allowance_envelope_id: "allow", buffer_envelope_id: "buf", allowance_amount: 15731, buffer_amount: 50000, date: "2026-10-05", transaction_ids: ["bu-a", "bu-b"] });
  assert.ok(setup.ok, JSON.stringify(setup.violations));
  add("Buffer: set up the envelopes", statusOf(setup, "bu-a"), ["draft", null]);
  const fund = M.planBufferFunding(setup.state, { transaction_id: "bf1", date: "2026-10-06", amount: 10000, from_account_id: "chk", gcash_account_id: "wal", buffer_envelope_id: "buf" }); assert.ok(fund.ok, JSON.stringify(fund.violations));
  add("Buffer: fund the buffer", statusOf(fund, "bf1"), ["draft", null]);
  // documents that prove themselves
  const good = slip({ transaction_id: "pg" }); add("Payslip whose lines match its printed totals", statusOf(M.planPayslip(s, good, NOW), "pg"), ["verified", "verified by payslip check"]);
  const bad = slip({ transaction_id: "pb", status: "draft" }); add("Payslip that does not match its printed totals", statusOf(M.planPayslip(s, bad, NOW), "pb"), ["draft", null]);
  // the weekly count, and what is confirmed by tap inside it
  const ci = M.planCheckIn(s, { id: "c1", transaction_id: "ck1", date: "2026-10-12", account_id: "wal", counted_balance: 60000, unlogged_category_id: UL }, NOW);
  add("Weekly count", statusOf({ state: { ...s, transactions: [...s.transactions, ci.transaction], entries: [...s.entries, ...ci.entries] } }, "ck1"), ["verified", "verified by count"]);
  const mv = M.planCheckInWithMove(s, { id: "c2", transaction_id: "ck2", date: "2026-10-12", account_id: "wal", counted_balance: 85731, unlogged_category_id: UL }, { account_id: "sav", move_id: "mv1" }, NOW);
  assert.ok(mv.ok, JSON.stringify(mv.violations));
  add("Weekly count: a move confirmed inside it", statusOf(mv, "mv1"), ["verified", "verified by count"]);
  // a statement
  const proof = { ok: true, card: false, asOf: "2026-10-31", statementClosing: 100000, ledgerBalance: 120000, difference: 20000 };
  const gap = M.planStatementGap(s, proof, { account_id: "chk", newId: (() => { let k = 0; return () => "sg" + ++k; })(), unlogged_category_id: UL, now: NOW }); assert.ok(gap.made);
  add("Statement: a kept difference", statusOf(gap, "sg2"), ["verified", "verified by statement"]);
  // corrections
  const spent = M.verifyDraft(M.applyDrafts(s, exp.drafts), "e1", NOW).state;
  const cor = M.planCorrection(spent, { id: "e1", redo_id: "fix1", today: "2026-10-20" }, NOW); assert.ok(cor.ok, JSON.stringify(cor.violations ?? cor));
  add("Weekly review: put right a verified entry", statusOf({ state: M.applyCorrection(spent, cor) }, "rev:e1"), ["verified", "correction of Shop"]);
  for (const [name, got, want] of rows) assert.deepEqual(got, want, name);
  assert.ok(rows.length >= 15, "the whole of Step 0 is listed");
});

test("EVERY PATH: a statement's Accept this month verifies by statement; a line already in the ledger as a draft is verified by statement too", () => {
  const line = (date, text, amount, direction, balance, meaning = "spending") => ({ date, text, payee: text, type: "", amount, direction, balance, meaning });
  const parsed = { ok: true, style: "credit-debit", bank: "Sample Bank", period: { from: "2026-09-01", to: "2026-09-30" }, summary: { opening: 85500, closing: 66000 }, check: { ok: true },
    lines: [line("2026-09-10", "Corner Cafe", 9500, "out", 76000), line("2026-09-15", "Bus fare", 10000, "out", 66000)] };
  let s = { ...M.emptyState(), accounts: [account({ id: "gt", name: "Test Bank", class: "asset", opening_balance: 0 })], categories: [{ id: "cat-food", name: "Food", kind: "expense", role: "food" }, { id: UL, name: "Unlogged", kind: "expense" }] };
  const { record, lines } = M.recordFromParse(parsed, { account_id: "gt", id: "rec1", now: new Date(TS) });
  s = { ...s, statementRecords: [record], statementLines: lines };
  const draft = M.planExpense(s, { transaction_id: "dr1", date: "2026-09-10", category_id: "cat-food", amount: 9500, account_id: "gt", payee: "Corner Cafe" }, NOW); assert.ok(draft.ok);
  s = M.applyDrafts(s, draft.drafts);
  let k = 0; const r = M.acceptMonth(s, "gt", "2026-09", { newId: () => "id" + ++k, now: NOW }); assert.equal(r.ok, true, r.message);
  const st = r.state.transactions.filter((t) => t.status === "verified");
  assert.equal(st.length, 2, "the matched draft and the new line");
  assert.ok(st.every((t) => t.verified_by === "verified by statement"), JSON.stringify(st.map((t) => t.verified_by)));
});

// ---------- the figures ----------
test("figures: typed income 1,000.00 is in no figure until verified, then counted exactly once; the same for a typed refund 500.00; a logged expense of 200.00 is unchanged", () => {
  let s = ledger();
  const ex = M.planExpense(s, { transaction_id: "e1", date: "2026-10-05", category_id: "food", amount: 20000, account_id: "chk", payee: "Shop" }, NOW); s = M.applyDrafts(s, ex.drafts);
  assert.equal(statusOf(s, "e1")[0], "draft", "a logged expense is still a draft");
  s = M.planPayReceived(s, { transaction_id: "i1", date: "2026-10-05", amount: 100000, account_id: "chk", category_id: "cat-salary" }, NOW).state;
  assert.equal(statusOf(s, "i1")[0], "draft");
  assert.equal(M.incomeBySource(s, { from: FROM, to: TO }).total, 0, "typed income is in no figure while it waits");
  s = M.verifyDraft(s, "i1", NOW).state;
  assert.equal(M.incomeBySource(s, { from: FROM, to: TO }).total, 100000, "once verified it counts, exactly once");
  s = M.verifyDraft(s, "e1", NOW).state;
  const before = M.spendingByCategory(s, { month: MONTH }).total; assert.equal(before, 20000);
  s = M.planRefund(s, { transaction_id: "r1", date: "2026-10-09", amount: 50000 - 40000, account_id: "chk", category_id: "food" }, NOW).state;
  assert.equal(M.spendingByCategory(s, { month: MONTH }).total, 20000, "a refund waiting in Verify lowers no spending");
  s = M.verifyDraft(s, "r1", NOW).state;
  assert.equal(M.spendingByCategory(s, { month: MONTH }).total, 10000, "once verified it counts once");
  assert.equal(s.entries.reduce((a, e) => a + e.amount, 0), 0, "the trial balance is zero");
});

// ---------- no screen and no function sets a status itself ----------
const read = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8");
test("AUDIT: no code outside the shared rule writes a verified status (a creator that did would be a second rule); the one tap path is Verify itself", () => {
  const verifiedLiteral = /status\s*:\s*(?:[^,;{}]*\?\s*)?["']verified["']|\.status\s*=\s*["']verified["']/;
  const hits = [];
  for (const dir of ["../src/model/", "../app/"]) for (const f of fs.readdirSync(new URL(dir, import.meta.url)).filter((x) => x.endsWith(".js"))) {
    const text = read(dir + f);
    text.split("\n").forEach((l, i) => { if (!l.trim().startsWith("//") && !/t\.status === "verified"/.test(l) && verifiedLiteral.test(l)) hits.push(dir.slice(3) + f + ":" + (i + 1)); });
  }
  assert.deepEqual(hits.map((h) => h.replace(/:\d+$/, "")), ["src/model/entryrule.js", "src/model/inbox.js"].filter((x) => hits.some((h) => h.startsWith(x))), "only the rule and the owner's tap write 'verified': " + hits.join(", "));
  assert.ok(!hits.some((h) => h.startsWith("app/")), "no screen sets a status");
  assert.match(read("../src/model/inbox.js"), /export function verifyTransaction[\s\S]*?status: "verified"/, "the tap path is verifyTransaction");
});

test("AUDIT: every file that creates a transaction is on the list reviewed in Step 0, so a new creation path cannot be added without this test being updated", () => {
  const creators = fs.readdirSync(new URL("../src/model/", import.meta.url)).filter((f) => f.endsWith(".js") && /status: "draft"|settle\(/.test(read("../src/model/" + f))).sort();   // a file that builds a transaction literal
  const reviewed = ["buffer.js", "checkin.js", "corrections.js", "drafts.js", "gaprepair.js", "goals.js", "income.js", "plan.js", "reconcile.js", "refunds.js", "schedules.js", "templates.js", "transfers.js"];
  assert.deepEqual(creators.filter((f) => !["entryrule.js", "inbox.js"].includes(f)), reviewed, "a file that makes transactions must be reviewed for P0-7 and added here");
});

// ---------- the data version stays 11: old data is untouched ----------
const v11 = () => { const l = M.emptyLedger(); const s = ledger();
  const t = (id, status, extra = {}) => ({ id, date: "2026-10-05", payee: "Old", memo: "", status, source: "manual", created_at: TS, ...(status === "verified" ? { verified_at: TS } : {}), ...extra });
  s.transactions = [t("o1", "verified"), t("o2", "draft"), t("o3", "verified", { verified_by: "verified by count", source: "reconciliation" })];
  s.entries = [{ transaction_id: "o1", account_id: "chk", amount: 5000 }, { transaction_id: "o1", category_id: "cat-salary", amount: -5000 }, { transaction_id: "o2", category_id: "food", amount: 100 }, { transaction_id: "o2", account_id: "chk", amount: -100 },
    { transaction_id: "o3", account_id: "chk", amount: 700 }, { transaction_id: "o3", category_id: UL, amount: -700 }];
  return { ...l, rev: 4, saved_at: TS, state: s, settings: { foo: "bar" } }; };
test("COMPATIBILITY: a version 11 ledger without verified_by loads, saves and backs up exactly as it is; the same with the field", async () => {
  assert.equal(M.LEDGER_VERSION, 11, "no data version change");
  const ledgerIn = v11(), text = JSON.stringify(ledgerIn), p = M.parseLedger(text);
  assert.ok(p.ok, p.error); assert.equal(p.older, undefined);
  assert.deepEqual(p.ledger, ledgerIn, "loads unchanged");
  assert.deepEqual(M.validateState(p.ledger.state), []);
  const saved = M.nextLedger(p.ledger, p.ledger.state, p.ledger.settings, NOW);
  assert.deepEqual(saved.state, ledgerIn.state, "saves unchanged"); assert.equal(JSON.stringify(saved.state), JSON.stringify(ledgerIn.state));
  const back = await M.decryptLedgerBackup(await M.encryptLedgerBackup(saved, "a long passphrase for tests"), "a long passphrase for tests");
  assert.deepEqual(back.state, ledgerIn.state, "backs up and opens unchanged");
  assert.ok(back.state.transactions.filter((t) => t.status === "verified").some((t) => t.verified_by === undefined), "an older verified entry has no field and is fine");
  assert.deepEqual(M.selfCheck(back), []);
});
test("COMPATIBILITY: an older backup restores and upgrades with its entries untouched", async () => {
  const cur = v11(), old = { ...cur, v: 10, state: { ...cur.state } }; delete old.state.payslipItems; delete old.state.payslipItemChanges;
  const file = await M.encryptLedgerBackup(old, "a long passphrase for tests"), opened = await M.decryptLedgerBackup(file, "a long passphrase for tests");
  assert.equal(opened.v, 10);
  const restored = M.restoreLedger(M.emptyLedger(), opened, NOW);
  const up = M.upgradeLedger(restored, { now: NOW }); assert.ok(up.ok, up.error);
  assert.equal(up.ledger.v, 11);
  assert.deepEqual(up.ledger.state.transactions, cur.state.transactions, "every entry as it was");
  assert.deepEqual(up.ledger.state.entries, cur.state.entries);
});

// ---------- "I paid the card" stays a draft; a later statement import that matches it verifies it by statement ----------
test("a card payment made by 'I paid the card' stays a draft, and a statement import that shows it verifies it by statement; the same for a plain logged entry; verified entries and drafts the statement does not show are left alone", () => {
  let s = ledger();
  const pay = M.planCardPayment(s, { card_id: "card", from_id: "chk", amount: 10000, date: "2026-10-05", newId: () => "cp1", now: NOW }); assert.ok(pay.ok); s = pay.state;
  assert.deepEqual(statusOf(s, "cp1"), ["draft", null], "I paid the card: a draft");
  const exp = M.planExpense(s, { transaction_id: "e1", date: "2026-10-06", category_id: "food", amount: 20000, account_id: "chk", payee: "Corner Cafe" }, NOW); s = M.applyDrafts(s, exp.drafts);
  const other = M.planExpense(s, { transaction_id: "e2", date: "2026-10-07", category_id: "food", amount: 33300, account_id: "chk", payee: "Elsewhere" }, NOW); s = M.applyDrafts(s, other.drafts);
  const done = M.planExpense(s, { transaction_id: "e3", date: "2026-10-08", category_id: "food", amount: 4400, account_id: "chk", payee: "Bakery" }, NOW); s = M.verifyDraft(M.applyDrafts(s, done.drafts), "e3", NOW).state;
  // the statement of the account that backs the card: the repayment (a move to the card), the cafe, and the bakery already verified; nothing for e2
  const lines = [{ date: "2026-10-06", text: "Credit Card Bill Repayment", payee: "Credit Card Bill Repayment", amount: 10000, direction: "out", meaning: "move", moveTo: "card" },
    { date: "2026-10-06", text: "Corner Cafe", payee: "Corner Cafe", amount: 20000, direction: "out", meaning: "spending" },
    { date: "2026-10-08", text: "Bakery", payee: "Bakery", amount: 4400, direction: "out", meaning: "spending" }];
  const items = lines.filter((l) => l.meaning === "spending").map((l) => ({ dateRaw: l.date, name: l.payee, amount: l.amount, meaning: l.meaning }));
  const preview = M.previewImport(s, items, "ymd", null, { accountId: "chk" });
  const moves = M.statementMoves(s, lines, { account_id: "chk", chosen: {} });
  assert.equal(moves.find((m) => m.moveTo === "card").match, "cp1", "the repayment line is matched to the logged card payment");
  const r = M.planStatementVerify(s, [...preview.duplicates.map((d) => d.match_id), ...moves.map((m) => m.match)], NOW);
  assert.equal(r.count, 2, "the card payment and the cafe; the bakery was already verified");
  assert.deepEqual(statusOf(r, "cp1"), ["verified", "verified by statement"]);
  assert.deepEqual(statusOf(r, "e1"), ["verified", "verified by statement"]);
  assert.deepEqual(statusOf(r, "e2"), ["draft", null], "a draft the statement does not show stays a draft");
  assert.equal(statusOf(r, "e3")[1], null, "an entry already verified by the owner is not rewritten");
  assert.equal(r.state.entries.reduce((a, e) => a + e.amount, 0), 0);
  assert.equal(M.planStatementVerify(r.state, ["cp1", "e1"], NOW).count, 0, "asking again changes nothing");
});

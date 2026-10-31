import { test } from "node:test";
import assert from "node:assert/strict";
import * as M from "../src/model/index.js";
import { makeState, account } from "./fixtures.js";

// P0-5 fix 1 (docs/ACCOUNTING.md, principle 7): a verified entry is never edited or deleted. Updating or removing a payslip, and removing an income entry, go through
// a correction (a new entry that reverses exactly one entry, once, with a reference), and the save check enforces reversals. Invented figures, centavos.
const NOW = new Date("2026-10-20T03:00:00Z"), TS = "2026-10-01T09:00:00.000+08:00";
function base() {
  const s = makeState();
  s.accounts = [account({ id: "chk", name: "Checking", class: "asset", opening_balance: 1000000 }), account({ id: "emg", name: "Emergency", class: "asset", opening_balance: 0 })];
  s.categories = [{ id: "food", name: "Food", kind: "expense" }];
  for (const k of ["payslips", "payslipLines", "payslipItems", "payslipItemChanges", "payslipRevisions", "attachments"]) s[k] = [];
  return M.ensureIncomeCategories(s);
}
const input = (o = {}) => ({ id: "p1", transaction_id: "ptx1", employer: "Co", period_from: "2026-10-01", period_to: "2026-10-15", pay_date: "2026-10-15", account_id: "chk", printed_gross: 1000000, printed_net: 800000, deposit: 800000,
  earnings: [{ kind: "basic", amount: 1000000 }], deductions: [{ kind: "sss", amount: 200000 }], ...o });
const slip = (s = base(), o = {}) => { const r = M.planPayslip(s, input(o), NOW); assert.ok(r.ok, JSON.stringify(r.violations)); return r.state; };
const bal = (s, id) => M.naturalBalance(s.accounts.find((a) => a.id === id), M.countedEntries(s));
const trial = (s) => s.entries.reduce((n, e) => n + e.amount, 0);
const verifiedBefore = (s) => s.transactions.filter((t) => t.status === "verified").map((t) => JSON.stringify([t, s.entries.filter((e) => e.transaction_id === t.id)]));
const stillThere = (before, after) => before.every((x) => verifiedBefore(after).includes(x));
const received = (s, id, amount) => { const t = { id, date: "2026-10-09", payee: "Interest", memo: "", status: "verified", source: "manual", created_at: TS, verified_at: TS }; const es = [{ transaction_id: id, account_id: "chk", amount }, { transaction_id: id, category_id: "cat-interest", amount: -amount }];
  return { ...s, transactions: [...s.transactions, t], entries: [...s.entries, ...es] }; };

// ---------- the save check enforces reversals ----------
const orig = (s) => { const t = { id: "o1", date: "2026-10-01", payee: "", memo: "", status: "verified", source: "manual", created_at: TS, verified_at: TS }, es = [{ transaction_id: "o1", category_id: "food", amount: 100 }, { transaction_id: "o1", account_id: "chk", amount: -100 }];
  return { ...s, transactions: [...s.transactions, t], entries: [...s.entries, ...es] }; };
const rev = (id, target, amount = -100, o = {}) => ({ transaction: { id, date: "2026-10-01", payee: "", memo: "", status: "verified", source: "correction", reverses: target, created_at: TS, verified_at: TS, ...o },
  entries: [{ transaction_id: id, category_id: "food", amount }, { transaction_id: id, account_id: "chk", amount: -amount }] });
test("a reversal must name a verified entry that exists", () => {
  const s = orig(base());
  assert.ok(M.checkTransactionSave(s, rev("rev:o1", "o1")).ok, "a proper reversal is accepted");
  assert.ok(M.checkTransactionSave(s, rev("rev:zzz", "zzz")).violations.some((v) => v.code === "REVERSES_MISSING"));
  const draft = { ...s, transactions: s.transactions.map((t) => (t.id === "o1" ? { ...t, status: "draft", verified_at: undefined } : t)) };
  assert.ok(M.checkTransactionSave(draft, rev("rev:o1", "o1")).violations.some((v) => v.code === "REVERSES_NOT_VERIFIED"));
});
test("an entry is reversed once, a reversal is never itself reversed, and a reversal is the exact opposite", () => {
  let s = orig(base());
  const a = rev("rev:o1", "o1"); s = { ...s, transactions: [...s.transactions, a.transaction], entries: [...s.entries, ...a.entries] };
  assert.ok(M.checkTransactionSave(s, rev("another", "o1")).violations.some((v) => v.code === "ALREADY_REVERSED"), "a second reversal under another id");
  assert.ok(M.checkTransactionSave(s, rev("rev:rev:o1", "rev:o1")).violations.some((v) => v.code === "REVERSAL_OF_REVERSAL"));
  assert.ok(M.checkTransactionSave(orig(base()), rev("rev:o1", "o1", -99)).violations.some((v) => v.code === "REVERSAL_NOT_EXACT"), "an amount that does not cancel");
  const wrongAccount = rev("rev:o1", "o1"); wrongAccount.entries[1] = { ...wrongAccount.entries[1], account_id: "emg" };
  assert.ok(M.checkTransactionSave(orig(base()), wrongAccount).violations.some((v) => v.code === "REVERSAL_NOT_EXACT"), "another account");
});

// ---------- removing a payslip ----------
test("Removing a verified payslip cancels its pay by a correction: the entry stays, the money leaves the account, income and the lists no longer count it", () => {
  const s = slip(), before = verifiedBefore(s);
  const r = M.deletePayslip(s, "p1", NOW);
  assert.ok(r.ok);
  const n = r.state;
  assert.ok(stillThere(before, n), "the verified pay entry is still there, unchanged");
  const c = n.transactions.find((t) => t.reverses === "ptx1");
  assert.ok(c && c.id === "rev:ptx1" && c.status === "verified" && c.source === "correction");
  assert.equal(trial(n), 0); assert.equal(bal(n, "chk"), 1000000, "the pay left the account again");
  assert.equal(M.liveSlips(n).length, 0, "the payslip no longer counts");
  assert.equal(M.incomeBySource(n, { from: "2026-10-01", to: "2026-10-31" }).total, 0);
  assert.equal(M.incomeWithoutPayslip(n, { from: "2026-10-01", to: "2026-10-31" }).length, 0, "and the pair is not listed as pay without a payslip");
  assert.equal(M.netPerPayday(n).length, 0);
});
test("Removing a payslip keeps a verified overtime transfer, drops a waiting draft, and a removed payslip can be added again", () => {
  let s = slip(base(), { printed_gross: 1200000, deposit: 800000, earnings: [{ kind: "basic", amount: 1000000 }, { kind: "overtime", amount: 200000, earned_month: "2026-10" }] });
  const d = M.overtimeDraft(s, "p1", { transaction_id: "ot-p1", emergency_account_id: "emg" }, NOW); assert.ok(d?.transaction); s = M.applyDrafts(s, [d]);
  const r = M.deletePayslip(s, "p1", NOW);
  assert.ok(!r.state.transactions.some((t) => t.id === "ot-p1"), "the waiting transfer draft is dropped (a draft may be deleted)");
  const v = M.verifyDraft(s, "ot-p1", NOW); const kept = M.deletePayslip(v.state, "p1", NOW);
  assert.equal(kept.keptTransfers, 1); assert.ok(kept.state.transactions.some((t) => t.id === "ot-p1" && t.status === "verified"));
  assert.ok(M.planPayslip(r.state, input({ id: "p2", transaction_id: "ptx2" }), NOW).ok, "the same payslip can be added again after it was removed");
});
test("Removing a payslip that waits as a draft deletes the draft as before", () => {
  const s = M.planPayslip(base(), input({ status: "draft" }), NOW).state, r = M.deletePayslip(s, "p1", NOW);
  assert.ok(!r.state.transactions.some((t) => t.id === "ptx1") && r.state.payslips.length === 0);
});

// ---------- removing an income entry ----------
test("Removing a verified income entry cancels it by a correction and keeps it", () => {
  const s = received(base(), "in1", 5000), before = verifiedBefore(s);
  const r = M.removeIncomeEntry(s, "in1", NOW);
  assert.ok(r.ok && stillThere(before, r.state));
  assert.ok(r.state.transactions.some((t) => t.id === "rev:in1" && t.reverses === "in1"));
  assert.equal(trial(r.state), 0); assert.equal(bal(r.state, "chk"), 1000000);
  assert.equal(M.incomeBySource(r.state, { from: "2026-10-01", to: "2026-10-31" }).total, 0);
  assert.equal(M.incomeWithoutPayslip(r.state, { from: "2026-10-01", to: "2026-10-31" }).length, 0);
  assert.equal(M.removeIncomeEntry(r.state, "in1", NOW).ok, false, "a removed entry cannot be removed again");
});

// ---------- changing a payslip ----------
test("Changing the pay of a verified payslip reverses the old pay entry once and makes a new one; the old entry is untouched", () => {
  const s = slip(), before = verifiedBefore(s);
  const r = M.updatePayslip(s, "p1", input({ printed_gross: 900000, printed_net: 700000, deposit: 700000, earnings: [{ kind: "basic", amount: 900000 }] }), NOW);
  assert.ok(r.ok, JSON.stringify(r.violations));
  const n = r.state;
  assert.ok(stillThere(before, n), "the old pay entry is exactly as it was");
  assert.ok(n.transactions.some((t) => t.id === "rev:ptx1" && t.reverses === "ptx1"));
  const p = n.payslips.find((x) => x.id === "p1"); assert.notEqual(p.transaction_id, "ptx1"); assert.equal(r.transaction.id, p.transaction_id);
  assert.equal(n.transactions.find((t) => t.id === p.transaction_id).status, "verified");
  assert.equal(trial(n), 0); assert.equal(bal(n, "chk"), 1000000 + 700000, "the account holds the new deposit once");
  assert.equal(M.liveSlips(n).length, 1); assert.equal(M.netPerPayday(n)[0].net, 700000);
  assert.equal(M.incomeBySource(n, { from: "2026-10-01", to: "2026-10-31" }).total, 700000);
  assert.equal(n.payslipRevisions.length, 1, "the figures it had are remembered");
});
test("Changing a verified payslip without changing its money leaves every entry alone", () => {
  const s = slip(), r = M.updatePayslip(s, "p1", input({ employer: "Co Ltd", earnings: [{ kind: "basic", amount: 1000000 }] }), NOW);
  assert.ok(r.ok);
  assert.deepEqual(r.state.transactions, s.transactions); assert.deepEqual(r.state.entries, s.entries);
  assert.equal(r.state.payslips[0].employer, "Co Ltd");
});
test("A payslip that waits as a draft is still edited in place, and a removed payslip cannot be changed", () => {
  const s = M.planPayslip(base(), input({ status: "draft" }), NOW).state;
  const r = M.updatePayslip(s, "p1", input({ printed_net: 700000, deposit: 700000, status: "draft" }), NOW);
  assert.ok(r.ok); assert.equal(r.state.payslips[0].transaction_id, "ptx1"); assert.ok(!r.state.transactions.some((t) => t.reverses));
  const gone = M.deletePayslip(slip(), "p1", NOW).state;
  assert.equal(M.updatePayslip(gone, "p1", input(), NOW).ok, false);
});

test("A removed payslip nets to nothing in the month its pay was counted, even when the pay day is in the next month", () => {
  const s = slip(base(), { period_from: "2026-09-16", period_to: "2026-09-30", pay_date: "2026-10-05" }), gone = M.deletePayslip(s, "p1", NOW).state;
  assert.equal(M.incomeBySource(s, { from: "2026-09-01", to: "2026-09-30" }).total + M.incomeBySource(s, { from: "2026-10-01", to: "2026-10-31" }).total, 800000);
  for (const [from, to] of [["2026-09-01", "2026-09-30"], ["2026-10-01", "2026-10-31"]]) assert.equal(M.incomeBySource(gone, { from, to }).total, 0, from);
});
test("a payslip whose pay is cancelled is not counted in the base income or the payslip list, and the change keeps trial balance zero", () => {
  let s = base();
  for (const [id, d] of [["a", "2026-08-07"], ["b", "2026-08-21"], ["c", "2026-09-04"]]) s = slip(s, { id, transaction_id: "t" + id, period_from: d, period_to: d, pay_date: d, period_type: "Bi-Week" });
  const before = M.baseIncome(s);
  const gone = M.deletePayslip(s, "c", NOW).state;
  assert.equal(M.liveSlips(gone).length, 2); assert.equal(M.netPerPayday(gone).length, 2); assert.equal(trial(gone), 0);
  assert.ok(before.text.startsWith("Last 3 payslips") && M.baseIncome(gone).text.startsWith("Last 2 payslips"));
});

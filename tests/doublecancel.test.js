import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as M from "../src/model/index.js";
import { makeState, account } from "./fixtures.js";

// The owner's real-phone bug (Oct 31): October showed Unlogged 20,007.94 inside spending. Invented figures in the same SHAPE: seven weekly counts of Oct 29 booked as spending
// (cash, a card, a payroll account, three pockets, a main account) and one earlier count of 993.00 that was cancelled TWICE (before #271 a stale screen could add a second
// cancelling entry). The repair must hold the seven counts out of spending AND put the second cancellation right, with every balance unchanged and a record of each step.
const NOW = new Date("2026-10-31T03:00:00Z"), TS = "2026-10-01T09:00:00.000+08:00", UNL = "unl";
const peso = (c) => (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
const GAPS = { cash: 125000, card: 340050, payroll: 500000, p1: 210025, p2: 180000, p3: 95019, main: 650000 };
function build(variant = "other-id") {
  const s = makeState(), pocket = (id) => account({ id, name: "Pocket " + id, class: "asset", role: "pocket", bank: "gotyme", opening_balance: 5000000, opening_date: "2026-01-01" });
  s.accounts = [account({ id: "cash", name: "Cash", class: "asset", opening_balance: 3000000, opening_date: "2026-01-01" }), account({ id: "card", name: "Test Card", class: "liability", opening_balance: 0, opening_date: "2026-01-01" }),
    account({ id: "payroll", name: "Payroll", class: "asset", opening_balance: 9000000, opening_date: "2026-01-01" }), pocket("p1"), pocket("p2"), pocket("p3"),
    account({ id: "main", name: "Main", class: "asset", opening_balance: 20000000, opening_date: "2026-01-01" })];
  s.categories = [{ id: "food", name: "Food", kind: "expense" }, { id: UNL, name: "Unlogged", kind: "expense" }, { id: "pay", name: "Pay", kind: "income" }];
  s.checkIns = [];
  s.transactions.push({ id: "groc", date: "2026-10-05", payee: "Grocer", memo: "", status: "verified", source: "manual", created_at: TS, verified_at: TS });
  s.entries.push({ transaction_id: "groc", category_id: "food", amount: 3733241 }, { transaction_id: "groc", account_id: "payroll", amount: -3733241 });
  const count = (st, id, date, account_id, counted) => { const p = M.planCheckIn(st, { id: "ci" + id, transaction_id: id, date, account_id, counted_balance: counted, unlogged_category_id: UNL }, NOW); assert.ok(p.ok, JSON.stringify(p.violations)); return { ...st, checkIns: [...st.checkIns, p.checkIn], transactions: [...st.transactions, p.transaction], entries: [...st.entries, ...p.entries] }; };
  const ledgerOf = (st, id) => { const a = st.accounts.find((x) => x.id === id); return M.ledgerBalanceFor(a, M.countedEntries(st)); };
  let st = count(s, "C", "2026-10-13", "cash", ledgerOf(s, "cash") - 99300);
  st = M.applyCorrection(st, M.planCorrection(st, { id: "C", redo_id: "redoC", today: "2026-10-13" }, NOW));
  const dupId = variant === "same-id" ? "rev:C" : "rev:C:again", dupDate = variant === "same-id" ? "2026-10-13" : "2026-10-20", orig = st.transactions.find((t) => t.id === "C");
  st = { ...st, transactions: [...st.transactions, { id: dupId, date: dupDate, payee: orig.payee, memo: "Correction of Weekly check-in", status: "verified", source: "correction", reverses: "C", created_at: TS, verified_at: TS }],
    entries: [...st.entries, ...st.entries.filter((e) => e.transaction_id === "C").map(({ transaction_id, ...e }) => ({ ...e, transaction_id: dupId, amount: -e.amount }))] };
  for (const [id, g] of Object.entries(GAPS)) { const a = st.accounts.find((x) => x.id === id); st = count(st, "g" + id, "2026-10-29", id, ledgerOf(st, id) + (a.class === "liability" ? g : -g)); }
  return st;
}
const month = (s) => M.spendingByCategory(s, { month: "2026-10" }), unl = (s) => month(s).rows.find((r) => r.category_id === UNL)?.amount ?? 0;
const bals = (s) => Object.fromEntries(s.accounts.map((a) => [a.id, M.naturalBalance(a, M.countedEntries(s))]));
const trial = (s) => s.entries.reduce((a, e) => a + e.amount, 0);
// how many cancelling entries of each entry still stand (a second one that was itself put right does not stand)
const standing = (s) => { const n = new Map(); for (const t of s.transactions) if (t.reverses != null) n.set(t.reverses, (n.get(t.reverses) ?? 0) + 1); for (const t of s.transactions) if (t.restores != null) n.set(t.restores, (n.get(t.restores) ?? 0) - 1); return n; };

for (const variant of ["other-id", "same-id"]) {
  test(`the owner's shape (${variant}): This month 57,340.35 and Unlogged 20,007.94 become 37,332.41 and 0.00; every balance is the same`, () => {
    const s = build(variant);
    assert.equal(peso(month(s).total), "57,340.35"); assert.equal(peso(unl(s)), "20,007.94");
    assert.deepEqual(M.extraCancellations(s).map((x) => x.target), ["C"], "one entry is cancelled twice");
    const plan = M.planGapRepair(s, { now: NOW });
    assert.ok(plan.ok, JSON.stringify(plan.violations)); assert.equal(plan.gapCount, 7); assert.equal(plan.extraCount, 1); assert.equal(plan.count, 8); assert.deepEqual(plan.skipped, []);
    assert.deepEqual(plan.months.map((m) => [m.month, peso(m.before), peso(m.after)]), [["2026-10", "57,340.35", "37,332.41"]]);
    const next = M.applyGapRepair(s, plan);
    assert.equal(peso(month(next).total), "37,332.41"); assert.equal(unl(next), 0, "nothing of Unlogged is left in spending");
    assert.deepEqual(bals(next), bals(s), "every account balance is exactly what it was"); assert.equal(trial(next), 0);
    assert.deepEqual(next.transactions.slice(0, s.transactions.length), s.transactions, "no old entry was edited or removed"); assert.deepEqual(next.entries.slice(0, s.entries.length), s.entries);
    const undo = next.transactions.find((t) => t.restores === "C");
    assert.ok(undo && undo.source === "correction" && undo.status === "verified", "the second cancellation is put right by a visible correction, with a record of which entry it concerns");
    assert.ok(next.transactions.some((t) => t.id === "held:" + undo.id && t.adjustment === true), "and its amount is kept apart as not yet explained, not spent");
    assert.deepEqual(M.unexplainedGaps(next).filter((g) => g.account_id === "cash").map((g) => [g.kind, peso(g.amount)]).sort(), [["extra", "993.00"], ["short", "1,250.00"]]);
    assert.deepEqual(M.ledgerProblems(next), [], "the ledger check is clean afterwards");
    assert.ok([...standing(next).values()].every((n) => n <= 1), "no entry stays cancelled twice");
    assert.equal(M.applyGapRepair(next, plan), next, "a repeat tap changes nothing");
    assert.equal(M.planGapRepair(next, { now: NOW }).count, 0); assert.equal(M.repairStatus(next).candidates, 0);
  });
}

test("a second cancellation can be put right only when it really is a second one, and only with the exact legs", () => {
  const s = build(), undo = (extra = {}, legs) => { const t = { id: "undo:C:1", date: "2026-10-20", payee: "Weekly check-in", memo: "x", status: "verified", source: "correction", restores: "C", created_at: TS, verified_at: TS, ...extra };
    const c = s.entries.filter((e) => e.transaction_id === "C").map(({ transaction_id, ...e }) => ({ ...e, transaction_id: t.id }));
    return M.checkTransactionSave(s, { transaction: t, entries: legs ?? c }); };
  assert.equal(undo().ok, true, "C is cancelled twice: one can be put back");
  assert.ok(undo({}, [{ transaction_id: "undo:C:1", account_id: "cash", amount: 99300 }, { transaction_id: "undo:C:1", category_id: UNL, amount: -99300 }]).violations.some((v) => v.code === "RESTORE_NOT_EXACT"), "the opposite legs (a plain second cancellation) are refused: only the entry's own legs put it right");
  assert.ok(undo({ restores: "groc" }, s.entries.filter((e) => e.transaction_id === "groc").map((e) => ({ ...e, transaction_id: "undo:C:1" }))).violations.some((v) => v.code === "RESTORE_NOT_NEEDED"), "an entry cancelled only once or never is refused");
  assert.ok(undo({ restores: "nope" }).violations.some((v) => v.code === "RESTORE_MISSING"));
  const once = { ...s, transactions: s.transactions.filter((t) => t.id !== "rev:C:again"), entries: s.entries.filter((e) => e.transaction_id !== "rev:C:again") };
  assert.ok(M.checkTransactionSave(once, { transaction: { id: "undo:C:1", date: "2026-10-20", payee: "Weekly check-in", memo: "x", status: "verified", source: "correction", restores: "C", created_at: TS, verified_at: TS }, entries: s.entries.filter((e) => e.transaction_id === "C").map(({ transaction_id, ...e }) => ({ ...e, transaction_id: "undo:C:1" })) }).violations.some((v) => v.code === "RESTORE_NOT_NEEDED"), "an entry cancelled exactly once cannot have its only cancellation put back");
  assert.ok(M.checkTransactionSave(s, { transaction: { id: "bad", date: "2026-10-20", payee: "x", memo: "x", status: "verified", source: "correction", reverses: "rev:C:again", created_at: TS, verified_at: TS }, entries: [] }).violations.some((v) => v.code === "REVERSAL_OF_REVERSAL"), "cancelling a cancellation is still refused: the only way back is the second-cancellation correction");
});

test("a count that cannot be repaired is skipped and said, the rest is repaired; when nothing can run the status says why in plain words", () => {
  let s = build("other-id");
  const bad = { id: "gbad", date: "2026-10-29", payee: "Weekly check-in", memo: "Reconciliation: counted 1, ledger 2", status: "verified", source: "reconciliation", created_at: TS, verified_at: TS };
  s = { ...s, transactions: [...s.transactions, bad], entries: [...s.entries, { transaction_id: "gbad", account_id: "cash", amount: -500 }, { transaction_id: "gbad", category_id: UNL, amount: 400 }] };   // does not add to zero
  const plan = M.planGapRepair(s, { now: NOW });
  assert.ok(plan.ok); assert.equal(plan.gapCount, 7); assert.deepEqual(plan.skipped.map((x) => x.id), ["gbad"]); assert.ok(plan.skipped[0].code);
  const st = M.repairStatus(s); assert.equal(st.count, 8); assert.equal(st.skipped.length, 1);
  assert.match(st.note, /1 could not be repaired/);
  const alone = { ...makeState(), accounts: s.accounts, categories: s.categories, transactions: [s.transactions.find((t) => t.id === "groc"), bad], entries: [...s.entries.filter((e) => e.transaction_id === "groc"), { transaction_id: "gbad", account_id: "cash", amount: -500 }, { transaction_id: "gbad", category_id: UNL, amount: 400 }] };
  const none = M.repairStatus(alone);
  assert.equal(none.candidates, 1); assert.equal(none.count, 0);
  assert.ok(none.reason && /cannot/i.test(none.reason) && none.reason.length < 220 && none.action, "one plain sentence says why it cannot run, and what to do: " + none.reason);
  assert.equal(M.repairStatus(makeState()).candidates, 0); assert.equal(M.repairStatus(makeState()).reason, null);
});

test("the repair check text holds counts only: no name, no amount, no date", () => {
  const text = M.repairReport(build("same-id"));
  assert.match(text, /past counts booked as spending: 7/); assert.match(text, /cancelled twice: 1/); assert.match(text, /repeated entry numbers: 1/);
  assert.ok(!/\d{1,3}(,\d{3})*\.\d\d|2026-|Cash|Payroll|Grocer|Pocket/.test(text), "nothing from the ledger is in it: " + text);
});

test("SAFETY COPY: the repair keeps a copy of the ledger first, reads it back, and stops if it cannot", async () => {
  const io = (o = {}) => { const p = { copies: [], text: null, writes: 0, ...o }; p.io = { readCopies: async () => p.copies, writeCopies: async (l) => { if (p.failCopy) return { local: false, idb: false }; if (!p.dropCopy) p.copies = l; return { local: true, idb: true }; }, writeLedger: async (t) => { p.writes++; p.text = t; return { local: true, idb: true }; } }; return p; };
  const cur = M.emptyLedger(); cur.rev = 5; cur.saved_at = TS; cur.state = build("same-id");
  const run = (p) => M.replaceWithCopy({ current: cur, next: M.nextLedger(cur, M.applyGapRepair(cur.state, M.planGapRepair(cur.state, { now: NOW })), cur.settings), io: p.io, meta: { at: "2026-10-31T12:00:00+08:00", from_version: cur.v, build: "test", kind: "repair" } });
  const ok = io(), r = await run(ok);
  assert.equal(r.ok, true); assert.equal(ok.copies.length, 1); assert.equal(ok.copies[0].kind, "repair"); assert.deepEqual(JSON.parse(ok.copies[0].text), cur, "the copy is the ledger exactly as it was"); assert.equal(M.copyHolds(ok.copies[0], cur), true);
  assert.equal(peso(month(JSON.parse(ok.text).state).total), "37,332.41");
  const a = io({ failCopy: true }), r1 = await run(a); assert.equal(r1.ok, false); assert.equal(a.writes, 0);
  const b = io({ dropCopy: true }), r2 = await run(b); assert.equal(r2.ok, false); assert.equal(b.writes, 0);
});

test("the Weekly review card NEVER hides silently: when there is something to repair it always shows, saying why when the repair cannot run", () => {
  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
  const card = app.slice(app.indexOf("function repairCardHtml()"), app.indexOf("// Held gaps that look like ONE move"));
  assert.match(card, /M\.repairStatus\(S\(\)\)/, "the card is drawn from the status, which counts the candidates themselves");
  assert.equal((card.match(/return ""/g) ?? []).length, 1, "the card returns nothing in ONE place only"); assert.match(card, /if \(!st\.candidates\) return "";/, "and that place is: nothing to repair at all");
  assert.doesNotMatch(card, /if \(!p\.ok \|\| !p\.count\) return ""/, "no early return that hides the card when the plan is invalid");
  assert.match(card, /st\.reason/, "the reason is shown"); assert.match(card, /copy-repair-check/, "and the check text can be copied");
  const win = app.slice(app.indexOf('} else if (sh.type === "repair") {'), app.indexOf('} else if (sh.type === "refund-repair") {'));
  assert.doesNotMatch(win, /Every past weekly count is already right[^]*candidates/, "the window does not say all is right when it is not");
  assert.match(win, /st\.reason/, "the window says why too");
});

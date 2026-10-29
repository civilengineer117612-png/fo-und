import { test } from "node:test";
import assert from "node:assert/strict";
import { repairableGaps, planGapRepair, applyGapRepair, matchHeldGaps, planGapMove, unexplainedGaps, spendingByCategory, naturalBalance, countedEntries, heldIds } from "../src/model/index.js";
import { makeState, account } from "./fixtures.js";

// Invented numbers, whole centavos (100000 is 1,000.00). OLD data, as the app made it before Oct 29: a count gap the owner did not explain was booked as unlogged
// SPENDING (a plain count); only a gap of extra money that was "just matched" carried the `adjustment` flag.
const TS = "2026-09-12T09:00:00.000+08:00", NOW = new Date("2026-10-29T12:00:00+08:00");
function ledger({ extra = [] } = {}) {
  const s = makeState();
  s.accounts = ["X", "Y", "Z"].map((id) => account({ id, name: "Test " + id, class: "asset", opening_balance: 1000000, opening_date: "2026-09-01" })).concat([account({ id: "CC", name: "Test Card", class: "liability", opening_balance: 0, opening_date: "2026-09-01" })]);
  s.categories = [{ id: "food", name: "Food", kind: "expense" }, { id: "unl", name: "Unlogged", kind: "expense" }, { id: "pay", name: "Pay", kind: "income" }];
  s.checkIns = [];
  const add = (id, date, memo, legs, flags = {}, status = "verified") => { s.transactions.push({ id, date, payee: "Weekly check-in", memo, status, source: "reconciliation", created_at: TS, verified_at: status === "verified" ? TS : undefined, ...flags }); s.entries.push(...legs.map((l) => ({ transaction_id: id, ...l }))); };
  s.transactions.push({ id: "lunch", date: "2026-09-10", payee: "Cafe", memo: "", status: "verified", source: "manual", created_at: TS, verified_at: TS });
  s.entries.push({ transaction_id: "lunch", category_id: "food", amount: 200000 }, { transaction_id: "lunch", account_id: "X", amount: -200000 });
  add("gX", "2026-09-12", "Reconciliation: counted 500000, ledger 800000", [{ account_id: "X", amount: -300000 }, { category_id: "unl", amount: 300000 }]);                       // short 3,000.00
  add("gY", "2026-09-12", "Reconciliation: counted 1300000, ledger 1000000", [{ account_id: "Y", amount: 300000 }, { category_id: "unl", amount: -300000 }], { adjustment: true });   // 3,000.00 extra, just matched
  add("gZ", "2026-09-13", "Reconciliation: counted 960000, ledger 1000000", [{ account_id: "Z", amount: -40000 }, { category_id: "unl", amount: 40000 }]);                         // short 400.00
  for (const e of extra) add(...e);
  return s;
}
const bal = (s, id) => naturalBalance(s.accounts.find((a) => a.id === id), countedEntries(s));
const month = (s, m = "2026-09") => spendingByCategory(s, { month: m }).total;
const balances = (s) => Object.fromEntries(s.accounts.map((a) => [a.id, bal(s, a.id)]));

test("CASE 9 repair: three old gaps (3,000.00 short, 3,000.00 extra, 400.00 short) become one proposed 3,000.00 move and 400.00 not yet explained", () => {
  const s = ledger();
  assert.equal(month(s), 200000 + 300000 + 40000, "before: the two shortfalls were counted as spending");
  assert.deepEqual(repairableGaps(s).map((t) => t.id).sort(), ["gX", "gZ"], "the extra one was already held; only the shortfalls are booked as spending");
  const plan = planGapRepair(s, { now: NOW });
  assert.ok(plan.ok, JSON.stringify(plan.violations));
  assert.deepEqual(plan.months, [{ month: "2026-09", count: 2, before: 540000, after: 200000, change: -340000 }], "spending lowered by 3,400.00, month by month");
  assert.equal(plan.lowered, 340000); assert.equal(plan.raised, 0);
  const next = applyGapRepair(s, plan);
  assert.equal(month(next), 200000, "after: just the lunch");
  assert.deepEqual(balances(next), balances(s), "every balance is exactly what it was");
  assert.deepEqual(next.transactions.slice(0, s.transactions.length), s.transactions, "no old entry was edited or removed");
  for (const id of ["gX", "gZ"]) {
    const rev = next.transactions.find((t) => t.id === "rev:" + id), held = next.transactions.find((t) => t.id === "held:" + id);
    assert.ok(rev && rev.reverses === id && rev.source === "correction" && rev.status === "verified", id + " is cancelled by a visible correction");
    assert.ok(held && held.adjustment === true && held.date === s.transactions.find((t) => t.id === id).date && held.memo.startsWith("Reconciliation:"), id + " is counted again, held, on the same date");
    assert.equal(next.entries.filter((e) => e.transaction_id === rev.id || e.transaction_id === held.id).reduce((n, e) => n + e.amount, 0), 0, "each new entry balances");
  }
  assert.deepEqual(unexplainedGaps(next).map((g) => [g.account_id, g.kind, g.amount]).sort(), [["X", "short", 300000], ["Y", "extra", 300000], ["Z", "short", 40000]]);
  const matches = matchHeldGaps(next);
  assert.deepEqual(matches.map((m) => [m.short.account_id, m.extra.account_id, m.amount]), [["X", "Y", 300000]], "one proposed 3,000.00 move; the 400.00 stays");
  const moved = planGapMove(next, matches[0], { move_id: "mv1", now: NOW });
  assert.ok(moved.ok, JSON.stringify(moved.violations));
  assert.deepEqual(balances(moved.state), balances(s), "still every balance as it was");
  assert.equal(month(moved.state), 200000, "and no spending");
  assert.deepEqual(unexplainedGaps(moved.state).map((g) => [g.account_id, g.amount]), [["Z", 40000]], "only 400.00 is left not yet explained");
  const mv = moved.state.transactions.find((t) => t.id === "mv1");
  assert.equal(mv.status, "draft"); assert.deepEqual(moved.state.entries.filter((e) => e.transaction_id === "mv1").map((e) => [e.account_id, e.amount]).sort(), [["X", -300000], ["Y", 300000]]);
  assert.ok(heldIds(moved.state).has("rev:held:gX") && heldIds(moved.state).has("rev:gY"), "the cancelling entries are held too");
});

test("a repeat changes nothing: the same state comes back, and nothing is left to repair", () => {
  const s = ledger(), plan = planGapRepair(s, { now: NOW }), once = applyGapRepair(s, plan);
  assert.equal(applyGapRepair(once, plan), once);
  assert.equal(planGapRepair(once, { now: NOW }).transactions.length, 0, "nothing left to repair");
  assert.equal(applyGapRepair(once, planGapRepair(once, { now: NOW })), once);
});

test("found money that was booked as lowering spending is put right too, and the table says it raised spending", () => {
  const s = ledger({ extra: [["gE", "2026-09-14", "Reconciliation: counted 1100000, ledger 1000000", [{ account_id: "Y", amount: 100000 }, { category_id: "unl", amount: -100000 }]]] });
  assert.equal(month(s), 440000, "before: 1,000.00 of found money lowered it");
  const plan = planGapRepair(s, { now: NOW });
  assert.deepEqual(plan.months, [{ month: "2026-09", count: 3, before: 440000, after: 200000, change: -240000 }]);
  const t = { ...s, transactions: s.transactions.filter((x) => !["gX", "gZ"].includes(x.id)), entries: s.entries.filter((x) => !["gX", "gZ"].includes(x.transaction_id)) };
  const p2 = planGapRepair(t, { now: NOW });
  assert.deepEqual([p2.raised, p2.lowered], [100000, 0], "a plain extra gap RAISES spending when it is repaired");
  assert.equal(month(applyGapRepair(t, p2)), 200000);
});

test("only a verified, uncancelled, unheld count gap is repaired: not an ordinary entry, a draft, a held or cancelled gap, a cancelling entry or the posted-by-the-bank pair", () => {
  const s = ledger({ extra: [
    ["dr", "2026-09-15", "Reconciliation: counted 1, ledger 2", [{ account_id: "Z", amount: -1000 }, { category_id: "unl", amount: 1000 }], {}, "draft"],
    ["pb", "2026-09-15", "Posted by the bank: x1", [{ account_id: "CC", amount: 5000, card_state: "pending" }, { account_id: "CC", amount: -5000, card_state: "posted" }]],
    ["gC", "2026-09-16", "Reconciliation: counted 1, ledger 2", [{ account_id: "Z", amount: -2000 }, { category_id: "unl", amount: 2000 }]],
    ["rev:gC", "2026-09-16", "Correction of Weekly check-in", [{ account_id: "Z", amount: 2000 }, { category_id: "unl", amount: -2000 }], { source: "correction", reverses: "gC" }],
  ] });
  assert.deepEqual(repairableGaps(s).map((t) => t.id).sort(), ["gX", "gZ"]);
});

test("a card gap is repaired with its card state kept, and a card is never part of a proposed move", () => {
  const s = ledger({ extra: [["gK", "2026-09-17", "Reconciliation: counted 25000, ledger 0", [{ account_id: "CC", amount: -25000, card_state: "posted" }, { category_id: "unl", amount: 25000 }]],
    ["gL", "2026-09-17", "Reconciliation: counted 1300000, ledger 1000000", [{ account_id: "Y", amount: 25000 }, { category_id: "unl", amount: -25000 }], { adjustment: true }]] });
  const next = applyGapRepair(s, planGapRepair(s, { now: NOW }));
  assert.ok(next.entries.filter((e) => e.transaction_id === "held:gK").every((e) => e.account_id !== "CC" || e.card_state === "posted"));
  assert.deepEqual(balances(next), balances(s));
  assert.equal(matchHeldGaps(next).filter((m) => m.short.account_id === "CC" || m.extra.account_id === "CC").length, 0);
});

test("matching: exact amounts, within 3 days, pockets of one bank first, each gap once", () => {
  const mk = (gaps, accounts) => { const s = ledger(); s.transactions = []; s.entries = []; if (accounts) s.accounts = accounts;
    gaps.forEach(([id, date, acct, amt]) => { s.transactions.push({ id, date, payee: "Weekly check-in", memo: "Reconciliation: x", status: "verified", source: "reconciliation", adjustment: true, created_at: TS, verified_at: TS });
      s.entries.push({ transaction_id: id, account_id: acct, amount: -amt }, { transaction_id: id, category_id: "unl", amount: amt }); }); return s; };
  assert.equal(matchHeldGaps(mk([["a", "2026-09-12", "X", 100000], ["b", "2026-09-15", "Y", -100000]])).length, 1, "3 days apart");
  assert.equal(matchHeldGaps(mk([["a", "2026-09-12", "X", 100000], ["b", "2026-09-16", "Y", -100000]])).length, 0, "4 days apart");
  assert.equal(matchHeldGaps(mk([["a", "2026-09-12", "X", 100000], ["b", "2026-09-12", "Y", -100001]])).length, 0, "1 centavo off: no fuzzy matching");
  assert.equal(matchHeldGaps(mk([["a", "2026-09-12", "X", 100000], ["b", "2026-09-12", "X", -100000]])).length, 0, "the same account cannot be both ends");
  assert.equal(matchHeldGaps(mk([["a", "2026-09-12", "X", 100000], ["b", "2026-09-12", "Y", -100000], ["c", "2026-09-12", "Z", -100000]])).length, 1, "one extra cannot be used twice");
  const pk = [account({ id: "AW", name: "Wallet", class: "asset" }), account({ id: "P1", name: "P1", class: "asset", role: "pocket", bank: "gotyme" }), account({ id: "P2", name: "P2", class: "asset", role: "pocket", bank: "gotyme" })];
  const m = matchHeldGaps(mk([["a", "2026-09-12", "P1", 100000], ["b", "2026-09-12", "AW", -100000], ["c", "2026-09-12", "P2", -100000]], pk));
  assert.deepEqual(m.map((x) => [x.short.account_id, x.extra.account_id]), [["P1", "P2"]], "the two pockets of one bank first, though the wallet sorts first");
});

test("confirming a match twice, or after one gap was already cancelled, is refused", () => {
  const s = applyGapRepair(ledger(), planGapRepair(ledger(), { now: NOW })), m = matchHeldGaps(s)[0];
  const once = planGapMove(s, m, { move_id: "mv1", now: NOW });
  assert.ok(once.ok);
  const twice = planGapMove(once.state, m, { move_id: "mv2", now: NOW });
  assert.equal(twice.ok, false); assert.equal(twice.violations[0].code, "ALREADY_CANCELLED");
});

// ---- the safety copy: repairing past data first keeps the whole ledger as it is, read back, and stops if it cannot ----
import { readFileSync } from "node:fs";
import { replaceWithCopy, copyHolds, emptyLedger, nextLedger, LEDGER_VERSION } from "../src/model/index.js";

function phone(opts = {}) {
  const p = { copies: [], text: null, ledgerWrites: 0, failCopy: false, dropCopy: false, ...opts };
  p.io = {
    readCopies: async () => p.copies,
    writeCopies: async (list) => { if (p.failCopy) return { local: false, idb: false }; if (!p.dropCopy) p.copies = list; return { local: true, idb: true }; },
    writeLedger: async (text) => { p.ledgerWrites++; p.text = text; return { local: true, idb: true }; },
  };
  return p;
}
const before = () => { const l = emptyLedger(); l.rev = 5; l.saved_at = TS; l.state = ledger(); return l; };
const repairRun = (p, current = before()) => {
  const plan = planGapRepair(current.state, { now: NOW });
  const next = nextLedger(current, applyGapRepair(current.state, plan), current.settings);
  return replaceWithCopy({ current, next, io: p.io, meta: { at: "2026-10-29T12:00:00+08:00", from_version: current.v, build: "test", kind: "repair" } }).then((r) => ({ r, next }));
};

test("SAFETY COPY: before the repair the whole ledger is kept as a copy, it reads back to the last field, and only then is the ledger replaced", async () => {
  const p = phone(), cur = before();
  const { r, next } = await repairRun(p, cur);
  assert.equal(r.ok, true); assert.equal(r.copied, true);
  assert.equal(p.copies.length, 1);
  assert.equal(p.copies[0].kind, "repair", "the copy says it is from before a repair");
  assert.deepEqual(JSON.parse(p.copies[0].text), cur, "the copy is the ledger exactly as it was, every entry and every centavo");
  assert.equal(copyHolds(p.copies[0], cur), true);
  assert.deepEqual(JSON.parse(p.text).state, next.state, "and the ledger is now the repaired one");
  assert.ok(JSON.parse(p.text).state.transactions.length > cur.state.transactions.length);
});

test("SAFETY COPY: a copy that cannot be saved, or that does not read back, stops the repair: the ledger is not written", async () => {
  const a = phone({ failCopy: true }), { r: r1 } = await repairRun(a);
  assert.equal(r1.ok, false); assert.equal(r1.stage, "copy"); assert.equal(a.ledgerWrites, 0);
  const b = phone({ dropCopy: true }), { r: r2 } = await repairRun(b);
  assert.equal(r2.ok, false); assert.equal(r2.stage, "check"); assert.equal(b.ledgerWrites, 0, "the write said yes but nothing was kept: still not replaced");
});

test("SAFETY COPY: the screen's repair goes only through the copy, with the pre-upgrade copy list, and says so", () => {
  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
  const run = app.slice(app.indexOf('case "repair-run": {'), app.indexOf('case "past-move": {'));
  assert.match(run, /M\.replaceWithCopy\(\{ current: ledger, next, io: \{ readCopies, writeCopies, writeLedger/, "the repair reads and writes the same copy list as an upgrade");
  assert.match(run, /kind: "repair"/);
  assert.ok(!/await commit\(/.test(run) && !/await writeBoth\(JSON/.test(run), "the repair never saves the ledger by any other way");
  assert.match(run, /if \(!r\.ok\)[^]*?break;/, "a failed copy stops before the ledger is replaced");
  assert.match(app, /c\.kind === "repair"/, "Setup names the copy from before the repair");
  assert.equal(LEDGER_VERSION, 10, "the repair adds entries only: the data version is unchanged");
});

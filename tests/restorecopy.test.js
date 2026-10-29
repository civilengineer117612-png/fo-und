import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { replaceWithCopy, copyHolds, holdsData, restorableCopy, emptyLedger, LEDGER_VERSION } from "../src/model/index.js";

// Invented numbers only. Whole centavos: 15000 is 150.00.
// Ledger A (the phone now): Food 150.00, Transport 45.00, Rent 3,000.00. Ledger B (an older backup): Food 150.00, Transport 45.00.
const TS = "2026-10-01T09:00:00.000+08:00";
const ENTRIES = { food: ["Food", 15000], transport: ["Transport", 4500], rent: ["Rent", 300000] };
function ledger(ids, rev) {
  const l = emptyLedger();
  l.rev = rev; l.saved_at = TS;
  l.state.accounts = [{ id: "cash", name: "Test Cash", class: "asset", role: "", hidden_by_default: false, archived: false, opening_balance: 1000000, opening_date: "2026-09-01" }];
  for (const id of ids) {
    const [cat, amount] = ENTRIES[id];
    l.state.transactions.push({ id: "t-" + id, date: "2026-10-01", payee: cat, memo: "", status: "verified", source: "manual", created_at: TS, verified_at: TS });
    l.state.entries.push({ transaction_id: "t-" + id, category_id: "cat-" + id, amount }, { transaction_id: "t-" + id, account_id: "cash", amount: -amount });
  }
  return l;
}
const A = () => ledger(["food", "transport", "rent"], 7), B = () => ledger(["food", "transport"], 4);

// A fake phone: two lists of copies (kept apart), the ledger text, and switches for the failures to simulate.
function phone(opts = {}) {
  const p = { restore: opts.restore ?? [], preupgrade: opts.preupgrade ?? [], ledgerText: null, reads: 0, writes: 0, ledgerWrites: 0, failWrite: false, dropWrite: false, garbleRead: false, throwWrite: false };
  p.io = {
    readCopies: async () => { p.reads++; return p.garbleRead ? p.restore.map((c) => ({ ...c, text: c.text.replace(/"amount":15000/, '"amount":15001') })) : p.restore; },
    writeCopies: async (list) => { p.writes++; if (p.throwWrite) throw new Error("disk"); if (p.failWrite) return { local: false, idb: false }; if (!p.dropWrite) p.restore = list; return { local: true, idb: true }; },
    writeLedger: async (text) => { p.ledgerWrites++; p.ledgerText = text; return { local: true, idb: true }; },
  };
  return p;
}
const META = (at) => ({ at, from_version: LEDGER_VERSION, build: "test" });
const restoreB = (p, current = A(), next = B(), at = "2026-10-29T10:00:00+08:00") => replaceWithCopy({ current, next, io: p.io, meta: META(at) });

test("restoring B over A: the ledger becomes B exactly, and A is kept as a restore copy, read back, to the last field", async () => {
  const p = phone(), a = A();
  const r = await restoreB(p, a, B());
  assert.equal(r.ok, true); assert.equal(r.copied, true);
  assert.deepEqual(JSON.parse(p.ledgerText), B(), "the ledger is B, nothing else");
  assert.equal(p.restore.length, 1);
  assert.deepEqual(JSON.parse(p.restore[0].text), a, "the copy is A, every field, every centavo");
  assert.equal(p.reads, 2, "the list was read once to add to it and once more to check what was saved");
  assert.equal(p.restore[0].from_version, LEDGER_VERSION);
});

test("the copy is saved and checked BEFORE the ledger is replaced", async () => {
  const order = [], p = phone(), io = { readCopies: async () => { order.push("read"); return p.restore; },
    writeCopies: async (l) => { order.push("copy"); p.restore = l; return { local: true, idb: true }; }, writeLedger: async () => { order.push("replace"); return { local: true, idb: true }; } };
  await replaceWithCopy({ current: A(), next: B(), io, meta: META("x") });
  assert.deepEqual(order, ["read", "copy", "read", "replace"]);
});

test("Put it back: the ledger is A exactly again, and B is now kept too, so putting back can be undone", async () => {
  const p = phone(), a = A();
  await restoreB(p, a, B());
  const current = JSON.parse(p.ledgerText);                                     // the phone now holds B
  const back = restorableCopy(p.restore[0], current.rev);                       // what "Put it back" writes
  const r = await replaceWithCopy({ current, next: back, io: p.io, meta: META("2026-10-29T11:00:00+08:00") });
  assert.equal(r.ok, true);
  const now = JSON.parse(p.ledgerText);
  assert.deepEqual({ v: now.v, state: now.state, settings: now.settings }, { v: a.v, state: a.state, settings: a.settings }, "A again, to the last field");
  assert.ok(now.rev > current.rev, "stamped newer than what was there, so it wins if the two stores ever disagree");
  assert.deepEqual(JSON.parse(p.restore[0].text).state, B().state, "B is the newest copy");
  assert.equal(p.restore.length, 2);
});

test("only the last two restore copies are kept, newest first, and the list of copies from before an upgrade is not touched", async () => {
  const pre = [{ at: "u1", text: "{}" }, { at: "u2", text: "{}" }], p = phone({ preupgrade: pre });
  for (let i = 0; i < 4; i++) await restoreB(p, ledger(["food", "transport", "rent"].slice(0, 1 + (i % 3)), 10 + i), B(), "r" + i);
  assert.equal(p.restore.length, 2, "never more than two");
  assert.deepEqual(p.restore.map((c) => c.at), ["r3", "r2"], "the newest first, the oldest pushed out");
  assert.deepEqual(p.preupgrade, pre, "the pre-upgrade copies are exactly as they were");
});

test("a copy that cannot be saved stops the restore: the ledger is not replaced", async () => {
  for (const how of ["failWrite", "throwWrite"]) {
    const p = phone(); p[how] = true;
    const r = await restoreB(p);
    assert.equal(r.ok, false, how); assert.equal(r.stage, "copy");
    assert.match(r.message, /not replaced.*safety copy.*could not be saved.*Nothing was changed/s);
    assert.equal(p.ledgerWrites, 0, "the ledger was never written");
  }
});

test("a copy that does not match when read back stops the restore: the ledger is not replaced", async () => {
  const p = phone(); p.garbleRead = true;
  const r = await restoreB(p);
  assert.equal(r.ok, false); assert.equal(r.stage, "check");
  assert.match(r.message, /not replaced.*did not match/s);
  assert.equal(p.ledgerWrites, 0);
  const q = phone(); q.dropWrite = true;   // the write says yes but nothing was kept
  const r2 = await restoreB(q);
  assert.equal(r2.ok, false); assert.equal(r2.stage, "check"); assert.equal(q.ledgerWrites, 0);
});

test("one of the two stores taking the copy is enough, as for the copies kept before an upgrade", async () => {
  const p = phone(); const io = { ...p.io, writeCopies: async (l) => { p.restore = l; return { local: false, idb: true }; } };
  const r = await replaceWithCopy({ current: A(), next: B(), io, meta: META("x") });
  assert.equal(r.ok, true);
});

test("an empty phone has nothing to lose: no copy is made, the data goes in, and there is nothing to put back", async () => {
  const p = phone(), r = await replaceWithCopy({ current: emptyLedger(), next: B(), io: p.io, meta: META("x") });
  assert.equal(r.ok, true); assert.equal(r.copied, false);
  assert.equal(p.writes, 0); assert.equal(p.restore.length, 0); assert.deepEqual(JSON.parse(p.ledgerText), B());
  assert.equal(holdsData(emptyLedger()), false); assert.equal(holdsData(A()), true);
});

test("restoring again while the newest copy already holds this data does not add a second copy of it", async () => {
  const p = phone(), a = A();
  await restoreB(p, a, B(), "r1");
  const again = await replaceWithCopy({ current: { ...a, rev: 99, saved_at: "later" }, next: B(), io: p.io, meta: META("r2") });
  assert.equal(again.ok, true, "the same data with a newer save stamp is still the same data, so the check passes");
  assert.equal(p.restore.length, 1, "the same data is kept once, so an older copy is not pushed out by a repeat");
  assert.equal(copyHolds(p.restore[0], a), true);
});

test("the restore copies have their own names in storage, and every replacement of the ledger goes through the safe path", () => {
  const store = readFileSync(new URL("../app/store.js", import.meta.url), "utf8");
  assert.match(store, /RESTORE_KEY = "financialTracker\.restorecopy"/);
  assert.match(store, /RESTORE_KEY = "financialTracker\.trial\.restorecopy"/, "the trial copy keeps its own, so it can never touch a real ledger");
  assert.match(store, /readRestoreCopies = \(\) => readList\(RESTORE_KEY, "restore-copies"\)/);
  assert.match(store, /writeRestoreCopies = \(copies\) => writeList\(RESTORE_KEY, "restore-copies", copies\)/);
  assert.match(store, /readCopies = \(\) => readList\(COPIES_KEY, "copies"\)/, "the pre-upgrade list keeps its names");
  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(app, /const restoreIo = \{ readCopies: readRestoreCopies, writeCopies: writeRestoreCopies,/, "a restore reads and writes the restore list, never the pre-upgrade one");
  const body = (name) => app.slice(app.indexOf(name), app.indexOf("\n}\n", app.indexOf(name)));
  assert.ok(body("async function restoreNow()").includes("replaceLedger("), "restoring a backup goes through the safe path");
  assert.ok(body("async function putBack()").includes("replaceLedger("), "putting back goes through it too");
  assert.match(app, /case "restore-copy": \{[^]*?await replaceLedger\(M\.restorableCopy\(c, ledger\.rev\)/, "and so does the copy from before an update");
  assert.ok(!body("async function restoreNow()").includes("writeBoth("), "no replacement of the ledger writes it directly");
  assert.ok(!/case "restore-copy": \{[^]*?await writeBoth\(JSON\.stringify\(M\.restorableCopy/.test(app), "the old direct write is gone");
});

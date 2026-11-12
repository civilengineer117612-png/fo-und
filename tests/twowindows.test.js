import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ledgerHead, mayOverwrite, emptyLedger, nextLedger, CHANGED_ELSEWHERE } from "../src/model/index.js";

// TWO WINDOWS (owner, Nov 12, L1): with the app open in two tabs or windows, the second save used to replace the first without a word (both said "Saved").
// A window may now save only on top of the ledger it loaded. Every figure here is invented.
const AT = (s) => new Date("2026-11-12T03:00:" + s + "Z");
const text = (l) => JSON.stringify(l);
const grow = (l, payee, sec) => nextLedger(l, { ...l.state, transactions: [...l.state.transactions, { id: "t-" + payee, date: "2026-11-12", payee, memo: "", status: "draft", source: "manual", created_at: "2026-11-12T11:00:00.000+08:00" }] }, l.settings, AT(sec));

test("the head of a stored ledger is read from its first characters: its revision and when it was saved", () => {
  const l = grow(emptyLedger(), "Lunch", "01");
  assert.deepEqual(ledgerHead(text(l)), { rev: l.rev, saved_at: l.saved_at });
  assert.equal(ledgerHead(null), null, "nothing stored");
  assert.equal(ledgerHead(""), null);
  assert.equal(ledgerHead("not a ledger"), null, "unreadable text has no head");
  assert.deepEqual(ledgerHead(JSON.stringify({ state: {}, saved_at: "2026-11-01T08:00:00.000+08:00", rev: 7, v: 3 })), { rev: 7, saved_at: "2026-11-01T08:00:00.000+08:00" }, "another key order is still read");
  const big = text({ ...l, state: { ...l.state, memo: "x".repeat(200000) } });
  assert.deepEqual(ledgerHead(big), { rev: l.rev, saved_at: l.saved_at }, "a large ledger is read the same way");
});

test("a window may write over an empty store, over exactly what it last saw, or over an older copy; never over a newer save", () => {
  const base = { rev: 5, saved_at: "2026-11-12T11:00:00.000+08:00" };
  assert.equal(mayOverwrite(null, base), true, "an empty store");
  assert.equal(mayOverwrite({ ...base }, base), true, "what this window last saw");
  assert.equal(mayOverwrite({ rev: 4, saved_at: "2026-11-11T09:00:00.000+08:00" }, base), true, "the store is behind this window (a copy being repaired)");
  assert.equal(mayOverwrite({ rev: 6, saved_at: "2026-11-12T11:00:05.000+08:00" }, base), false, "another window saved a newer revision");
  assert.equal(mayOverwrite({ rev: 5, saved_at: "2026-11-12T11:00:05.000+08:00" }, base), false, "the same revision saved at another moment is another window's save");
  assert.equal(mayOverwrite({ rev: 1, saved_at: "x" }, null), false, "a window that started from an empty store finds it filled");
  assert.equal(mayOverwrite(null, null), true);
});

// A small stand-in for the phone's two stores, shared by every "window". Like IndexedDB, it runs transactions one after another, whichever window made them.
function fakeStores() {
  const dbs = new Map(), ls = new Map(); let chain = Promise.resolve();
  const mkDb = (name) => { const stores = dbs.get(name); return { objectStoreNames: { contains: (n) => stores.has(n) }, createObjectStore: (n) => stores.set(n, new Map()), close() {},
    transaction(n) { const tx = {}, pending = [];
      const st = { get(k) { const r = {}; pending.push(() => { r.result = stores.get(n).get(k); r.onsuccess?.(); }); return r; }, put(v, k) { const r = {}; pending.push(() => { stores.get(n).set(k, v); r.onsuccess?.(); }); return r; } };
      tx.objectStore = () => st;
      chain = chain.then(async () => { await null; while (pending.length) pending.shift()(); tx.oncomplete?.(); });
      return tx; } }; };
  globalThis.indexedDB = { open(name) { const req = {}; queueMicrotask(() => { const fresh = !dbs.has(name); if (fresh) dbs.set(name, new Map()); req.result = mkDb(name); if (fresh) req.onupgradeneeded?.(); req.onsuccess?.(); }); return req; } };
  globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, v), removeItem: (k) => ls.delete(k) };
  return { idb: () => dbs.get("financialTracker")?.get("kv")?.get("ledger") ?? null, local: () => ls.get("financialTracker.ledger") ?? null };
}
let n = 0;
const windowOf = () => import("../app/store.js?window=" + ++n);   // each import is its own window: its own memory, the same stores

test("two windows on one ledger: the second save is refused and nothing of it is written, in either store", async () => {
  const stores = fakeStores(), start = grow(emptyLedger(), "Start", "00");
  const boot = await windowOf(); assert.deepEqual(await boot.writeBoth(text(start)), { local: true, idb: true }, "a start-up write is not judged (the app has not started)");
  const A = await windowOf(), B = await windowOf(); A.setBase(start); B.setBase(start);
  const a1 = grow(start, "Tab A lunch", "05"), b1 = grow(start, "Tab B dinner", "09");
  assert.deepEqual(await A.writeBoth(text(a1)), { local: true, idb: true });
  const refused = await B.writeBoth(text(b1));
  assert.deepEqual(refused, { local: false, idb: false, conflict: true }, "the window that loaded before the other one saved is refused");
  assert.equal(stores.idb(), text(a1), "the main store still holds the first window's save, to the letter");
  assert.equal(stores.local(), text(a1), "and so does the spare");
  assert.ok(!stores.idb().includes("Tab B dinner"));
  assert.equal(await B.changedElsewhere(), true, "the refused window can tell it is out of date");
  assert.equal(await A.changedElsewhere(), false, "the window that saved is not");
  const a2 = grow(a1, "Tab A coffee", "20");
  assert.deepEqual(await A.writeBoth(text(a2)), { local: true, idb: true }, "the first window goes on saving on top of its own save");
  assert.equal(stores.idb(), text(a2));
  // after loading the latest, the second window saves on top of it and nothing is lost
  B.setBase(a2); const b2 = grow(a2, "Tab B dinner", "30");
  assert.deepEqual(await B.writeBoth(text(b2)), { local: true, idb: true });
  for (const p of ["Start", "Tab A lunch", "Tab A coffee", "Tab B dinner"]) assert.ok(stores.idb().includes(p), p + " is in the ledger");
});

test("two saves started at the same instant: exactly one is written", async () => {
  const stores = fakeStores(), start = grow(emptyLedger(), "Start", "00");
  await (await windowOf()).writeBoth(text(start));
  const A = await windowOf(), B = await windowOf(); A.setBase(start); B.setBase(start);
  const [ra, rb] = await Promise.all([A.writeBoth(text(grow(start, "Race A", "05"))), B.writeBoth(text(grow(start, "Race B", "06")))]);
  assert.equal([ra, rb].filter((r) => r.conflict).length, 1, "one of the two is refused");
  assert.equal([ra, rb].filter((r) => r.idb && r.local).length, 1, "and one is saved");
  assert.equal(stores.idb().includes("Race A"), !ra.conflict); assert.equal(stores.idb().includes("Race B"), !rb.conflict);
  assert.equal(stores.idb(), stores.local(), "both stores hold the same save");
});

test("a brand-new phone open in two windows: the second first save is refused; an older copy in the store may be repaired; the spare is judged the same way", async () => {
  const stores = fakeStores();
  const A = await windowOf(), B = await windowOf(); A.setBase(null); B.setBase(null);
  const first = grow(emptyLedger(), "First window", "01");
  assert.deepEqual(await A.writeBoth(text(first)), { local: true, idb: true });
  assert.equal((await B.writeBoth(text(grow(emptyLedger(), "Second window", "02")))).conflict, true);
  assert.equal(stores.idb(), text(first));
  // a window that holds a NEWER ledger than the store (one store fell behind) repairs it
  const C = await windowOf(), newer = grow(first, "Kept by the spare", "10"); C.setBase(newer);
  assert.deepEqual(await C.writeBoth(text(newer)), { local: true, idb: true }, "the store was behind this window, so it is brought up to date");
  // only the spare is written (a repair of the spare): judged by what the spare holds
  const D = await windowOf(), E = await windowOf(); D.setBase(newer); E.setBase(newer);
  const d1 = grow(newer, "Window D", "20");
  assert.deepEqual(await D.writeBoth(text(d1)), { local: true, idb: true });
  assert.deepEqual(await E.writeBoth(text(grow(newer, "Window E", "21")), { idb: false }), { local: false, idb: false, conflict: true }, "a spare-only write from an out-of-date window is refused too");
  assert.equal(stores.local(), text(d1));
});

test("the app wires it: every whole-ledger write is judged, a refused save says so once, offers only Load the latest, and never reaches Saved", () => {
  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8"), store = readFileSync(new URL("../app/store.js", import.meta.url), "utf8");
  assert.match(app, /const writeLedgerHere = async \(text\) => \{ const r = await writeBoth\(text\); if \(r\.conflict\) await noteElsewhere\(\{ refused: true \}\); return r; \};/, "a restore or a repair that is refused says so too");
  assert.ok(!app.includes("writeLedger: (text) => writeBoth(text)") && (app.match(/writeLedger: writeLedgerHere/g) ?? []).length >= 5, "every replacement of the whole ledger goes through it");
  assert.match(app, /if \(r\.conflict\) \{ await noteElsewhere\(\{ refused: !quiet \}\); if \(ui\.elsewhere\) \{ ledger = beforeFlight; renderScreen\(\); \} throw new ChangedElsewhere\(\); \}/, "a refused save puts the ledger in memory back and throws, so the caller's Saved message is never reached");
  assert.match(app, /if \(!refused && await adoptLatest\(\)\) \{ renderAll\(\);/, "a window with nothing open quietly takes the latest ledger; a refused save the owner asked for never does");
  assert.match(app, /if \(ui\.sheet \|\| ui\.upgrade\?\.failed \|\| \$\("warn"\)\.firstChild\) return false;/, "and never while a window is open in it");
  assert.match(app, /if \(ui\.elsewhere\) throw new ChangedElsewhere\(\);/, "an out-of-date window tries nothing more");
  assert.match(app, /case "reload-latest": location\.reload\(\); break;/);
  assert.match(app, /inFlight\+\+; document\.documentElement\.dataset\.saving = "1";/, "the page is marked while a save is on its way");
  assert.match(app, /finally \{ inFlight--; if \(inFlight === 0\) delete document\.documentElement\.dataset\.saving; \}/, "and unmarked when the last one has landed, whatever its outcome");
  assert.match(app, /setBase\(boot\.status === "NONE" \? null : ledger\); watchOtherWindows\(noteElsewhere\);/, "armed once the app has chosen its ledger");
  assert.match(app, /changedElsewhere\(\)\.then\(\(yes\) => \{ if \(yes\) noteElsewhere\(\); \}\);/, "a window that was asleep asks when it comes back to the front");
  assert.match(app, /e\.reason\?\.code === "CHANGED_ELSEWHERE"/, "a refused save is not reported as an unexpected fault");
  assert.match(store, /g\.onsuccess = \(\) => \{ if \(armed && !mayOverwrite\(ledgerHead\(g\.result \?\? null\), base\)\) \{ conflict = true; return; \} st\.put\(text, KEY\); \};/, "the read and the write are one IndexedDB transaction");
  assert.match(store, /new BroadcastChannel\(DB_NAME \+ "\.saves"\)/, "the news channel is named after the database, so a trial copy and a real one never hear each other");
  assert.ok(CHANGED_ELSEWHERE.includes("Nothing was saved from here"), "the message says nothing was saved");
});

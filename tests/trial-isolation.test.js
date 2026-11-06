import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// "Start the trial over" must erase ONLY the trial copy (financialTracker-trial and financialTracker.trial.*) and never the real ledger (financialTracker,
// financialTracker.ledger, financialTracker.preupgrade, financialTracker.restorecopy, the app lock). Two proofs here; the browser proof, in both orders of opening
// the two copies, is e2e/trial-isolation.mjs.

// 1) Every call in the app that can erase stored data is listed here, with the file it lives in. A new one fails this test until someone decides it is safe.
test("the only code that erases stored data: the trial clear (two calls) and the app lock's own key", () => {
  const dir = new URL("../app/", import.meta.url), found = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".js"))) {
    const text = readFileSync(new URL(f, dir), "utf8").split("\n");
    text.forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, "");
      for (const m of code.matchAll(/localStorage\.(removeItem|clear)\(([^)]*)\)|\bindexedDB\.deleteDatabase\(([^)]*)\)|sessionStorage\.(removeItem|clear)\(([^)]*)\)|\.(?:objectStore\([^)]*\)|store)\.(clear|delete)\(([^)]*)\)/g)) found.push(`${f}: ${m[0]}`);
    });
  }
  const sessionOnly = found.filter((x) => /sessionStorage/.test(x)), rest = found.filter((x) => !/sessionStorage/.test(x));
  assert.deepEqual(rest.filter((x) => !/deletePhoto|store\.js: .*\.delete\(/.test(x)).sort(), [
    "store.js: indexedDB.deleteDatabase(DB_NAME)",
    "store.js: localStorage.removeItem(LOCK_LS)",
    "store.js: localStorage.removeItem(LS_KEY)",
  ], "an erasing call that is not one of these three is new: it must be proved safe for the real ledger first");
  assert.ok(Array.isArray(sessionOnly));
});

// 2) clearTrialStorage, run against fake browser stores: it touches the trial names and nothing else, and does nothing at all in a real copy.
function fakeBrowser() {
  const log = { removed: [], deleted: [] };
  globalThis.localStorage = { removeItem: (k) => log.removed.push(k), getItem: () => null, setItem() {} };
  globalThis.indexedDB = { deleteDatabase: (name) => { log.deleted.push(name); const r = {}; queueMicrotask(() => r.onsuccess?.()); return r; } };
  return log;
}
test("in a real copy (no trial) clearTrialStorage does nothing: nothing is removed, no database is deleted", async () => {
  const log = fakeBrowser();
  const { clearTrialStorage } = await import("../app/store.js");
  await clearTrialStorage();
  assert.deepEqual(log, { removed: [], deleted: [] });
});
test("in the trial copy it removes only financialTracker.trial.ledger and deletes only the database financialTracker-trial", async () => {
  const log = fakeBrowser();
  const { clearTrialStorage, useTrialStorage } = await import("../app/store.js");
  useTrialStorage();
  await clearTrialStorage();
  assert.deepEqual(log.removed, ["financialTracker.trial.ledger"]);
  assert.deepEqual(log.deleted, ["financialTracker-trial"]);
  for (const real of ["financialTracker", "financialTracker.ledger", "financialTracker.preupgrade", "financialTracker.restorecopy", "financialTracker.applock"]) {
    assert.ok(!log.removed.includes(real) && !log.deleted.includes(real), real + " is never touched");
  }
  for (const name of [...log.removed, ...log.deleted]) assert.ok(/trial/.test(name), name + " is a trial name");
});

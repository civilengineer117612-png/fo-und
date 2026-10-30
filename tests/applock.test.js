import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validPin, lockOn, hashPin, makeRecord, checkPin, newSalt, waitSeconds, secondsLeft, afterWrong, afterRight, shouldLock, AWAY_MS, emptyLedger, LEDGER_VERSION } from "../src/model/index.js";

// Invented PINs only. The lock is a privacy screen: the PIN is kept as a salted hash, wrong tries wait longer, and nothing is ever erased.
const NOW = 1_000_000_000;

test("a PIN is exactly 6 digits", () => {
  for (const ok of ["000000", "123456", "999999"]) assert.equal(validPin(ok), true, ok);
  for (const bad of ["12345", "1234567", "12345a", "", " 12345", "12 456", "١٢٣٤٥٦", null, undefined, 123456]) assert.equal(validPin(bad), false, String(bad));
});

test("the PIN is kept only as a salted hash: two records of one PIN differ, the PIN is nowhere in the record, and only the right PIN opens it", async () => {
  const a = await makeRecord({ pin: "246810", cred: "cred-a" }), b = await makeRecord({ pin: "246810", cred: "cred-b" });
  assert.notEqual(a.salt, b.salt, "each record has its own random salt"); assert.notEqual(a.hash, b.hash, "so the same PIN gives a different hash");
  assert.ok(!JSON.stringify(a).includes("246810")); assert.equal(a.on, true); assert.equal(a.fails, 0); assert.equal(a.until, 0); assert.equal(a.cred, "cred-a");
  assert.equal(await checkPin(a, "246810"), true); assert.equal(await checkPin(a, "246811"), false); assert.equal(await checkPin(a, "000000"), false);
  assert.equal(await checkPin(a, "24681"), false, "a PIN of the wrong shape is never tried"); assert.equal(await checkPin(null, "246810"), false);
  assert.equal(await hashPin("246810", a.salt, a.iter), a.hash, "the same PIN and salt give the same hash"); assert.notEqual(await hashPin("246810", newSalt(), a.iter), a.hash);
  await assert.rejects(() => makeRecord({ pin: "12" }), /6 digits/);
});

test("the lock counts as on only for a complete record", async () => {
  const rec = await makeRecord({ pin: "135790", cred: null });
  assert.equal(lockOn(rec), true); assert.equal(lockOn({ ...rec, on: false }), false); assert.equal(lockOn({ ...rec, hash: undefined }), false); assert.equal(lockOn({ ...rec, salt: undefined }), false); assert.equal(lockOn(null), false); assert.equal(lockOn({}), false);
});

test("wrong tries: none wait for the first four, then 30, 60, 120, 240 seconds, never more than an hour", () => {
  assert.deepEqual([1, 2, 3, 4].map(waitSeconds), [0, 0, 0, 0]);
  assert.deepEqual([5, 6, 7, 8, 9].map(waitSeconds), [30, 60, 120, 240, 480]);
  assert.equal(waitSeconds(12), 3600); assert.equal(waitSeconds(100), 3600, "the wait stops growing at an hour");
});

test("a wrong PIN counts, the fifth sets a 30 second wait from now, a right PIN clears it, and the record is never otherwise changed", async () => {
  let rec = await makeRecord({ pin: "112233", cred: "c" });
  for (let i = 1; i <= 4; i++) { rec = afterWrong(rec, NOW); assert.equal(rec.fails, i); assert.equal(secondsLeft(rec, NOW), 0, "no wait yet"); }
  rec = afterWrong(rec, NOW); assert.equal(rec.fails, 5); assert.equal(secondsLeft(rec, NOW), 30); assert.equal(secondsLeft(rec, NOW + 10_000), 20); assert.equal(secondsLeft(rec, NOW + 31_000), 0);
  const sixth = afterWrong(rec, NOW + 31_000); assert.equal(sixth.fails, 6); assert.equal(secondsLeft(sixth, NOW + 31_000), 60);
  assert.equal(sixth.hash, rec.hash); assert.equal(sixth.salt, rec.salt); assert.equal(sixth.cred, rec.cred); assert.equal(sixth.on, true, "wrong tries never switch the lock off or change the PIN");
  const cleared = afterRight(sixth); assert.equal(cleared.fails, 0); assert.equal(cleared.until, 0); assert.equal(await checkPin(cleared, "112233"), true);
});

test("away for MORE than a minute locks again; a minute or less does not", () => {
  assert.equal(AWAY_MS, 60000);
  assert.equal(shouldLock(NOW, NOW + 59_000), false); assert.equal(shouldLock(NOW, NOW + 60_000), false, "exactly a minute"); assert.equal(shouldLock(NOW, NOW + 60_001), true); assert.equal(shouldLock(NOW, NOW + 3_600_000), true);
  assert.equal(shouldLock(null, NOW), false, "never hidden: nothing to lock"); assert.equal(shouldLock(undefined, NOW), false);
});

test("the lock is not part of the ledger, its settings, its backup or its data version", async () => {
  const rec = await makeRecord({ pin: "654321", cred: "c" });
  const l = emptyLedger(); assert.equal(l.v, LEDGER_VERSION); assert.equal(LEDGER_VERSION, 11, "the lock adds nothing to the saved data (the version is the payslip lines' step, 10 to 11)");
  const text = JSON.stringify(l); for (const word of ["applock", "passkey", "salt", "hash", rec.hash]) assert.ok(!text.includes(word), word);
  const store = readFileSync(new URL("../app/store.js", import.meta.url), "utf8");
  assert.match(store, /const LOCK_KEY = "applock", LOCK_LS = "financialTracker\.applock"/, "the lock has its own keys");
  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
  assert.ok(!/ledger\.settings[^;\n]*applock|settings:[^;\n]*applock|lockRec[^;\n]*ledger\.settings/.test(app), "the lock is never written into the ledger settings");
  assert.ok(!/export (async )?function \w*[Bb]ackup[^]*?lockRec/.test(app), "no backup reads the lock");
});

test("the screen never draws while locked, never reads the lock in a trial copy, never erases, and covers the page when it is hidden", () => {
  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
  for (const fn of ["renderAll", "renderMenu", "renderBanner", "renderNav", "renderScreen", "renderSheet", "showToast"]) assert.match(app, new RegExp(`function ${fn}\\([^)]*\\) \\{ ?(if \\(ui\\.locked\\) return;|\\n  if \\(ui\\.locked\\) return;)`), fn + " returns at once while locked");
  assert.match(app, /if \(!trial\) \{[^]*?lockRec = await readLock\(\);[^]*?\}\s*renderAll\(\);/, "the lock is read before the first render, and never for a trial copy");
  const wrong = app.slice(app.indexOf("async function lockKey(k) {"), app.indexOf("async function lockFace(quiet) {"));
  assert.match(wrong, /lockRec = M\.afterWrong\(lockRec, Date\.now\(\)\); await writeLock\(lockRec\)/);
  assert.ok(!/writeBoth|clearLock|clearTrialStorage|localStorage\.removeItem|indexedDB|commit\(|deleteDatabase/.test(wrong), "a wrong PIN touches nothing but the try count");
  assert.match(app, /function appHidden\(\) \{[^]*?coverOn\(\);/); assert.match(app, /addEventListener\("pagehide", appHidden\)/);
  assert.match(app, /M\.shouldLock\(lockHiddenAt, Date\.now\(\)\)/);
  const blank = app.slice(app.indexOf("function blankApp() {"), app.indexOf("function closeLock()"));
  assert.match(blank, /el\.innerHTML = ""/, "content is emptied, not hidden");
});

test("NOTHING on the lock screen changes the ledger: Delete is only the PIN's backspace, and every handler there touches at most the lock record", () => {
  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8"), store = readFileSync(new URL("../app/store.js", import.meta.url), "utf8");
  const section = app.slice(app.indexOf("function lockHtml() {"), app.indexOf("async function start() {"));
  assert.match(section, /k === "del"\) \{ ui\.lockPin = \(ui\.lockPin \?\? ""\)\.slice\(0, -1\); drawLock\(\); \}/, "Delete removes the last typed digit and nothing else");
  assert.ok(!/writeBoth|commit\(|putPhoto|deletePhoto|clearTrialStorage|deleteDatabase|ledger = |ledger\.state|ledger\.settings|writeCopies|writeRestoreCopies|replaceLedger|localStorage|indexedDB/.test(section), "the lock screen code never writes or reads the ledger or any other store");
  const allowed = [...section.matchAll(/\b(writeLock|clearLock|readLock)\(/g)].map((m) => m[1]);
  assert.ok(allowed.length > 0 && allowed.every((n) => ["writeLock", "clearLock"].includes(n)), "only the lock record is ever written");
  const clear = store.slice(store.indexOf("export async function clearLock()"));
  assert.ok(!/\bKEY\b|LS_KEY|COPIES_KEY|RESTORE_KEY|PHOTOS|SAFETY/.test(clear.slice(0, clear.indexOf("\n}\n") + 3)), "clearLock can only remove the lock's own keys");
});

test("Face ID is tried when the lock appears, and a swipe up or a tap on the line tries it again; the PIN pad is always there", () => {
  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(app, /if \(mode === "open"\) lockFace\(true\);/, "tried by itself when the lock appears");
  assert.match(app, /t0\.y - t\.clientY > 60[^]*?lockFace\(false\)/, "a swipe up asks again");
  assert.match(app, /data-lock="face"/, "so does a tap on the quiet line");
  assert.match(app, /const keys = `<div class="keypad">/, "the PIN pad is part of every lock screen");
  assert.ok(!/lockFace\([^)]*\)[^;\n]*(return|await)[^;\n]*(disabled|hidden)/.test(app));
});

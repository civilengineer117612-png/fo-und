import { test } from "node:test";
import assert from "node:assert/strict";
import { detectPlatform, assessDevice, trialAllowed } from "../src/model/index.js";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36";
const both = (v) => ({ local: v, idb: v });
const ok = { platform: "ios", standalone: true, stores: both(true) };

test("platform is read from the user agent", () => {
  assert.equal(detectPlatform(IPHONE), "ios");
  assert.equal(detectPlatform(ANDROID), "android");
  assert.equal(detectPlatform(IPAD), "other");
  assert.equal(detectPlatform(DESKTOP), "other");
});

// ANDROID READY (owner, Nov 21; before: Android said "not the finance phone" and a computer "not the finance phone", entry off): any phone or
// computer may hold a ledger now; only an iPhone's Safari tab is stopped, because there the storage is separate from the Home Screen app.
test("Android and computers hold a ledger like an iPhone's Home Screen app: installed or in a browser tab, entry is on", () => {
  for (const platform of ["android", "other"]) for (const standalone of [true, false]) {
    assert.deepEqual(assessDevice({ platform, standalone, stores: both(true) }), { status: "OK", message: "", allowEntry: true }, platform + " " + standalone);
    const e = assessDevice({ platform, standalone, stores: both(false) });
    assert.equal(e.status, "EMPTY"); assert.equal(e.allowEntry, true); assert.match(e.message, /restore/);
  }
});
test("no device is called the wrong phone any more, and no message names a brand of phone", () => {
  const messages = [];
  for (const platform of ["ios", "android", "other"]) for (const standalone of [true, false]) for (const stores of [both(true), both(false), { local: true, idb: false }, { local: null, idb: true }]) for (const trial of [false, true]) {
    const r = assessDevice({ platform, standalone, stores, trial });
    assert.ok(!["ANDROID_NO_LEDGER", "NOT_THE_FINANCE_PHONE"].includes(r.status), r.status);
    messages.push(r.message);
  }
  for (const m of messages) assert.doesNotMatch(m, /iPhone|Android|Safari|iOS|finance phone/, m);
});
test("iPhone in a Safari tab: wrong storage, open the Home Screen icon (still stopped: Safari keeps a tab's storage apart)", () => {
  const r = assessDevice({ ...ok, standalone: false });
  assert.equal(r.status, "BROWSER_TAB");
  assert.equal(r.allowEntry, false);
});
test("iPhone Home Screen app with data in both stores is fine and silent", () => {
  assert.deepEqual(assessDevice(ok), { status: "OK", message: "", allowEntry: true });
});
test("iPhone Home Screen app with both stores empty: expected on first run, restore if not", () => {
  const r = assessDevice({ ...ok, stores: both(false) });
  assert.equal(r.status, "EMPTY");
  assert.equal(r.allowEntry, true);
  assert.match(r.message, /restore/);
});
test("one store empty and one not is flagged as partial loss, naming the empty one", () => {
  const a = assessDevice({ ...ok, stores: { local: true, idb: false } });
  assert.equal(a.status, "PARTIAL_LOSS");
  assert.match(a.message, /IndexedDB is empty/);
  assert.equal(a.allowEntry, false);
});
test("an empty spare copy (localStorage) is not a loss: IndexedDB is the main store, entry stays on", () => {
  const r = assessDevice({ ...ok, stores: { local: false, idb: true } });
  assert.equal(r.status, "OK"); assert.equal(r.allowEntry, true); assert.equal(r.message, "");
});
test("a store that cannot be read stops saving", () => {
  for (const stores of [{ local: null, idb: true }, { local: true, idb: null }, { local: null, idb: null }]) {
    const r = assessDevice({ ...ok, stores });
    assert.equal(r.status, "STORAGE_UNAVAILABLE");
    assert.equal(r.allowEntry, false);
  }
});
test("an Android that holds a ledger is guarded like an iPhone: one store emptied is flagged as partial loss", () => {   // before: Android never reported it (it held no ledger)
  assert.equal(assessDevice({ platform: "android", standalone: true, stores: { local: true, idb: false } }).status, "PARTIAL_LOSS");
});

test("a trial copy turns entry on for an Android phone, a desktop or an iPhone browser tab, and says plainly that it is not the real ledger", () => {
  for (const platform of ["android", "other", "ios"]) {
    const r = assessDevice({ platform, standalone: false, stores: both(false), trial: true });
    assert.equal(r.status, "TRIAL", platform);
    assert.equal(r.allowEntry, true, platform);
    assert.match(r.message, /not your real ledger/);
    assert.match(r.message, /Do not enter real financial data/);
  }
});
test("a trial can never be switched on in an installed (Home Screen) app, which holds the real ledger, on any phone", () => {
  for (const platform of ["ios", "android", "other"]) { assert.equal(trialAllowed({ platform, standalone: true }), false, platform); assert.equal(trialAllowed({ platform, standalone: false }), true, platform); }
  assert.equal(assessDevice({ platform: "android", standalone: true, stores: both(true), trial: true }).status, "OK", "an installed Android app ignores ?trial too");
  const r = assessDevice({ platform: "ios", standalone: true, stores: both(true), trial: true });
  assert.equal(r.status, "OK", "the ?trial is ignored and the real ledger is shown as usual");
  assert.equal(assessDevice({ platform: "ios", standalone: true, stores: both(false), trial: true }).status, "EMPTY");
});
test("without ?trial an Android tab is the real ledger (empty on first run); a trial still refuses unreadable storage", () => {
  assert.equal(assessDevice({ platform: "android", standalone: false, stores: both(false) }).status, "EMPTY");
  const r = assessDevice({ platform: "android", standalone: false, stores: { local: null, idb: false }, trial: true });
  assert.equal(r.status, "STORAGE_UNAVAILABLE");
  assert.equal(r.allowEntry, false);
});

test("the first-run preview (Nov 21) runs on any device, an iPhone's Safari tab and the installed app too, and says nothing is kept", () => {
  for (const platform of ["ios", "android", "other"]) for (const standalone of [true, false]) {
    const r = assessDevice({ platform, standalone, stores: both(false), preview: true });
    assert.equal(r.status, "PREVIEW", platform + " " + standalone); assert.equal(r.allowEntry, true);
    assert.match(r.message, /Nothing is kept/); assert.match(r.message, /your ledger is not touched/);
  }
  assert.equal(assessDevice({ platform: "ios", standalone: true, stores: both(true), preview: true, trial: true }).status, "PREVIEW", "the preview wins over ?trial");
  assert.equal(assessDevice({ platform: "ios", standalone: true, stores: { local: null, idb: false }, preview: true }).status, "STORAGE_UNAVAILABLE");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { requestStorageProtection, storageProtected } from "../app/protection.js";

test("a granted request reports the browser's true result", async () => {
  assert.equal(await requestStorageProtection({claim:async()=>true,storage:{persist:async()=>true}}),true);
});
test("a refused request reports false, never protection", async () => {
  assert.equal(await requestStorageProtection({claim:async()=>true,storage:{persist:async()=>false}}),false);
});
test("a missing persistence API makes no request or claim", async () => {
  let claims=0;assert.equal(await requestStorageProtection({storage:{},claim:async()=>{claims++;return true;}}),false);
  assert.equal(claims,0);
});
test("repeated and concurrent saves request once after the durable claim", async () => {
  let claimed=false,calls=0;
  const options={claim:async()=>{if(claimed)return false;claimed=true;return true;},storage:{persist:async()=>{assert.equal(claimed,true);calls++;return false;},persisted:async()=>false}};
  await Promise.all([requestStorageProtection(options),requestStorageProtection(options)]);
  await requestStorageProtection(options);assert.equal(calls,1);
});
test("permission errors do not reject or claim protection", async () => {
  assert.equal(await requestStorageProtection({claim:async()=>true,storage:{persist:async()=>{throw new Error('example denial');}}}),false);
});
test("an unavailable durable marker does not prompt repeatedly", async () => {
  let calls=0;assert.equal(await requestStorageProtection({claim:async()=>{throw new Error('example storage failure');},storage:{persist:async()=>{calls++;return true;}}}),false);
  assert.equal(calls,0);
});
test("Setup reads fresh browser status and accepts only an explicit true", async () => {
  let value=true;const storage={persisted:async()=>value};assert.equal(await storageProtected(storage),true);
  value=false;assert.equal(await storageProtected(storage),false);
  value='true';assert.equal(await storageProtected(storage),false);
  assert.equal(await storageProtected({}),false);
  assert.equal(await storageProtected({persisted:async()=>{throw new Error('example failure');}}),false);
});

// Owner, Nov 22 (his Android phone said "Storage protected: no" in the installed app): the first save had been made in the Chrome tab, Chrome
// refused the tab, and the one claim was used up. The installed app has its own claim, so it asks once more; a tab never asks twice.
test("a request used up in a browser tab is made once more by the installed app, and only once", async () => {
  const claimed = new Set(), calls = [];
  const claim = async (key) => { if (claimed.has(key)) return false; claimed.add(key); return true; };
  let granted = false, isProtected = false;   // the browser's answer to the next request, and whether it has protected the storage yet
  const storage = { persist: async () => { calls.push(granted ? "yes" : "no"); isProtected = granted; return granted; }, persisted: async () => isProtected };
  assert.equal(await requestStorageProtection({ claim, storage, installed: false }), false, "the tab is refused");
  assert.equal(await requestStorageProtection({ claim, storage, installed: false }), false, "and a tab never asks twice");
  granted = true;
  assert.equal(await requestStorageProtection({ claim, storage, installed: true }), true, "the installed app asks once and is protected");
  assert.equal(calls.length, 2, "one request from the tab, one from the installed app");
  assert.deepEqual([...claimed].sort(), ["persistence-requested", "persistence-requested-installed"]);
  granted = false; isProtected = false;   // say the browser later dropped the protection
  assert.equal(await requestStorageProtection({ claim, storage, installed: true }), false);
  assert.equal(calls.length, 2, "the installed app never asks a second time either");
});
test("storage already protected asks nothing and uses no claim", async () => {
  let claims = 0, calls = 0;
  assert.equal(await requestStorageProtection({ claim: async () => { claims++; return true; }, storage: { persist: async () => { calls++; return true; }, persisted: async () => true }, installed: true }), true);
  assert.equal(claims + calls, 0);
});

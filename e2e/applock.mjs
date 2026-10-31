// App lock, in the browser (owner, Oct 29). A virtual Face ID (a WebAuthn platform authenticator) stands in for the phone's. Every name and figure is invented.
import { encryptLedgerBackup, upgradeLedger } from "../src/model/index.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function appLockChecks({ browser, base, open, menuGo, check, seen, text, stored, OWNER_STYLE, ANDROID }) {
  const TS = "2026-10-02T09:00:00.000+08:00", PIN = "246810", WRONG = "111111";
  const bank = { id: "b", name: "Zebra Bank", class: "asset", role: "", hidden_by_default: false, archived: false, opening_balance: 5000000, opening_date: "2026-03-01" };
  const seed = { ...OWNER_STYLE, state: { ...OWNER_STYLE.state, accounts: [bank],
    transactions: [{ id: "t1", date: "2026-10-02", payee: "Quagga Cafe", memo: "", status: "verified", source: "manual", created_at: TS, verified_at: TS }],
    entries: [{ transaction_id: "t1", category_id: "cat-food", amount: 123456 }, { transaction_id: "t1", account_id: "b", amount: -123456 }] } };
  const faceIdFor = async (ctx, page) => {   // the pretend phone: user verification can be switched off (Face ID fails) and the passkeys wiped (a new phone)
    const c = await ctx.newCDPSession(page); await c.send("WebAuthn.enable");
    const { authenticatorId } = await c.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    return { verified: (v) => c.send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified: v }), wipe: () => c.send("WebAuthn.clearCredentials", { authenticatorId }), count: async () => (await c.send("WebAuthn.getCredentials", { authenticatorId })).credentials.length };
  };
  const tap = async (page, pin) => { for (const d of pin) await page.click(`#lockscreen [data-lock="key"][data-k="${d}"]`); };
  const record = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem("financialTracker.applock") ?? "null"); } catch { return null; } });
  const ledgerTexts = async (page) => { const s = await stored(page); return JSON.stringify([s.local, s.idb]); };
  const bare = (page) => page.evaluate(() => ["top", "banner", "screen", "sheet", "warn", "toast", "menu", "nav"].every((id) => document.getElementById(id).innerHTML.trim() === ""));
  const reload = async (page) => { await page.reload(); await page.waitForSelector("#lockscreen, #nav button"); };
  const goSetup = async (page) => { await page.click("#menuBtn"); await page.click('#menu [data-tab="setup"]'); await page.waitForSelector(".setlist"); };
  const turnOn = async (page, pin = PIN) => { await page.click('button[data-action="lock-toggle"]'); await page.fill("#l-pin", pin); await page.fill("#l-pin2", pin); await page.click('button[data-action="lock-enable"]'); };

  console.log("\n-- App lock --");
  // 1. off by default: the app opens straight to Log
  let { ctx, page, errors } = await open({ blockSw: true, setupFlat: false, seed });
  const face = await faceIdFor(ctx, page);
  check(await page.locator("#lockscreen").count() === 0 && (await text(page, "#nav")).includes("Log") && await record(page) === null, "the lock is off by default: the app opens straight to Log, no record exists");
  await goSetup(page);
  check((await text(page, ".setlist")).includes("App lock") && /Off/.test(await text(page, '.setrow[data-action="lock-toggle"]')), "Setup has ONE line, App lock, with an Off chip");

  // 2. turning on: both steps or nothing
  await page.click('button[data-action="lock-toggle"]'); await page.fill("#l-pin", PIN); await page.fill("#l-pin2", "135790");
  check(await page.locator('button[data-action="lock-enable"]').isDisabled(), "two different PINs cannot be saved");
  await page.fill("#l-pin2", PIN);
  await face.verified(false);   // Face ID cannot be set up
  await page.click('button[data-action="lock-enable"]');
  check(await seen(page, "#sheet", "The lock stays off") && await record(page) === null && await face.count() === 0, "if the passkey cannot be made the lock stays off, says so, and nothing is kept");
  await face.verified(true);
  await page.click('button[data-action="lock-enable"]');
  check(await seen(page, "#toast", "App lock is on") && await face.count() === 1, "with both steps done the lock is on and a passkey exists");
  const rec = await record(page), led0 = await ledgerTexts(page);
  check(rec?.on === true && typeof rec.hash === "string" && rec.hash.length > 20 && typeof rec.salt === "string" && rec.cred && !JSON.stringify(rec).includes(PIN) && rec.fails === 0, "only a salted hash of the PIN and the passkey id are kept, never the PIN");
  check(!led0.includes("applock") && !led0.includes(rec.hash) && !led0.includes(rec.salt), "nothing of the lock is in the saved ledger");
  check(/On/.test(await text(page, '.setrow[data-action="lock-toggle"]')), "Setup now says On");

  // 3. locked on open: not one ledger figure or name is on the page (Face ID is tried at the start, so for now it is made to fail)
  await face.verified(false); await reload(page);
  check(await page.locator("#lockscreen").count() === 1 && await bare(page), "locked: every part of the page that holds ledger content is empty");
  const body = await text(page, "body");
  check(!/Quagga|Zebra|1,234\.56|Test Bank/.test(body) && !/Log|Verify/.test(body.replace(/Enter PIN|Swipe up for Face ID/g, "")), "locked: no entry, account, figure or screen name is anywhere in the page");
  check(await page.locator("#lockscreen [data-lock=key]").count() === 10 && (await text(page, "#lockscreen")).includes("Enter PIN"), "the lock shows the PIN pad");

  // 4. Face ID: success unlocks, failure stays locked and the PIN pad is there
  await face.verified(true); await page.click('#lockscreen [data-lock="face"]');
  check(await seen(page, "#nav", "Log") && await page.locator("#lockscreen").count() === 0, "Face ID success unlocks");
  await face.verified(true); await reload(page);
  check(await page.locator("#lockscreen").count() === 0 && (await text(page, "#nav")).includes("Log"), "Face ID is tried when the app opens: with it working the app opens straight in");
  await face.verified(false); await reload(page);
  await page.click('#lockscreen [data-lock="face"]');
  check(await seen(page, "#lockscreen", "Face ID did not work. Use your PIN.") && await page.locator("#lockscreen").count() === 1 && await bare(page), "Face ID failure stays locked and says to use the PIN");

  // Delete is only the PIN's backspace; a swipe up and Face ID failing change nothing else either
  await tap(page, "123");
  check((await page.locator("#lockscreen .pindots span.on").count()) === 3, "typing shows the digits as filled circles");
  await page.click('#lockscreen [data-lock="del"]'); await page.click('#lockscreen [data-lock="del"]');
  check((await page.locator("#lockscreen .pindots span.on").count()) === 1 && (await ledgerTexts(page)) === led0 && (await record(page)).on === true, "Delete removes one typed digit at a time and changes nothing else");
  await page.click('#lockscreen [data-lock="del"]');
  await page.evaluate(() => { const el = document.getElementById("lockscreen"); const mk = (type, y) => new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === "touchend" ? [] : [new Touch({ identifier: 1, target: el, clientX: 200, clientY: y })], changedTouches: [new Touch({ identifier: 1, target: el, clientX: 200, clientY: y })] }); el.dispatchEvent(mk("touchstart", 700)); el.dispatchEvent(mk("touchend", 500)); });
  check(await seen(page, "#lockscreen", "Face ID did not work. Use your PIN.") && (await ledgerTexts(page)) === led0, "a swipe up asks for Face ID again (it fails here) and changes nothing");
  // 5. PIN: right opens; five wrong ones make the next try wait; nothing is ever erased
  await tap(page, WRONG);
  check(await seen(page, "#lockscreen", "That PIN was not right.") && await bare(page), "a wrong PIN says so and stays locked");
  for (let i = 0; i < 3; i++) await tap(page, WRONG);
  check(!(await text(page, "#lockscreen")).includes("Try again in"), "four wrong tries: no wait yet");
  await tap(page, WRONG);
  check(await seen(page, "#lockscreen", "Try again in 30 seconds") && await page.locator("#lockscreen [data-lock=key]:not([disabled])").count() === 0, "the fifth wrong PIN starts a 30 second wait and the keys rest");
  check((await record(page)).fails === 5 && (await ledgerTexts(page)) === led0, "five wrong tries changed only the count: the ledger is byte-for-byte what it was");
  await reload(page);
  check(await seen(page, "#lockscreen", "Try again in") && (await record(page)).fails === 5, "closing and opening the app does not clear the wait");
  await page.evaluate(() => { const r = JSON.parse(localStorage.getItem("financialTracker.applock")); r.until = 0; localStorage.setItem("financialTracker.applock", JSON.stringify(r)); });   // the wait is over (the clock is tested in the unit tests)
  await page.evaluate(async () => { const db = await new Promise((res) => { const r = indexedDB.open("financialTracker", 3); r.onsuccess = () => res(r.result); }); const rec = JSON.parse(localStorage.getItem("financialTracker.applock")); await new Promise((res) => { const tx = db.transaction("kv", "readwrite"); tx.objectStore("kv").put(rec, "applock"); tx.oncomplete = res; }); db.close(); });
  await reload(page);
  await tap(page, PIN);
  check(await seen(page, "#nav", "Log") && await page.locator("#lockscreen").count() === 0 && (await record(page)).fails === 0, "the right PIN unlocks and clears the count");
  check((await ledgerTexts(page)) === led0, "after all of it the ledger is still byte-for-byte what it was");

  // 6 and 7. away for a minute or less: no lock; more than a minute: locked; hidden: covered at once
  await page.clock.install();
  const hide = () => page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  const show = () => page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" }); document.dispatchEvent(new Event("visibilitychange")); });
  await hide();
  check(await page.locator("#lockcover").count() === 1 && await page.evaluate(() => { const r = document.getElementById("lockcover").getBoundingClientRect(); return r.width >= innerWidth && r.height >= innerHeight; }), "when the page becomes hidden it is covered at once (the app switcher shows nothing)");
  await page.clock.fastForward(30_000); await show();
  check(await page.locator("#lockcover").count() === 0 && await page.locator("#lockscreen").count() === 0 && (await text(page, "#nav")).includes("Log"), "away for 30 seconds: no lock, the cover is gone");
  await hide(); await page.clock.fastForward(59_000); await show();
  check(await page.locator("#lockscreen").count() === 0, "away for 59 seconds: no lock (the exact minute is in the unit test)");
  await hide(); await page.clock.fastForward(61_000); await show();
  check(await page.locator("#lockscreen").count() === 1 && await bare(page) && !/Quagga|Zebra/.test(await text(page, "body")), "away for more than a minute: locked again, and the page holds nothing");
  await face.verified(true); await page.click('#lockscreen [data-lock="face"]');
  check(await seen(page, "#nav", "Log"), "and Face ID opens it again");

  // 8. the passkey is gone (a new phone, a deleted passkey): the PIN still opens the app
  await face.wipe(); await reload(page);
  check(await page.locator("#lockscreen [data-lock=face]").count() === 1, "the swipe line is still offered");
  await page.click('#lockscreen [data-lock="face"]');
  check(await seen(page, "#lockscreen", "Face ID did not work. Use your PIN."), "with the passkey gone Face ID fails plainly");
  await tap(page, PIN);
  check(await seen(page, "#nav", "Log"), "and the PIN still unlocks");

  // 11. turning it off needs unlocking first
  await goSetup(page); await page.click('button[data-action="lock-toggle"]');
  check(await seen(page, "#lockscreen", "Enter PIN to turn off") && await page.locator("#lockscreen").count() === 1, "turning the lock off asks for the PIN first");
  await tap(page, WRONG);
  check(await seen(page, "#lockscreen", "That PIN was not right.") && await record(page) !== null, "a wrong PIN does not turn it off");
  await page.click('#lockscreen [data-lock="cancel"]');
  check(await page.locator("#lockscreen").count() === 0 && (await record(page)) !== null && /On/.test(await text(page, '.setrow[data-action="lock-toggle"]')), "Cancel leaves it on");
  await page.click('button[data-action="lock-toggle"]'); await tap(page, PIN);
  check(await seen(page, "#toast", "App lock is off") && await record(page) === null && /Off/.test(await text(page, '.setrow[data-action="lock-toggle"]')), "the right PIN turns it off and removes the record");
  check(JSON.stringify(JSON.parse((await stored(page)).local).state) === JSON.stringify(JSON.parse(led0)[0] ? JSON.parse(JSON.parse(led0)[0]).state : null), "turning it on and off never touched the entries, accounts or categories");
  check(errors.length === 0, "no script errors in the app lock: " + errors.join("; ")); await ctx.close();

  // 9. a backup made with the lock on has no lock in it, and restoring it on a fresh install leaves the lock off
  ({ ctx, page, errors } = await open({ blockSw: true, setupFlat: false, seed }));
  await faceIdFor(ctx, page); await goSetup(page); await turnOn(page); await seen(page, "#toast", "App lock is on");
  const live = JSON.parse((await stored(page)).local);
  check(!JSON.stringify(live).includes("applock") && !JSON.stringify(live.settings).match(/pin|salt|hash|cred/i), "the ledger and its settings, which are what a backup holds, carry no lock");
  const up = upgradeLedger(live), file = join(mkdtempSync(join(tmpdir(), "lk-")), "finance-backup-lock.json"); writeFileSync(file, JSON.stringify(await encryptLedgerBackup(up.ledger, "correct horse battery")));
  await ctx.close();
  ({ ctx, page, errors } = await open({ blockSw: true, seed: null, styled: false }));
  await menuGo(page, "Setup"); await page.click('button:has-text("Restore from a backup")'); await page.setInputFiles("#r-file", file); await page.fill("#r-pass", "correct horse battery"); await page.click('button:has-text("Open the backup")');
  await page.click("#f-save"); await page.click("#f-save");
  await page.waitForFunction(() => /Your data was replaced/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
  await reload(page).catch(() => {});
  check(await page.locator("#lockscreen").count() === 0 && await record(page) === null, "restoring that backup on a fresh install leaves the lock off");
  await ctx.close();

  // 10. a trial copy never shows the lock, even with a lock record on the phone (the same record locks the real app)
  const lockRecord = { v: 1, on: true, cred: "AAAA", salt: "AAAAAAAAAAAAAAAAAAAAAA==", iter: 150000, hash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", fails: 0, until: 0 };
  const plant = (c) => c.addInitScript((r) => { try { localStorage.setItem("financialTracker.applock", JSON.stringify(r)); } catch {} }, lockRecord);
  ({ ctx, page, errors } = await open({ ua: ANDROID, standalone: false, blockSw: true, url: base + "?trial" }));
  await page.evaluate((r) => localStorage.setItem("financialTracker.applock", JSON.stringify(r)), lockRecord); await page.reload(); await page.waitForSelector("#nav button");
  check(await page.locator("#lockscreen").count() === 0 && (await text(page, "#nav")).includes("Log") && (await text(page, "#banner")).includes("Trial copy"), "a trial copy never shows the lock, even with a lock record on the phone");
  await ctx.close();
  ({ ctx, page, errors } = await open({ ua: ANDROID, standalone: false, blockSw: true, url: base }));
  await page.evaluate((r) => localStorage.setItem("financialTracker.applock", JSON.stringify(r)), lockRecord); await page.reload(); await page.waitForSelector("#lockscreen");
  check(await page.locator("#lockscreen").count() === 1, "the same record does lock the real app (so the trial check means something)");
  await ctx.close();
}

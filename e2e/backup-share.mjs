// Serve the repo on port 8124, then node e2e/backup-share.mjs (ENGINE=webkit for Safari's engine). Every name and figure here is invented.
// BACKUP THROUGH THE SHARE SHEET (owner, Nov 23: the iPhone said "Not saved. Tap Create backup file to try again."). On the iPhone a backup leaves the
// app ONLY through the share sheet (Save to Files); the other e2e scripts take the download fallback, because the test browsers have no share sheet.
// Here the page gets the share sheet the iPhone has (navigator.canShare and navigator.share, played by this script), so "Back up now" takes the
// iPhone's own path, on BOTH engines, and the checks are:
//   1. the phone still counts the owner's tap when the share sheet is asked for (transient user activation): the backup is encrypted first
//      (600,000 rounds), and a share asked for after the tap has lapsed is REFUSED by a real iPhone;
//   2. closing the sheet (or cancelling Save to Files) says "Not saved", records no backup date, and the window stays to try again;
//   3. the retry hands over ONE file, records the backup date, and that very file restores the ledger, identical, on a wiped phone.
// Pictures are not in this script (WebKit's test build cannot keep them, see engine.mjs); backup-roundtrip.mjs proves them on Chromium.
import assert from "node:assert/strict";
import { launchBrowser, ENGINE } from "./engine.mjs";
import { emptyLedger, CHANGES, SCREEN_NAMES, validateState } from "../src/model/index.js";

const browser = await launchBrowser();
const base = process.env.BASE ?? "http://127.0.0.1:8124/app/index.html";
const errors = [], TS = "2026-11-23T03:00:00Z", PW = "invented share sheet 2026";
let passed = 0;
const ok = (cond, label) => { assert.ok(cond, label); passed++; console.log("ok: " + label); };

const seeded = () => {
  const l = emptyLedger(), s = l.state; l.rev = 3; l.saved_at = "2026-11-22T08:00:00.000+08:00";
  s.accounts.push({ id: "wal", name: "Sample Wallet", class: "asset", role: "", opening_balance: 250000, opening_date: "2026-01-01", hidden_by_default: false, archived: false });
  s.transactions.push({ id: "t1", date: "2026-11-22", payee: "Sample Shop", memo: "", status: "verified", source: "manual", edited_before_verify: false, created_at: "2026-11-22T09:00:00.000+08:00", verified_at: "2026-11-22T09:05:00.000+08:00" });
  s.entries.push({ transaction_id: "t1", category_id: "cat-food", amount: 12500 }, { transaction_id: "t1", account_id: "wal", amount: -12500 });
  assert.deepEqual(validateState(s), []);
  l.settings = { notice_seen_at: TS, whatsnew_seen: CHANGES[0].id, version_seen: "999.0.0", welcome_off: true, start_rule_seen: TS, cat_card_seen: TS, firstrun_done: TS, bankLogosTried: {},
    intro_off: Object.fromEntries(Object.keys(SCREEN_NAMES).map((k) => [k, true])), payee_book: { "sample shop": { name: "Corner shop", category_id: "cat-food" } } };
  return l;
};

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1";
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: IPHONE, acceptDownloads: true });
await ctx.route("**/*", (route) => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
// The iPhone's share sheet, played here. window.__sheet says what the owner does with it: "close" (closes it, or cancels Save to Files: the phone
// answers AbortError) or "save". Every call records whether the tap still counted and what was handed over.
await ctx.addInitScript(() => {
  Object.defineProperty(navigator, "standalone", { get: () => true });
  try { sessionStorage.setItem("logOpen", "1"); } catch {}
  window.__sheet = "save"; window.__shares = [];
  navigator.canShare = (data) => Array.isArray(data?.files) && data.files.length > 0;
  navigator.share = async ({ files }) => {
    const call = { active: navigator.userActivation ? navigator.userActivation.isActive : null, names: files.map((f) => f.name), files: [] };
    window.__shares.push(call);
    if (window.__sheet === "close") throw new DOMException("Share canceled", "AbortError");
    for (const f of files) { const b = new Uint8Array(await f.arrayBuffer()); let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); call.files.push({ name: f.name, type: f.type, b64: btoa(s) }); }
  };
});
await ctx.clock.setFixedTime(new Date(TS));
const page = await ctx.newPage(); page.on("pageerror", (e) => errors.push(e.message));
const downloads = []; page.on("download", (d) => downloads.push(d));
const ready = () => page.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 });
await page.goto(base); await ready();
const stored = () => page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open("financialTracker", 3); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const text = await new Promise((res) => { const g = db.transaction("kv").objectStore("kv").get("ledger"); g.onsuccess = () => res(g.result ?? null); }); db.close();
  return text;
});
await page.evaluate(async (text) => {
  localStorage.setItem("financialTracker.ledger", text);
  const db = await new Promise((res) => { const r = indexedDB.open("financialTracker", 3); r.onsuccess = () => res(r.result); });
  await new Promise((res) => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").put(text, "ledger"); t.oncomplete = res; }); db.close();
}, JSON.stringify(seeded()));
await page.reload(); await ready();
console.log("engine: " + ENGINE + ", user activation API: " + await page.evaluate(() => Boolean(navigator.userActivation)));

// Setup, Backup and restore, Back up now: the iPhone's path
await page.click("#menuBtn"); await page.click('#menu .item:has-text("Setup")');
await page.click('.setrow:has-text("Backup and restore")');
await page.click('button[data-action="open-backup"][data-all="1"]');
await page.fill("#b-pass", PW); await page.fill("#b-pass2", PW);

// 2. the owner closes the sheet (or cancels Save to Files)
await page.evaluate(() => { window.__sheet = "close"; });
await page.click("#f-save");
await page.waitForFunction(() => /Not saved|Could not/.test(document.getElementById("f-msg")?.textContent ?? ""), null, { timeout: 60000 });
const shares1 = await page.evaluate(() => window.__shares);
ok(shares1.length === 1 && shares1[0].names.length === 1, "Back up now hands ONE file to the share sheet (" + shares1.map((c) => c.names.join(" + ")).join() + ")");
if (shares1[0].active !== null) ok(shares1[0].active === true, "the tap still counts when the share sheet is asked for, after the encryption (an iPhone refuses a share once it has lapsed)");
else console.log("  note: this engine has no navigator.userActivation; the tap check runs on the other engine");
ok((await page.locator("#f-msg").innerText()) === "Not saved. Tap Create backup file to try again.", "a closed sheet says exactly: Not saved. Tap Create backup file to try again.");
ok(!JSON.parse(await stored()).settings.last_backup_at, "and no backup date is recorded: the reminder still says no backup");
ok(await page.locator("#sheet #f-save").isEnabled(), "the window stays, with Create backup file ready to tap again");

// 3. the retry: the owner taps Save in Files
await page.evaluate(() => { window.__sheet = "save"; });
await page.click("#f-save");
await page.waitForFunction(() => /Backup file created/.test(document.querySelector("#toast")?.innerText ?? ""), null, { timeout: 60000 });
const shares2 = await page.evaluate(() => window.__shares);
const call = shares2[1];
ok(shares2.length === 2 && call.files.length === 1 && /^fo-und backup \d{4}-\d{2}-\d{2} \d{2}-\d{2}\.json$/.test(call.files[0].name), "the retry hands over ONE backup file (" + call.files[0]?.name + ")");
if (call.active !== null) ok(call.active === true, "and the tap still counted on the retry too");
ok(downloads.length === 0, "nothing went the download way: the iPhone's share sheet was used both times");
const kept = JSON.parse(await stored());
ok(Boolean(kept.settings.last_backup_at), "the backup date is recorded only now, after the file was saved");
const bytes = Buffer.from(call.files[0].b64, "base64");
ok(bytes.length > 0 && bytes.subarray(0, 8).toString("latin1") === "FOUNDBK2", "the file is the one-file backup (FOUNDBK2), " + bytes.length + " bytes");

// the very file restores, identical, on a wiped phone (the first-run step "I have a backup")
await page.evaluate(async () => { localStorage.clear(); sessionStorage.clear(); await new Promise((res) => { const r = indexedDB.deleteDatabase("financialTracker"); r.onsuccess = r.onerror = r.onblocked = () => res(); }); });
await page.evaluate(() => { try { sessionStorage.setItem("logOpen", "1"); } catch {} });
await page.reload();
await page.locator("#sheet .frn").waitFor({ timeout: 60000 });
ok(await stored() === null, "the phone is wiped: the first-run setup shows");
await page.click('#sheet button:has-text("I have a backup")');
await page.setInputFiles("#r-file", { name: call.files[0].name, mimeType: call.files[0].type || "application/json", buffer: bytes });
await page.fill("#r-pass", PW); await page.click("#f-save");
await page.locator('#sheet :text("Replace this phone")').first().waitFor({ timeout: 60000 });
await Promise.all([page.waitForEvent("load", { timeout: 30000 }), (async () => { await page.click("#f-save"); await page.click("#f-save").catch(() => {}); })()]);
await ready();
await page.locator('#sheet button:has-text("Got it")').click({ timeout: 15000 }).catch(() => {});
let back = null; for (let i = 0; i < 40 && !back; i++) { back = await stored(); if (!back) await page.waitForTimeout(250); }
const L1 = kept, L2 = JSON.parse(back);
ok(JSON.stringify(L2.state) === JSON.stringify(L1.state), "the ledger's data comes back identical from the file the share sheet was given");
ok(L2.settings.payee_book?.["sample shop"]?.name === "Corner shop" && Boolean(L2.settings.last_backup_at), "with the owner's settings and the backup's own date");
ok(errors.length === 0, "no script errors" + (errors.length ? " -> " + errors[0] : ""));
await ctx.close(); await browser.close();
console.log(`backup-share (${ENGINE}): ${passed} checks passed`);

// Serve the repo on port 8124, then node e2e/backup-roundtrip.mjs. Every name and figure here is invented.
// DECISION 5 (owner, Nov 22): a backup holds EVERYTHING the owner keeps on the phone. Back up through the app, WIPE the phone (every store), restore
// from the first-run "I have a backup", and every store comes back the same: the ledger (its data and every setting the owner chose: payee names,
// payslip category memory, order of categories and accounts, buckets, look, paydays), the spare copy, and every picture byte for byte, the photos
// still waiting in the reading queue included (before this, they were left out and a restore quietly dropped them).
// Stays OUT by the owner's rule of Oct 30, and checked: the App lock record (a privacy screen for this phone, never in a file that leaves it).
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchBrowser, ENGINE, skippedPictures } from "./engine.mjs";
import { emptyLedger, CHANGES, SCREEN_NAMES, validateState } from "../src/model/index.js";
if (ENGINE === "webkit") { skippedPictures("backup round trip (pictures)"); process.exit(0); }
const browser = await launchBrowser();
const base = process.env.BASE ?? "http://127.0.0.1:8124/app/index.html";
const errors = [], TS = "2026-11-22T03:00:00Z", PW = "invented round trip 2026";
let passed = 0;
const ok = (cond, label) => { assert.ok(cond, label); passed++; console.log("ok: " + label); };

const seeded = () => {
  const l = emptyLedger(), s = l.state; l.rev = 7; l.saved_at = "2026-11-21T08:00:00.000+08:00";
  s.accounts.push({ id: "wal", name: "Sample Wallet", class: "asset", role: "", opening_balance: 250000, opening_date: "2026-01-01", hidden_by_default: false, archived: false },
    { id: "bnk", name: "Sample Bank", class: "asset", role: "", opening_balance: 900000, opening_date: "2026-01-01", hidden_by_default: false, archived: false, last4: "1234" });
  s.transactions.push({ id: "t1", date: "2026-11-20", payee: "Sample Shop", memo: "", status: "verified", source: "photo", edited_before_verify: false, created_at: "2026-11-20T09:00:00.000+08:00", verified_at: "2026-11-20T09:05:00.000+08:00" });
  s.entries.push({ transaction_id: "t1", category_id: "cat-food", amount: 12500 }, { transaction_id: "t1", account_id: "wal", amount: -12500 });
  s.attachments.push({ id: "pic-att", transaction_id: "t1", type: "photo", file: "pic-att", file_timestamp: "2026-11-20T09:00:00.000+08:00" });
  assert.deepEqual(validateState(s), []);
  l.settings = { notice_seen_at: TS, whatsnew_seen: CHANGES[0].id, version_seen: "999.0.0", welcome_off: true, start_rule_seen: TS, cat_card_seen: TS, firstrun_done: TS, bankLogosTried: {},
    intro_off: Object.fromEntries(Object.keys(SCREEN_NAMES).map((k) => [k, true])),
    // what the owner set on the phone: mappings, order, buckets, look, paydays, budgets helpers
    payee_book: { "sample shop": { name: "Corner shop", category_id: "cat-food" } }, payslip_categories: { "sample employer|earning|basic pay": "basic" },
    category_order: ["cat-food", "cat-transport"], account_order: ["bnk", "wal"], bucket_overrides: { "cat-food": "needs" }, appearance: "dark",
    pay_schedule: { kind: "twice", days: [15, "last"] }, goal_monthly: {}, buffer_monthly: 150000, backup_reminder: false,
    scan_queue: [{ id: "pic-q", at: "2026-11-21T07:00:00.000+08:00", needs: true, text: "SAMPLE RECEIPT 99.00" }] };   // read already, waiting for the owner: not read again
  return l;
};
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1";
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: IPHONE, acceptDownloads: true });
await ctx.route("**/*", (route) => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
await ctx.addInitScript(() => { Object.defineProperty(navigator, "standalone", { get: () => true }); try { sessionStorage.setItem("logOpen", "1"); } catch {} });
await ctx.clock.setFixedTime(new Date(TS));
const page = await ctx.newPage(); page.on("pageerror", (e) => errors.push(e.message));
const ready = () => page.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 });
await page.goto(base); await ready();

// EVERY store the app keeps: the ledger in IndexedDB and its spare in localStorage, every picture (as bytes), the safety copies and the lock record.
const snapshot = () => page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open("financialTracker", 3); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const all = (store) => new Promise((res) => { const t = db.transaction(store); const s = t.objectStore(store); const k = s.getAllKeys(); k.onsuccess = () => { const v = s.getAll(); v.onsuccess = () => res(k.result.map((key, i) => [key, v.result[i]])); }; });
  const photos = {}; for (const [k, b] of await all("photos")) photos[k] = Array.from(new Uint8Array(await b.arrayBuffer())).join(",");
  const kv = Object.fromEntries(await all("kv")), safety = Object.fromEntries(await all("safety")); db.close();
  return { ledger: kv.ledger ?? null, lock: kv.applock ?? null, safety, photos, spare: localStorage.getItem("financialTracker.ledger"), spareLock: localStorage.getItem("financialTracker.applock") };
});
const quiet = async () => { let last = null; for (let same = 0; same < 4;) { const now = JSON.stringify(await snapshot()); same = now === last ? same + 1 : 0; last = now; await page.waitForTimeout(300); } return JSON.parse(last); };

// seed the phone: the ledger in both stores and two pictures (one attached, one waiting in the queue)
await page.evaluate(async (text) => {
  localStorage.setItem("financialTracker.ledger", text);
  const db = await new Promise((res) => { const r = indexedDB.open("financialTracker", 3); r.onsuccess = () => res(r.result); });
  const pic = (fill, n) => new Blob([new Uint8Array(n).fill(fill)], { type: "image/jpeg" });
  await new Promise((res) => { const t = db.transaction(["kv", "photos"], "readwrite"); t.objectStore("kv").put(text, "ledger"); t.objectStore("photos").put(pic(7, 3000), "pic-att"); t.objectStore("photos").put(pic(9, 2000), "pic-q"); t.oncomplete = res; });
  db.close();
}, JSON.stringify(seeded()));
await page.reload(); await ready();
const before = await quiet();
const led0 = JSON.parse(before.ledger);
ok(Object.keys(before.photos).sort().join() === "pic-att,pic-q" && led0.settings.scan_queue.length === 1 && led0.settings.payee_book["sample shop"].name === "Corner shop", "the phone holds the ledger, the owner's settings, an attached picture and a photo waiting in the queue");

// back up through the app
await page.click("#menuBtn"); await page.click('#menu .item:has-text("Setup")');
await page.click('.setrow:has-text("Backup and restore")');
await page.click('button[data-action="open-backup"][data-all="1"]');
await page.fill("#b-pass", PW); await page.fill("#b-pass2", PW);
const got = []; page.on("download", (d) => got.push(d));
await page.click("#f-save");
await page.waitForFunction(() => /Backup file created/.test(document.querySelector("#toast")?.innerText ?? ""), null, { timeout: 60000 });
await page.waitForTimeout(500);
ok(got.length === 1 && (await page.locator("#toast").innerText()).includes("2 pictures"), "Back up now made ONE file with the ledger and BOTH pictures (" + (await page.locator("#toast").innerText()) + ")");
const file = join(mkdtempSync(join(tmpdir(), "rt-")), got[0].suggestedFilename()); await got[0].saveAs(file);
const backedUp = await quiet();   // the backup date the app keeps is the only change the backup itself makes

// WIPE: every store this app has on the phone
await page.evaluate(async () => { localStorage.clear(); sessionStorage.clear(); await new Promise((res) => { const r = indexedDB.deleteDatabase("financialTracker"); r.onsuccess = r.onerror = r.onblocked = () => res(); }); });
await page.evaluate(() => { try { sessionStorage.setItem("logOpen", "1"); } catch {} });
await page.reload();
await page.locator("#sheet .frn").waitFor({ timeout: 60000 });
const wiped = await snapshot();
ok(wiped.ledger === null && Object.keys(wiped.photos).length === 0 && wiped.spare === null, "the phone is wiped: no ledger, no spare, no picture; the first-run setup shows");

// restore from the first-run step "I have a backup"
await page.click('#sheet button:has-text("I have a backup")');
await page.setInputFiles("#r-file", [file]); await page.fill("#r-pass", PW); await page.click("#f-save");
await page.locator('#sheet :text("Replace this phone")').first().waitFor({ timeout: 30000 });
ok((await page.locator("#sheet").innerText()).includes("2 pictures missing here will be put back"), "the restore window counts BOTH pictures, the queued photo included");
await Promise.all([page.waitForEvent("load", { timeout: 30000 }), (async () => { await page.click("#f-save"); await page.click("#f-save").catch(() => {}); })()]);
await ready();
await page.locator('#sheet button:has-text("Got it")').click({ timeout: 15000 }).catch(() => {});
const after = await quiet();

// IDENTICAL: every picture byte for byte; the ledger's data; every setting the owner chose
ok(JSON.stringify(after.photos) === JSON.stringify(backedUp.photos), "every picture is back, byte for byte (the attached one and the one waiting in the queue)");
const L1 = JSON.parse(backedUp.ledger), L2 = JSON.parse(after.ledger);
ok(JSON.stringify(L2.state) === JSON.stringify(L1.state), "the ledger's data is identical: every account, entry, category and record");
// the only settings a restore itself writes: it marks the setup done after a restore (firstrun_done) and the restore is not a new backup. Everything else, equal.
const RESTORE_WRITES = new Set(["firstrun_done"]);
const changed = [...new Set([...Object.keys(L1.settings), ...Object.keys(L2.settings)])].filter((k) => !RESTORE_WRITES.has(k) && JSON.stringify(L1.settings[k]) !== JSON.stringify(L2.settings[k]));
ok(changed.length === 0, "every setting the owner chose is identical (payee names, payslip categories, order, buckets, look, paydays, buffer, reminder, the queue)" + (changed.length ? " -> differs: " + changed.join(", ") : ""));
ok(L2.settings.scan_queue.length === 1 && L2.settings.scan_queue[0].id === "pic-q" && after.photos["pic-q"], "the photo waiting to be read is back WITH its picture (before, the queue entry came back alone and was dropped)");
ok(after.spare === after.ledger, "the spare copy in localStorage matches the main store");
ok(after.lock === null && after.spareLock === null, "the App lock record stays out of a backup (owner's rule, Oct 30): a restore brings no lock");
ok(await page.evaluate(() => document.documentElement.dataset.theme) === "dark", "and the restored look is on screen (Dark)");
ok(errors.length === 0, "no script errors" + (errors.length ? " -> " + errors[0] : ""));
await ctx.close(); await browser.close();
console.log(`backup-roundtrip: ${passed} checks passed`);

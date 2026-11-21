// Serve the repo on port 8124, then node e2e/preview.mjs. Every name and figure here is invented.
// FIRST-RUN PREVIEW (owner, Nov 21): the owner walks the first-run setup on the phone that holds his real ledger. It runs in scratch storage of
// its own (wiped when it starts and when it ends), says so on every step, never offers the app lock (one real key), and leaves the real ledger,
// its copies and the lock record byte for byte as they were.
import assert from "node:assert/strict";
import { launchBrowser } from "./engine.mjs";
import { emptyLedger, CHANGES, SCREEN_NAMES, validateState } from "../src/model/index.js";
const browser = await launchBrowser();
const base = process.env.BASE ?? "http://127.0.0.1:8124/app/index.html";
const errors = [], TS = "2026-11-21T03:00:00Z";
let passed = 0;
const ok = (cond, label) => { assert.ok(cond, label); passed++; console.log("ok: " + label); };
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1";

const seeded = () => {
  const l = emptyLedger(), s = l.state; l.rev = 4; l.saved_at = "2026-11-20T08:00:00.000+08:00";
  s.accounts.push({ id: "wal", name: "Sample Wallet", class: "asset", role: "", opening_balance: 120000, opening_date: "2026-01-01", hidden_by_default: false, archived: false });
  s.categories = [{ id: "food", name: "Food", kind: "expense", role: "food" }, ...s.categories.filter((c) => c.kind === "income")];
  assert.deepEqual(validateState(s), []);
  l.settings = { notice_seen_at: TS, whatsnew_seen: CHANGES[0].id, welcome_off: true, start_rule_seen: TS, cat_card_seen: TS, firstrun_done: TS, bankLogosTried: {}, intro_off: Object.fromEntries(Object.keys(SCREEN_NAMES).map((k) => [k, true])) };
  return l;
};
const phone = async ({ standalone }) => {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: IPHONE });
  await ctx.route("**/*", (route) => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
  await ctx.addInitScript((sa) => { if (sa) Object.defineProperty(navigator, "standalone", { get: () => true }); try { sessionStorage.setItem("logOpen", "1"); } catch {} }, standalone);
  await ctx.clock.setFixedTime(new Date(TS));
  return ctx;
};
const ready = (page) => page.waitForFunction(() => document.querySelector("#nav button, #sheet .sheet, #banner .bar"), null, { timeout: 60000 });
// Everything the real copy keeps: the two ledger stores, the copies kept before an upgrade and a restore, and the lock record.
const realStores = (page) => page.evaluate(async () => {
  const local = Object.fromEntries(["financialTracker.ledger", "financialTracker.preupgrade", "financialTracker.restorecopy", "financialTracker.applock"].map((k) => [k, localStorage.getItem(k)]));
  const idb = await new Promise((res) => { const r = indexedDB.open("financialTracker", 3); r.onsuccess = () => { const db = r.result, out = {}; const tx = db.transaction(["kv"]); const st = tx.objectStore("kv"); const keys = st.getAllKeys(); keys.onsuccess = () => { const all = st.getAll(); all.onsuccess = () => { keys.result.forEach((k, i) => { out[k] = typeof all.result[i] === "string" ? all.result[i] : JSON.stringify(all.result[i]); }); db.close(); res(out); }; }; }; });
  return JSON.stringify({ local, idb });
});
const quiet = async (page) => { let last = null, same = 0; while (same < 4) { const now = await realStores(page); same = now === last ? same + 1 : 0; last = now; await page.waitForTimeout(300); } return last; };

{ const ctx = await phone({ standalone: true });
  const page = await ctx.newPage(); page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base); await ready(page);
  const lockRecord = { v: 1, on: false, salt: "AAAAAAAAAAAAAAAAAAAAAA==", iter: 150000, hash: "AAAA", fails: 0, until: 0 };   // a record that is there but off: it must stay exactly as it is
  await page.evaluate(async ({ text, lock }) => { localStorage.setItem("financialTracker.ledger", text); localStorage.setItem("financialTracker.applock", JSON.stringify(lock));
    await new Promise((res) => { const r = indexedDB.open("financialTracker", 3); r.onsuccess = () => { const tx = r.result.transaction("kv", "readwrite"); tx.objectStore("kv").put(text, "ledger"); tx.oncomplete = () => { r.result.close(); res(); }; }; }); }, { text: JSON.stringify(seeded()), lock: lockRecord });
  await page.reload(); await ready(page);
  const before = await quiet(page);
  ok(JSON.parse(JSON.parse(before).local["financialTracker.ledger"]).state.accounts[0].name === "Sample Wallet", "the real ledger is on the phone");

  await page.click("#menuBtn"); await page.click('#menu .item:has-text("Help")'); await page.waitForSelector('[data-action="open-preview"]');
  ok((await page.locator("#screen").innerText()).includes("Nothing is kept, and your ledger is not touched."), "Help offers \"Preview the first-run setup\" and says nothing is kept");
  await page.click('[data-action="open-preview"]');
  await page.waitForFunction(() => location.search === "?preview" && document.querySelector("#sheet .frn")?.textContent === "Step 1 of 5", null, { timeout: 30000 });
  ok((await page.locator("#fr-preview").innerText()).includes("Preview: nothing is kept, and your ledger is not touched."), "the setup opens at step 1 and says on the step that it is a preview");
  await page.click('#sheet button:has-text("Start fresh")'); await page.waitForFunction(() => document.querySelector("#sheet .frn")?.textContent === "Step 2 of 5");
  await page.fill("#fr-aname", "Preview Cash"); await page.fill("#fr-aopen", "0"); await page.click('#sheet button[data-action="fr-next"]');
  await page.waitForFunction(() => document.querySelector("#sheet .frn")?.textContent === "Step 3 of 5");
  ok(await page.locator("#fr-preview").count() === 1, "every step says it");
  await page.click('#sheet button[data-action="fr-later"]'); await page.waitForFunction(() => document.querySelector("#sheet .frn")?.textContent === "Step 4 of 5");
  ok(!(await page.locator("#sheet").innerText()).includes("App lock") && await page.locator('#sheet [data-action="lock-toggle"]').count() === 0 && await page.locator('#sheet button:has-text("Make a backup now")').count() === 0,
    "step 4 offers neither the app lock (one real key) nor a backup (it would hold only the scratch ledger)");
  const scratch = await page.evaluate(() => JSON.parse(localStorage.getItem("financialTracker.preview.ledger") ?? "null"));
  ok(scratch?.state.accounts.some((a) => a.name === "Preview Cash"), "what was typed lives in the preview's own scratch storage");
  ok(await realStores(page) === before, "and the real ledger, its copies and the lock record are byte for byte as they were");

  await page.click('#sheet button[data-action="fr-later"]'); await page.waitForFunction(() => document.querySelector("#sheet .frn")?.textContent === "Step 5 of 5");
  await page.click('#sheet button.primary');   // the last step's button ends the preview
  await page.waitForFunction(() => location.search === "" && document.querySelector("#nav button"), null, { timeout: 30000 }); await page.waitForTimeout(800);
  ok((await page.locator("#top").innerText()).includes("Log") && !(await page.locator("#banner").innerText()).includes("Preview") && await page.locator("#sheet .frn").count() === 0, "the last step ends the preview: the app opens on the real ledger");
  const after = await quiet(page);
  ok(after === before, "after the preview every real store is byte for byte what it was");
  ok(await page.evaluate(async () => localStorage.getItem("financialTracker.preview.ledger") === null && !(await indexedDB.databases()).some((d) => d.name === "financialTracker-preview")), "and the preview's scratch storage is gone");

  // End preview from the first step, too
  await page.goto(base + "?preview"); await page.waitForFunction(() => document.querySelector("#sheet .frn")?.textContent === "Step 1 of 5", null, { timeout: 30000 });
  await page.click('#sheet [data-action="end-preview"]');
  await page.waitForFunction(() => location.search === "" && document.querySelector("#nav button"), null, { timeout: 30000 });
  ok(await quiet(page) === before, "End preview from a step goes back to the untouched ledger");
  await ctx.close(); }

{ const ctx = await phone({ standalone: false });
  const page = await ctx.newPage(); page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "?preview"); await page.waitForFunction(() => document.querySelector("#sheet .frn")?.textContent === "Step 1 of 5", null, { timeout: 60000 });
  ok(await page.locator("#fr-preview").count() === 1, "in an iPhone's Safari tab (otherwise stopped) the preview opens too");
  await ctx.close(); }

ok(errors.length === 0, "no script errors" + (errors.length ? " -> " + errors[0] : ""));
await browser.close();
console.log(`preview: ${passed} checks passed`);

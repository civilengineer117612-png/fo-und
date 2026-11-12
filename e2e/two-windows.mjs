// Serve the repo on port 8124, then node e2e/two-windows.mjs. Every name and figure here is invented.
// TWO WINDOWS (owner, Nov 12, L1): the app open in two tabs or windows on one ledger. The second save used to replace the first without a word (both said
// "Saved"). Now a window saves only on top of the ledger it loaded: an out-of-date window is refused, writes nothing, says so, and offers "Load the latest".
// This script has its own ledger and its own windows, so it can be run alone.
import assert from "node:assert/strict";
import { launchBrowser } from "./engine.mjs";
import { emptyLedger, CHANGES, SCREEN_NAMES, CHANGED_ELSEWHERE } from "../src/model/index.js";
const browser = await launchBrowser();
const base = process.env.BASE ?? "http://127.0.0.1:8124/app/index.html";
const errors = [], TS = "2026-11-12T03:00:00Z";
let passed = 0;
const ok = (cond, label) => { assert.ok(cond, label); passed++; console.log("ok: " + label); };

const seeded = () => {
  const l = emptyLedger(); l.rev = 1; l.saved_at = "2026-11-10T08:00:00.000+08:00";
  l.state.accounts.push({ id: "chk", name: "Sample Checking", class: "asset", role: "", opening_balance: 5000000, opening_date: "2026-01-01", hidden_by_default: false, archived: false });
  l.state.categories = [{ id: "food", name: "Food", kind: "expense", role: "food" }, { id: "fun", name: "Fun", kind: "expense" }, ...l.state.categories.filter((c) => c.kind === "income")];
  l.settings = { notice_seen_at: TS, whatsnew_seen: CHANGES[0].id, welcome_off: true, start_rule_seen: TS, cat_card_seen: TS, bankLogosTried: {}, intro_off: Object.fromEntries(Object.keys(SCREEN_NAMES).map((k) => [k, true])) };
  return l;
};
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1" });
await ctx.route("**/*", (route) => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
// A window. `deaf` takes its news channel away, so only the save itself can find out (a window that was asleep hears nothing either).
async function open({ deaf = false, trial = false } = {}) {
  const page = await ctx.newPage(), url = trial ? base + "?trial" : base;
  if (!trial) await page.addInitScript(() => { Object.defineProperty(navigator, "standalone", { get: () => true }); sessionStorage.setItem("logOpen", "1"); });   // a real copy is the Home Screen app; a trial copy never is
  page.on("pageerror", (error) => errors.push(error.message));
  if (deaf) await page.addInitScript(() => { delete window.BroadcastChannel; });
  await page.clock.setFixedTime(new Date(TS));
  await page.goto(url); await page.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 });
  return page;
}
const stored = (page) => page.evaluate(() => new Promise((res) => { const r = indexedDB.open("financialTracker", 3); r.onsuccess = () => { const g = r.result.transaction("kv").objectStore("kv").get("ledger"); g.onsuccess = () => { r.result.close(); res({ idb: g.result ?? null, local: localStorage.getItem("financialTracker.ledger") }); }; }; }));
const spentOf = (text) => { const l = JSON.parse(text); return l.state.entries.filter((e) => e.category_id === "food").map((e) => e.amount).sort((a, b) => a - b).join(","); };
async function addExpense(page, amount) {
  await page.click('[data-action="open-other"]'); await page.waitForSelector("#sheet #f-amount"); await page.fill("#f-amount", amount);
  await page.evaluate(() => document.querySelector('#sheet [data-action="pick-cat"][data-id="food"]').click());
  await page.evaluate(() => document.querySelector('#sheet [data-action="pick-acct"][data-id="chk"]').click());
  await page.waitForFunction(() => !document.querySelector("#f-save").disabled);
  await page.click("#f-save");
}
const alertShown = (page) => page.locator('#warn [role="alertdialog"]:has-text("Changed in another window")').waitFor({ state: "visible", timeout: 8000 }).then(() => true, () => false);

// ---- the ledger is put on the phone, then every window opens on it
const first = await open();
await first.evaluate(async (text) => { localStorage.setItem("financialTracker.ledger", text);
  await new Promise((res) => { const r = indexedDB.open("financialTracker", 3); r.onsuccess = () => { const tx = r.result.transaction("kv", "readwrite"); tx.objectStore("kv").put(text, "ledger"); tx.oncomplete = () => { r.result.close(); res(); }; }; });
}, JSON.stringify(seeded()));
await first.close();
const A = await open(), B = await open({ deaf: true }), C = await open(), asleep = await open({ deaf: true });
// each window finishes its own start-up saves first (an idle window whose background save is refused quietly takes the latest and goes on)
const quiet = async () => { let last = null, same = 0; while (same < 5) { const now = (await stored(A)).idb; same = now === last ? same + 1 : 0; last = now; await A.waitForTimeout(500); } };
await quiet();
for (const w of [A, B, C, asleep]) ok(await w.locator("#warn [role=alertdialog]").count() === 0, "four windows opened together: no warning in a window where nothing is being done");

// ---- 1. window A saves; window B (opened before, and deaf) then tries to save
await addExpense(A, "11"); await A.locator("#toast").filter({ hasText: "Saved" }).waitFor({ timeout: 8000 });
const afterA = await stored(A);
ok(spentOf(afterA.idb) === "1100" && afterA.idb === afterA.local, "window A saved 11.00, in both stores");
await addExpense(B, "22");
ok(await alertShown(B), "window B, opened before that save, is told its data was changed in another window");
ok((await B.locator("#warn").innerText()).includes(CHANGED_ELSEWHERE) && (await B.locator("#warn").innerText()).includes("Nothing was saved from here"), "the window says nothing was saved from here");
ok(await B.locator("#warn button").count() === 1 && (await B.locator("#warn button.primary").innerText()).trim() === "Load the latest", "it offers one thing: Load the latest");
ok(!((await B.locator("#toast").innerText().catch(() => "")).includes("Saved")), "window B never says Saved");
const afterB = await stored(B);
ok(afterB.idb === afterA.idb && afterB.local === afterA.local, "nothing of window B's save was written: both stores are byte for byte what window A saved");
ok(spentOf(afterB.idb) === "1100", "the 11.00 from window A is still there (it used to be erased)");
ok(!(await B.locator("#screen").innerText()).includes("22.00"), "window B's screen does not show the entry it could not save");

// ---- 2. a window that was only being looked at takes the latest by itself; a sleeping one does when it comes back to the front
await C.locator("#toast").filter({ hasText: "Updated: your data was changed in another window." }).waitFor({ timeout: 8000 });
ok((await C.locator("#screen").innerText()).includes("11.00") && await C.locator("#warn [role=alertdialog]").count() === 0, "a third window with nothing open shows the 11.00 by itself, with one line saying why and no warning");
ok(!(await asleep.locator("#screen").innerText()).includes("11.00"), "a window that hears no news still shows the old data");
await asleep.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
await asleep.locator("#toast").filter({ hasText: "Updated" }).waitFor({ timeout: 8000 });
ok((await asleep.locator("#screen").innerText()).includes("11.00") && await asleep.locator("#warn [role=alertdialog]").count() === 0, "and takes the latest when it comes back to the front");
ok((await stored(A)).idb === afterA.idb, "taking the latest writes nothing");

// ---- 3. Load the latest: window B sees window A's entry and can save again; a window with something typed in it is warned, never replaced under the fingers
await C.click('[data-action="open-other"]'); await C.waitForSelector("#sheet #f-amount"); await C.fill("#f-amount", "44");
await B.click('#warn button[data-action="reload-latest"]'); await B.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 });
await B.waitForTimeout(800);
ok(await B.locator("#warn [role=alertdialog]").count() === 0 && (await B.locator("#screen").innerText()).includes("11.00"), "after Load the latest window B shows the 11.00 and no warning");
await addExpense(B, "22"); await B.locator("#toast").filter({ hasText: "Saved" }).waitFor({ timeout: 8000 });
const both = await stored(B);
ok(spentOf(both.idb) === "1100,2200" && both.idb === both.local, "window B's 22.00 is saved on top: the ledger holds both entries");
// window B has no news channel, so the others find out the way a window does that was asleep: when they come back to the front
await A.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
const aSees = await A.waitForFunction(() => document.querySelector("#screen").innerText.includes("22.00"), null, { timeout: 8000 }).then(() => true, () => false);
ok(aSees && await A.locator("#warn [role=alertdialog]").count() === 0, "window A, with nothing open, now shows the 22.00 too, with no warning");
await C.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
ok(await alertShown(C), "window C, with an amount typed into an open window, is warned");
ok(await C.inputValue("#sheet #f-amount") === "44", "and what was typed there is still on the screen, not replaced under the fingers");
{ const now = await stored(A); ok(now.idb === both.idb && now.local === both.local, "none of this wrote anything more"); }

// ---- 4. a trial copy and the real copy never hear each other
const trial = await open({ trial: true });
await trial.waitForTimeout(1500);
ok((await trial.locator("#banner").innerText()).includes("Trial copy"), "a trial copy is open beside the real one");
await addExpense(A, "33"); await A.locator("#toast").filter({ hasText: "Saved" }).waitFor({ timeout: 8000 });
await trial.waitForTimeout(1500);
ok(await trial.locator("#warn [role=alertdialog]").count() === 0 && !(await trial.locator("#toast").innerText().catch(() => "")).includes("Updated"), "a save in the real copy says nothing in a trial copy");
ok(spentOf((await stored(A)).idb) === "1100,2200,3300", "and the real ledger holds all three entries");

ok(errors.length === 0, "no script errors" + (errors.length ? " -> " + errors[0] : ""));
await browser.close();
console.log(`two-windows: ${passed} checks passed`);

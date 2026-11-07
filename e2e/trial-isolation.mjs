// Serve the repo on port 8124, then node e2e/trial-isolation.mjs. Every name and figure here is invented.
// "Start the trial over" must erase ONLY the trial copy (the database financialTracker-trial and the keys financialTracker.trial.*) and never the real ledger
// (the database financialTracker; the keys financialTracker, financialTracker.ledger, financialTracker.preupgrade, financialTracker.restorecopy, financialTracker.applock).
// Both copies live on ONE origin here (the worst case: they share localStorage and IndexedDB), opened in both orders. The real stores are compared byte for byte.
import assert from "node:assert/strict";
import { launchBrowser, ENGINE, skippedPictures } from "./engine.mjs";
import { emptyLedger, CHANGES } from "../src/model/index.js";

const browser = await launchBrowser();
const base = process.env.BASE ?? "http://127.0.0.1:8124/app/index.html";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1";
const errors = [], TS = "2026-10-22T03:00:00Z", AT = "2026-10-20T09:00:00.000+08:00";
const REAL_LS = ["financialTracker", "financialTracker.ledger", "financialTracker.preupgrade", "financialTracker.restorecopy", "financialTracker.applock"];

const ledgerText = (label) => {
  const l = emptyLedger(); l.rev = 1; l.saved_at = TS;
  l.state.accounts.push({ id: "acct-" + label, name: label + " account", class: "asset", role: "bank", opening_balance: 100000, opening_date: "2026-01-01", hidden_by_default: false, archived: false });
  l.state.categories.push({ id: "food", name: "Food", kind: "expense" });
  l.state.transactions.push({ id: "tx-" + label, date: "2026-10-05", payee: label + " marker", memo: "", status: "verified", source: "manual", created_at: AT, verified_at: AT });
  l.state.entries.push({ transaction_id: "tx-" + label, category_id: "food", amount: 5000 }, { transaction_id: "tx-" + label, account_id: "acct-" + label, amount: -5000 });
  l.settings = { notice_seen_at: TS, whatsnew_seen: CHANGES[0].id, welcome_off: true, start_rule_seen: TS, cat_card_seen: TS, intro_off: { scan: true, income: true, log: true, money: true } };
  return JSON.stringify(l);
};

// Put a value in the localStorage keys and the IndexedDB database (kv/ledger, safety/<key>, photos/p1) the way the app does.
const seed = (page, { ls, db, ledger, copies, photo }) => page.evaluate(async ({ ls, db, ledger, copies, photo }) => {
  for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v);
  await new Promise((res, rej) => {
    const r = indexedDB.open(db, 3);
    r.onupgradeneeded = () => { for (const n of ["kv", "photos", "safety"]) if (!r.result.objectStoreNames.contains(n)) r.result.createObjectStore(n); };
    r.onerror = () => rej(r.error);
    r.onsuccess = () => { const tx = r.result.transaction(["kv", "safety", "photos"], "readwrite"); tx.objectStore("kv").put(ledger, "ledger"); tx.objectStore("safety").put(copies, "copies"); if (photo !== null) tx.objectStore("photos").put(photo, "p1"); tx.oncomplete = () => { r.result.close(); res(); }; tx.onerror = () => rej(tx.error); };
  });
}, { ls, db, ledger, copies, photo });

// Everything stored under the REAL names: every localStorage key that is not a trial key, and every row of the database financialTracker.
const realSnapshot = (page) => page.evaluate(async () => {
  const ls = {}; for (const k of Object.keys(localStorage)) if (!k.includes(".trial.")) ls[k] = localStorage.getItem(k);
  const names = (await indexedDB.databases()).map((d) => d.name).sort();
  const db = await new Promise((res) => {
    const r = indexedDB.open("financialTracker", 3);
    r.onsuccess = () => {
      const out = {}, d = r.result, stores = [...d.objectStoreNames].sort();
      if (!stores.length) { d.close(); return res(out); }
      const tx = d.transaction(stores, "readonly"); let left = stores.length;
      for (const s of stores) { const os = tx.objectStore(s), keys = os.getAllKeys(), vals = os.getAll(); vals.onsuccess = () => { out[s] = keys.result.map((k, i) => [k, vals.result[i]]); if (--left === 0) { d.close(); res(out); } }; }
    };
    r.onerror = () => res({ error: String(r.error) });
  });
  return { ls, names, db };
});
const trialSnapshot = (page) => page.evaluate(async () => ({ ls: Object.fromEntries(Object.keys(localStorage).filter((k) => k.includes(".trial.")).map((k) => [k, localStorage.getItem(k)])), names: (await indexedDB.databases()).map((d) => d.name).sort() }));

// The app finishes its own start-up saves a moment after it opens (extra income categories, bank-logo bookkeeping). The comparison is only about what "Start over"
// does, so wait until the real stores have stopped changing (the same snapshot six times in a row, half a second apart) before taking the "before" picture.
async function settle(page, what) {
  let last = null, same = 0;
  for (let i = 0; i < 80 && same < 6; i++) {
    const now = JSON.stringify(await realSnapshot(page));
    same = now === last ? same + 1 : 0; last = now;
    await page.waitForTimeout(500);
  }
  assert.ok(same >= 6, what + ": the real stores never settled");
}

async function openPage(ctx, { real, label }) {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  if (real) await page.addInitScript(() => { Object.defineProperty(navigator, "standalone", { get: () => true }); sessionStorage.setItem("logOpen", "1"); });
  else await page.addInitScript(() => { sessionStorage.setItem("logOpen", "1"); });
  await page.clock.setFixedTime(new Date(TS));
  await page.goto(real ? base : base + "?trial");
  await page.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 });
  return page;
}
const newContext = async () => {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: IPHONE });
  await ctx.route("**/*", (route) => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
  return ctx;
};
const PHOTO = ENGINE === "webkit" ? null : "real photo bytes";   // the WebKit test build cannot store pictures in IndexedDB: the owner's iPhone can (engine.mjs)
if (PHOTO === null) skippedPictures("a real picture row is kept when the trial starts over");
const seedReal = async (page) => { await seed(page, { ls: { financialTracker: "legacy-marker", "financialTracker.preupgrade": JSON.stringify([{ at: AT, kind: "upgrade", text: "real copy" }]), "financialTracker.restorecopy": JSON.stringify([{ at: AT, kind: "restore", text: "real restore copy" }]), "financialTracker.applock": JSON.stringify({ on: false, marker: "real lock record" }), "financialTracker.ledger": ledgerText("Real") }, db: "financialTracker", ledger: ledgerText("Real"), copies: "real safety copies", photo: PHOTO }); };
const seedTrial = async (page) => { await seed(page, { ls: { "financialTracker.trial.ledger": ledgerText("Trial"), "financialTracker.trial.preupgrade": JSON.stringify([{ at: AT, kind: "upgrade", text: "trial copy" }]), "financialTracker.trial.restorecopy": JSON.stringify([{ at: AT, kind: "restore", text: "trial restore copy" }]) }, db: "financialTracker-trial", ledger: ledgerText("Trial"), copies: "trial safety copies", photo: PHOTO === null ? null : "trial photo bytes" }); };

// Start the trial over, in the page that shows the trial strip, and wait until the trial copy is gone (a fresh empty one may then be made).
async function startOver(page) {
  await page.click('.trialstrip button:has-text("Start over")');
  await page.waitForFunction(() => document.querySelector("#banner")?.innerText.includes("Tap again to erase"), null, { timeout: 15000 });
  await page.click('.trialstrip button:has-text("Tap again to erase")');
  await page.waitForFunction(() => !(localStorage.getItem("financialTracker.trial.ledger") ?? "").includes("Trial marker") && document.querySelector("#banner")?.innerText.includes("Trial copy") && !document.querySelector("#banner")?.innerText.includes("Tap again"), null, { timeout: 30000 });
  await page.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 });
}

async function scenario(order) {
  const ctx = await newContext();
  let real, trial;
  if (order === "real first") {
    real = await openPage(ctx, { real: true }); await seedReal(real); await real.reload(); await real.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 });
    trial = await openPage(ctx, { real: false }); await seedTrial(trial); await trial.reload(); await trial.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 });
  } else {
    trial = await openPage(ctx, { real: false }); await seedTrial(trial); await trial.reload(); await trial.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 });
    real = await openPage(ctx, { real: true }); await seedReal(real); await real.reload(); await real.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 });
  }
  assert.ok((await trial.locator("#banner .trialstrip").innerText()).includes("Trial copy"), order + ": the trial page shows the trial strip");
  assert.equal(await trial.locator("#banner .trialstrip").count(), 1);
  assert.equal(await real.locator("#banner .trialstrip").count(), 0, order + ": the real page is not a trial");
  await settle(real, order);
  const before = await realSnapshot(real), trialBefore = await trialSnapshot(trial);
  assert.ok(before.ls["financialTracker.ledger"].includes("Real marker") && before.db.kv?.[0]?.[1].includes("Real marker"), order + ": the real ledger is what we seeded, in both stores");
  assert.ok(trialBefore.ls["financialTracker.trial.ledger"].includes("Trial marker") && trialBefore.names.includes("financialTracker-trial"), order + ": the trial copy holds its own data");
  assert.ok(before.names.includes("financialTracker"), order + ": the real database exists");

  await startOver(trial);

  const after = await realSnapshot(trial), afterFromReal = await realSnapshot(real), trialAfter = await trialSnapshot(trial);
  assert.deepEqual(after, before, order + ": every real key and every row of the real database is byte for byte what it was (seen from the trial page)");
  assert.deepEqual(afterFromReal, before, order + ": and the same seen from the real page");
  for (const k of REAL_LS) assert.ok(k in after.ls, order + ": " + k + " still exists");
  assert.ok(after.names.includes("financialTracker"), order + ": the real database still exists");
  assert.ok(!(trialAfter.ls["financialTracker.trial.ledger"] ?? "").includes("Trial marker"), order + ": the trial ledger is erased");
  // the trial database was deleted (a fresh empty one may have been made at once): its old rows are gone
  const old = await trial.evaluate(() => new Promise((res) => { const r = indexedDB.open("financialTracker-trial", 3); r.onsuccess = () => { const d = r.result; if (![...d.objectStoreNames].includes("safety")) { d.close(); return res("none"); } const q = d.transaction("safety").objectStore("safety").get("copies"); q.onsuccess = () => { d.close(); res(q.result ?? "none"); }; }; r.onerror = () => res("none"); }));
  assert.ok(old === "none", order + ": the trial database's old rows are gone (found " + String(old).slice(0, 40) + ")");
  // the real copy still opens with its own data
  await real.reload(); await real.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 });
  assert.deepEqual(await realSnapshot(real), before, order + ": after reopening the real copy nothing changed either");
  // Only trial names were ever touched: every key that differs from before is a trial key (the real snapshot excludes them by construction), and no real key was added or removed
  assert.deepEqual(Object.keys(after.ls).sort(), Object.keys(before.ls).sort(), order + ": no real key was added or removed");
  await ctx.close();
  console.log("ok: " + order + ": Start over erased only the trial copy; the real ledger, copies, lock record and photos are byte for byte unchanged");
}

try {
  await scenario("real first");
  await scenario("trial first");
  assert.deepEqual(errors, [], "no script errors");
  console.log("trial-isolation: both orders passed (" + ENGINE + ")");
} finally { await browser.close(); }

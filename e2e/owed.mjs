// Serve the repo on port 8124, then node e2e/owed.mjs. Every name and figure here is invented.
// SPLIT AND "OWED TO ME" (owner, Nov 14, overhaul A4; data version 12). A version 11 ledger is updated with the app's own safety copy first; then, on that
// same ledger: a 3,000.00 dinner split three ways counts 1,000.00 as spending, Ana pays her 1,000.00 back (a move, not income), Ben never pays (his
// 1,000.00 becomes the owner's spending), and "Owed to me" is in no account list and not in the big figure on Cards.
import assert from "node:assert/strict";
import { launchBrowser, tapSafety } from "./engine.mjs";
import * as M from "../src/model/index.js";
const browser = await launchBrowser();
const base = process.env.BASE ?? "http://127.0.0.1:8124/app/index.html";
const errors = [], TS = "2026-11-14T03:00:00Z", TODAY = "2026-11-14", CT = "2026-11-02T09:00:00.000+08:00";
let passed = 0;
const ok = (cond, label) => { assert.ok(cond, label); passed++; console.log("ok: " + label); };
const P = (c) => M.formatPesos(c);

// A hand-written version 11 ledger: no `people` list, no person on any line.
const v11 = () => {
  const l = M.emptyLedger(), s = l.state; l.v = 11; l.rev = 7; l.saved_at = CT; delete s.people;
  const acct = (id, name, opening, o = {}) => ({ id, name, class: "asset", role: "", opening_balance: opening, opening_date: "2026-01-01", hidden_by_default: false, archived: false, last4: "", ...o });
  s.accounts.push(acct("cash", "Cash", 200000), acct("chk", "Sample Checking", 5000000), acct("wal", "Sample Wallet", 300000), acct("card", "Sample Card", 0, { class: "liability" }));
  s.categories = [{ id: "cat-food", name: "Food", kind: "expense", role: "food" }, { id: "cat-fun", name: "Fun", kind: "expense" }, { id: M.UNLOGGED_CATEGORY_ID, name: "Uncategorized", kind: "expense" }, ...s.categories.filter((c) => c.kind === "income"), ...M.INCOME_CATEGORIES.filter((c) => !s.categories.some((x) => x.id === c.id))];
  s.transactions.push({ id: "old1", date: "2026-11-02", payee: "Sample Grocer", memo: "", status: "verified", source: "manual", created_at: CT, verified_at: CT });
  s.entries.push({ transaction_id: "old1", category_id: "cat-food", amount: 45000 }, { transaction_id: "old1", account_id: "chk", amount: -45000 });
  l.settings = { notice_seen_at: TS, whatsnew_seen: M.CHANGES[0].id, welcome_off: true, start_rule_seen: TS, cat_card_seen: TS, bankLogosTried: {}, last_backup_at: TS, intro_off: Object.fromEntries(Object.keys(M.SCREEN_NAMES).map((k) => [k, true])) };
  return l;
};
const original = v11();
assert.equal("people" in original.state, false);

const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1" });
await ctx.addInitScript(() => { Object.defineProperty(navigator, "standalone", { get: () => true }); sessionStorage.setItem("logOpen", "1"); });
await ctx.clock.setFixedTime(new Date(TS));   // on the window, before any page: on WebKit a fresh page's own clock was not ready yet
const open = async () => { const page = await ctx.newPage(); page.on("pageerror", (e) => errors.push(e.message)); await page.goto(base); await page.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 }); return page; };
const stored = async (page) => { await page.waitForFunction(() => !document.documentElement.dataset.saving); return page.evaluate(() => new Promise((res) => { const r = indexedDB.open("financialTracker", 3); r.onsuccess = () => { const g = r.result.transaction("kv").objectStore("kv").get("ledger"); g.onsuccess = () => { r.result.close(); res(JSON.parse(g.result)); }; }; })); };
const first = await open();
await first.evaluate(async (text) => { localStorage.setItem("financialTracker.ledger", text);
  await new Promise((res) => { const r = indexedDB.open("financialTracker", 3); r.onsuccess = () => { const tx = r.result.transaction("kv", "readwrite"); tx.objectStore("kv").put(text, "ledger"); tx.oncomplete = () => { r.result.close(); res(); }; }; });
}, JSON.stringify(original));
await first.close();
const page = await open();
const text = async (sel) => (await page.locator(sel).innerText()).replace(/\s+/g, " ").trim();
const menu = async (name) => { await page.click("#menuBtn"); await page.click(`#menu .item:has-text("${name}")`); await page.waitForFunction(() => !document.querySelector("#menu .drawer")); };
const nav = async (name) => { await page.click(`#nav button:has-text("${name}")`); };
const pick = async (key, name) => { await page.click(`#sheet [data-action="pick-toggle"][data-key="${key}"]`); await page.locator(`#sheet .pick:has([data-key="${key}"]) .pickitem`, { hasText: name }).first().click(); await page.waitForFunction((k) => document.querySelector(`#sheet [data-action="pick-toggle"][data-key="${k}"]`)?.getAttribute("aria-expanded") === "false", key); };
const toast = (words) => page.locator("#toast").filter({ hasText: words }).waitFor({ timeout: 8000 });
const balance = (led, id) => M.naturalBalance(led.state.accounts.find((a) => a.id === id), M.countedEntries(led.state));
const spent = (led) => M.spendingByCategory(led.state, { month: "2026-11" });
const amountOf = (i) => page.inputValue(`#sheet [data-field="sh:${i}:amt"]`);

// ---- 1. the update from data version 11: the app keeps its own copy first, then adds the empty list; nothing else changes
{ await page.waitForFunction((v) => JSON.parse(localStorage.getItem("financialTracker.ledger")).v === v, M.LEDGER_VERSION, { timeout: 30000 });
  const kept = await page.evaluate(async () => {
    const local = JSON.parse(localStorage.getItem("financialTracker.preupgrade") ?? "[]");
    const idb = await new Promise((res) => { const r = indexedDB.open("financialTracker", 3); r.onsuccess = () => { const g = r.result.transaction("safety").objectStore("safety").get("copies"); g.onsuccess = () => { r.result.close(); res(g.result ?? []); }; g.onerror = () => res([]); }; r.onerror = () => res([]); });
    return { local, idb };
  });
  for (const [name, list] of [["the spare store", kept.local], ["the main store", kept.idb]]) {
    const copy = list.length === 1 ? JSON.parse(list[0].text) : null;
    ok(copy && copy.v === 11 && JSON.stringify(copy.state) === JSON.stringify(original.state), "before the update the app kept the version 11 ledger in " + name + ", and the copy reads back exactly as it was");
  }
  const led = await stored(page);
  ok(led.v === 12 && M.LEDGER_VERSION === 12 && Array.isArray(led.state.people) && led.state.people.length === 0, "the ledger is now data version 12 with an empty list of people");
  ok(Object.keys(original.state).every((k) => JSON.stringify(led.state[k]) === JSON.stringify(original.state[k])) && Object.keys(led.state).length === Object.keys(original.state).length + 1, "every record is the same: nothing but the new list was added");
  ok(!led.state.accounts.some((a) => a.role === "owed"), "the update makes no Owed to me account: it is made at the first split");
  ok(balance(led, "chk") === 5000000 - 45000 && spent(led).total === 45000, "the balance and this month's spending are what they were");
}

// ---- 2. Add expense: Split with others
await page.click('[data-action="open-other"]'); await page.waitForSelector("#sheet #f-amount");
ok((await text('#sheet .sharetoggle')) === "Split with others Only your share is spending Off" && await page.locator("#sheet .owerow").count() === 0, "Add expense has the switch Split with others, off, with nothing under it");
await page.fill("#f-amount", "3,000"); await page.fill("#f-payee", "Dinner"); await pick("cat", "Food"); await pick("acct", "Sample Checking");
ok(!(await page.isDisabled("#f-save")), "with the switch off the entry can be saved as before");
await page.click('#sheet [data-action="toggle-share"]'); await page.waitForSelector("#sheet .owerow");
ok(await page.isDisabled("#f-save") && (await text("#share-why")) === "Type who owes you.", "switched on, Save waits and says what is missing: who owes you");
await page.fill('#sheet [data-field="sh:0:name"]', "Ana");
ok((await amountOf(0)) === "1,500.00" && (await text("#share-yours")) === "₱1,500.00" && !(await page.isDisabled("#f-save")), "one person: an equal part each, 1,500.00, and your share is ₱1,500.00");
await page.click('#sheet [data-action="share-add"]'); await page.waitForSelector('#sheet [data-field="sh:1:name"]');
ok((await page.inputValue("#f-amount")) === "3,000" && (await page.inputValue('#sheet [data-field="sh:0:name"]')) === "Ana", "Add a person keeps everything typed so far");
await page.fill('#sheet [data-field="sh:1:name"]', "ana");
ok(await page.isDisabled("#f-save") && (await text("#share-why")) === "Each person can be listed once.", "the same person twice is refused, whatever the capitals");
await page.fill('#sheet [data-field="sh:1:name"]', "Ben");
ok((await amountOf(0)) === "1,000.00" && (await amountOf(1)) === "1,000.00" && (await text("#share-yours")) === "₱1,000.00", "three people: 1,000.00 each and your share ₱1,000.00");
await page.fill('#sheet [data-field="sh:0:amt"]', "500");
ok((await amountOf(1)) === "1,250.00" && (await text("#share-yours")) === "₱1,250.00", "typing Ana's part as 500 shares the rest equally: Ben 1,250.00, you ₱1,250.00");
await page.fill('#sheet [data-field="sh:0:amt"]', "3,000");
ok(await page.isDisabled("#f-save") && (await text("#share-why")) === "Your own share must be more than zero.", "the others cannot owe all of it: Save waits and says so");
await page.fill('#sheet [data-field="sh:0:amt"]', "");
ok((await amountOf(1)) === "1,000.00" && (await text("#share-yours")) === "₱1,000.00" && !(await page.isDisabled("#f-save")), "emptying Ana's part goes back to equal parts");
await page.locator('#sheet [data-field="sh:1:amt"]').focus();   // Save is tapped straight after the last box, as a finger does
await page.click("#f-save"); await toast("Saved Food ₱1,000.00");
let led = await stored(page);
const dinner = led.state.transactions.find((t) => t.payee === "Dinner"), owedId = led.state.accounts.find((a) => a.role === "owed")?.id;
const [ana, ben] = ["Ana", "Ben"].map((n) => led.state.people.find((p) => p.name === n)?.id);
ok(dinner?.status === "draft" && owedId && ana && ben && led.state.people.length === 2, "saved as ONE draft; the Owed to me account and the two people were made in the same save");
assert.deepEqual(led.state.entries.filter((e) => e.transaction_id === dinner.id), [{ transaction_id: dinner.id, category_id: "cat-food", amount: 100000 }, { transaction_id: dinner.id, account_id: "chk", amount: -300000 },
  { transaction_id: dinner.id, account_id: owedId, person_id: ana, amount: 100000 }, { transaction_id: dinner.id, account_id: owedId, person_id: ben, amount: 100000 }]);
ok(true, "its lines: Food 1,000.00, Sample Checking -3,000.00, Ana 1,000.00 and Ben 1,000.00 on Owed to me: they add to zero");
ok(balance(led, "chk") === 5000000 - 45000 - 300000, "the whole 3,000.00 left Sample Checking");
ok((await text("#screen")).includes("+ ₱1,000.00 waiting in Verify") && (await text("#screen")).includes("your share of ₱3,000.00") && (await text("#screen")).includes("-₱1,000.00"), "Log shows ₱1,000.00 waiting in Verify, and the entry as -₱1,000.00, your share of ₱3,000.00");

// ---- 3. Verify: one card, as drawn
await nav("Verify"); await page.waitForSelector('#screen [data-action="verify-ok"]');
ok((await text("#screen .card .what")) === "Dinner" && (await text("#screen .card .big")) === "₱3,000.00", "Verify shows Dinner with what was paid, ₱3,000.00");
ok(/Category Food Paid from (S )?Sample Checking Your share ₱1,000\.00 Ana owes ₱1,000\.00 Ben owes ₱1,000\.00$/.test(await text("#screen .card dl")), "and its rows: Category, Paid from, Your share, Ana owes, Ben owes");
await page.click('#screen [data-action="verify-ok"]'); await page.waitForFunction(() => !document.querySelector('#screen [data-action="verify-ok"]'));
led = await stored(page);
ok(spent(led).total === 45000 + 100000 && spent(led).rows.find((r) => r.category_id === "cat-food").amount === 145000, "verified: Food this month went up by ₱1,000.00, your share, not by the ₱3,000.00 paid");
ok(M.spendingByAccount(led.state, { month: "2026-11" }).total === spent(led).total, "Accounts and Category give the same total");
await nav("Log"); await page.waitForSelector(".daytotal");
ok((await text(".daytotal")) === "₱1,000.00", "Spent today is ₱1,000.00");

// ---- 4. Cards: Owed to me, apart from the accounts and from the big figure; in no other list
await menu("Cards"); await page.waitForSelector('#screen [data-action="open-person"]');
ok(!(await text("#screen")).includes("1,000.00") && /owed to me/i.test(await text("#screen")), "Cards opens with every amount hidden, the Owed to me amounts too");
await page.click('[data-action="cards-eye"]'); await page.waitForFunction(() => document.querySelector("#screen .netbig")?.textContent.includes("."));
const rows = (await page.locator('#screen [data-action="open-person"]').allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
ok(JSON.stringify(rows) === JSON.stringify(["AAna ₱1,000.00", "BBen ₱1,000.00"]), "shown: one row per person, Ana ₱1,000.00 and Ben ₱1,000.00 -> " + JSON.stringify(rows));
const free = balance(led, "cash") + balance(led, "chk") + balance(led, "wal") - balance(led, "card");
ok((await text("#screen .netbig")) === P(free) && free === 200000 + 5000000 - 45000 - 300000 + 300000, "the big figure is " + P(free) + ": what is in the accounts, without the ₱2,000.00 owed to you");
ok(await page.locator("#screen .gridcards .gcard").count() === 4 && !/owed to me/i.test(await text("#screen .gridcards")), "Owed to me is not one of the account cards");
ok(M.netWorthSeries(led.state, { today: TODAY }).points.at(-1).net === free, "net worth today is the same figure");
await menu("Setup"); await page.locator("#screen button, #screen [data-action]").filter({ hasText: "Accounts" }).first().click(); await page.waitForSelector("#screen .acctrow");
ok(await page.locator("#screen .acctrow").count() === 4 && !/owed to me/i.test(await text("#screen")), "Setup lists the four accounts; Owed to me is not an account to change, hide or remove");
await menu("Weekly review"); await page.waitForSelector("#screen");
ok(!/owed to me/i.test(await text("#screen")), "the Weekly review does not ask to count it");
await nav("Log"); await page.click('[data-action="open-other"]'); await page.waitForSelector("#sheet #f-amount");
await page.click('#sheet [data-action="pick-toggle"][data-key="acct"]');
ok(!(await page.locator('#sheet .pick:has([data-key="acct"]) .pickitem').allInnerTexts()).join("|").includes("Owed"), "it is not offered under Paid from");
await page.click('#sheet button[data-action="close-sheet"]'); await page.waitForFunction(() => !document.querySelector("#sheet .sheet"));

// ---- 5. Ana paid me back: a move into the account, never income
await menu("Cards"); await page.click('[data-action="cards-eye"]'); await page.locator('#screen [data-action="open-person"]', { hasText: "Ana" }).click(); await page.waitForSelector("#sheet #f-amount");
ok((await text("#sheet h3")) === "Ana" && (await text("#sheet .hero")) === "₱1,000.00" && (await text("#sheet .owefor")) === "Dinner · Sat, Nov 14", "Ana's window: she owes ₱1,000.00, for Dinner on Nov 14");
ok(await page.locator("#sheet button.primary").count() === 1 && (await page.inputValue("#sheet #f-amount")) === "1,000.00" && await page.isDisabled("#f-save"), "one filled button, Paid me back; the amount starts at what she owes; it waits for the account");
await pick("to", "Sample Wallet");
ok(!(await page.isDisabled("#f-save")), "with the account chosen it can be saved");
await page.fill("#sheet #f-amount", "1,000.01");
ok(await page.isDisabled("#f-save") && (await text("#person-why")) === "That is more than they owe you.", "more than she owes is refused and says so");
await page.fill("#sheet #f-amount", "1,000");
await page.click("#f-save"); await toast("₱1,000.00 from Ana");
led = await stored(page);
const back = led.state.transactions.find((t) => t.payee === "Ana");
assert.deepEqual(led.state.entries.filter((e) => e.transaction_id === back.id), [{ transaction_id: back.id, account_id: "wal", amount: 100000 }, { transaction_id: back.id, account_id: owedId, person_id: ana, amount: -100000 }]);
ok(back.status === "draft", "the pay-back is one draft: Sample Wallet +1,000.00, Ana -1,000.00 on Owed to me, and no category line");
await nav("Verify"); await page.waitForSelector('#screen [data-action="verify-ok"]');
ok((await text("#screen .card .what")) === "Ana paid you back" && (await text("#screen .card .big")) === "₱1,000.00" && /Paid into (S )?Sample Wallet$/.test(await text("#screen .card dl")) && !(await text("#screen .card")).includes("Same amount"), "Verify shows Ana paid you back, ₱1,000.00, Paid into Sample Wallet, with no same-amount warning");
await page.click('#screen [data-action="verify-ok"]'); await page.waitForFunction(() => !document.querySelector('#screen [data-action="verify-ok"]'));
led = await stored(page);
ok(balance(led, "wal") === 300000 + 100000 && spent(led).total === 145000 && !led.state.entries.some((e) => e.transaction_id === back.id && e.category_id), "verified: the wallet holds 1,000.00 more, spending is unchanged, and nothing was counted as income");

// ---- 6. Ben will not pay: his share becomes the owner's spending, in Food
await menu("Cards"); await page.click('[data-action="cards-eye"]');
ok((await page.locator('#screen [data-action="open-person"]').allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim()).join() === "BBen ₱1,000.00", "only Ben is left under Owed to me");
await page.locator('#screen [data-action="open-person"]', { hasText: "Ben" }).click(); await page.waitForSelector('#sheet [data-action="person-unpaid"]');
await page.click('#sheet [data-action="person-unpaid"]');
await page.waitForFunction(() => document.querySelector('#sheet [data-action="person-unpaid"]')?.textContent.includes("Tap again"));
ok((await text('#sheet [data-action="person-unpaid"]')) === "Tap again: ₱1,000.00 becomes your spending" && (await stored(page)).state.transactions.length === led.state.transactions.length, "Will not pay asks for a second tap and says what it does; nothing is made yet");
await page.click('#sheet [data-action="person-unpaid"]'); await toast("is now your spending");
await nav("Verify"); await page.waitForSelector('#screen [data-action="verify-ok"]');
ok((await text("#screen .card .what")) === "Ben did not pay" && (await text("#screen .card .big")) === "₱1,000.00" && /Category Food$/.test(await text("#screen .card dl")) && !(await text("#screen .card")).includes("Same amount"), "Verify shows Ben did not pay, ₱1,000.00, Category Food, with no same-amount warning");
await page.click('#screen [data-action="verify-ok"]'); await page.waitForFunction(() => !document.querySelector('#screen [data-action="verify-ok"]'));
led = await stored(page);
ok(spent(led).rows.find((r) => r.category_id === "cat-food").amount === 45000 + 200000 && M.owedSummary(led.state).total === 0, "verified: Food holds two shares of the dinner now (2,000.00), and nobody owes anything");
await nav("Log"); await page.waitForSelector(".daytotal");
ok((await text(".daytotal")) === "₱2,000.00", "Spent today is ₱2,000.00");
await menu("Cards"); await page.click('[data-action="cards-eye"]'); await page.waitForFunction(() => document.querySelector("#screen .netbig")?.textContent.includes("."));
ok(await page.locator('#screen [data-action="open-person"]').count() === 0 && !/owed to me/i.test(await text("#screen")), "Cards shows no Owed to me section when nobody owes");
ok(JSON.stringify(M.ledgerProblems(led.state)) === "[]" && M.selfCheck(led).length === 0, "the ledger check finds no problem");

// ---- 7. a spoken entry: the same switch, and one kind of split at a time
await nav("Log"); await page.click('button[data-action="open-voice"]'); await page.waitForSelector("#v-text");
await page.fill("#v-text", "taxi 600 at Sample Cab"); await page.click("#f-save"); await page.waitForSelector('#sheet [data-action="toggle-share"]');
ok((await text("#sheet h3")) === "Check what I heard" && await page.locator('#sheet [data-action="toggle-split"]').count() === 1, "the form for a spoken (or scanned) entry has Split with others next to Split receipt");
await page.click('#sheet [data-action="toggle-split"]'); await page.waitForSelector("#sheet #f-split");
await page.click('#sheet [data-action="toggle-share"]'); await page.waitForSelector("#sheet .owerow");
ok(await page.locator("#sheet #f-split").count() === 0 && (await text('#sheet [data-action="toggle-split"]')) === "Split receipt", "turning Split with others on closes Split receipt: one kind of split at a time");
await page.fill('#sheet [data-field="sh:0:name"]', "Ana");
if (await page.locator('#sheet [data-action="pick-toggle"][data-key="cat"] .ph').count()) await pick("cat", "Fun");
await pick("acct", "Cash");
ok((await amountOf(0)) === "300.00" && (await text("#share-yours")) === "₱300.00", "600.00 with Ana: 300.00 each");
await page.waitForFunction(() => !document.querySelector("#f-save").disabled);
await page.click("#f-save"); await page.waitForFunction(() => !document.querySelector("#sheet .sheet"));
led = await stored(page);
const taxi = led.state.transactions.find((t) => t.source === "voice");
ok(taxi?.status === "draft" && led.state.people.length === 2 && led.state.accounts.filter((a) => a.role === "owed").length === 1, "saved as a spoken draft; Ana is the same person as before and there is still one Owed to me account");
ok(JSON.stringify(led.state.entries.filter((e) => e.transaction_id === taxi.id).map((e) => [e.category_id ?? e.account_id, e.person_id ?? null, e.amount]).sort()) === JSON.stringify([[taxi && led.state.entries.find((e) => e.transaction_id === taxi.id && e.category_id).category_id, null, 30000], ["cash", null, -60000], [owedId, ana, 30000]].sort()), "its lines: your share 300.00, Cash -600.00, Ana 300.00 on Owed to me");

ok(tapSafety.size === 0, "tap-safety: 0 places" + (tapSafety.size ? " -> " + [...tapSafety.keys()].join("; ") : ""));
ok(errors.length === 0, "no script errors" + (errors.length ? " -> " + errors[0] : ""));
await browser.close();
console.log(`owed: ${passed} checks passed`);

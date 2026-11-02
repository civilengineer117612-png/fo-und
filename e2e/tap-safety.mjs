// Serve the repo on port 8124, then node e2e/tap-safety.mjs. Every name and figure here is invented.
// TAP SAFETY (owner, Nov 1, after the Safari P0): on Safari's engine a tap is lost when the button under the finger changes between the press and the
// release. Each window below is filled to its LAST box (or last choice) and the next button is tapped AT ONCE, with a finger-length hold (engine.mjs).
// Where the iPhone itself does something the moment a box is left, the test does the same:
//   - a list (select) reports its new choice only when its picker closes, which is often the tap on the next button: "change" fires on leaving it;
//   - a refresh that runs on leaving a box (as the payslip window does): "input" fires on leaving the box;
//   - autocorrect replaces the last word when the box is left: "input" fires on leaving the search box, with the corrected word.
// Each test checks that the tap did its job AND that the watcher saw no change under the finger (tapSafety, engine.mjs).
import assert from "node:assert/strict";
import { launchBrowser, tapSafety } from "./engine.mjs";
import { emptyLedger, CHANGES } from "../src/model/index.js";
const browser = await launchBrowser();
const base = process.env.BASE ?? "http://127.0.0.1:8124/app/index.html";
const errors = [], TS = "2026-10-22T03:00:00Z", AT = "2026-10-20T09:00:00.000+08:00";
async function open(seedLedger) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1" });
  await ctx.route("**/*", (route) => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
  await ctx.addInitScript(() => { Object.defineProperty(navigator, "standalone", { get: () => true }); sessionStorage.setItem("logOpen", "1"); });
  const page = await ctx.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date(TS));
  await page.goto(base); await page.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 });
  await page.evaluate(async (text) => {
    localStorage.setItem("financialTracker.ledger", text);
    await new Promise((res) => { const r = indexedDB.open("financialTracker", 3); r.onsuccess = () => { const tx = r.result.transaction("kv", "readwrite"); tx.objectStore("kv").put(text, "ledger"); tx.oncomplete = () => { r.result.close(); res(); }; }; r.onerror = () => res(); });
  }, JSON.stringify(seedLedger));
  await page.reload(); await page.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 });
  return { ctx, page };
}
const acct = (o) => ({ class: "asset", role: "", opening_balance: 0, opening_date: "2026-09-01", hidden_by_default: false, archived: false, ...o });
const seeded = ({ accounts = [], transactions = [], entries = [] } = {}) => {
  const l = emptyLedger(); l.rev = 1; l.saved_at = TS;
  l.state.categories.push({ id: "food", name: "Food", kind: "expense" }, { id: "cat-unlogged", name: "Uncategorized", kind: "expense" });   // every real ledger has Uncategorized from its first save
  l.state.accounts.push(...accounts); l.state.transactions.push(...transactions); l.state.entries.push(...entries);
  l.settings = { notice_seen_at: TS, whatsnew_seen: CHANGES[0].id, welcome_off: true, start_rule_seen: TS, cat_card_seen: TS,
    intro_off: { log: true, money: true, income: true, cards: true, review: true, setup: true, scan: true } };
  return l;
};
const spend = () => "food";
const ledgerOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("financialTracker.ledger")));
const menu = async (page, name) => { await page.click("#menuBtn"); await page.click(`#menu .item:has-text("${name}")`); await page.waitForFunction(() => !document.querySelector("#menu .drawer")); if (await page.locator('[data-action="intro-done"]').count()) await page.click('[data-action="intro-done"]'); };
const setupPage = async (page, row) => { await menu(page, "Setup"); await page.click(`.setrow:has-text("${row}")`); await page.waitForTimeout(200); };
// What the iPhone does the moment a box is left (see the top of this file), set up on the box that has the keyboard now.
const onLeave = (page, selector, what, value = null) => page.evaluate(([sel, w, v]) => {
  const el = document.querySelector(sel);
  el.addEventListener("blur", () => {
    if (v !== null) el.value = v;
    el.dispatchEvent(w === "change" ? new Event("change", { bubbles: true }) : new InputEvent("input", { bubbles: true, inputType: v !== null ? "insertReplacementText" : "insertText" }));
  }, { once: true });
}, [selector, what, value]);
// The tap: the watcher must see nothing change under the finger.
async function tapAtOnce(page, selector) {
  const before = new Set(tapSafety.keys());
  await page.click(selector);
  const fresh = [...tapSafety.keys()].filter((k) => !before.has(k));
  assert.deepEqual(fresh, [], "the button under the finger changed or moved during the tap: " + fresh.join(" | "));
}
const choose = (page, selector, value) => page.evaluate(([sel, v]) => { const el = document.querySelector(sel); el.focus(); el.value = v; }, [selector, value]);   // a choice made in the picker, reported when the picker closes

try {
  // (1) Weekly review, count a card: the count is typed, then "I paid the card" is tapped at once.
  { const bank = acct({ id: "b", name: "Example Bank", opening_balance: 2000000, reserve_for: "cc" }), card = acct({ id: "cc", name: "Example Card", class: "liability" });
    const l = seeded({ accounts: [bank, card] });
    l.state.transactions.push({ id: "buy", date: "2026-10-20", payee: "Sample Mart", memo: "", status: "verified", source: "manual", created_at: AT, verified_at: AT });
    l.state.entries.push({ transaction_id: "buy", category_id: spend(l), amount: 1000000 }, { transaction_id: "buy", account_id: "cc", amount: -1000000, card_state: "posted" });
    const { ctx, page } = await open(l);
    await menu(page, "Weekly review"); await page.waitForTimeout(200);
    await page.click('button[data-action="open-checkin"][data-id="cc"]'); await page.waitForSelector("#sheet .sheet");
    if (await page.locator('button[data-action="count-basis"][data-id="owed"]').count()) await page.click('button[data-action="count-basis"][data-id="owed"]');
    await page.fill("#f-amount", "0");
    await page.locator('button[data-action="count-paid"]').waitFor();
    await onLeave(page, "#f-amount", "input");
    await tapAtOnce(page, 'button[data-action="count-paid"]');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("financialTracker.ledger")).state.transactions.some((t) => t.status === "draft"), null, { timeout: 5000 });
    const st = (await ledgerOf(page)).state, draft = st.transactions.find((t) => t.status === "draft");
    assert.ok(st.entries.some((e) => e.transaction_id === draft.id && e.account_id === "cc" && e.amount === 1000000), "one draft payment of 10,000.00 into the card");
    await ctx.close(); console.log("ok: Weekly review, card count: I paid the card, tapped right after the count, logs the payment"); }

  // (5) Setup, Card reserve: the account the reserve comes out of is chosen, then the next button is tapped at once.
  { const l = seeded({ accounts: [acct({ id: "b", name: "Example Bank", opening_balance: 500000, reserve_for: "cc" }), acct({ id: "cc", name: "Example Card", class: "liability" }), acct({ id: "b2", name: "Other Bank", opening_balance: 300000 })] });
    const { ctx, page } = await open(l);
    await setupPage(page, "Accounts");
    await page.locator("#r-src").waitFor();
    await choose(page, "#r-src", "b2"); await onLeave(page, "#r-src", "change");
    await tapAtOnce(page, '.back button:has-text("Setup")');
    await page.locator('.setrow:has-text("Accounts")').waitFor({ timeout: 5000 });
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("financialTracker.ledger")).settings.reserve_source_id === "b2", null, { timeout: 5000 });
    await ctx.close(); console.log("ok: Setup, Card reserve: the next tap after choosing the source works, and the choice is saved"); }

  // (4) Setup, add an account: the name and amount are typed, the kind is chosen last, then Add account is tapped at once.
  { const { ctx, page } = await open(seeded({ accounts: [acct({ id: "b", name: "Example Bank", opening_balance: 100000 })] }));
    await setupPage(page, "Accounts");
    if (!(await page.locator("#a-kind").count())) await page.click('[data-action="toggle-add-account"]');
    if (await page.locator("#a-name").count()) await page.fill("#a-name", "Example Card"); else { await page.click('[data-action="open-banks"]'); }
    await page.fill("#a-open", "500");
    await choose(page, "#a-kind", "liability"); await onLeave(page, "#a-kind", "change");
    await tapAtOnce(page, '[data-action="add-account"]');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("financialTracker.ledger")).state.accounts.some((a) => a.name === "Example Card"), null, { timeout: 5000 });
    assert.equal((await ledgerOf(page)).state.accounts.find((a) => a.name === "Example Card").class, "liability", "added as the kind chosen last");
    await ctx.close(); console.log("ok: Setup, add an account: Add account, tapped right after choosing the kind, adds it as that kind"); }

  // (3) See every entry: a word is typed in the search, the phone's autocorrect fixes it on leaving, and a result is tapped at once.
  { const l = seeded({ accounts: [acct({ id: "b", name: "Example Bank", opening_balance: 100000 })] });
    l.state.transactions.push({ id: "t1", date: "2026-10-20", payee: "Sample Bakery", memo: "", status: "verified", source: "manual", created_at: AT, verified_at: AT });
    l.state.entries.push({ transaction_id: "t1", category_id: spend(l), amount: 12500 }, { transaction_id: "t1", account_id: "b", amount: -12500 });
    const { ctx, page } = await open(l);
    await menu(page, "Cash flow"); await page.click('button:has-text("See every entry")');
    await page.fill("#e-q", "Bakery");
    await page.locator('#entries-list [data-action="open-tx"]').first().waitFor();
    await onLeave(page, "#e-q", "input", "Bakery ");   // autocorrect's own version of the same word, sent as the box is left
    await tapAtOnce(page, '#entries-list [data-action="open-tx"]');
    await page.waitForFunction(() => document.querySelector("#sheet")?.innerText.includes("Sample Bakery") && !document.querySelector("#e-q"), null, { timeout: 5000 });
    await ctx.close(); console.log("ok: See every entry: a result tapped right after the search opens it"); }

  // (6, found by the watcher) Payslip: a figure is typed, then the Total deductions fold is tapped at once.
  { const { ctx, page } = await open(seeded({ accounts: [acct({ id: "b", name: "Example Bank", opening_balance: 100000 })] }));
    await menu(page, "Cash flow"); await page.click("#top .titleswitch");
    await page.click('button:has-text("Add income")'); await page.click('#sheet button:has-text("Type a payslip")');
    await page.evaluate(() => { const d = document.querySelector('#sheet details[data-keep="t"]'); if (d) d.open = true; });
    await page.fill("#p-gross", "10000");
    const was = await page.locator('#sheet details.tot[data-keep="d"]').evaluate((d) => d.open);
    await tapAtOnce(page, '#sheet details.tot[data-keep="d"] > summary');
    assert.equal(await page.locator('#sheet details.tot[data-keep="d"]').evaluate((d) => d.open), !was, "the fold opened or closed");
    await ctx.close(); console.log("ok: Payslip: the Total deductions fold, tapped right after typing a figure, opens"); }

  assert.deepEqual(errors, []);
  assert.equal(tapSafety.size, 0, "no tap changed under the finger anywhere in this script");
} finally { await browser.close(); }

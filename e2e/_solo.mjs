// End-to-end check of the app in an iPhone-like Home Screen browser. Run by hand:
//   python3 -m http.server 8124 &   node e2e/run.mjs
// It is not part of `npm test`; CI runs it as its own job, "e2e", in the Tests workflow (.github/workflows/test.yml).
import { createRequire } from "node:module";
import { protectionChecks } from "./protection.mjs";
import { appLockChecks } from "./applock.mjs";
import { ENGINE, TOOLS, launchBrowser, skipped } from "./engine.mjs";
import { execSync } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);

const BASE = process.env.BASE ?? "http://localhost:8124/app/index.html";
const SHOTS = process.env.SHOTS ?? "";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
const T0 = new Date("2026-10-03T03:00:00Z");   // 11:00 on Oct 3 in Manila

// What most tests start from: a ledger in the owner's own style (the categories and the three meal tiles the app used to start everyone with), so the
// long flows below keep their wording. A brand-new install is now neutral: tests of that open with styled: false.
const owner = (id, name, role) => ({ id, name, kind: "expense", ...(role ? { role } : {}) });
const LEDGER_V = 11;
const OWNER_STYLE = { v: 6, rev: 1, saved_at: "2026-10-01T08:00:00.000+08:00", settings: { notice_seen_at: "2026-10-01T08:00:00.000+08:00" }, state: {
  ...Object.fromEntries(["accounts", "goals", "envelopes", "transactions", "entries", "categoryMaps", "rules", "templates", "payeeRules", "subscriptions", "checkIns", "attachments", "tags", "foreignAmounts", "surveyResponses", "payslips", "payslipLines", "payslipRevisions"].map((k) => [k, []])),
  categories: [owner("cat-food", "Food", "food"), owner("cat-lakat", "Lakat/Date"), owner("cat-family", "Family"), owner("cat-shopping", "Shopping"), owner("cat-essentials", "Essentials", "essentials"), owner("cat-upskill", "Upskill"),
    owner("cat-subscription", "Subscription", "subscription"), owner("cat-rent", "Rent", "rent"), owner("cat-unlogged", "Unlogged"),
    { id: "cat-salary", name: "Salary", kind: "income" }, { id: "cat-overtime", name: "Overtime", kind: "income" }, { id: "cat-interest", name: "Interest", kind: "income" }, { id: "cat-refund", name: "Refund", kind: "income" }, { id: "cat-other-income", name: "Other income", kind: "income" }],
  presets: [{ id: "pre-breakfast", name: "Breakfast", amount: 2000, category_id: "cat-food" }, { id: "pre-lunch", name: "Lunch", amount: 9500, category_id: "cat-food" }, { id: "pre-dinner", name: "Dinner", amount: 9500, category_id: "cat-food" }] } };

let failures = 0;
const check = (cond, label) => { console.log((cond ? "  ok   " : "  FAIL ") + label); if (!cond) failures++; };
const browser = await launchBrowser();
console.log("Engine: " + ENGINE);

// Every request for a bank logo goes through this, so the network is faked: by default nothing answers.
let iconServe = (r) => r.abort();
const iconAsked = [];   // every address the app asked an icon service or bank site for
const dismissNotice = async (page) => { try { await page.waitForSelector('#sheet button:has-text("I understand")', { timeout: 2500 }); await page.click('#sheet button:has-text("I understand")'); } catch { /* an old ledger shows no notice */ }
  try { await page.waitForSelector('#sheet button:has-text("Skip for now")', { timeout: 700 }); await page.click('#sheet button:has-text("Skip for now")'); } catch { /* the welcome card only shows on a new install */ } };
async function open({ storageMode = null, logOpen = true, setupFlat = true, ua = IPHONE, standalone = true, blockSw = false, url = BASE, noSpeech = false, fakeSpeech = false, seed = undefined, routes = [], keepNotice = false, styled = true, whatsNew = false, keepCatCard = false, keepIntro = false, keepWarn = false } = {}) {
  if (seed === undefined) seed = styled ? OWNER_STYLE : null;
  if (seed && !whatsNew) seed = { ...seed, settings: { ...(seed.settings ?? {}), whatsnew_seen: seed.settings?.whatsnew_seen ?? CHANGES[0].id, start_rule_seen: seed.settings?.start_rule_seen ?? "2026-10-01T08:00:00.000+08:00" } };   // the What's new pop-up is tested on its own
  if (seed && !keepIntro) seed = { ...seed, settings: { ...(seed.settings ?? {}), intro_off: { ...Object.fromEntries(["plan", "money", "income", "cards", "budget", "goals", "scheduled", "checkin", "scan", "trips", "buffer", "setup"].map((id) => [id, true])), ...(seed.settings?.intro_off ?? {}) } } };   // the small "what is this screen" popup is tested on its own
  if (seed && !keepCatCard) seed = { ...seed, settings: { ...(seed.settings ?? {}), cat_card_seen: seed.settings?.cat_card_seen ?? "2026-10-01T08:00:00.000+08:00" } };   // the one-time card about editing categories is tested on its own
  const ctx = await browser.newContext({ ...(blockSw ? { serviceWorkers: "block" } : {}), userAgent: ua, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript((o) => { try { if (o) sessionStorage.setItem("logOpen", "1"); } catch {} }, logOpen);
  await ctx.addInitScript((o) => { try { if (o) sessionStorage.setItem("setupFlat", "1"); } catch {} }, setupFlat);   // most tests read the old one long Setup page; the real list of pages has its own test   // the day's entries are folded away until tapped; most tests read them, so they start unfolded
  await ctx.addInitScript((s) => { if (s) Object.defineProperty(navigator, "standalone", { get: () => true }); }, standalone);
  // A pretend phone speech service that, like the real ones, listens once and closes the microphone when you pause: the first try hears
  // nothing, the second hears the sentence. It records the language it was asked for.
  if (fakeSpeech) await ctx.addInitScript(() => {
    const said = ["", "lunch 95 at sample burger using gcash"]; let round = 0; window.__langs = [];
    window.SpeechRecognition = window.webkitSpeechRecognition = class { start() { window.__langs.push(this.lang); const words = said[round++] ?? ""; setTimeout(() => { if (words) this.onresult?.({ results: [{ 0: { transcript: words, confidence: 0.9 }, isFinal: true, length: 1 }] }); }, 80); setTimeout(() => this.onend?.(), 260); } stop() { setTimeout(() => this.onend?.(), 20); } };
  });
  // `seed`: data already on the phone before the app first runs (written only if nothing is there yet, so a reload keeps what the app saved). `routes`: [pattern, (body) => body] changes a file the page loads.
  for (const [pattern, change] of routes) await ctx.route(pattern, async (route) => { const r = await route.fetch(); route.fulfill({ response: r, body: change(await r.text()) }); });
  if (noSpeech) await ctx.addInitScript(() => { window.webkitSpeechRecognition = undefined; window.SpeechRecognition = undefined; });
  await ctx.route(/icon\.horse|faviconkit\.com|gstatic\.com|duckduckgo\.com|apple-touch-icon\.png|wikipedia\.org|wikimedia\.org/, (r) => { iconAsked.push(r.request().url()); iconServe(r); });
  if (storageMode) await ctx.addInitScript(mode => {
    window.__persistCalls = 0; let protectedNow = false;
    const storage = { estimate: async () => ({ usage: 0 }), persisted: async () => protectedNow };
    if (mode !== "missing") storage.persist = async () => {
      window.__persistCalls++;
      if (mode === "pending") return new Promise(() => {});
      if (mode === "throws") throw new Error("invented API failure");
      protectedNow = mode === "granted"; return protectedNow;
    };
    Object.defineProperty(navigator, "storage", { configurable: true, value: storage });
  }, storageMode);
  const page = await ctx.newPage();
  // Category, Paid from and "It looks like" are dropdown rows now: a test that taps a choice by its text first opens the list that holds it.
  const rawClick = page.click.bind(page);
  page.click = async (selector, options) => {
    if (typeof selector === "string" && selector.startsWith("#sheet") && (selector.includes(".chip") || selector.includes("data-action=\"pick-"))) {
      const item = page.locator(selector).first();
      if (await item.count() && !(await item.isVisible())) await item.locator("xpath=ancestor::div[@class='pick'][1]").locator(".pickrow").click();
    }
    const out = await rawClick(selector, options);
    // A test that spends from an account with no money in it meets the overdraw warning; it taps Save anyway, unless the test is about the warning.
    if (!keepWarn && !String(selector).includes("data-action=\"warn-")) { const save = page.locator('#warn button[data-action="warn-save"]'); if (await save.count()) { await rawClick('#warn button[data-action="warn-save"]'); await page.waitForTimeout(150); } }
    return out;
  };
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (/Content Security Policy|Refused to (load|execute|connect|create)/i.test(m.text())) errors.push("CSP: " + m.text().slice(0, 200)); });   // the content security policy must never refuse something the app needs
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|gstatic|duckduckgo|icon\.horse|apple-touch-icon|wikipedia|wikimedia/.test(m.location().url ?? "")) errors.push(m.text()); });   // blocked icon requests are staged on purpose
  if (!keepIntro) await page.addLocatorHandler(page.locator('#sheet button[data-action="intro-done"]'), async (b) => { await b.click(); });   // a new install has no switched-off popups: any other test just says Got it when one gets in the way
  await page.clock.setFixedTime(T0);
  await page.goto(url);
  await page.waitForSelector("#nav button");
  // A brand-new install shows the first-run notice once; every test but the one about the notice closes it first.
  if (!keepNotice && !seed) await dismissNotice(page);
  if (seed) {   // data already on the phone before this start: written to BOTH stores as the app writes them, then the app starts again
    await page.evaluate(async ([text, lsKey, dbName]) => {
      localStorage.setItem(lsKey, text);
      await new Promise((res, rej) => { const r = indexedDB.open(dbName, 3); r.onsuccess = () => { const tx = r.result.transaction("kv", "readwrite"); tx.objectStore("kv").put(text, "ledger"); tx.oncomplete = () => { r.result.close(); res(); }; tx.onerror = () => rej(tx.error); }; r.onerror = () => rej(r.error); });
    }, [JSON.stringify(seed), url.includes("trial") ? "financialTracker.trial.ledger" : "financialTracker.ledger", url.includes("trial") ? "financialTracker-trial" : "financialTracker"]);
    await page.reload(); await page.waitForSelector("#nav button");
    if (!keepNotice && seed.v < LEDGER_V) await dismissNotice(page);   // an upgraded ledger may show the one-time role notice
  }
  return { ctx, page, errors };
}
const text = (page, sel = "body") => page.locator(sel).innerText();
// The payslip form lists ONLY the lines printed on that payslip (owner, Oct 30): add one by a quick label or a typed label, give its amount, Done.
const slipAmount = async (page, amount) => {   // change the figure of the first earnings line
  await page.evaluate(() => { const d = document.querySelector('#sheet details.tot[data-keep="e"]'); if (d) d.open = true; });
  await page.click('#sheet details.tot[data-keep="e"] .pl-main'); await page.fill("#p-ia", amount); await page.click('#sheet [data-action="slip-line-done"]');
};
const slipLine = async (page, section, label, amount, { quick = false } = {}) => {
  await page.evaluate((k) => { const d = document.querySelector(`#sheet details.tot[data-keep="${k}"]`); if (d) d.open = true; }, { earning: "e", deduction: "d", employer: "r" }[section]);
  await page.click(`#sheet [data-action="slip-add"][data-id="${section}"]`);
  if (quick) await page.click(`#sheet [data-action="slip-quick"]:text-is("${label}")`);
  else { await page.fill("#p-addlabel", label); await page.click('#sheet [data-action="slip-add-typed"]'); }
  await page.fill("#p-ia", amount); await page.click('#sheet [data-action="slip-line-done"]');
};
// Money, Budget and Setup live in the menu at the upper left; only Log and Verify are on the bottom bar.
const addPayslipFlow = async (page) => { await page.click('button:has-text("Add income")'); };   // the Add income window offers the payslip ways straight away
// Screens that belong together share one menu row; the picture strip on top of them switches between them (HUBS in names.js).
const HUB_OF = { Goals: "Plan & Save", "Pay plan": "Plan & Save", Checks: "Weekly review" };
const openAddForm = async (page) => { const b = page.locator("#add-account-open"); if (await b.count()) { await b.click(); await page.waitForSelector("#a-bank"); } };   // with accounts, Setup keeps the form behind a button
const afterAdd = async (page) => { await page.waitForFunction(() => !document.querySelector("#a-bank") || document.querySelector("#a-error"), null, { timeout: 2500 }).catch(() => {}); await openAddForm(page); };   // adding closes the form: open it again for the next one
const openGoal = async (page, name) => { await page.click(`#screen .gname:has-text("${name}")`); await page.waitForSelector("#sheet .gview"); };   // a goal's row opens its window
const menuGo = async (page, name, opts = {}) => {   // Spending and Income are one menu item, Cash flow, with a switch inside; Cards opens with its amounts hidden, so the helper taps the eye unless `keepHidden`
  await page.click("#menuBtn");
  const money = name === "Spending" || name === "Income";
  await page.click(`#menu .item:has-text("${money ? "Cash flow" : name === "Budget" ? "Plan & Save" : HUB_OF[name] ?? name}")`);
  await page.waitForFunction(() => !document.querySelector("#menu .drawer"));
  if (HUB_OF[name]) await page.click(`#screen .hub button:has-text("${name}")`);
  if (name === "Setup") await openAddForm(page);
  if (name === "Income") await page.click("#top .titleswitch");
  if (name === "Cards" && !opts.keepHidden) { const eye = page.locator('button[data-action="cards-eye"][aria-pressed="false"]'); if (await eye.count()) await eye.click(); }
};
// Saving is asynchronous (it writes two stores), so checks wait for the text to appear instead of racing it.
const seen = async (page, sel, sub, ms = 4000) => { try { await page.waitForFunction(([q, t]) => document.querySelector(q)?.innerText.includes(t), [sel, sub], { timeout: ms }); return true; } catch { return false; } };
const gone = async (page, sel, sub, ms = 4000) => { try { await page.waitForFunction(([q, t]) => !document.querySelector(q)?.innerText.includes(t), [sel, sub], { timeout: ms }); return true; } catch { return false; } };
const stored = (page) => page.evaluate(async () => {
  const local = localStorage.getItem("financialTracker.ledger");
  const idb = await new Promise((res) => { const r = indexedDB.open("financialTracker"); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => { const g = r.result.transaction("kv").objectStore("kv").get("ledger"); g.onsuccess = () => res(g.result ?? null); }; });
  return { local, idb };
});
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: SHOTS + "/" + name + ".png" }); };
const stars = async (page) => page.locator("#sheet label .req").count();   // how many fields in the open window carry the * (needed before saving)


// The app has no way to load a plan file any more (nobody has one yet), so tests that need a plan put one in the phone's settings, as parsed by the model.
import { parsePlan, planWithBudgets, CHANGES, emptyState, recordFromParse, addSchedule, makeDueDrafts } from "../src/model/index.js";
async function writeLedger(page, led) {
  const text = JSON.stringify(led);
  await page.evaluate(async ([text]) => { localStorage.setItem("financialTracker.ledger", text); await new Promise((res) => { const r = indexedDB.open("financialTracker", 3); r.onsuccess = () => { const tx = r.result.transaction("kv", "readwrite"); tx.objectStore("kv").put(text, "ledger"); tx.oncomplete = () => { r.result.close(); res(); }; }; }); }, [text]);
  await page.reload(); await page.waitForSelector("#nav button");
}
async function installPlan(page, file) {
  const parsed = parsePlan(JSON.stringify(file)); if (!parsed.ok) throw new Error(parsed.error);
  const led = JSON.parse((await stored(page)).local);
  led.settings = { ...led.settings, plans: [...(led.settings.plans ?? []), parsed.plan] }; led.rev += 1;
  await writeLedger(page, led);
}

async function addAccount(page, name, kind, opening, covers) {
  await menuGo(page, "Setup");
  await page.fill("#a-name", name);
  await page.selectOption("#a-kind", kind);
  if (opening) await page.fill("#a-open", opening);
  if (covers) await page.selectOption("#a-covers", { label: covers });
  await page.click('button:has-text("Add account")'); await afterAdd(page);
  await page.waitForFunction((n) => [...document.querySelectorAll("#screen .row, #screen .choice, #screen li")].some((e) => e.innerText.includes(n)) || document.getElementById("screen").innerText.includes(n), name, { timeout: 8000 }).catch(() => {});   // saving is asynchronous: wait until the account is listed before going on
}

let ctx, page, errors;
console.log("\n-- Goals in the flat look --");
{ const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10), ym = today.slice(0, 7), day = (n) => `${ym}-${String(n).padStart(2, "0")}`;
  const TSS = `${today}T09:00:00.000+08:00`;
  const acc2 = (id, name, cls, extra = {}) => ({ id, name, class: cls, role: "", hidden_by_default: false, archived: false, opening_balance: 0, opening_date: `${ym}-01`, ...extra });
  const txs = [], ens = []; let n = 0;
  const spend = (d, payee, cat, amt) => { const id = "t" + ++n; txs.push({ id, date: day(d), payee, memo: "", status: "verified", source: "manual", created_at: TSS, verified_at: TSS }); ens.push({ transaction_id: id, category_id: cat, amount: amt }, { transaction_id: id, account_id: "w", amount: -amt }); };
  spend(2, "Groceries", "cat-food", 185000); spend(5, "Lunch", "cat-food", 42000); spend(9, "Dinner", "cat-food", 63000); spend(12, "Cafe", "cat-food", 91000);
  spend(1, "Rent", "cat-rent", 500000); spend(3, "Movie", "cat-lakat", 120000); spend(8, "Date", "cat-lakat", 135000); spend(6, "Bag", "cat-shopping", 410000); spend(10, "Electric", "cat-essentials", 230000); spend(4, "Streaming", "cat-subscription", 45000); spend(11, "Course", "cat-upskill", 80000);
  const rules = [["cat-food", 500000], ["cat-rent", 500000], ["cat-lakat", 200000], ["cat-shopping", 300000], ["cat-essentials", 400000], ["cat-subscription", 60000], ["cat-upskill", 150000]].map(([c, a], i) => ({ id: "r" + i, kind: "budget", subject_id: c, amount: a, effective_from: "2026-01-01", created_at: TSS }));
  const seed = { ...OWNER_STYLE, settings: { ...OWNER_STYLE.settings }, state: { ...OWNER_STYLE.state, accounts: [acc2("w", "Sample Wallet", "asset", { opening_balance: 3000000 }), acc2("s", "Sample Savings", "asset", { opening_balance: 1200000 }), acc2("s2", "Sample Pocket", "asset", { opening_balance: 300000 })],
    goals: [{ id: "g1", name: "Emergency Fund", account_id: "s", target: 3000000, hidden_by_default: false, role: "emergency" }, { id: "g2", name: "Trip", account_id: "s2", target: 800000, hidden_by_default: false }],
    transactions: txs, entries: ens, rules } };
  { const { ctx, page, errors } = await open({ blockSw: true, setupFlat: false, seed }); await menuGo(page, "Budget"); await page.waitForTimeout(300);
    let t;
    await page.click('button:has-text("Goals")'); await page.waitForTimeout(300);
    t = await text(page, "#screen");
    check(/saved toward goals/i.test(t) && t.includes("15,000.00") && t.includes("across 2 goals"), "Goals opens with the total saved");
    console.log("TEXT>>"+t.replace(/\n/g," | ")); console.log("catbar", await page.locator("#screen .catbar").count(), "ring", await page.locator("#screen svg.ring").count(), "TODAY", new Date(Date.now()+8*3600e3).toISOString());
    check(await page.locator("#screen .catbar").count() === 2 && !(await page.locator("#screen svg.ring").count()), "each goal has a thin bar, no ring");
    { const aria = (await page.locator("#screen .catbar").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))).join(" | "); check(aria.includes("28%") && aria.includes("37%") && /12,000\.00\s*\/\s*.*42,000\.00/.test(t), "each goal says its percent (to a screen reader, on its bar) and reads saved / target: " + aria); }
    await page.click("#screen .pair >> nth=0"); await page.waitForTimeout(300);
    t = await text(page, "#screen");
    check(t.includes("30,000.00 to go") && t.includes("5,000.00 to go") && !/\d \/ \u20B1/.test(t), "one tap on a figure turns every goal into what is to go");
    await page.click("#screen .pair >> nth=0"); await page.waitForTimeout(300);
    t = await text(page, "#screen");
    check(!t.includes("Monthly contribution") && await page.locator("#screen details.goaldet").count() === 0, "the list keeps one plain row per goal; the emergency fund's table is not folded into it");
    await openGoal(page, "Emergency Fund"); await page.waitForTimeout(200);
    check((await text(page, "#sheet")).includes("Monthly contribution") && (await text(page, "#sheet")).includes("Months to target") && (await text(page, "#sheet")).includes("Target"), "tapping a goal opens its window with the target, contribution and months");
    await page.click('#sheet button[data-action="close-sheet"]');
    check(errors.length === 0, "no script errors on Budget and Goals: " + errors.join("; ")); await ctx.close(); }
  { const hid = { ...seed, state: { ...seed.state, goals: seed.state.goals.map((g) => ({ ...g, hidden_by_default: true })) } };
    const { ctx, page } = await open({ blockSw: true, setupFlat: false, seed: hid }); await menuGo(page, "Budget"); await page.click('button:has-text("Goals")'); await page.waitForTimeout(300);
    const t = await text(page, "#screen");
    check(!t.includes("15,000.00") && !t.includes("12,000.00") && t.includes("\u20b1\u2022\u2022\u2022\u2022\u2022"), "with balances hidden, no goal figure and no total is shown, only dots");
    await ctx.close(); }
}

// ===== Suggest a budget: a window from Buckets, nothing saved until Confirm =====
await browser.close();
console.log(failures ? "\n" + failures + " check(s) FAILED" : "\nAll checks passed");
process.exit(failures ? 1 : 0);
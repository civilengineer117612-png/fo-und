// End-to-end check of the app in an iPhone-like Home Screen browser. Run by hand:
//   python3 -m http.server 8124 &   node e2e/run.mjs
// It is not part of `npm test`; CI runs it as its own job, "e2e", in the Tests workflow (.github/workflows/test.yml).
import { createRequire } from "node:module";
import { protectionChecks } from "./protection.mjs";
import { appLockChecks } from "./applock.mjs";
import { ENGINE, TOOLS, launchBrowser, skipped, skippedPictures } from "./engine.mjs";
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
const recentConsole = [];   // the last few console errors any page printed, shown under a failed check so a failure on another engine says why
const check = (cond, label) => { console.log((cond ? "  ok   " : "  FAIL ") + label); if (!cond) { failures++; for (const m of recentConsole.slice(-3)) console.log("       page console: " + m.slice(0, 240)); } };
const browser = await launchBrowser();
console.log("Engine: " + ENGINE);

// Every request for a bank logo goes through this, so the network is faked: by default nothing answers.
let iconServe = (r) => r.abort();
const iconAsked = [];   // every address the app asked an icon service or bank site for
const dismissNotice = async (page) => { try { await page.waitForSelector('#sheet button:has-text("I understand")', { timeout: 2500 }); await page.click('#sheet button:has-text("I understand")'); } catch { /* an old ledger shows no notice */ }
  try { await page.waitForSelector('#sheet button:has-text("Skip for now")', { timeout: 700 }); await page.click('#sheet button:has-text("Skip for now")'); } catch { /* the welcome card only shows on a new install */ } };
async function open({ storageMode = null, logOpen = true, setupFlat = true, ua = IPHONE, standalone = true, blockSw = !TOOLS.serviceWorkerNetwork, url = BASE, noSpeech = false, fakeSpeech = false, seed = undefined, routes = [], keepNotice = false, styled = true, whatsNew = false, keepCatCard = false, keepIntro = false, keepWarn = false } = {}) {
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
  page.on("pageerror", (e) => recentConsole.push("pageerror: " + e.message)); page.on("console", (m) => { if (m.type() === "error") recentConsole.push(m.text()); });
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

// EVERY BLOCK RUNS AND REPORTS (owner, Nov 1): each block below sits in try/catch. A step that throws (a button that is not there, a page that
// never loads) is ONE failure for its block: it is said with the block's name, the block's window is closed, and the next block runs, so one
// stuck step can no longer hide every check after it. Blocks share helpers, so what a block declares at its top level is `var` (it stays
// visible to the blocks after it). A check that merely fails is counted as before.
let blockName = "";
const blockFailed = async (e) => { failures++; console.log("  FAIL block \"" + blockName + "\" stopped: " + String(e?.message ?? e).split("\n")[0].slice(0, 240)); try { await ctx?.close(); } catch { /* already closed */ } };

// ===== 5g. income: a payslip with overtime =====
try { blockName = "5g. income: a payslip with overtime";
console.log("Income");
({ ctx, page, errors } = await open({ blockSw: true }));
await addAccount(page, "Wallet", "asset", "1000");
await addAccount(page, "Savings", "asset", "0");
await menuGo(page, "Goals");
await page.click('button:has-text("Add a goal")'); await page.fill("#g-name", "Emergency Fund"); await page.click('#sheet button[data-action="pick-goal-role"]'); await page.click('#sheet .chip:has-text("Savings")'); await page.click("#f-save");
await seen(page, "#screen", "Emergency Fund");
var receiptPngForSlip = await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 600; c.height = 300; const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, 600, 300); x.fillStyle = "#000"; x.font = "bold 36px sans-serif"; x.fillText("Net Pay   1,000.00", 30, 120); return c.toDataURL("image/png").split(",")[1]; });
await menuGo(page, "Income");
check((await text(page, "#screen")).includes("Nothing recorded"), "Income starts empty and says how to begin");
await page.click('button:has-text("Add income")');
{ const t = await text(page, "#sheet");
  check(t.includes("Add income") && t.includes("Type a payslip") && t.includes("Take a photo") && t.includes("Choose from photos or files") && t.includes("Other income") && !t.includes("(interest, refund)") && await page.locator('#screen button:has-text("Add other income")').count() === 0, "Add income opens one window: type a payslip, take or choose a photo, or other income; no step in between"); }
await page.click('#sheet button:has-text("Cancel")');
await addPayslipFlow(page);
var choice = await text(page, "#sheet");
check(choice.includes("Type a payslip") && choice.includes("Take a photo") && choice.includes("Choose from photos or files") && await page.locator('#sheet input[data-scan="payslip"][capture="environment"]').count() === 1, "Add a payslip offers two ways: type it in, or read it from a photo (camera, or photos and files)");
await page.click('#sheet button:has-text("Type a payslip")');
check(await page.locator("#p-emp").count() === 1, "'Type a payslip' opens the payslip form");
check(await stars(page) === 8, "the payslip marks what is needed with the * (" + await stars(page) + ")");
await page.click('#sheet button:has-text("Cancel")');
await addPayslipFlow(page);
await page.setInputFiles('#sheet input[data-scan="payslip"]:not([capture])', { name: "any.png", mimeType: "image/png", buffer: Buffer.from(receiptPngForSlip, "base64") });
check(await seen(page, "#sheet", "Add a payslip", 180000) && await page.locator("#sheet img.shot").count() === 1, "choosing a photo from there opens the payslip window with the photo, whatever the reader thought it was");
check((await page.inputValue("#p-from")) === "" && (await page.inputValue("#p-to")) === "" && (await page.inputValue("#p-date")) === "" && await page.locator("#f-save").isDisabled(), "dates the reader could not find are left empty (never today), and saving waits until they are chosen");
await page.click('#sheet button:has-text("Cancel")');
await addPayslipFlow(page); await page.click('#sheet button:has-text("Type a payslip")');
check(await page.locator("#sheet").innerText().then((t) => /tax id|employee|account number/i.test(t) && /Do not type/.test(t)), "the payslip window tells you not to type any id or account number");
await page.fill("#p-emp", "Sample Employer Inc");
await page.fill("#p-from", "2026-09-16"); await page.fill("#p-to", "2026-09-30"); await page.fill("#p-date", "2026-10-02");
await slipLine(page, "earning", "Basic salary", "9000", { quick: true }); await slipLine(page, "earning", "Rice subsidy", "1000", { quick: true }); await slipLine(page, "earning", "Overtime", "1500", { quick: true });
await slipLine(page, "deduction", "Withholding tax", "700", { quick: true }); await slipLine(page, "deduction", "SSS", "300", { quick: true }); await slipLine(page, "deduction", "PhilHealth", "100", { quick: true }); await slipLine(page, "deduction", "Pag-IBIG", "100", { quick: true });
await page.evaluate(() => document.querySelectorAll("#sheet details[data-keep]").forEach((d) => { d.open = true; }));
await page.fill("#p-gross", "10000"); await page.fill("#p-net", "9300"); await page.fill("#p-dep", "9300");
check((await text(page, "#p-flags")).includes("leaves out the overtime ₱1,500.00"), "a printed gross that leaves out overtime is flagged while typing");
await shot(page, "37-payslip");
await page.fill("#p-gross", "11500"); await page.fill("#p-net", "10300"); await page.fill("#p-dep", "10300");
check(!(await text(page, "#p-flags")).includes("▲"), "once the figures agree there is no flag");
check(await page.locator("#sheet details.tot").count() === 2 && (await page.locator("#p-tot-e").innerText()) === "₱11,500.00" && (await page.locator("#p-tot-d").innerText()) === "₱1,200.00", "the two folding rows show the totals of the printed lines");
await page.fill("#p-ded", "1200");
console.log("DBG before save: disabled=", await page.locator("#f-save").isDisabled(), "label=", await page.locator("#f-save").innerText());
await page.click("#f-save");
await page.waitForTimeout(2500);
console.log("DBG toast:", JSON.stringify(await page.locator("#toast").innerText().catch((e) => "ERR " + e.message)));
console.log("DBG sheet:", JSON.stringify((await page.locator("#sheet").innerText().catch(() => "")).slice(0, 1500)));
console.log("DBG banner:", JSON.stringify(await page.locator("#banner").innerText().catch(() => "")));
console.log("DBG errors:", JSON.stringify(errors));
console.log("DBG screen:", JSON.stringify((await page.locator("#screen").innerText().catch(() => "")).slice(0, 800)));
check(await seen(page, "#toast", "Payslip saved"), "the payslip is saved");
check((await text(page, "#toast")).includes("Emergency Fund draft"), "overtime makes an Emergency Fund draft, and says so");
// the payslip is for September 16-30 and arrived on October 2: it counts in October, the month the deposit arrived (P0-5 fix 4: the period is only a label)
check((await text(page, ".hero")).includes("₱10,300.00") && (await text(page, "#screen")).includes("earned in October 2026"), "a payslip for September 16-30 received on October 2 counts in October, the month it arrived");
await page.click('button[aria-label="Earlier"]');
check((await text(page, ".hero")).includes("₱0.00") && (await text(page, "#screen")).includes("earned in September 2026"), "and not in September, the month of its pay period");
await page.click('button[aria-label="Later"]');
var incText = await text(page, "#screen");
check(/Gross\s*₱11,500\.00[\s\S]*Deductions\s*-₱1,200\.00[\s\S]*Net\s*₱10,300\.00/.test(incText) && !incText.includes("Basic salary") && (await page.locator("#screen .bars").count()) === 0, "the Overview is gross, deductions and net, with no bar graph");
{ const ov = await page.evaluate(() => { const r = (el) => Math.round(el.getBoundingClientRect().right); return { rows: [...document.querySelectorAll("#screen .mlist .mline .mv")].map(r), net: r(document.querySelector("#screen .mtotal .mv")) }; });
  check(ov.rows.length === 2 && ov.rows.every((x) => Math.abs(x - ov.net) <= 1), "on the Overview the gross and deductions amounts line up at the right with the net (" + JSON.stringify(ov) + ")"); }
{ const pt = await page.locator("#screen .ptitle").evaluateAll((els) => els.map((e) => [e.getAttribute("aria-label"), getComputedStyle(e).fontSize, getComputedStyle(e).fontWeight].join("|")));
  check(pt.length === 1 && pt[0].startsWith("Choose the period: ") && pt[0].includes("|16px|6"), "the period bar is the same one Spending has: tap it to choose a month, a year or a range (" + pt.join(" ; ") + ")"); }
check(!incText.includes("Year to date") && !(await page.locator("#screen table.tbl").count()), "the Overview shows only the important things: no tables");
await page.click('#screen .seg button:has-text("Deductions")');
check((await text(page, "#screen")).includes("Went to government in this period: ₱1,200.00"), "Deductions: they add up");
check(await page.locator(".mlist details.mrow").evaluateAll((els) => els.length >= 1 && els.every((d) => d.open)) && (await text(page, ".mlist")).includes("Withholding tax") && await page.locator(".mlist .mtotal").count() === 0, "Deductions: the month is open at once, with each kind listed, and no repeated total for one month");
await page.click('#screen .seg button:has-text("Earnings")');
check(await page.locator(".btrack.stack .bfill.ot").count() === 1 && !(await page.locator("#screen table.tbl th").allInnerTexts()).includes("Other"), "Earnings: the payday bar stacks base and overtime, and there is no Other column when nothing is in it");
check(await page.locator('#screen .seg button:has-text("Pay history")').count() === 0 && await page.locator('#screen .seg button:has-text("Months")').count() === 0 && await page.locator('#screen .seg button').count() === 3, "the views are Overview, Earnings and Deductions: no Months, no Pay history");
await page.click('#screen .seg button:has-text("Overview")');
await shot(page, "38-income");
await page.click('button[aria-label="Earlier"]'); await page.click('button[aria-label="Earlier"]');
var prevMonth = await text(page, "#screen");
check(prevMonth.includes("Nothing recorded for August 2026") && !prevMonth.includes("Sample Employer") && !prevMonth.includes("Plan against what arrived") && !prevMonth.includes("Employers"), "another month shows only that month");
await page.click('button[aria-label="Later"]'); await page.click('button[aria-label="Later"]');
await page.click('#nav button:has-text("Verify")');
check((await text(page, "#screen")).includes("Overtime to Emergency Fund") && (await text(page, "#screen")).includes("₱900.00"), "Verify holds the 60% draft: 60% of ₱1,500.00 is ₱900.00");
await menuGo(page, "Income");
check(!(await text(page, "#screen")).includes("stays in the account the pay landed in") && await page.locator('#screen button.choice[data-action="open-payslips"]').count() === 1, "the payslips are not listed on the Income screen: one Payslips button opens them");
await page.click('button.choice[data-action="open-payslips"]');
check((await text(page, "#sheet")).includes("stays in the account the pay landed in"), "in the Payslips window, the free part of the overtime stays put by default and says so");
await page.click('#sheet button:has-text("Move it somewhere else")');
await page.click('#sheet .chip:has-text("Wallet")'); await page.click("#f-save");
check(await seen(page, "#toast", "waiting in Verify"), "choosing an account makes a second draft");
await page.click('button.choice[data-action="open-payslips"]');
check(!(await text(page, "#sheet")).includes("stays in the account the pay landed in"), "and the choice is no longer offered");
check((await text(page, "#sheet")).includes("Sep 16\u201330, 2026") && (await text(page, "#sheet")).includes("paid Oct 2, 2026"), "each payslip shows the period it pays for and the day it was paid");
await page.click('#sheet button:has-text("Close")');
await page.click('#nav button:has-text("Verify")');
check((await text(page, "#screen")).includes("2 to check"), "Verify now holds two drafts: the Emergency Fund part and the free part");
// the title and the first line below it sit at the same height on Log and on Verify
var barAt = () => page.evaluate(() => ({ h1: Math.round(document.querySelector("#top h1").getBoundingClientRect().top), below: Math.round(document.querySelector("#screen").getBoundingClientRect().top) }));
var onVerify = await barAt(); await page.click('#nav button:has-text("Log")'); const onLog = await barAt(); await page.click('#nav button:has-text("Verify")');
check(onVerify.h1 === onLog.h1 && onVerify.below === onLog.below, "the title and the content start at the same height on Log and Verify (" + JSON.stringify(onVerify) + " vs " + JSON.stringify(onLog) + ")");
// changing the payslip: the window opens filled in, and saving replaces the payslip (the pay is not counted twice)
await menuGo(page, "Income");
var heroBefore = await text(page, ".hero");
await page.click('button.choice[data-action="open-payslips"]');
await page.click('#sheet button[data-action="edit-slip"]');
check(await page.locator('#sheet details.tot[data-keep="e"] .pl').count() === 3 && await page.locator('#sheet details.tot[data-keep="d"] .pl').count() === 4 && await page.locator("#sheet details.tot").count() === 2, "Change this payslip opens with its printed lines (3 earnings, 4 deductions) and no Employer share row");
check((await text(page, "#sheet")).includes("Change this payslip") && await page.locator("#p-emp").inputValue() !== "" && await page.locator("#p-net").inputValue() !== "", "Change this payslip opens the payslip window already filled in");
await page.fill("#p-emp", "Renamed Test Employer"); await page.click("#f-save");
check(await seen(page, "#toast", "Payslip changed"), "saving the change says so");
check((await text(page, ".hero")) === heroBefore && await page.locator('button.choice[data-action="open-payslips"] .bval:has-text("1")').count() === 1, "the Income total is the same and there is still one payslip");
await page.click('button.choice[data-action="open-payslips"]');
check((await text(page, "#sheet")).includes("Renamed Test Employer"), "the list shows the changed employer");
check((await text(page, "#sheet")).includes("Lines match paper.") && !(await text(page, "#sheet")).includes("Saved before the fix") && !(await text(page, "#sheet")).includes("days after period end"), "the printed deductions total was kept: Lines match paper; a payslip saved now carries no old-figures line");
check(await page.locator('#sheet details.earlier:has(summary:text-is("Earlier figures"))').count() === 1 && (await page.locator('#sheet details.earlier:has(summary:text-is("Earlier figures"))').textContent()).includes("Sample Employer Inc"), "the change kept the old figures under Earlier figures");
await page.click('#sheet button:has-text("Close")');
// the Earnings view is a short list: one line per month, tap a month for where it came from
await page.click('button[data-action="income-view"][data-view="earnings"]');
check(await page.locator(".mlist details.mrow").count() >= 1 && await page.locator(".mlist .mtotal").count() === 0 && await page.locator("#screen table.tbl th:text-is('Month')").count() === 0, "Earnings is a short list: one month, no repeated total line, not a five-column table");
{ const open = await page.locator(".mlist details.mrow").evaluateAll((els) => els.every((d) => d.open));
  const t = await page.locator(".mlist details.mrow").first().innerText();
  check(open && /^Oct\s*₱10,300\.00[\s\S]*Basic salary[\s\S]*Rice subsidy[\s\S]*Overtime[\s\S]*Gross\s*₱11,500\.00[\s\S]*Deductions\s*-₱1,200\.00/.test(t) && !t.includes("Base pay"), "the month is open at once: net at the top, each kind of earning with rice subsidy and overtime apart, then gross and deductions (" + t.replace(/\n/g, " | ").slice(0, 200) + ")"); }
{ const e = (await text(page, "#screen")).toLowerCase();
  check(!e.includes("where it came from") && !e.includes("net, this month"), "no 'where it came from' list and no second gross, deductions and net block under the month");
  const legend = await text(page, ".legend"), th = (await page.locator("#screen table.tbl th").allInnerTexts()).join(",");
  check(legend.includes("Regular pay") && !legend.includes("Base pay") && th.includes("Regular") && !th.includes("Base"), "the payday chart and table say Regular pay, not Base pay"); }
await shot(page, "38-months");
await page.click('button[data-action="income-view"][data-view="overview"]');
// income added without a payslip (a payslip photo once saved as plain pay received) is listed and can be removed
await page.click('button:has-text("Add income")'); await page.click('#sheet button:has-text("Other income")');
await page.fill("#f-amount", "777"); await page.fill("#f-date", "2026-10-01"); await page.click('#sheet .chip:has-text("Salary")'); await page.click('#sheet .chip:has-text("Wallet")'); await page.click("#f-save");
await seen(page, 'button.choice[data-action="open-payslips"]', "without one");
check(/without one/.test(await text(page, 'button.choice[data-action="open-payslips"]')), "an income entry with no payslip behind it shows on the Payslips row (+ 1 without one)");
await page.click('button.choice[data-action="open-payslips"]');
check((await text(page, "#sheet")).includes("Added without a payslip") && (await text(page, "#sheet")).includes("₱777.00"), "and the Payslips window lists it");
await page.click('#sheet button[data-action="del-inc"]');
check((await text(page, "#sheet")).includes("also comes out of"), "Remove asks once, and says the money also leaves the account");
await page.click('#sheet button[data-action="del-inc-yes"]');
check(await seen(page, "#toast", "Entry removed") && !(await text(page, "#sheet")).includes("Added without a payslip"), "removing takes it out of the list");
await page.click('#sheet button:has-text("Close")');
// the view buttons stay exactly where they are when the view or the month changes (with or without payslips in the month)
var segTop = () => page.evaluate(() => Math.round(document.querySelector("#screen .seg").getBoundingClientRect().top));
var vp = page.viewportSize(); await page.setViewportSize({ width: vp.width, height: 560 });   // short enough that the Months list scrolls, so a shorter view could make the page jump
await page.click('#screen .seg button:has-text("Earnings")'); await page.evaluate(() => window.scrollTo(0, 120));
var t0 = await segTop();
await page.click('#screen .seg button:has-text("Deductions")'); const t1 = await segTop();
await page.click('#screen .seg button:has-text("Earnings")'); const t2 = await segTop();
await page.evaluate(() => document.querySelector('button[aria-label="Earlier"]').click()); const t3 = await segTop();
await page.evaluate(() => document.querySelector('button[aria-label="Later"]').click()); const t4 = await segTop();
check([t1, t2, t3, t4].every((t) => t === t0), "the view buttons do not move when the view or the month changes (" + [t0, t1, t2, t3, t4].join(", ") + ")");
await page.setViewportSize(vp);
await page.click('#screen .seg button:has-text("Overview")');
// removing the payslip
await menuGo(page, "Income");
await page.click('button.choice[data-action="open-payslips"]');
await page.click('#sheet button[data-action="del-slip"]');
check((await text(page, "#sheet")).includes("Remove this payslip and the pay it recorded?"), "Remove asks once more");
await page.click('#sheet button[data-action="del-slip-yes"]');
check(await seen(page, "#toast", "Payslip removed.") && (await text(page, "#sheet")).includes("No payslips in this period."), "removing takes the payslip out of the list");
await page.click('#sheet button:has-text("Close")');
check((await text(page, ".hero")).includes("₱0.00") && /^Payslips\s*0\b/.test(await text(page, 'button.choice[data-action="open-payslips"]')), "and its pay out of the Income total, with the Payslips row still in its place saying 0");
// a late pay date and a pay period with no payslip: three invented payslips, Jul 16-31, Sep 1-15 (paid 15 days late) and Sep 16-30
for (const [from, to, pay, amt] of [["2026-07-16", "2026-07-31", "2026-07-31", "5001"], ["2026-09-01", "2026-09-15", "2026-09-30", "5002"], ["2026-09-16", "2026-09-30", "2026-09-30", "5003"]]) {
  await menuGo(page, "Income"); await addPayslipFlow(page); await page.click('#sheet button:has-text("Type a payslip")');
  await page.fill("#p-emp", "Sample Employer Inc"); await page.fill("#p-from", from); await page.fill("#p-to", to); await page.fill("#p-date", pay);
  await page.evaluate(() => document.querySelectorAll("#sheet details[data-keep]").forEach((d) => { d.open = true; }));
  await slipLine(page, "earning", "Basic salary", amt, { quick: true }); await page.fill("#p-gross", amt); await page.fill("#p-net", amt); await page.fill("#p-dep", amt);
  await page.click("#f-save"); await seen(page, "#toast", "Payslip saved");
}
await menuGo(page, "Income");
await page.click(".ptitle"); await page.click('#sheet button[data-kind="year"]'); await page.click('#sheet button[data-action="period-year"][data-id="2026"]');
await page.click('button.choice[data-action="open-payslips"]');
check(/Aug 1\u201315(, 2026)?: no payslip\./.test(await text(page, "#sheet")) && /Aug 16\u201331(, 2026)?: no payslip\./.test(await text(page, "#sheet")) && !/Sep 1\u201315[^\n]*no payslip/.test(await text(page, "#sheet")), "the Payslips window names each pay period with no payslip, and only those");
check((await text(page, "#sheet")).includes("Pay date is 15 days after period end.") && (await text(page, "#sheet").then((t) => t.split("Pay date is").length)) === 2, "a pay date more than 7 days after the period end is named, once");
await page.click('#sheet button:has-text("Close")');
await page.click('#nav button:has-text("Verify")');
check(!(await text(page, "#screen")).includes("Overtime to Emergency Fund"), "and the overtime drafts that waited for it out of Verify");
await page.click('#nav button:has-text("Log")');
check(await page.locator(".sumgrid").count() === 0, "the Log screen has no In, Spent, Saved, Left card");
check(errors.length === 0, "no script errors" + (errors.length ? " -> " + errors[0] : ""));
await ctx.close();
} catch (e) { await blockFailed(e); }

console.log(failures ? failures + " check(s) FAILED" : "All checks passed"); await browser.close(); process.exit(failures ? 1 : 0);

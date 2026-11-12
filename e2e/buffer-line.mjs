// Serve the repo on port 8124, then node e2e/buffer-line.mjs. Every name and figure here is invented.
// THE BUFFER LINE (owner's marks Nov 11, overhaul A5, L4, L5): Budget shows Wants before the Buffer, two compact buttons side by side, and a Buffer
// row to tap when none is set. The figure typed there is the one Suggest a budget proposes: the two never differ.
import assert from "node:assert/strict";
import { launchBrowser } from "./engine.mjs";
import { emptyLedger, CHANGES, SCREEN_NAMES, validateState } from "../src/model/index.js";
const browser = await launchBrowser();
const base = process.env.BASE ?? "http://127.0.0.1:8124/app/index.html";
const errors = [], TS = "2026-11-12T03:00:00Z";
let passed = 0;
const ok = (cond, label) => { assert.ok(cond, label); passed++; console.log("ok: " + label); };
const ORDER = ["Fixed", "Needs", "Savings", "Wants", "Buffer", "Other"];
const inOrder = (heads) => heads.every((h, i) => ORDER.includes(h) && (i === 0 || ORDER.indexOf(heads[i - 1]) < ORDER.indexOf(h)));

const seeded = () => {
  const l = emptyLedger(), s = l.state; l.rev = 1; l.saved_at = "2026-11-10T08:00:00.000+08:00";
  s.accounts.push({ id: "chk", name: "Sample Checking", class: "asset", role: "", opening_balance: 5000000, opening_date: "2026-01-01", hidden_by_default: false, archived: false });
  s.categories = [{ id: "cat-food", name: "Food", kind: "expense", role: "food" }, { id: "cat-fun", name: "Fun", kind: "expense" }, ...s.categories.filter((c) => c.kind === "income")];
  // two budgets: Food (a need, read from its name) and Fun (a want), so the order of the parts can be seen
  s.rules.push({ id: "r1", kind: "budget", subject_id: "cat-food", amount: 800000, effective_from: "2026-11-01", created_at: "2026-11-01T09:00:00.000+08:00" },
    { id: "r2", kind: "budget", subject_id: "cat-fun", amount: 300000, effective_from: "2026-11-01", created_at: "2026-11-01T09:00:00.000+08:00" });
  assert.deepEqual(validateState(s), []);
  l.settings = { notice_seen_at: TS, whatsnew_seen: CHANGES[0].id, welcome_off: true, start_rule_seen: TS, cat_card_seen: TS, bankLogosTried: {}, intro_off: Object.fromEntries(Object.keys(SCREEN_NAMES).map((k) => [k, true])),
    income_base_pin: 2500000, starter_rent: 0 };
  return l;
};
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1" });
await ctx.addInitScript(() => { Object.defineProperty(navigator, "standalone", { get: () => true }); sessionStorage.setItem("logOpen", "1"); });
await ctx.clock.setFixedTime(new Date(TS));   // on the window, before any page: on WebKit a fresh page's own clock was not ready yet
const open = async () => { const page = await ctx.newPage(); page.on("pageerror", (e) => errors.push(e.message)); await page.goto(base); await page.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 }); return page; };
const stored = (page) => page.evaluate(() => new Promise((res) => { const r = indexedDB.open("financialTracker", 3); r.onsuccess = () => { const g = r.result.transaction("kv").objectStore("kv").get("ledger"); g.onsuccess = () => { r.result.close(); res(JSON.parse(g.result)); }; }; }));
const first = await open();
await first.evaluate(async (text) => { localStorage.setItem("financialTracker.ledger", text);
  await new Promise((res) => { const r = indexedDB.open("financialTracker", 3); r.onsuccess = () => { const tx = r.result.transaction("kv", "readwrite"); tx.objectStore("kv").put(text, "ledger"); tx.oncomplete = () => { r.result.close(); res(); }; }; });
}, JSON.stringify(seeded()));
await first.close();
const page = await open();
const toBudget = async () => {
  await page.click("#menuBtn"); await page.click('#menu .item:has-text("Plan & Save")'); await page.waitForFunction(() => !document.querySelector("#menu .drawer"));
  await page.click('#screen .hub button:has-text("Budget")'); await page.waitForSelector('#screen button[data-action="open-suggest"]');
};
await toBudget();
const heads = async (where) => (await page.locator(where + " h4.sugh").allTextContents()).map((h) => h.trim());
const bufRow = () => page.locator('#screen button[data-action="open-buffer-monthly"]');

// ---- 1. no buffer set: an empty row to tap, after Wants
ok(await bufRow().count() === 1 && (await bufRow().innerText()).replace(/\s+/g, " ").includes("Buffer For overspending; not savings Not set"), "with no buffer set, Budget shows one Buffer row: its name, what it is for, and Not set");
const headsNow = await heads("#screen");
ok(inOrder(headsNow) && ["Needs", "Wants", "Buffer"].every((h) => headsNow.includes(h)), "the parts follow the owner's order, Wants before the Buffer: " + headsNow.join(", "));
const actions = page.locator("#screen .actrow2 > button.act");
ok(await actions.count() >= 1 && (await actions.allInnerTexts()).some((t) => t.trim() === "Record pay received") && await page.locator('#screen button.primary').count() === 1, "Record pay received is a compact plain button in the row of actions; Suggest a budget stays the one filled button");

// ---- 2. typing the buffer in its own window
await bufRow().click(); await page.waitForSelector("#sheet #f-amount");
ok((await page.locator("#sheet").innerText()).includes("It is never counted as savings."), "the window says what the buffer is for and that it is not savings");
await page.fill("#sheet #f-amount", "2,500");
await page.waitForFunction(() => !document.querySelector("#f-save").disabled);
await page.click("#f-save"); await page.locator("#toast").filter({ hasText: "Buffer: " }).waitFor({ timeout: 8000 });
await page.waitForFunction(() => !document.documentElement.dataset.saving);
ok((await stored(page)).settings.buffer_monthly === 250000, "the buffer is kept as 2,500.00 a month");
ok((await bufRow().innerText()).includes("₱2,500.00"), "and the row shows ₱2,500.00");

// ---- 3. Suggest a budget proposes the same buffer, grouped like Budget
await page.click('#screen button[data-action="open-suggest"]'); await page.waitForSelector("#sheet #sug-left");
const sheetBuf = page.locator('#sheet button[data-action="open-buffer-monthly"]');
ok(await sheetBuf.count() === 1 && (await sheetBuf.innerText()).includes("₱2,500.00"), "Suggest a budget proposes the same ₱2,500.00 buffer (it used to propose its own figure)");
const headsSheet = await heads("#sheet");
ok(inOrder(headsSheet) && ["Wants", "Buffer"].every((h) => headsSheet.includes(h)), "Suggest groups its lines under the same headings, in the same order: " + headsSheet.join(", "));
ok(/^Paid in this order: Fixed, Needs, your savings minimum, the buffer, then Wants /.test((await page.locator("#sug-left").innerText()).trim()), "the note says the order money is paid in, in the screen's words");
await page.evaluate(() => document.querySelector("#scrim").click()); await page.waitForFunction(() => !document.querySelector("#sheet .sheet"));

// ---- 4. No buffer clears it
await page.waitForSelector('#screen button[data-action="open-buffer-monthly"]');
await bufRow().click(); await page.waitForSelector('#sheet button[data-action="clear-buffer-monthly"]');
await page.click('#sheet button[data-action="clear-buffer-monthly"]'); await page.locator("#toast").filter({ hasText: "No buffer" }).waitFor({ timeout: 8000 });
await page.waitForFunction(() => !document.documentElement.dataset.saving);
ok(!("buffer_monthly" in (await stored(page)).settings) && (await bufRow().innerText()).includes("Not set"), "No buffer removes the setting and the row says Not set again");

ok(errors.length === 0, "no script errors" + (errors.length ? " -> " + errors[0] : ""));
await browser.close();
console.log(`buffer-line: ${passed} checks passed`);

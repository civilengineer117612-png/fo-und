// UI audit of the real app on an iPhone-sized screen with an INVENTED ledger (every name and figure is made up). Serve the repo on port 8124, then node e2e/ui-audit.mjs.
// Two rules from docs/UI.md, checked on every screen and every window in light and dark:
//   A. no text-link action: nothing a person taps may be an underlined word (button.link, a link, or any tappable thing drawn with an underline). Help is the one place where
//      a link sits inside a sentence, so the Help screen is left out.
//   B. at most ONE filled main button (button.primary) is visible on a screen, or in the window that is open on it.
import { launchBrowser } from "./engine.mjs";
import * as M from "../src/model/index.js";
const base = process.env.BASE ?? "http://127.0.0.1:8124/app/index.html";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1";
let passed = 0, failed = 0;
const check = (ok, label, detail = "") => { if (ok) { passed++; console.log("  ok  ", label); } else { failed++; console.log("  FAIL", label); if (detail) console.log("      ", detail); } };
function makeLedger() {
  const TS = "2026-11-08T03:00:00Z", CT = "2026-11-01T09:00:00.000+08:00";
  const cat = (id, name, role) => ({ id, name, kind: "expense", ...(role ? { role } : {}) });
  const l = M.emptyLedger(); l.rev = 1; l.saved_at = TS;
  const acct = (id, name, bal, o = {}) => ({ id, name, class: "asset", role: "", opening_balance: bal, opening_date: "2026-01-01", hidden_by_default: false, archived: false, ...o });
  l.state.accounts.push(acct("cash", "Cash", 350000), acct("chk", "Sample Checking", 9000000), acct("sav", "Sample Savings", 6000000), acct("wal", "Sample Wallet", 1500000),
    acct("card", "Sample Card", 0, { class: "liability" }), acct("x1", "Sample Extra One", 100000), acct("x2", "Sample Extra Two", 200000));
  l.state.categories = [cat("rent", "Rent", "rent"), cat("subs", "Subscription", "subscription"), cat("food", "Food", "food"), cat("transport", "Transport", "transport"),
    cat("fun", "Fun"), cat("shop", "Shopping"), cat(M.UNLOGGED_CATEGORY_ID, "Uncategorized"), ...M.INCOME_CATEGORIES];
  const rule = (id, amount) => ({ id: "r-" + id, kind: "budget", subject_id: id, amount, effective_from: "2026-01-01", created_at: "2026-01-01T09:00:00.000+08:00" });
  l.state.rules = [rule("rent", 2000000), rule("subs", 50000), rule("food", 800000), rule("transport", 300000), rule("fun", 300000), rule("shop", 200000)];
  l.state.goals = [{ id: "ef", name: "Emergency fund", account_id: "sav", role: "emergency", hidden_by_default: false }, { id: "trip", name: "Trip", account_id: "wal", target: 6000000, deadline: "2027-03-31", hidden_by_default: false }, { id: "laptop", name: "Laptop", target: 9000000, hidden_by_default: false }];
  let n = 0;
  const spend = (date, payee, catId, amount, status = "verified", from = "chk") => { const id = "t" + (++n);
    l.state.transactions.push({ id, date, payee, memo: "", status, source: "manual", created_at: CT, ...(status === "verified" ? { verified_at: CT } : {}) });
    l.state.entries.push({ transaction_id: id, account_id: from, amount: -amount }, { transaction_id: id, category_id: catId, amount }); };
  spend("2026-11-01", "Rent", "rent", 2000000); spend("2026-11-02", "Sample Grocer", "food", 245000); spend("2026-11-03", "Bus fare", "transport", 4500, "verified", "cash");
  spend("2026-11-05", "Movie night", "fun", 60000); spend("2026-11-06", "Sample Shop", "shop", 129900); spend("2026-11-07", "Lunch", "food", 18500, "verified", "cash");
  spend("2026-11-08", "Dinner out", "food", 42000, "draft"); spend("2026-11-08", "Ride", "transport", 15000, "draft", "wal");
  spend("2026-10-12", "Sample Grocer", "food", 310000); spend("2026-10-20", "Streaming", "subs", 50000); spend("2026-09-14", "Sample Grocer", "food", 280000);
  const s = M.addSchedule(l.state, { id: "s1", kind: "repeating", name: "Streaming", category_id: "subs", account_id: "chk", start: "2026-06-01", amount: 50000, day: 20 });
  if (s.ok) l.state = s.state;
  l.settings = { notice_seen_at: TS, whatsnew_seen: M.CHANGES[0].id, welcome_off: true, start_rule_seen: TS, cat_card_seen: TS, income_base_pin: 5000000, pay_schedule: { kind: "twice", days: [15, "last"] }, plan_moved: "2026-10", starter_rent: 2000000,
    goal_monthly: { ef: 600000, trip: 400000 }, intro_off: Object.fromEntries(Object.keys(M.SCREEN_NAMES).map((k) => [k, true])) };
  const bad = M.validateState(l.state);
  if (bad.length) throw new Error("ledger invalid: " + JSON.stringify(bad.slice(0, 3)));
  return { ledger: l, TS };
}

const menu = (name) => async (p) => { await p.click("#menuBtn"); await p.click(`#menu .item:has-text("${name}")`); };
const tap = (text, scope = "#screen") => async (p) => { await p.evaluate(([t, s]) => { const el = [...document.querySelectorAll(s + " button, " + s + " [data-action]")].find((b) => b.offsetParent && b.textContent.replace(/\s+/g, " ").trim().includes(t)); if (!el) throw new Error("no button " + t); el.click(); }, [text, scope]); };
const act = (sel) => async (p) => { await p.evaluate((s) => { const el = document.querySelector(s); if (!el) throw new Error("no " + s); el.click(); }, sel); };
export const SCREENS = [
  ["Log", []], ["Verify", [async (p) => p.click('#nav button:has-text("Verify")')]],
  ["Log: Add expense window", [act('[data-action="open-other"]')]],
  ["Cash flow", [menu("Cash flow")]], ["Cash flow: Category", [menu("Cash flow"), tap("Category")]], ["Cash flow: Accounts", [menu("Cash flow"), tap("Accounts")]], ["Cash flow: Trends", [menu("Cash flow"), tap("Trends")]],
  ["Income", [menu("Cash flow"), act("button.titleswitch")]],
  ["Cards", [menu("Cards")]], ["Cards: More window", [menu("Cards"), act('[data-action="cards-more"]')]], ["Cards: as a list", [menu("Cards"), act('[data-action="cards-list"]')]], ["Cards: Pay a card window", [menu("Cards"), act('.gcard[data-action="open-card"]')]],
  ["Budget", [menu("Plan & Save")]], ["Budget: Suggest window", [menu("Plan & Save"), act('[data-action="open-suggest"]')]],
  ["Goals", [menu("Plan & Save"), tap("Goals", "#screen .hub")]], ["Goals: goal window", [menu("Plan & Save"), tap("Goals", "#screen .hub"), act('#screen [data-action="view-goal"]')]],
  ["Scheduled", [menu("Scheduled")]], ["Weekly review", [menu("Weekly review")]], ["Checks", [menu("Weekly review"), tap("Checks", "#screen .hub")]],
  ["Scan", [menu("Scan")]], ["Trips", [menu("Trips")]], ["Buffer", [menu("Buffer")]], ["Help", [menu("Help")]],
  ["Setup", [menu("Setup")]], ["Setup: Accounts", [menu("Setup"), tap("Accounts")]], ["Setup: account window", [menu("Setup"), tap("Accounts"), act('#screen [data-action="acct-more"]')]], ["Setup: Categories", [menu("Setup"), tap("Categories")]], ["Setup: Backup and restore", [menu("Setup"), tap("Backup and restore")]], ["Setup: About this app", [menu("Setup"), tap("About this app")]],
  ["Menu", [async (p) => p.click("#menuBtn")]],
];

// Runs in the page: returns what breaks rule A and rule B on the screen as it is now (or on the open window).
const AUDIT = (isHelp) => {
  const vis = (el) => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && el.offsetParent !== null; };
  const sheetEl = document.querySelector("#sheet"), sheetOpen = sheetEl && [...sheetEl.querySelectorAll("*")].some((x) => x.getBoundingClientRect().height > 120 && getComputedStyle(x).visibility !== "hidden");
  const top = sheetOpen ? sheetEl : document.querySelector("#menu .drawer") ? document.querySelector("#menu") : document.body, within = (el) => top === document.body || top.contains(el);
  const txt = (el) => (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40);
  const links = [], filled = [];
  for (const b of document.querySelectorAll("button, a[href], [data-action]")) {
    if (!vis(b) || !within(b) || isHelp) continue;
    const under = getComputedStyle(b).textDecorationLine.includes("underline") || [...b.children].some((c) => getComputedStyle(c).textDecorationLine.includes("underline"));
    if (b.matches("button.link, a[href]") || under) links.push(txt(b));
  }
  for (const b of document.querySelectorAll("button.primary")) if (vis(b) && within(b)) filled.push(txt(b));
  return { links, filled };
};
const browser = await launchBrowser(), { ledger, TS } = makeLedger(), errors = [];
for (const scheme of ["light", "dark"]) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: scheme, userAgent: UA });
  await ctx.route("**/*", (r) => new URL(r.request().url()).origin === new URL(base).origin ? r.continue() : r.abort());
  await ctx.addInitScript(() => { Object.defineProperty(navigator, "standalone", { get: () => true }); sessionStorage.setItem("logOpen", "1"); });
  const page = await ctx.newPage(); page.on("pageerror", (e) => errors.push(e.message)); await page.clock.setFixedTime(new Date(TS));
  await page.goto(base); await page.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 });
  await page.evaluate(async (text) => { localStorage.setItem("financialTracker.ledger", text); await new Promise((res) => { const r = indexedDB.open("financialTracker", 3); r.onsuccess = () => { const tx = r.result.transaction("kv", "readwrite"); tx.objectStore("kv").put(text, "ledger"); tx.oncomplete = () => { r.result.close(); res(); }; }; r.onerror = () => res(); }); }, JSON.stringify(ledger));
  for (const [name, steps] of SCREENS) {
    try {
      await page.reload(); await page.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 });
      for (const s of steps) { await s(page); await page.waitForTimeout(350); }
      await page.waitForTimeout(300);
      const r = await page.evaluate(AUDIT, /^Help/.test(name));
      check(r.links.length === 0, `${scheme}: ${name}: no text-link action`, "underlined or link-styled: " + JSON.stringify(r.links));
      check(r.filled.length <= 1, `${scheme}: ${name}: at most one filled main button`, "filled buttons: " + JSON.stringify(r.filled));
    } catch (e) { check(false, `${scheme}: ${name}: could not be opened`, String(e.message).split("\n")[0]); }
  }
  await ctx.close();
}
check(errors.length === 0, "no script errors" + (errors.length ? " -> " + errors[0] : ""));
await browser.close();
console.log(`ui-audit: ${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);

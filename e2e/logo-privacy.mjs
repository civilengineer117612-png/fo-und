// Serve the repo on port 8124, then node e2e/logo-privacy.mjs. Every name and figure here is invented, and NO request leaves this machine: every outside
// address is answered here.
// LOGO PRIVACY (owner, Nov 12, P1): no network request may carry the owner's data or reveal it. The bank logos are the app's only outside requests. This
// script opens the app on two very different ledgers and proves that what it asks the outside is the SAME for both, carries nothing from the ledger, and
// that drawing accounts asks for nothing at all. It has its own ledgers and windows, so it can be run alone.
import assert from "node:assert/strict";
import { launchBrowser } from "./engine.mjs";
import { emptyLedger, CHANGES, SCREEN_NAMES, BANKS } from "../src/model/index.js";
const browser = await launchBrowser();
const base = process.env.BASE ?? "http://127.0.0.1:8124/app/index.html", ORIGIN = new URL(base).origin;
const errors = [];
let passed = 0;
const ok = (cond, label) => { assert.ok(cond, label); passed++; console.log("ok: " + label); };
const HOSTS = ["icon.horse", "api.faviconkit.com", "en.wikipedia.org", "upload.wikimedia.org"];

const settings = (TS, more = {}) => ({ notice_seen_at: TS, whatsnew_seen: CHANGES[0].id, welcome_off: true, start_rule_seen: TS, cat_card_seen: TS, intro_off: Object.fromEntries(Object.keys(SCREEN_NAMES).map((k) => [k, true])), ...more });
const acct = (id, name, o = {}) => ({ id, name, class: "asset", role: "", opening_balance: 1234500, opening_date: "2026-01-01", hidden_by_default: false, archived: false, ...o });
// Ledger A: accounts at listed banks, digits, a credit card, a logo address an earlier version saved (on the bank and on an account).
const ledgerA = () => { const l = emptyLedger(); l.rev = 1; l.saved_at = "2026-11-10T08:00:00.000+08:00";
  l.state.accounts.push(acct("a1", "GoTyme Everyday", { bank: "gotyme", last4: "4321" }), acct("a2", "MariBank Savings", { bank: "maribank", last4: "8765" }), acct("a3", "Landbank Payroll", { bank: "landbank", icon_url: "https://icons.duckduckgo.com/ip3/landbank.com.ico" }),
    acct("a4", "UnionBank Card", { class: "liability", bank: "unionbank", opening_balance: 0 }), acct("a5", "Maya Wallet", { bank: "maya", last4: "2468" }));
  l.settings = settings("2026-11-10T03:00:00Z", { bankLogos: { landbank: { icon_url: "https://landbank.com/apple-touch-icon.png" }, bdo: { icon_url: "https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&nfrp=2&url=https://bdo.com.ph&size=128" } } });
  return l; };
// Ledger B: one cash account, no bank at all.
const ledgerB = () => { const l = emptyLedger(); l.rev = 1; l.saved_at = "2026-11-10T08:00:00.000+08:00"; l.state.accounts.push(acct("c1", "Cash", { opening_balance: 50000 })); l.settings = settings("2026-11-10T03:00:00Z"); return l; };
const SECRETS = ["GoTyme%20Everyday", "Everyday", "Wallet", "2468", "MariBank%20Savings", "Payroll", "UnionBank%20Card", "4321", "8765", "12345", "1234500"];

let PNG = null;
// One phone: its own storage, its own clock, and a list of everything it asked the outside (which is answered here, never sent on).
async function phone(ledger, { fail = () => false } = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1" });
  const asked = [];
  await ctx.route("**/*", (route) => { const req = route.request(), u = new URL(req.url());
    if (u.origin === ORIGIN) return route.continue();
    asked.push({ url: req.url(), host: u.host, headers: req.headers() });
    if (fail(u)) return route.abort();
    if (u.host === "en.wikipedia.org") return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ query: { pages: [{ title: "Sample", thumbnail: { source: "https://upload.wikimedia.org/wikipedia/commons/thumb/sample-logo.png" } }] } }) });
    if (HOSTS.includes(u.host)) return route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG });
    return route.abort(); });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, "standalone", { get: () => true }); sessionStorage.setItem("logOpen", "1"); });
  const page = await ctx.newPage(); page.on("pageerror", (e) => errors.push(e.message));
  const at = async (iso) => { await page.clock.setFixedTime(new Date(iso)); };
  await at("2026-11-12T03:00:00Z");
  await page.goto(base); await page.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 });
  if (!PNG) PNG = Buffer.from(await page.evaluate(() => { const c = document.createElement("canvas"); c.width = c.height = 64; const x = c.getContext("2d"); x.fillStyle = "#1a8"; x.fillRect(0, 0, 64, 64); x.fillStyle = "#fff"; x.fillRect(20, 20, 24, 24); return c.toDataURL("image/png").split(",")[1]; }), "base64");
  await page.evaluate(async (text) => { localStorage.setItem("financialTracker.ledger", text);
    await new Promise((res) => { const r = indexedDB.open("financialTracker", 3); r.onsuccess = () => { const tx = r.result.transaction("kv", "readwrite"); tx.objectStore("kv").put(text, "ledger"); tx.oncomplete = () => { r.result.close(); res(); }; }; }); }, JSON.stringify(ledger));
  const stored = () => page.evaluate(() => new Promise((res) => { const r = indexedDB.open("financialTracker", 3); r.onsuccess = () => { const g = r.result.transaction("kv").objectStore("kv").get("ledger"); g.onsuccess = () => { r.result.close(); res(JSON.parse(g.result)); }; }; }));
  // start the app and let the logo lookup run to its end (it notes the day it tried every bank it asked for)
  const start = async () => { asked.length = 0; await page.reload(); await page.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 });
    let last = -1, same = 0; while (same < 4) { await page.waitForTimeout(500); same = asked.length === last ? same + 1 : 0; last = asked.length; } };
  const menu = async (name) => { await page.evaluate(() => document.querySelector("#menuBtn").click()); await page.waitForTimeout(350); await page.evaluate((n) => [...document.querySelectorAll("#menu .item")].find((x) => x.textContent.includes(n)).click(), name); await page.waitForTimeout(400); };
  // every screen that draws account or bank pictures
  const lookAround = async () => { await menu("Cards"); await menu("Setup"); await page.evaluate(() => [...document.querySelectorAll("#screen button")].find((x) => x.textContent.includes("Accounts"))?.click()); await page.waitForTimeout(400);
    await page.evaluate(() => document.querySelector('#nav button[data-tab="log"]').click()); await page.waitForTimeout(300); };
  const remoteImages = () => page.evaluate(() => [...document.querySelectorAll("img")].map((i) => i.getAttribute("src") ?? "").filter((s) => /^https?:/i.test(s)));
  return { ctx, page, asked, at, start, stored, menu, lookAround, remoteImages };
}
const urls = (p) => [...new Set(p.asked.map((a) => a.url))].sort();

// ---- 1. the same requests, whatever the ledger holds
const A = await phone(ledgerA()), B = await phone(ledgerB());
await A.start(); await B.start();
const firstA = urls(A), firstB = urls(B);
ok(firstA.length > 0 && firstA.length === firstB.length && firstA.every((u, i) => u === firstB[i]), `a phone with four bank accounts and a phone with only cash ask the outside for exactly the same ${firstA.length} addresses`);
ok(BANKS.filter((b) => !b.noLookup).every((b) => firstA.some((u) => u.includes(b.domain))), "every listed bank is asked for, not only the owner's");
ok(A.asked.every((a) => HOSTS.includes(a.host)), "only the four logo hosts are ever asked: " + [...new Set(A.asked.map((a) => a.host))].join(", "));
ok(!A.asked.some((a) => BANKS.some((b) => a.host === b.domain || a.host === "www." + b.domain) || /gstatic|duckduckgo|google/.test(a.host) || /apple-touch-icon/.test(a.url)), "a bank's own site and the show-only icon services are never asked");
ok(!A.asked.some((a) => SECRETS.some((s) => a.url.includes(s))), "no address carries an account name, its digits or an amount");
ok(A.asked.every((a) => !("cookie" in a.headers) && !("referer" in a.headers)), "no request carries a cookie or the address of this page");

// ---- 2. drawing the accounts asks for nothing, and nothing is drawn from an outside address
A.asked.length = 0; await A.lookAround();
ok(A.asked.length === 0, "looking at Cards, Setup and the accounts asks the outside for nothing");
await A.menu("Cards");
ok((await A.remoteImages()).length === 0, "no picture on screen comes from an outside address (a logo address saved by an earlier version is not drawn)");
ok(await A.page.locator('#screen img.ico[src^="data:image/"]').count() >= 1, "the owner's banks show the copies kept on the phone");
{ const s = (await A.stored()).settings; ok(Object.values(s.bankLogos).length > 0 && Object.values(s.bankLogos).every((l) => l.icon?.startsWith("data:image/") && !l.icon_url), "what is kept for every bank is a picture on the phone, never an outside address"); }

// ---- 3. with every logo copied, the next start asks for nothing
await A.start(); await B.start();
ok(urls(A).length === 0 && urls(B).length === 0, "once the logos are on the phone, starting the app asks the outside for nothing");

// ---- 4. removing a logo does not change what is asked: a week later both phones ask for the same (nothing, here)
await A.menu("Setup"); await A.page.evaluate(() => [...document.querySelectorAll("#screen button")].find((x) => x.textContent.includes("Accounts"))?.click()); await A.page.waitForTimeout(400);
await A.page.click('button[data-action="acct-more"][data-id="a1"]'); await A.page.click('#sheet button[data-action="open-icon"]'); await A.page.click('#sheet button:has-text("Remove the picture")'); await A.page.waitForTimeout(600);
{ const s = (await A.stored()).settings; ok(s.bankLogosBlocked?.gotyme === true && s.bankLogos.gotyme?.icon?.startsWith("data:image/"), "Remove the picture hides GoTyme's logo and keeps its copy on the phone"); }
await A.menu("Cards");
ok(await A.page.locator('.gcard[data-id="a1"] img.ico').count() === 0, "the account shows its letter again");
await A.at("2026-11-21T03:00:00Z"); await B.at("2026-11-21T03:00:00Z"); await A.start(); await B.start();
ok(urls(A).length === urls(B).length && urls(A).every((u, i) => u === urls(B)[i]), "nine days later the phone that removed a logo and the phone that did not ask for exactly the same (" + urls(A).length + " addresses)");
await A.ctx.close(); await B.ctx.close();

// ---- 5. when a service does not answer, the same banks are asked again a week later on both phones, and still nothing of the ledger goes out
const down = (u) => u.host === "icon.horse" || u.host === "api.faviconkit.com";
const C = await phone(ledgerA(), { fail: down }), D = await phone(ledgerB(), { fail: down });
await C.start(); await D.start();
ok(urls(C).length > 0 && urls(C).join("\n") === urls(D).join("\n"), "with the icon services down, both phones asked for the same addresses");
// Landbank has no copy on this phone (the services are down), only the address an earlier version saved, on the bank and on the account: it must not be drawn
C.asked.length = 0; await C.lookAround(); await C.menu("Cards");
ok((await C.remoteImages()).length === 0 && C.asked.length === 0, "an account whose bank has only an old outside address shows its letter: nothing is drawn from outside and nothing is asked");
ok(await C.page.locator('.gcard[data-id="a3"] .ico.mono').count() === 1, "the Landbank account shows a letter tile");
// the one logo that did arrive (through Wikipedia) is removed on the phone that has that bank
await C.menu("Setup"); await C.page.evaluate(() => [...document.querySelectorAll("#screen button")].find((x) => x.textContent.includes("Accounts"))?.click()); await C.page.waitForTimeout(400);
await C.page.click('button[data-action="acct-more"][data-id="a5"]'); await C.page.click('#sheet button[data-action="open-icon"]'); await C.page.click('#sheet button:has-text("Remove the picture")'); await C.page.waitForTimeout(600);
ok((await C.stored()).settings.bankLogosBlocked?.maya === true, "the owner of a Maya account removes Maya's logo");
await C.at("2026-11-20T03:00:00Z"); await D.at("2026-11-20T03:00:00Z"); await C.start(); await D.start();
ok(urls(C).length > 0 && urls(C).join("\n") === urls(D).join("\n"), "and a week later they ask again for the same ones, whatever accounts they hold and whatever logo was removed (" + urls(C).length + " addresses)");
ok(!C.asked.some((a) => SECRETS.some((s) => a.url.includes(s))) && C.asked.every((a) => HOSTS.includes(a.host)), "still nothing of the ledger in any address, and only the four hosts");
await C.ctx.close(); await D.ctx.close();

ok(errors.length === 0, "no script errors" + (errors.length ? " -> " + errors[0] : ""));
await browser.close();
console.log(`logo-privacy: ${passed} checks passed`);

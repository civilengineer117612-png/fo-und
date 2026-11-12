// Serve the repo on port 8124, then node e2e/network.mjs. Every name and figure here is invented.
// NOTHING LEAVES THE TEST MACHINE (owner, Nov 12, L12): a window opened through e2e/engine.mjs, with NO route of its own, reaches only the served app.
// The app does ask the bank logo services at start (that is its job); here those requests must be stopped by the engine, never answered by the
// real internet. A script's own route still wins, so a script can play a service.
import assert from "node:assert/strict";
import { launchBrowser, outsideStopped, isOutside } from "./engine.mjs";
import { emptyLedger, CHANGES, SCREEN_NAMES } from "../src/model/index.js";
const browser = await launchBrowser();
const base = process.env.BASE ?? "http://127.0.0.1:8124/app/index.html";
const TS = "2026-11-12T03:00:00Z";
let passed = 0;
const ok = (cond, label) => { assert.ok(cond, label); passed++; console.log("ok: " + label); };

ok(isOutside("https://icon.horse/icon/x.com") && isOutside("http://example.com/") && isOutside("wss://example.com/s"), "an address on the internet is outside");
ok(!isOutside(base) && !isOutside("http://localhost:8124/app/") && !isOutside("data:image/png;base64,AAAA") && !isOutside("blob:http://localhost:8124/x") && !isOutside("about:blank"), "the served app, and data kept in the page, are not");

async function open(routes) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1" });   // NO route here: the engine's own rule is what is tested
  if (routes) await routes(ctx);
  await ctx.addInitScript(() => { Object.defineProperty(navigator, "standalone", { get: () => true }); sessionStorage.setItem("logOpen", "1"); });
  const page = await ctx.newPage(), asked = [], answered = [], failed = [];
  page.on("request", (r) => { if (isOutside(r.url())) asked.push(r.url()); });
  page.on("response", (r) => { if (isOutside(r.url())) answered.push(r.url()); });
  page.on("requestfailed", (r) => { if (isOutside(r.url())) failed.push(r.url()); });
  await page.clock.setFixedTime(new Date(TS));
  await page.goto(base); await page.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 });
  const l = emptyLedger(); l.rev = 1; l.saved_at = "2026-11-10T08:00:00.000+08:00";
  l.settings = { notice_seen_at: TS, whatsnew_seen: CHANGES[0].id, welcome_off: true, start_rule_seen: TS, cat_card_seen: TS, intro_off: Object.fromEntries(Object.keys(SCREEN_NAMES).map((k) => [k, true])) };
  await page.evaluate(async (text) => { localStorage.setItem("financialTracker.ledger", text);
    await new Promise((res) => { const r = indexedDB.open("financialTracker", 3); r.onsuccess = () => { const tx = r.result.transaction("kv", "readwrite"); tx.objectStore("kv").put(text, "ledger"); tx.oncomplete = () => { r.result.close(); res(); }; }; });
  }, JSON.stringify(l));
  asked.length = 0; answered.length = 0; failed.length = 0;
  await page.reload(); await page.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 });
  // the logo lookup runs to its end: nothing new is asked for three seconds
  { let last = -1, same = 0; while (same < 6) { await page.waitForTimeout(500); same = asked.length === last ? same + 1 : 0; last = asked.length; } }
  return { ctx, page, asked, answered, failed };
}

// ---- 1. a window with no route of its own
const before = new Map(outsideStopped);
const a = await open();
ok(a.asked.length > 10, "the app asked the outside for bank logos at start (" + a.asked.length + " requests)");
ok(a.answered.length === 0, "not one of them was answered by the internet");
ok(a.failed.length === a.asked.length, "every one of them was stopped");
const stoppedNow = [...outsideStopped].reduce((n, [h, c]) => n + c - (before.get(h) ?? 0), 0);
ok(stoppedNow === a.asked.length && outsideStopped.has("icon.horse") && outsideStopped.has("api.faviconkit.com"), "the engine counted each one it stopped, by host");
ok(await a.page.locator("#nav button").first().isVisible() && await a.page.locator("#banner .alert, #warn [role=alertdialog]").count() === 0, "the app goes on as if it had no internet: no error on the screen");
await a.ctx.close();

// ---- 2. a script's own route is asked first, so it can still play a service
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
let played = 0;
const b = await open((ctx) => ctx.route(/^https:\/\/icon\.horse\//, (route) => { played++; return route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG }); }));
ok(played > 5 && b.answered.length === played && b.answered.every((u) => new URL(u).host === "icon.horse"), "a route the script adds answers its service (" + played + " requests), and only that one");
ok(b.failed.length === b.asked.length - played && b.failed.every((u) => new URL(u).host !== "icon.horse"), "everything else outside is still stopped by the engine");
await b.ctx.close();

await browser.close();
console.log(`network: ${passed} checks passed`);

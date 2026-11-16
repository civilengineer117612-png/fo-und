// TEMPORARY (Nov 16, the owner's bisect of the WebKit window jump): the sheet-scroll steps, repeated REPEATS times, with no check.
// Prints one line: how many repeats moved the window up when the list opened or when a choice was made. Removed after the bisect.
import { launchBrowser, ENGINE } from "./engine.mjs";
import { emptyLedger, CHANGES, SCREEN_NAMES } from "../src/model/index.js";
const browser = await launchBrowser();
const base = process.env.BASE ?? "http://127.0.0.1:8124/app/index.html";
const errors = [], TS = "2026-11-12T03:00:00Z";
const seeded = (seen = CHANGES[0].id) => {
  const l = emptyLedger(), s = l.state; l.rev = 1; l.saved_at = "2026-11-10T08:00:00.000+08:00";
  const acct = (id, name, opening) => ({ id, name, class: "asset", role: "", opening_balance: opening, opening_date: "2026-01-01", hidden_by_default: false, archived: false });
  s.accounts.push(acct("w", "Wallet", 100000), acct("g", "GCash", 50000));
  l.settings = { notice_seen_at: TS, whatsnew_seen: seen, welcome_off: true, start_rule_seen: TS, cat_card_seen: TS, bankLogosTried: {}, intro_off: Object.fromEntries(Object.keys(SCREEN_NAMES).map((k) => [k, true])) };
  return l;
};

// One run of the owner's steps: a short screen, Add expense, scroll the window to its bottom, open Paid from, choose GCash.
// opts: wait (ms after the window opens before typing; run.mjs 5i types at once, while the window is still sliding up), blur (leave the amount box
// before choosing), js (a script run in the page before the steps).
// bgSave: the bank logos are answered only after the window is scrolled and its list is open, so the app's own quiet background save (the
// logos) lands while the window is open, as in run.mjs 5i (the logos are answered there) and on a phone that fetches its logos at start.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqGeoBwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
async function steps(extraCss, { wait = 400, blur = false, js = null, bgSave = false, base, seen } = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,   // 2x like a phone and like run.mjs 5i
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1" });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, "standalone", { get: () => true }); sessionStorage.setItem("logOpen", "1"); });
  await ctx.clock.setFixedTime(new Date(TS));
  // Only the reloaded page's lookups are held: the first page's are refused at once, else WebKit's reload waits for them and never finishes (CI, Nov 13).
  let release = () => {}, armed = false; const held = new Promise((res) => { release = res; });
  if (bgSave) await ctx.route(/icon\.horse|faviconkit\.com|wikipedia\.org|wikimedia\.org/, async (route) => { if (!armed) return route.abort().catch(() => {}); await held; await route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG }).catch(() => {}); });
  const page = await ctx.newPage(); page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base); await page.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 });
  await page.evaluate(async (text) => { localStorage.setItem("financialTracker.ledger", text);
    await new Promise((res) => { const r = indexedDB.open("financialTracker", 3); r.onsuccess = () => { const tx = r.result.transaction("kv", "readwrite"); tx.objectStore("kv").put(text, "ledger"); tx.oncomplete = () => { r.result.close(); res(); }; }; }); }, JSON.stringify(seeded(seen)));
  armed = true;
  await page.reload({ waitUntil: "domcontentloaded" }); await page.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 });
  if (extraCss) await page.addStyleTag({ content: extraCss });
  if (js) await page.evaluate(js);
  await page.setViewportSize({ width: 360, height: 520 });   // a short screen, so the window has to scroll
  await page.click('[data-action="open-other"]'); await page.waitForSelector("#sheet #f-amount");
  if (wait) await page.waitForTimeout(wait);   // the window has arrived (wait 0: typed at once, as run.mjs 5i does)
  await page.fill("#f-amount", "50");
  const top = () => page.evaluate(() => document.querySelector("#sheet .sheet").scrollTop);
  await page.evaluate(() => { const s = document.querySelector("#sheet .sheet"); s.scrollTop = s.scrollHeight; });
  const before = await top();
  const paid = page.locator("#sheet .pick").nth(1);
  await page.evaluate(() => { document.querySelector("#sheet .sheet").__same = true; });   // marks this window: a rebuilt one would not carry it
  await paid.locator(".pickrow").click();
  const opened = await top();
  const later = await page.evaluate(() => new Promise((res) => { const b = document.querySelector("#sheet .sheet"), at = [b.scrollTop]; requestAnimationFrame(() => { at.push(b.scrollTop); setTimeout(() => { at.push(b.scrollTop); res(at.join("/")); }, 100); }); }));   // diag: right after, one frame later, 100 ms later
  const same = await page.evaluate(() => document.querySelector("#sheet .sheet")?.__same === true && !document.querySelectorAll("#sheet .picklist")[1]?.hidden);
  if (blur) await page.evaluate(() => document.activeElement?.blur());
  if (bgSave) { release(); await page.waitForFunction(() => Object.keys(JSON.parse(localStorage.getItem("financialTracker.ledger") ?? "{}").settings?.bankLogosTried ?? {}).length > 0, null, { timeout: 30000 }); await page.waitForTimeout(300); }
  const saved = await top();
  await paid.locator('.chip:has-text("GCash")').click();
  await page.waitForTimeout(300);
  const after = await top();
  const chosen = await page.evaluate(() => document.querySelector("#sheet .pick:nth-of-type(2) .pickrow, #sheet .pickrow:nth-of-type(1)") && [...document.querySelectorAll("#sheet .pickrow")].map((r) => r.textContent.trim()).join(" | "));
  const sizes = await page.evaluate(() => { const s = document.querySelector("#sheet .sheet"); return { scrollHeight: s.scrollHeight, clientHeight: s.clientHeight }; });
  await ctx.close();
  return { before, opened, later, saved, after, chosen, same, ...sizes };
}

// Every variant on the SAME machine, interleaved (the jump rate changes from machine to machine: main was 8/60 on one, 1/60 on another).
// VARIANTS="label=dir;label=dir": each dir is a copy of the app served by the same server. One warm-up per variant is not counted.
const V = process.env.VARIANTS.split(";").map((x) => { const [label, dir] = x.split("="); return { label, dir, url: `http://127.0.0.1:8124/${dir}/app/index.html`, runs: [] }; });
for (const v of V) v.seen = (await import(new URL(`../../${v.dir}/src/model/index.js`, import.meta.url))).CHANGES[0].id;
const R = Number(process.env.ROUNDS ?? 20);
for (const v of V) v.warm = await steps(null, { wait: 0, bgSave: true, base: v.url, seen: v.seen });
for (let r = 0; r < R; r++) for (let k = 0; k < V.length; k++) { const v = V[(k + r) % V.length]; v.runs.push(await steps(null, { wait: 0, bgSave: r % 2 === 0, base: v.url, seen: v.seen })); }
const up = (x) => x.opened < x.before - 2 || x.after < x.before - 2;
for (const v of V) {
  console.log(`BISECT ${v.label}: ${v.runs.filter(up).length} of ${R} jumped (warm-up ${up(v.warm) ? "jumped " + v.warm.before + ">" + v.warm.opened + ">" + v.warm.after : "kept"}) ` + v.runs.map((x) => x.before + ">" + x.after).join(" "));
}
if (process.env.RESULT_FILE) (await import("node:fs")).writeFileSync(process.env.RESULT_FILE, JSON.stringify(Object.fromEntries(V.map((v) => [v.label, v.runs.filter(up).length]))));
await browser.close();

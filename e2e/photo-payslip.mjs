// Serve the repo on port 8124, then node e2e/photo-payslip.mjs. Every name and figure is invented (e2e/payslip-photo.mjs, hand-worked there).
// The owner's report (Nov 1): a screenshot of a payroll table was read line by line, so the Hours column became the amounts, the Summary's figures became
// deduction lines and the dates were lost. Here the same LAYOUT is drawn into a picture and read by the app's own on-phone reader, as on the phone.
import assert from "node:assert/strict";
import { launchBrowser } from "./engine.mjs";
import { emptyLedger, CHANGES } from "../src/model/index.js";
import { photoRows, PHOTO_EARNINGS, PHOTO_DEDUCTIONS } from "./payslip-photo.mjs";
const browser = await launchBrowser();
const base = process.env.BASE ?? "http://127.0.0.1:8124/app/index.html";
const errors = [], TS = "2026-01-20T03:00:00Z", READ = 240000;
const NOT_CHECKED = "Not checked: the printed totals were not found. Check every line against the page.";
async function open() {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1" });
  await ctx.route("**/*", (route) => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());   // nothing leaves this site
  await ctx.addInitScript(() => { Object.defineProperty(navigator, "standalone", { get: () => true }); sessionStorage.setItem("logOpen", "1"); });
  const page = await ctx.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date(TS));
  await page.goto(base); await page.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 });
  const l = emptyLedger(); l.rev = 1; l.saved_at = TS;
  l.state.accounts.push({ id: "example-bank", name: "Example Bank", class: "asset", role: "bank", opening_balance: 100000, opening_date: "2026-01-01", hidden_by_default: false, archived: false });
  l.settings = { notice_seen_at: TS, whatsnew_seen: CHANGES[0].id, welcome_off: true, start_rule_seen: TS, cat_card_seen: TS, intro_off: { scan: true, income: true, log: true, money: true } };
  await page.evaluate(async (text) => {
    localStorage.setItem("financialTracker.ledger", text);
    await new Promise((res) => { const r = indexedDB.open("financialTracker", 3); r.onsuccess = () => { const tx = r.result.transaction("kv", "readwrite"); tx.objectStore("kv").put(text, "ledger"); tx.oncomplete = () => { r.result.close(); res(); }; }; r.onerror = () => res(); });
  }, JSON.stringify(l));
  await page.reload(); await page.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 });
  return { ctx, page };
}
// The invented page drawn as a screenshot would show it: white, black letters, the app's own bundled font so every engine draws the same letters.
const draw = (page, rows) => page.evaluate(async (rows) => {
  const face = new FontFace("Slip", "url(fonts/ibm-plex-sans-latin-600-normal.woff2)"); await face.load(); document.fonts.add(face);
  const k = 1.5, c = document.createElement("canvas"); c.width = 1500; c.height = 1320;
  const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.fillStyle = "#000"; x.font = "600 21px Slip"; x.textBaseline = "middle";
  for (const r of rows) { x.textAlign = r.a === "r" ? "right" : "left"; x.fillText(r.t, r.x * k, r.y * k); }
  return c.toDataURL("image/png").split(",")[1];
}, rows);
async function scan(page, rows) {
  const png = await draw(page, rows);
  await page.click("#menuBtn"); await page.click('#menu .item:has-text("Scan")'); await page.waitForFunction(() => !document.querySelector("#menu .drawer"));
  await page.setInputFiles("input[data-scan]:not([capture])", { name: "payslip.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await page.locator("#sheet h3", { hasText: "Add a payslip" }).waitFor({ timeout: READ });
}
const rows = (page, key) => page.evaluate((k) => [...document.querySelectorAll(`#sheet details.tot[data-keep="${k}"] .pl`)].map((r) => r.querySelector(".pl-label").textContent + " " + r.querySelector(".pl-amt").textContent), key);
const peso = (s) => "₱" + s;
try {
  { const { ctx, page } = await open();
    await scan(page, photoRows());
    const earn = await rows(page, "e"), ded = await rows(page, "d");
    // Every line, in print order, with its exact AMOUNT (never its hours). A label may carry one misread letter (a real run read HDMF as HDME):
    // the owner checks the words against the page; the money must be exact.
    const near = (a, b) => { if (a === b) return true; if (Math.abs(a.length - b.length) > 1) return false; let i = 0; while (a[i] === b[i]) i++; return [a.slice(i + 1) === b.slice(i + 1), a.slice(i + 1) === b.slice(i), a.slice(i) === b.slice(i + 1)].some(Boolean); };
    const same = (got, want) => got.length === want.length && got.every((g, i) => g.endsWith(" " + peso(want[i][1])) && near(g.slice(0, -(peso(want[i][1]).length + 1)), want[i][0]));
    assert.ok(same(earn, PHOTO_EARNINGS.map(([l, , v]) => [l, v])), "every earnings line with its AMOUNT, never its hours (" + JSON.stringify(earn) + ")");
    assert.ok(same(ded, PHOTO_DEDUCTIONS), "every deduction, the tax line among them (" + JSON.stringify(ded) + ")");
    const v = async (id) => page.inputValue("#" + id);
    assert.deepEqual([await v("p-gross"), await v("p-net"), await v("p-dep"), await v("p-date"), await v("p-from"), await v("p-to")], ["10700.00", "9750.00", "9750.00", "2026-01-16", "2026-01-01", "2026-01-14"], "the Summary's figures under their titles, and the dates");
    const sheet = await page.locator("#sheet").innerText();
    assert.ok(!/could not be placed|could not find/i.test(sheet), "nothing was left unplaced or unfound");
    assert.equal(await page.locator("#p-unchecked").isVisible(), false, "the printed totals were found: it is checked");
    assert.equal(await page.locator("#f-save").innerText(), "Save payslip");
    await ctx.close(); console.log("ok: a payroll table read from a picture keeps every line with its amount (not its hours), the Summary's totals and the dates"); }
  { const { ctx, page } = await open();
    await scan(page, photoRows({ summary: false, distribution: false }));
    assert.equal(await page.locator("#p-unchecked").innerText(), NOT_CHECKED, "no printed totals on the page: the payslip says it was not checked");
    assert.deepEqual([await page.inputValue("#p-gross"), await page.inputValue("#p-net")], ["", ""], "gross and net stay empty: never what the lines add to");
    assert.equal(await page.locator("#f-save").innerText(), "Save as a draft");
    const unfold = (sel) => page.locator(sel).evaluate((d) => { d.open = true; });
    await unfold('#sheet details[data-keep="t"]'); await page.fill("#p-dep", "9750"); await page.click('#sheet .pickrow:has-text("Choose an account")'); await page.click('#sheet .chip:has-text("Example Bank")');
    // a net of zero or below always says Check this
    await unfold('#sheet details.tot[data-keep="d"]');
    await page.click('#sheet details.tot[data-keep="d"] .pl-main:has-text("SSS")'); await page.fill("#p-ia", "20000"); await page.click('[data-action="slip-line-done"]');
    await page.locator("#chk-net").waitFor({ state: "visible" });
    assert.match(await page.locator("#chk-net").innerText(), /Check this: the lines give a net of minus 9,800\.00: check every line against the page/);
    assert.equal(await page.locator("#f-save").isDisabled(), true, "a net below zero cannot be saved");
    await unfold('#sheet details.tot[data-keep="d"]'); await page.click('#sheet details.tot[data-keep="d"] .pl-main:has-text("SSS")'); await page.fill("#p-ia", "450"); await page.click('[data-action="slip-line-done"]');
    assert.equal(await page.locator("#chk-net").isVisible(), false);
    await page.click("#f-save");
    await page.locator("#toast", { hasText: "Kept as a draft" }).waitFor({ timeout: 10000 });
    const st = await page.evaluate(() => JSON.parse(localStorage.getItem("financialTracker.ledger")).state);
    const slip = st.payslips[0], tx = st.transactions.find((t) => t.id === slip.transaction_id);
    assert.equal(slip.totals_unchecked, true); assert.equal(tx.status, "draft", "saved as a draft, never verified income");
    await ctx.close(); console.log("ok: a picture with no printed totals says Not checked, a net below zero says Check this, and Save makes a draft"); }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }

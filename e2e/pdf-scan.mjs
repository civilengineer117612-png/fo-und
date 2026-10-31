// Serve the repo on port 8124, then node e2e/pdf-scan.mjs. All documents are invented.
import assert from "node:assert/strict";
import { payrollItems, payrollPdf } from "./payroll-table.mjs";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { emptyLedger, CHANGES, BANKS } from "../src/model/index.js";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? execSync("npm root -g").toString().trim() + "/playwright");
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const base = process.env.BASE ?? "http://127.0.0.1:8124/app/index.html";
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1" });
const errors = [], external = [];
ctx.on("request", (request) => { if (!request.url().startsWith(new URL(base).origin) && /^https?:/.test(request.url())) external.push({ url: request.url(), method: request.method(), body: request.postData() }); });
await ctx.route("**/*", (route) => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
await ctx.addInitScript(() => { Object.defineProperty(navigator, "standalone", { get: () => true }); sessionStorage.setItem("logOpen", "1"); });
const page = await ctx.newPage();
page.on("pageerror", (error) => errors.push(error.message));
const fixture = (name) => fileURLToPath(new URL("./fixtures/" + name, import.meta.url));
const visible = (selector) => page.locator(selector).first().waitFor({ state: "visible", timeout: 180000 });
const scan = async (name) => {
  await page.locator('[data-action="open-scan-pick"]').first().click();
  await page.locator('input[data-scan="quick"]:not([capture])').setInputFiles(fixture(name));
};
const unlock = async (password) => { await visible("#pdf-pw"); await page.locator("#pdf-pw").fill(password); await page.locator('[data-action="pdf-open"]').click(); };
// The printed lines the form holds, by section: [[label, amount text, category text, notes]], read from the page (the section may be folded).
const lines = (key) => page.evaluate((k) => [...document.querySelectorAll(`#sheet details.tot[data-keep="${k}"] .pl`)].map((r) => [r.querySelector(".pl-label").textContent, r.querySelector(".pl-amt").textContent, r.querySelector(".pl-cat").textContent.replace(/\s*\u203A$/, ""), [...r.querySelectorAll(".pl-t")].map((t) => t.textContent)]), key);
const checkPayslip = async () => {
  await page.locator("#p-net").waitFor({ state: "attached", timeout: 30000 });
  assert.equal(await page.locator("#p-net").inputValue(), "7400.00");
  assert.equal(await page.locator("#p-gross").inputValue(), "8000.00");
  assert.deepEqual((await lines("e")).map((l) => l.slice(0, 2)), [["Regular", "\u20B18,000.00"]], "the printed earnings line, as printed");
  assert.deepEqual((await lines("d")).map((l) => l.slice(0, 3)), [["SSS", "\u20B1400.00", "SSS"], ["Tax Deduction", "\u20B1200.00", "Choose a category"]], "the printed deduction lines, as printed; SSS is matched by its word");
  assert.equal(await page.locator('[data-field="period_from"]').inputValue(), "2026-10-01");
  assert.equal(await page.locator('[data-field="period_to"]').inputValue(), "2026-10-15");
  assert.equal(await page.locator('[data-field="pay_date"]').inputValue(), "2026-10-20");
  assert.equal(await page.locator("#sheet img.shot").count(), 1);
  // The page picture is OPEN without any tap, above the figures (where a photo's picture sits); "Hide the page" folds it and "Show the page" brings it back.
  assert.equal(await page.locator("#sheet details.pagepeek[open]").count(), 1, "the page is open by default");
  assert.equal(await page.locator("#sheet details.pagepeek img.shot").isVisible(), true, "the page picture shows without a tap");
  const imgY = (await page.locator("#sheet img.shot").boundingBox()).y, grossY = (await page.locator("#p-gross").boundingBox())?.y ?? Infinity;
  assert.ok(imgY < grossY, "the page picture sits above the figures");
  assert.equal(await page.locator("#sheet .pagepeek summary:visible").innerText(), "Hide the page");
  await page.locator("#sheet .pagepeek summary").click();
  assert.equal(await page.locator("#sheet details.pagepeek[open]").count(), 0, "Hide the page folds it");
  assert.equal(await page.locator("#sheet .pagepeek summary:visible").innerText(), "Show the page");
  await page.locator("#sheet .pagepeek summary").click();
  assert.equal(await page.locator("#sheet details.pagepeek[open]").count(), 1, "Show the page opens it again");
};
try {
  await page.clock.setFixedTime(new Date("2026-10-22T03:00:00Z"));
  await page.goto(base); await visible("#nav button");
  const seed = emptyLedger(); seed.rev = 1; seed.saved_at = "2026-10-22T03:00:00Z";
  seed.state.accounts.push({ id: "example-bank", name: "Example Bank", class: "asset", role: "bank", opening_balance: 0, opening_date: "2026-01-01", hidden_by_default: false, archived: false });
  seed.settings = { notice_seen_at: seed.saved_at, whatsnew_seen: CHANGES[0].id, welcome_off: true,
    start_rule_seen: seed.saved_at, cat_card_seen: seed.saved_at, intro_off: { scan: true, income: true, log: true, money: true } };
  await page.evaluate(async (seed) => {
    const text = JSON.stringify(seed); localStorage.setItem("financialTracker.ledger", text);
    await new Promise((resolve, reject) => { const r = indexedDB.open("financialTracker", 3); r.onsuccess = () => { const tx = r.result.transaction("kv", "readwrite"); tx.objectStore("kv").put(text, "ledger"); tx.oncomplete = () => { r.result.close(); resolve(); }; tx.onerror = () => reject(tx.error); }; });
  }, seed);
  await page.reload(); await visible("#nav button");
  await scan("sample-payslip-open.pdf"); await checkPayslip();
  if (process.env.PDF_SCAN_SHOT) await page.screenshot({ path: process.env.PDF_SCAN_SHOT });
  await page.locator('#sheet [data-action="close-sheet"]').last().click();
  console.log("ok: an open two-page PDF is read into the payslip form, including its dates and amounts");
  await scan("sample-payslip-locked.pdf"); await unlock("wrong");
  await page.getByText("That password did not open it. Try again.").waitFor();
  await unlock("test1234"); await checkPayslip();
  const preview = await page.locator("#sheet img.shot").evaluate((image) => ({ width: image.naturalWidth, height: image.naturalHeight }));
  assert.ok(preview.height > preview.width * 2, "both pages are in the retained preview");
  assert.ok(!(await page.content()).includes("test1234"));
  assert.ok(!await page.evaluate(() => JSON.stringify({ ...localStorage }).includes("test1234")));
  await page.locator('#sheet [data-action="close-sheet"]').last().click();
  console.log("ok: AES-256 password retry opens the same form; the password is absent from the DOM and localStorage");
  for (const selector of ['[data-action="pdf-cancel"]', '#scrim', '#sheet [data-action="close-sheet"]']) {
    await scan("sample-payslip-locked.pdf"); await visible("#pdf-pw");
    await page.locator(selector).last().click();
    await page.locator("#sheet .sheet").waitFor({ state: "detached" });
    await page.waitForTimeout(200);
    assert.equal(await page.locator("#sheet .sheet").count(), 0);
  }
  console.log("ok: Cancel, the backdrop, and the sheet close button cancel password entry without reopening it");
  // Exercise image-only PDF rendering and the real local OCR reader.
  await scan("sample-receipt-image-locked.pdf"); await unlock("test1234");
  await visible('#sheet [data-field="amount"]');
  assert.equal(await page.locator('#sheet [data-field="amount"]').inputValue(), "250.00", await page.locator("#sheet").textContent());
  assert.equal(await page.locator("#sheet img.shot").count(), 1);
  console.log("ok: an encrypted image-only PDF is rendered and read by the on-device OCR reader");
  await page.locator('#sheet [data-action="close-sheet"]').last().click();
  await page.locator('#menuBtn').click();
  await page.locator('#menu [data-tab="money"]').click();
  await page.locator('#top [data-tab="income"]').click();
  await page.locator('[data-action="open-payslip-choice"]').click();
  await page.locator('input[data-scan="payslip"]:not([capture])').setInputFiles(fixture("sample-payslip-locked.pdf"));
  await unlock("test1234"); await checkPayslip();
  await page.locator('#sheet [data-action="close-sheet"]').last().click();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("financialTracker.ledger")).state.transactions.length), 0);
  console.log("ok: Add income accepts the encrypted PDF too; reading and cancellation add no ledger entries");
  // A text-based payroll PDF is generated in memory, never committed as a file.
  await page.locator('#nav [data-tab="log"]').click();
  const payrollScan = async (options) => {
    await page.locator('[data-action="open-scan-pick"]').first().click();
    await page.locator('input[data-scan="quick"]:not([capture])').setInputFiles({ name: 'invented-payroll.pdf', mimeType: 'application/pdf', buffer: payrollPdf(payrollItems(options)) });
  };
  const extracted = await page.evaluate(async (bytes) => {
    const { readPdfScan } = await import('./pdftext.js');
    const { readPayslip } = await import('../src/model/scan.js');
    let ocr = 0;
    const r = await readPdfScan(new File([new Uint8Array(bytes)],'invented.pdf'), async()=>null, async()=>{ocr++;return '';});
    return { ocr, slip: readPayslip(r.text,'2026-10-23',{allowHistorical:true}) };
  }, [...payrollPdf()]);
  assert.equal(extracted.ocr,0);
  assert.equal(extracted.slip.earnings.reduce((n,l)=>n+l.amount,0),1700000);
  assert.equal(extracted.slip.deposit,1520000);
  console.log('ok: a text payroll PDF uses its text layer, counts every earnings line, and reads the distribution independently');
  await payrollScan();
  await page.locator('#p-net').waitFor({state:'attached'});
  for (const [field, expected] of [['gross','17000.00'],['net','15200.00'],['ded','1800.00'],['deposit','15200.00']]) {
    assert.equal(await page.locator(`[data-field="${field}"]`).inputValue(),expected);
  }
  // EVERY printed line is on the form as printed (nothing squeezed into "Other earnings"), with its hours; Retro is back pay, Non Taxable a flag, exact "Overtime" only suggested
  assert.deepEqual(await lines('e'), [['Regular','\u20B112,000.00','Choose a category',['64.00 hours']], ['Allowance Non Taxable','\u20B11,500.00','Choose a category',['Not taxable','0.00 hours']],
    ['Overtime','\u20B12,500.00','Choose a category',['Overtime (suggested)','8.00 hours']], ['Retro Regular','\u20B11,000.00','Choose a category',['Back pay','8.00 hours']]]);
  assert.deepEqual((await lines('d')).map((l) => l.slice(0, 3)), [['HDMF','\u20B1100.00','Pag-IBIG'], ['PhilHealth','\u20B1400.00','PhilHealth'], ['SSS','\u20B1700.00','SSS'], ['Tax Deduction','\u20B1600.00','Choose a category']]);
  assert.deepEqual([await page.locator('[data-field="pay_rate"]').inputValue(), await page.locator('[data-field="pay_basis"]').inputValue(), await page.locator('[data-field="period_type"]').inputValue()], ['34,000.00','Monthly Non Exempt','Bi-Week'], 'pay rate, basis and period type as printed');
  assert.equal(await page.locator('#p-emp').inputValue(),'Example Employer Ltd');
  // The layout report: one tap copies a skeleton of the PDF's text with every digit as 9 and every word that is not an app heading as x's; the real
  // name, employer and figures never reach the clipboard.
  await ctx.grantPermissions(['clipboard-read','clipboard-write'], { origin: new URL(base).origin });
  await page.locator('[data-action="copy-layout"]').click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(copied, /^LAYOUT REPORT/);
  for (const heading of ['Gross','Summary','Earnings','Distribution','Amount']) assert.ok(copied.includes(heading), heading + ' is kept');
  for (const secret of ['Example','Person','17,000.00','15,200.00','12,000.00','2,500.00','Jan','2026']) assert.ok(!copied.includes(secret), secret + ' never leaves the phone');
  const body = copied.split('\n').filter(l => l && !/^(LAYOUT|Page )/.test(l)).map(l => l.replace(/^\d+:\s*/, '').replace(/(^|; )\d+\/\d+ /g, '$1')).join('\n');
  assert.ok(!/[0-8]/.test(body), 'no digit but 9 in any text');
  console.log('ok: Copy layout report copies a masked skeleton: headings and positions, no digit or name');
  const paid = page.locator('#sheet button[data-id="example-bank"]');
  if (!(await paid.isVisible())) await paid.locator('xpath=ancestor::div[@class="pick"][1]').locator('.pickrow').click();
  await paid.click();
  assert.equal(await page.locator('#f-save').isDisabled(),false);
  await page.locator('#f-save').click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('financialTracker.ledger')).state.payslips.length===1);
  const saved = await page.evaluate(()=>JSON.parse(localStorage.getItem('financialTracker.ledger')));
  assert.equal(saved.state.payslipLines.filter(l=>l.side==='earning').reduce((n,l)=>n+l.amount,0),1700000);
  assert.equal(saved.state.payslipLines.filter(l=>l.side==='deduction').reduce((n,l)=>n+l.amount,0),180000);
  assert.equal(saved.state.payslips[0].deposit,1520000);
  assert.equal(saved.v,seed.v);
  console.log('ok: the actual scan form saves reconciled earnings and deductions in the unchanged ledger format');
  // A table that does not add up is never refused (owner, Oct 29): the form is filled with the best reading, the figure the arithmetic did not prove is
  // marked "Check this" with the difference, and Save asks once and keeps the payslip as a DRAFT in Verify, never as verified income.
  const ledgerNow = () => page.evaluate(() => JSON.parse(localStorage.getItem('financialTracker.ledger')));
  const verifiedPay = (l) => l.state.transactions.filter(t => t.status === 'verified' && l.state.payslips.some(x => x.transaction_id === t.id)).length;
  let month = 1;
  for (const [name, change, field, reason, gap] of [
    ['gross',a=>{a.find(i=>i.y===640&&i.str==='17,000.00').str='18,000.00';}, '#p-gross', 'earnings add up to 1,000.00 less than the printed gross', '\u20B11,000.00'],
    ['deductions',a=>{a.find(i=>i.y===580&&i.str==='100.00').str='200.00';}, '#p-net', 'gross less deductions is 100.00 less than the printed net pay', '\u20B1100.00'],
    ['net',a=>{a.find(i=>i.y===640&&i.str==='15,200.00').str='15,300.00';}, '#p-net', 'gross less deductions is 100.00 less than the printed net pay', '\u20B1100.00'],
    ['distribution',a=>{a.find(i=>i.y===345&&i.str==='15,200.00').str='15,100.00';}, '#p-dep', 'the account received 100.00 less than the printed net pay', '\u20B1100.00'],
  ]) {
    const before = await ledgerNow();
    await payrollScan({change});
    await page.locator('#p-net').waitFor({state:'attached'});
    assert.doesNotMatch(await page.locator('#sheet').innerText(),/Nothing was filled in/);
    assert.equal((await lines('e'))[0][1],'\u20B112,000.00', name + ': the lines are filled as read');
    assert.equal((await lines('d')).at(-1)[1],'\u20B1600.00');
    assert.ok(await page.locator(field).evaluate(el => el.classList.contains('chk')), name + ': the figure is outlined');
    const mark = await page.locator(field.replace('#p-gross','#chk-gross').replace('#p-net','#chk-net').replace('#p-dep','#chk-deposit')).first();
    assert.match(await mark.innerText(), new RegExp('Check this: ' + reason));
    assert.ok(!(await page.locator('#sheet').innerHTML()).match(/color:\s*red|#[Ff]00|#[Cc]00/), 'never red');
    month++; const m = String(month).padStart(2, '0');
    await page.locator('#p-from').fill(`2026-${m}-01`); await page.locator('#p-to').fill(`2026-${m}-15`); await page.locator('#p-date').fill(`2026-${m}-16`);
    const paid = page.locator('#sheet button[data-id="example-bank"]');
    if (!(await paid.isVisible())) await paid.locator('xpath=ancestor::div[@class="pick"][1]').locator('.pickrow').click();
    await paid.click();
    assert.equal(await page.locator('#f-save').isDisabled(), false, name + ': Save stays available');
    await page.locator('#f-save').click();
    await page.locator('#p-ask').waitFor({state:'visible'});
    assert.match(await page.locator('#p-askq').innerText(), new RegExp('The figures differ by ' + gap.replace('\u20B1','\u20B1') + '\\. Save as a draft to check later\\?'));
    assert.equal((await ledgerNow()).state.payslips.length, before.state.payslips.length, 'asking saves nothing');
    await page.locator('[data-action="save-payslip-draft"]').click();
    await page.waitForFunction((n)=>JSON.parse(localStorage.getItem('financialTracker.ledger')).state.payslips.length===n, before.state.payslips.length + 1);
    const after = await ledgerNow(), slip = after.state.payslips.at(-1), tx = after.state.transactions.find(t => t.id === slip.transaction_id);
    assert.equal(tx.status, 'draft', name + ': kept as a draft'); assert.equal(tx.verified_at, undefined);
    assert.equal(verifiedPay(after), verifiedPay(before), name + ': no verified income was created');
    assert.equal(after.v, seed.v);
    console.log(`ok: inconsistent ${name} fills the form, marks the figure, and Save keeps a draft (no verified income)`);
  }
  // The draft waits in Verify: a tap asks "Verify anyway?"; "Not now" changes nothing; the yes makes the DEPOSIT verified money in and the payslip keeps its note.
  { const l = await ledgerNow();
    await page.locator('#nav [data-tab="verify"]').click();
    await page.locator('#screen').getByText('Example Employer Ltd').first().waitFor();
    await page.locator('#screen [data-action="verify-ok"]').first().click();
    await page.locator('#sheet').getByText(/The payslip itself differs by .*Verify anyway\?/).waitFor();
    await page.locator('#sheet [data-action="close-sheet"]').last().click();
    assert.equal(verifiedPay(await ledgerNow()), verifiedPay(l), 'Not now: no payslip became verified');
    await page.locator('#screen [data-action="verify-ok"]').first().click();
    await page.locator('#sheet [data-action="verify-paper-gap"]').click();
    await page.waitForFunction((n) => JSON.parse(localStorage.getItem('financialTracker.ledger')).state.transactions.filter(t => t.status === 'verified').length > n, l.state.transactions.filter(t => t.status === 'verified').length);
    const after = await ledgerNow(), tx = after.state.transactions.find(t => t.status === 'verified' && !l.state.transactions.find(o => o.id === t.id && o.status === 'verified'));
    const slip = after.state.payslips.find(x => x.transaction_id === tx.id);
    assert.equal(after.state.entries.filter(e => e.transaction_id === tx.id && e.account_id === 'example-bank').reduce((n, e) => n + e.amount, 0), slip.deposit, 'money in is the deposit exactly');
    assert.deepEqual(after.state.payslipLines.filter(x => x.payslip_id === slip.id), l.state.payslipLines.filter(x => x.payslip_id === slip.id), 'no line was changed');
    await page.locator('#menuBtn').click(); await page.locator('#menu [data-tab="money"]').click(); await page.locator('#top [data-tab="income"]').click();
    console.log('ok: Verify anyway makes the deposit verified money in, and the lines stay as read');
  }

  // An old payslip (saved before every printed line was kept) reads the same invented PDF again: the lines must reconcile to what it holds, and the pay is untouched.
  { const l = await ledgerNow(), at = "2026-10-20T09:00:00.000+08:00";
    l.state.transactions.push({ id: "tx-oldslip", date: "2026-10-20", payee: "Old Employer", memo: "Payslip", status: "verified", source: "manual", created_at: at, verified_at: at });
    l.state.entries.push({ transaction_id: "tx-oldslip", account_id: "example-bank", amount: 740000 }, { transaction_id: "tx-oldslip", category_id: "cat-salary", amount: -740000 });
    l.state.payslips.push({ id: "oldslip", employer: "Old Employer", period_from: "2026-10-01", period_to: "2026-10-15", pay_date: "2026-10-20", account_id: "example-bank", transaction_id: "tx-oldslip", printed_gross: 800000, printed_net: 740000, deposit: 740000, version: 2 });
    l.state.payslipLines.push({ payslip_id: "oldslip", side: "earning", kind: "basic", amount: 800000 }, { payslip_id: "oldslip", side: "deduction", kind: "sss", amount: 40000 }, { payslip_id: "oldslip", side: "deduction", kind: "tax", amount: 20000 });
    await page.evaluate(async (l) => {
      const text = JSON.stringify(l); localStorage.setItem("financialTracker.ledger", text);
      await new Promise((resolve, reject) => { const r = indexedDB.open("financialTracker", 3); r.onsuccess = () => { const tx = r.result.transaction("kv", "readwrite"); tx.objectStore("kv").put(text, "ledger"); tx.oncomplete = () => { r.result.close(); resolve(); }; tx.onerror = () => reject(tx.error); }; });
    }, l);
    await page.reload(); await visible("#nav button");
    await page.locator('#menuBtn').click(); await page.locator('#menu [data-tab="money"]').click(); await page.locator('#top [data-tab="income"]').click();
    await page.locator('[data-action="open-payslips"]').click();
    await page.locator('#sheet .slipcard', { hasText: "Old Employer" }).locator('[data-action="add-lines"]').click();
    await page.locator('#sheet input[data-scan="payslip"]:not([capture])').setInputFiles(fixture("sample-payslip-open.pdf"));
    await page.locator('#sheet details.tot[data-keep="e"] .pl').first().waitFor({ state: "attached", timeout: 180000 });
    assert.equal(await page.locator("#sheet h3").first().innerText(), "Add the breakdown");
    assert.deepEqual((await lines("e")).map((x) => x.slice(0, 2)), [["Regular", "\u20B18,000.00"]]);
    assert.equal(await page.locator("#f-save").isDisabled(), false, "the lines read from the PDF reconcile to the payslip as saved");
    await page.locator("#f-save").click();
    await page.waitForFunction(() => (JSON.parse(localStorage.getItem("financialTracker.ledger")).state.payslipItems ?? []).some((i) => i.payslip_id === "oldslip"));
    const after = await ledgerNow();
    assert.deepEqual(after.state.transactions, l.state.transactions, "transactions unchanged"); assert.deepEqual(after.state.entries, l.state.entries, "entries unchanged");
    assert.deepEqual(after.state.payslips, l.state.payslips, "the payslip's own figures unchanged");
    assert.deepEqual(after.state.payslipItems.filter((i) => i.payslip_id === "oldslip").map((i) => [i.label, i.amount]), [["Regular", 800000], ["SSS", 40000], ["Tax Deduction", 20000]]);
    assert.equal(after.state.payslipRevisions.filter((r) => r.payslip_id === "oldslip").length, 1);
    console.log("ok: an old payslip keeps its printed lines by reading the same PDF again; the pay is untouched");
  }

  const bankDomains = new Set(BANKS.flatMap((bank) => [bank.domain, ...(bank.alt ?? [])]));
  for (const request of external) {
    const host = new URL(request.url).hostname.replace(/^www\./, "");
    assert.ok(bankDomains.has(host) || /(^|\.)(icon\.horse|faviconkit\.com|gstatic\.com|duckduckgo\.com|wikipedia\.org|wikimedia\.org)$/.test(host), "only existing bank logo lookups: " + request.url);
    assert.equal(request.method, "GET"); assert.equal(request.body, null);
    assert.ok(!request.url.includes("test1234"));
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }

// Serve the repo on port 8124, then node e2e/payslip-items.mjs. Every payslip, name and figure here is invented.
// The review form lists ONLY the lines printed on a payslip; a typed payslip starts with none; every line is kept and can be given a category.
import assert from "node:assert/strict";
import { launchBrowser } from "./engine.mjs";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { emptyLedger, CHANGES, LEDGER_VERSION } from "../src/model/index.js";
const require = createRequire(import.meta.url);
const browser = await launchBrowser();
const base = process.env.BASE ?? "http://127.0.0.1:8124/app/index.html";
const errors = [];
const TS = "2026-10-22T03:00:00Z";
async function open(seedLedger) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1" });
  await ctx.route("**/*", (route) => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
  await ctx.addInitScript(() => { Object.defineProperty(navigator, "standalone", { get: () => true }); sessionStorage.setItem("logOpen", "1"); });
  const page = await ctx.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-10-22T03:00:00Z"));
  await page.goto(base); await page.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 });
  await page.evaluate(async (text) => {
    localStorage.setItem("financialTracker.ledger", text);
    await new Promise((res) => { const r = indexedDB.open("financialTracker", 3); r.onsuccess = () => { const tx = r.result.transaction("kv", "readwrite"); tx.objectStore("kv").put(text, "ledger"); tx.oncomplete = () => { r.result.close(); res(); }; }; r.onerror = () => res(); });
  }, JSON.stringify(seedLedger));
  await page.reload(); await page.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 });
  return { ctx, page };
}
const seeded = (extra = {}) => {
  const l = emptyLedger(); l.rev = 1; l.saved_at = TS;
  l.state.accounts.push({ id: "example-bank", name: "Example Bank", class: "asset", role: "bank", opening_balance: 0, opening_date: "2026-01-01", hidden_by_default: false, archived: false });
  l.settings = { notice_seen_at: TS, whatsnew_seen: CHANGES[0].id, welcome_off: true, start_rule_seen: TS, cat_card_seen: TS, intro_off: { scan: true, income: true, log: true, money: true }, ...extra };
  return l;
};
const ledgerOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("financialTracker.ledger")));
const goIncome = async (page) => { await page.click("#menuBtn"); await page.click('#menu .item:has-text("Cash flow")'); await page.waitForFunction(() => !document.querySelector("#menu .drawer")); await page.click("#top .titleswitch"); };

// Add a typed line: "+ Add ..." -> the quick list or a typed label -> the line window (amount) -> Done.
async function addLine(page, section, label, amount, { quick = false, category = null } = {}) {
  await page.locator(`#sheet [data-action="slip-add"][data-id="${section}"]`).click();
  if (quick) await page.locator(`#sheet [data-action="slip-quick"]`, { hasText: new RegExp("^" + label + "$") }).click();
  else { await page.locator("#p-addlabel").fill(label); await page.locator('#sheet [data-action="slip-add-typed"]').click(); }
  await page.locator("#p-ia").fill(amount);
  if (category) { await page.locator('#sheet [data-action="pick-toggle"][data-key="slipcat"]').click(); await page.locator(`#sheet [data-action="slip-cat"]`, { hasText: category }).click(); }
  await page.locator('#sheet [data-action="slip-line-done"]').click();
}
const openSection = async (page, key) => { if (!(await page.locator(`#sheet details.tot[data-keep="${key}"]`).evaluate((d) => d.open))) await page.locator(`#sheet details.tot[data-keep="${key}"] > summary`).click(); };
const rows = (page, key) => page.locator(`#sheet details.tot[data-keep="${key}"] .pl`);

try {
  // ---------- 1. a typed payslip starts with NO lines, offers the quick labels, and keeps exactly what is typed ----------
  { const { ctx, page } = await open(seeded());
    await goIncome(page);
    await page.locator('button:has-text("Add income")').click(); await page.locator('#sheet button:has-text("Type a payslip")').click();
    assert.equal(await page.locator("#p-emp").count(), 1, "the payslip form opens");
    assert.equal(await page.locator('#sheet [data-field^="e_"], #sheet [data-field^="d_"]').count(), 0, "no fixed category boxes");
    assert.equal(await page.locator("#sheet .pl").count(), 0, "no lines at the start");
    assert.equal(await page.locator('#sheet details.tot[data-keep="r"]').count(), 0, "no Employer share row without employer lines");
    await openSection(page, "e");
    await page.locator('#sheet [data-action="slip-add"][data-id="earning"]').click();
    assert.deepEqual(await page.locator("#sheet .pl-quick .chip").allInnerTexts(), ["Basic salary", "Overtime", "Holiday and night pay", "Rice subsidy", "Allowance"], "the quick labels for earnings");
    await page.locator('#sheet [data-action="slip-back"]').click();
    await openSection(page, "d");
    await page.locator('#sheet [data-action="slip-add"][data-id="deduction"]').click();
    assert.deepEqual(await page.locator("#sheet .pl-quick .chip").allInnerTexts(), ["SSS", "PhilHealth", "Pag-IBIG", "Withholding tax", "Loan"], "the quick labels for deductions");
    await page.locator('#sheet [data-action="slip-back"]').click();
    // three earnings lines (one quick, two typed), one printed 0.00 line
    await openSection(page, "e");
    await addLine(page, "earning", "Basic salary", "20000", { quick: true });
    await addLine(page, "earning", "Meal Allowance Non Taxable", "1500");
    await addLine(page, "earning", "Retro Meal Allowance Taxable", "500");
    assert.equal(await rows(page, "e").count(), 3, "an invented payslip with 3 earnings lines shows exactly 3");
    assert.deepEqual(await rows(page, "e").locator(".pl-label").allInnerTexts(), ["Basic salary", "Meal Allowance Non Taxable", "Retro Meal Allowance Taxable"], "the labels as typed, in order");
    const notes = await rows(page, "e").locator(".pl-t").allInnerTexts();
    assert.ok(notes.includes("Not taxable") && notes.includes("Taxable") && notes.includes("Back pay"), "flags come from the label, as plain text: " + notes.join(","));
    assert.equal(await page.locator("#sheet .pl-sub .chip, #sheet .pl-t.chip").count(), 0, "no chips");
    await openSection(page, "d");
    await addLine(page, "deduction", "SSS", "900", { quick: true });
    await addLine(page, "deduction", "Salary Loan", "1250"); await addLine(page, "deduction", "Salary Loan", "640");
    await addLine(page, "deduction", "Absences", "0.00");
    assert.equal(await rows(page, "d").count(), 4, "two loans of one label are two lines; a 0.00 line is a line");
    const zero = rows(page, "d").filter({ hasText: "Absences" });
    assert.ok(await zero.evaluate((el) => el.classList.contains("zero")), "the printed 0.00 line is marked");
    const colours = await page.evaluate(() => { const c = (sel) => getComputedStyle(document.querySelector(sel)).color; return { zero: c('#sheet .pl.zero .pl-label'), normal: c('#sheet details.tot[data-keep="e"] .pl .pl-label') }; });
    assert.notEqual(colours.zero, colours.normal, "a 0.00 line is shown in lighter text");
    // the category notes: SSS and the loans are found by their words; the rest says Choose a category
    assert.deepEqual((await rows(page, "d").locator(".pl-cat").allTextContents()).map((t) => t.replace(/\s+/g, " ").trim()),   // textContent: a known category is screen-reader text (class sronly), which WebKit leaves out of innerText
    ["SSS ›", "Loan repayments ›", "Loan repayments ›", "Choose a category ›"].map((t) => t));
    assert.equal(await page.locator("#p-tot-e").innerText(), "₱22,000.00"); assert.equal(await page.locator("#p-tot-d").innerText(), "₱2,790.00");
    // the rest of the form
    await page.locator("#p-emp").fill("Sample Employer Inc");
    await page.locator('#sheet details[data-keep="t"] > summary').click();
    for (const [id, v] of [["#p-gross", "22000"], ["#p-net", "19210"], ["#p-dep", "19210"], ["#p-ded", "2790"]]) await page.locator(id).fill(v);
    await page.locator("#p-from").fill("2026-10-01"); await page.locator("#p-to").fill("2026-10-15"); await page.locator("#p-date").fill("2026-10-20");
    await page.locator("#p-rate").fill("1,250.00 / day"); await page.locator("#p-ptype").fill("Semi-Monthly"); await page.locator("#p-basis").fill("Daily");
    assert.equal(await page.locator("#f-save").isDisabled(), false, "all the figures match the lines: Save is ready");
    // "Same for the rest": one tap gives the lines with no category one category (this payslip only)
    await openSection(page, "e");
    assert.ok((await page.locator('#sheet details.tot[data-keep="e"] .pl-cat.need').count()) >= 2, "Meal lines need a category");
    await page.locator('#sheet details.tot[data-keep="e"] [data-action="pick-toggle"][data-key="rest"]').click();
    await page.locator('#sheet [data-action="slip-rest"]', { hasText: "Allowances" }).click();
    assert.equal(await page.locator('#sheet details.tot[data-keep="e"] .pl-cat.need').count(), 0, "Same for the rest set every empty earnings line");
    assert.equal(await page.locator('#sheet details.tot[data-keep="d"] .pl-cat.need').count(), 1, "the deductions were not touched");
    await page.locator("#f-save").click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("financialTracker.ledger")).state.payslips.length === 1);
    const led = await ledgerOf(page), st = led.state, slip = st.payslips[0];
    assert.equal(led.v, LEDGER_VERSION);
    assert.deepEqual(st.payslipItems.map((i) => [i.section, i.label, i.amount, i.position]), [["earning", "Basic salary", 2000000, 0], ["earning", "Meal Allowance Non Taxable", 150000, 1], ["earning", "Retro Meal Allowance Taxable", 50000, 2],
      ["deduction", "SSS", 90000, 3], ["deduction", "Salary Loan", 125000, 4], ["deduction", "Salary Loan", 64000, 5], ["deduction", "Absences", 0, 6]].map(([a, b, c, d], n) => [a, b, c, n]), "every typed line is saved as typed, in order, 0.00 included");
    assert.deepEqual([slip.pay_rate, slip.pay_basis, slip.period_type], ["1,250.00 / day", "Daily", "Semi-Monthly"], "as printed");
    assert.equal(st.payslipItems.find((i) => i.label === "Meal Allowance Non Taxable").tax, "non_taxable");
    assert.equal(st.payslipItems.find((i) => i.label === "Retro Meal Allowance Taxable").back_pay, true);
    assert.equal(st.payslipItems.filter((i) => i.category === "allowance").length, 2, "Same for the rest gave the two Meal lines the owner's category");
    const gross = st.payslipLines.filter((l) => l.side === "earning").reduce((n, l) => n + l.amount, 0), ded = st.payslipLines.filter((l) => l.side === "deduction").reduce((n, l) => n + l.amount, 0);
    assert.deepEqual([gross, ded], [2200000, 279000], "the generated lines add to the same totals as the items");
    assert.equal(st.transactions.filter((t) => t.status === "verified").length, 1, "one verified pay entry for what arrived");
    assert.deepEqual(Object.keys(led.settings.payslip_categories ?? {}).sort(), ["sample employer inc|deduction|sss", "sample employer inc|earning|basic salary", "sample employer inc|earning|meal allowance non taxable", "sample employer inc|earning|retro meal allowance taxable"],
      "what the owner chose (two quick labels and Same for the rest) is remembered for this employer; what the app matched by itself (the loans) is not: " + JSON.stringify(led.settings.payslip_categories));
    assert.deepEqual(errors, []); await ctx.close();
    console.log("ok: a typed payslip starts with no lines; every line typed is kept as typed (0.00 lighter, repeated labels separate); Same for the rest; flags from labels; pay rate, basis and period type"); }

  // ---------- 2. an old payslip says "Original wording not kept"; a payslip with lines lists them; a category can be changed on a past line without touching anything else ----------
  { const old = seeded();
    Object.assign(old.state, {
      categories: [{ id: "cat-salary", name: "Salary", kind: "income" }, { id: "cat-overtime", name: "Overtime", kind: "income" }],
      transactions: [{ id: "tx-old", date: "2026-10-15", payee: "Old Co", memo: "Payslip", status: "verified", source: "manual", created_at: "2026-10-15T09:00:00.000+08:00", verified_at: "2026-10-15T09:00:00.000+08:00" }],
      entries: [{ transaction_id: "tx-old", account_id: "example-bank", amount: 800000 }, { transaction_id: "tx-old", category_id: "cat-salary", amount: -800000 }],
      payslips: [{ id: "old1", employer: "Old Co", period_from: "2026-10-01", period_to: "2026-10-15", pay_date: "2026-10-15", account_id: "example-bank", transaction_id: "tx-old", printed_gross: 900000, printed_net: 800000, deposit: 800000, version: 2 }],
      payslipLines: [{ payslip_id: "old1", side: "earning", kind: "basic", amount: 900000 }, { payslip_id: "old1", side: "deduction", kind: "tax", amount: 100000 }] });
    const { ctx, page } = await open(old);
    await goIncome(page);
    await page.locator('[data-action="open-payslips"]').click();
    assert.ok((await page.locator("#sheet").innerText()).includes("Original wording not kept"), "an old payslip says so and invents no lines");
    const sheetText = await page.locator("#sheet").innerText();
    assert.ok(!/Printed lines/.test(sheetText), "the heading Printed lines is nowhere on the list (only the Add the breakdown link)");
    assert.equal(await page.locator("#sheet details.slipc").count(), 0, "an old payslip has no lines to open");
    assert.equal(await page.locator("#sheet .slipcard .slipkv").count(), 2, "Gross and Deductions are one row each");
    assert.ok(/Gross\s*\u20B19,000\.00/.test(await page.locator("#sheet .slipkv").nth(0).innerText()) && /Deductions\s*\u20B11,000\.00/.test(await page.locator("#sheet .slipkv").nth(1).innerText()), "with their figures");
    // ---------- Add the breakdown: they must reconcile to the payslip as saved; the pay itself is untouched ----------
    const before = await ledgerOf(page);
    await page.locator('#sheet [data-action="add-lines"]').click();
    assert.ok((await page.locator("#sheet").innerText()).includes("The pay itself does not change"), "the window says what it will not touch");
    await page.locator('#sheet [data-action="add-lines-type"]').click();
    assert.equal(await page.locator("#sheet h3").innerText(), "Add the breakdown");
    assert.equal(await page.locator("#f-save").isDisabled(), true, "nothing to save yet");
    await openSection(page, "e"); await openSection(page, "d");
    await addLine(page, "earning", "Basic salary", "8000", { quick: true });
    assert.ok((await page.locator("#chk-e").innerText()).includes("Check this"), "8,000 of earnings against the payslip's 9,000 gross says Check this");
    assert.equal(await page.locator("#f-save").isDisabled(), true, "lines that do not reconcile cannot be saved");
    await addLine(page, "earning", "Holiday and night pay", "1000", { quick: true });
    assert.equal(await page.locator("#f-save").isDisabled(), true, "gross matches but net does not yet: still Check this");
    assert.ok((await page.locator("#chk-net").innerText()).includes("Check this"));
    await addLine(page, "deduction", "Withholding tax", "1000", { quick: true });
    assert.equal(await page.locator("#f-save").isDisabled(), false, "gross 9,000, deductions 1,000, net 8,000: it reconciles");
    await page.locator("#f-save").click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("financialTracker.ledger")).state.payslipItems.length === 3);
    const after = await ledgerOf(page);
    for (const k of ["transactions", "entries", "payslips", "payslipLines", "accounts", "categories"]) assert.deepEqual(after.state[k], before.state[k], k + " are exactly as they were");
    assert.equal(after.state.payslipRevisions.length, 1); assert.equal(after.state.payslipRevisions[0].change, "Breakdown added");
    assert.deepEqual(after.state.payslipItems.map((i) => [i.section, i.label, i.amount]), [["earning", "Basic salary", 800000], ["earning", "Holiday and night pay", 100000], ["deduction", "Withholding tax", 100000]]);
    await page.locator('[data-action="open-payslips"]').click();
    assert.equal(await page.locator('#sheet [data-action="add-lines"]').count(), 0, "the payslip now has its lines");
    await page.locator("#sheet details.slipc summary").click();
    assert.equal(await page.locator("#sheet details.slipc .pl").count(), 3, "its three printed lines open from the card");
    await ctx.close();
    console.log("ok: an old payslip shows Original wording not kept, and Add the breakdown keeps the pay untouched"); }

  // ---------- 3. the update from data version 10: the app keeps its own copy first, then adds the two lists; every figure of an old payslip stays ----------
  { const v10 = seeded(); v10.v = 10;
    const strip = (l) => { const { payslipItems, payslipItemChanges, ...rest } = l.state; return { ...l, state: rest }; };
    Object.assign(v10.state, {
      categories: [{ id: "cat-salary", name: "Salary", kind: "income" }, { id: "cat-overtime", name: "Overtime", kind: "income" }],
      transactions: [{ id: "tx-old", date: "2026-10-15", payee: "Old Co", memo: "Payslip", status: "verified", source: "manual", created_at: "2026-10-15T09:00:00.000+08:00", verified_at: "2026-10-15T09:00:00.000+08:00" }],
      entries: [{ transaction_id: "tx-old", account_id: "example-bank", amount: 800000 }, { transaction_id: "tx-old", category_id: "cat-salary", amount: -800000 }],
      payslips: [{ id: "old1", employer: "Old Co", period_from: "2026-10-01", period_to: "2026-10-15", pay_date: "2026-10-15", account_id: "example-bank", transaction_id: "tx-old", printed_gross: 900000, printed_net: 800000, deposit: 800000, version: 2 }],
      payslipLines: [{ payslip_id: "old1", side: "earning", kind: "basic", amount: 900000 }, { payslip_id: "old1", side: "deduction", kind: "tax", amount: 100000 }] });
    const original = strip(v10); delete v10.state.payslipItems; delete v10.state.payslipItemChanges;
    const { ctx, page } = await open(original);
    await page.waitForFunction((v) => JSON.parse(localStorage.getItem("financialTracker.ledger")).v === v, LEDGER_VERSION, { timeout: 30000 });
    const kept = await page.evaluate(async () => {
      const local = JSON.parse(localStorage.getItem("financialTracker.preupgrade") ?? "[]");
      const idbCopies = await new Promise((res) => { const r = indexedDB.open("financialTracker", 3); r.onsuccess = () => { const g = r.result.transaction("safety").objectStore("safety").get("copies"); g.onsuccess = () => { r.result.close(); res(g.result ?? []); }; g.onerror = () => res([]); }; r.onerror = () => res([]); });
      return { local, idb: idbCopies };
    });
    for (const [name, list] of [["localStorage", kept.local], ["IndexedDB", kept.idb]]) {
      assert.equal(list.length, 1, "a safety copy exists in " + name); const copy = JSON.parse(list[0].text);
      assert.equal(copy.v, 10, "the copy is the data as it was"); assert.deepEqual(copy.state, original.state, "and reads back exactly (" + name + ")");
    }
    const led = await ledgerOf(page);
    assert.equal(led.v, LEDGER_VERSION); assert.deepEqual(led.state.payslipItems, []); assert.deepEqual(led.state.payslipItemChanges, []);
    assert.deepEqual(led.state.payslips, original.state.payslips, "every figure of the old payslip is the same"); assert.deepEqual(led.state.payslipLines, original.state.payslipLines);
    assert.deepEqual(led.state.entries, original.state.entries); assert.deepEqual(led.state.transactions, original.state.transactions);
    await goIncome(page); await page.locator('[data-action="open-payslips"]').click();
    assert.ok((await page.locator("#sheet").innerText()).includes("Original wording not kept"));
    assert.deepEqual(errors, []); await ctx.close();
    console.log("ok: data version 10 upgrades with the app's own safety copy first (both stores, read back exactly); the old payslip keeps every figure and says Original wording not kept"); }

  // ---------- 4. changing a past line's category changes the category and nothing else; the choice is remembered for that employer only ----------
  { const { ctx, page } = await open(seeded());
    const save = async (employer, lines, net) => {
      await goIncome(page); await page.locator('button:has-text("Add income")').click(); await page.locator('#sheet button:has-text("Type a payslip")').click();
      await page.locator("#p-emp").fill(employer);
      await openSection(page, "e");
      for (const [label, amount] of lines) await addLine(page, "earning", label, amount);
      return net;
    };
    // payslip 1: an unfamiliar label
    await save("Sample Employer Inc", [["Basic Salary", "10000"], ["Meal Subsidy", "700"]]);
    assert.equal(await rows(page, "e").locator(".pl-cat").first().innerText(), "Basic pay (suggested) ›", "Basic Salary is only suggested as basic pay");
    assert.equal(await rows(page, "e").filter({ hasText: "Meal Subsidy" }).locator(".pl-cat.need").count(), 1, "an unfamiliar label asks for a category");
    await page.locator('#sheet details[data-keep="t"] > summary').click();
    for (const [id, v] of [["#p-gross", "10700"], ["#p-net", "10700"], ["#p-dep", "10700"]]) await page.locator(id).fill(v);
    await page.locator("#p-from").fill("2026-10-01"); await page.locator("#p-to").fill("2026-10-15"); await page.locator("#p-date").fill("2026-10-20");
    // the owner picks the category once
    await rows(page, "e").filter({ hasText: "Meal Subsidy" }).locator(".pl-main").click();
    await page.locator('#sheet [data-action="pick-toggle"][data-key="slipcat"]').click(); await page.locator('#sheet [data-action="slip-cat"]', { hasText: "Allowances" }).click();
    await page.locator('#sheet [data-action="slip-line-done"]').click();
    await page.locator("#f-save").click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("financialTracker.ledger")).state.payslips.length === 1);
    // payslip 2, same employer: the same label has its category already; another employer's does not
    await save("Sample Employer Inc", [["Meal Subsidy", "800"]]);
    assert.equal(await rows(page, "e").locator(".pl-cat").first().innerText(), "Allowances ›", "the same employer and label: the choice is remembered");
    await page.evaluate(() => document.querySelector('#sheet [data-action="close-sheet"]')?.click());
    await save("Another Company", [["Meal Subsidy", "800"]]);
    assert.equal(await rows(page, "e").locator(".pl-cat.need").count(), 1, "another employer with the same label gets nothing");
    await page.evaluate(() => document.querySelector('#sheet [data-action="close-sheet"]')?.click());
    // a past line: change the category of the line that has none (Basic Salary was suggested and saved as Basic pay)
    await goIncome(page); await page.locator('[data-action="open-payslips"]').click();
    await page.locator("#sheet details.slipc summary").first().click();
    const before = await ledgerOf(page);
    await page.locator('#sheet .pl-main', { hasText: "Meal Subsidy" }).click();
    assert.ok((await page.locator("#sheet").innerText()).includes("No amount, no income and no transfer"), "the window says what it changes");
    await page.locator('#sheet [data-action="pick-toggle"][data-key="itemcat"]').click(); await page.locator('#sheet [data-action="itemcat-pick"]', { hasText: "Other earnings" }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("financialTracker.ledger")).state.payslipItemChanges.length === 1);
    const after = await ledgerOf(page);
    for (const k of Object.keys(before.state)) if (k !== "payslipItems" && k !== "payslipItemChanges") assert.deepEqual(after.state[k], before.state[k], k + " is untouched by a category change");
    assert.equal(after.state.transactions.length, before.state.transactions.length);
    const changed = after.state.payslipItems.filter((i) => JSON.stringify(i) !== JSON.stringify(before.state.payslipItems.find((b) => b.id === i.id)));
    assert.deepEqual(changed.map((i) => [i.label, i.category, i.amount]), [["Meal Subsidy", "other_earning", 70000]], "one line changed, its amount the same");
    assert.deepEqual(after.state.payslipItemChanges.map((c) => [c.from, c.to]), [["allowance", "other_earning"]], "and there is a visible record");
    await page.waitForFunction(() => document.querySelector("#sheet")?.innerText.includes("Changed"), null, { timeout: 5000 }).catch(() => {});
    assert.ok((await page.locator("#sheet").innerText()).includes("Changed"), "the record shows in the window");
    // Income groups the printed lines by category; tapping a category shows its lines
    await page.evaluate(() => document.querySelector('#sheet [data-action="close-sheet"]')?.click());
    await page.evaluate(() => document.querySelector('#sheet [data-action="close-sheet"]')?.click());
    await page.locator('[data-action="income-view"][data-view="earnings"]').click();
    const block = page.locator("#screen details.crow", { hasText: "Other earnings" }).first();
    await block.locator("summary").click();
    assert.ok((await block.innerText()).includes("Meal Subsidy"), "tapping a category shows its printed lines");
    assert.deepEqual(errors, []); await ctx.close();
    console.log("ok: a category chosen once is remembered for that employer and label only; changing a past line's category touches only that line and leaves a record; Income groups lines by category"); }

  assert.deepEqual(errors, []);
} finally { await browser.close(); }

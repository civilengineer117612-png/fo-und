// AMOUNTS (owner, Nov 12, L2 and P3). A comma is only the mark between thousands; anywhere else the amount is refused and says so, never read as a
// bigger number. Entries typed before this fix that look like a dropped comma are only LISTED (read-only). Every figure here is invented.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parsePesos, formatPesos, readAmount, parseNotes, suspectAmounts, openAmountChecks, markAmountRight, AMOUNT_FIX_BEFORE, emptyLedger, validateState, AMOUNT_COMMA, AMOUNT_HINT, AMOUNT_CHECK_TIMES } from "../src/model/index.js";

test("a comma is read only between thousands; anywhere else the amount is refused, never made bigger", () => {
  for (const [input, c] of [["1,250", 125000], ["1,250.5", 125050], ["12,345,678.90", 1234567890], ["1250", 125000], ["999", 99900], ["0,000", 0]]) assert.deepEqual(parsePesos(input), { ok: true, centavos: c }, input);
  // each of these used to be SAVED: "1,5" as 15.00, "1,23" as 123.00, "12,50" as 1,250.00, "1,2345" as 12,345.00
  for (const bad of ["1,5", "1,23", "12,50", "1,2345", "12,34.50", "1234,567", "1,", ",5", "1,,000", "1,000,00", "1,00,000", "1.5,000", "0,5"]) {
    const r = parsePesos(bad);
    assert.equal(r.ok, false, bad);
    assert.equal(r.error, AMOUNT_COMMA, bad + " says what is wrong with the comma");
  }
  assert.notEqual(parsePesos("abc").error, AMOUNT_COMMA);
  assert.notEqual(parsePesos("a,b").error, AMOUNT_COMMA, "the comma message is only for digits and a comma");
});

test("the peso sign, P and PHP in front are read; nothing else is", () => {
  for (const [input, c] of [["₱1,234.50", 123450], ["P1,234.50", 123450], ["p95", 9500], ["PHP 1,234.50", 123450], ["Php1234", 123400], ["₱ 20", 2000], ["  P 7  ", 700]]) assert.deepEqual(parsePesos(input), { ok: true, centavos: c }, input);
  for (const bad of ["PP5", "$5", "5P", "PHP", "P", "₱", "USD 5", "P-5", "P1,5"]) assert.equal(parsePesos(bad).ok, false, bad);
});

test("what the app prints is read back to the same centavos", () => {
  for (const c of [0, 1, 99, 100, 99999, 100000, 123456789, 100000000000]) assert.equal(parsePesos(formatPesos(c)).centavos, c);
});

test("a list or spreadsheet amount follows the same comma rule", () => {
  assert.equal(readAmount("1,250.50"), 125050);
  assert.equal(readAmount("₱1,250"), 125000);
  assert.equal(readAmount("PHP 95"), 9500);
  for (const bad of ["1,5", "12,50", "1,2345", "1,"]) assert.equal(readAmount(bad), null, bad + " is not read (it used to be read as a bigger amount)");
  const notes = parseNotes("2026-10-03\nLunch 1,5\nKape 65\nRent 12,000");
  assert.deepEqual(notes.items.map((i) => [i.name, i.amount]), [["Kape", 6500], ["Rent", 1200000]]);
  assert.deepEqual(notes.notRead, ["Lunch 1,5"], "the line is listed as not read, for the owner to type");
});

// ---- the read-only list
const state = () => {
  const l = emptyLedger(), s = l.state;
  s.accounts.push({ id: "chk", name: "Sample Checking", class: "asset", role: "", opening_balance: 9000000, opening_date: "2026-01-01", hidden_by_default: false, archived: false });
  s.categories = [{ id: "food", name: "Food", kind: "expense" }, { id: "ride", name: "Transport", kind: "expense" }, ...s.categories.filter((c) => c.kind === "income")];
  return s;
};
let n = 0;
const spend = (s, payee, amount, o = {}) => {
  const id = o.id ?? "t" + ++n, date = o.date ?? "2026-10-" + String(10 + (n % 15)).padStart(2, "0");
  s.transactions.push({ id, date, payee, memo: "", status: o.status ?? "verified", source: o.source ?? "manual", created_at: date + "T09:00:00+08:00", ...((o.status ?? "verified") === "verified" ? { verified_at: date + "T09:05:00+08:00" } : {}), ...(o.extra ?? {}) });
  s.entries.push({ transaction_id: id, account_id: "chk", amount: -amount }, { transaction_id: id, category_id: o.cat ?? "food", amount });
  return id;
};

test("check these amounts: a typed whole-peso entry at least ten times the usual for the same thing is listed, and nothing is changed", () => {
  const s = state();
  spend(s, "Kape", 6500); spend(s, "Kape", 7000); spend(s, "kape!", 6500);
  const big = spend(s, "Kape", 65000, { date: "2026-10-28" });          // 650.00: "6,5" typed for 6.50? no: ten times 65.00
  spend(s, "Kape", 64900);                                              // just under ten times: not listed
  spend(s, "Lunch", 15000); spend(s, "Lunch", 16000); spend(s, "Lunch", 155050);   // has centavos: a dropped comma never leaves centavos
  const before = JSON.stringify(s);
  const list = suspectAmounts(s);
  assert.equal(JSON.stringify(s), before, "the ledger is not touched");
  assert.deepEqual(list.map((r) => [r.id, r.amount, r.usual, r.times]), [[big, 65000, 6500, 10]]);
  assert.deepEqual(validateState(s), [], "the invented ledger is a valid one");
  assert.equal(AMOUNT_CHECK_TIMES, 10);
});

test("check these amounts: what is and is not listed", () => {
  const s = state();
  // not typed by hand: a statement, a photo, a tile
  for (const source of ["statement", "photo", "preset", "import"]) { spend(s, "Bus " + source, 1500, { cat: "ride" }); spend(s, "Bus " + source, 1500, { cat: "ride" }); spend(s, "Bus " + source, 150000, { cat: "ride", source, extra: source === "photo" ? { edited_before_verify: false } : {} }); }
  assert.deepEqual(suspectAmounts(s), [], "only typed entries are listed");
  // fewer than two others: nothing can be said
  spend(s, "Barber", 20000); spend(s, "Barber", 2000000);
  assert.deepEqual(suspectAmounts(s), []);
  // no name: the category is the thing
  const a = spend(s, "", 5000), b = spend(s, "", 5500); const c = spend(s, "", 550000, { date: "2026-10-29" });
  assert.deepEqual(suspectAmounts(s).map((r) => r.id), [c]);
  assert.ok(a && b);
  // a draft is listed too (it can still be edited), and says so
  const d = spend(s, "Taho", 2000), e = spend(s, "Taho", 2500), f = spend(s, "Taho", 25000, { status: "draft", date: "2026-10-30" });
  assert.ok(d && e);
  assert.deepEqual(suspectAmounts(s).map((r) => [r.id, r.status]), [[f, "draft"], [c, "verified"]], "newest first");
  // a cancelled entry is not listed, and neither is the entry that cancels it
  s.transactions.push({ id: "rev:" + c, date: "2026-10-30", payee: "", memo: "", status: "verified", source: "correction", reverses: c, created_at: "2026-10-30T09:00:00+08:00", verified_at: "2026-10-30T09:00:00+08:00" });
  s.entries.push({ transaction_id: "rev:" + c, account_id: "chk", amount: 550000 }, { transaction_id: "rev:" + c, category_id: "food", amount: -550000 });
  assert.deepEqual(suspectAmounts(s).map((r) => r.id), [f]);
});

test("the app says what is wrong under the box, keeps the list until each entry is resolved, and changes no entry", () => {
  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(app, /if \(e\.target\.getAttribute\?\.\("inputmode"\) === "decimal"\) amountHint\(e\.target\);/, "every amount box is checked while typing");
  assert.match(app, /M\.parsePesos\(el\.value\)\.error === M\.AMOUNT_COMMA/);
  assert.match(app, /for \(const el of document\.querySelectorAll\('#sheet input\[inputmode="decimal"\]'\)\) amountHint\(el\);/, "and again when a window is drawn");
  assert.ok(AMOUNT_HINT.length < 90 && !/[—–]/.test(AMOUNT_HINT));
  const card = app.slice(app.indexOf("function amountCheckHtml()"), app.indexOf("function repairCardHtml()"));
  // before (Nov 12, #338): one "Got it" hid the card for good. After (owner, Nov 12): one "This amount is right" per entry; no Got it; the old mark is not read.
  assert.ok(card.includes("M.openAmountChecks(S(), ledger.settings)") && card.includes("Nothing was changed.") && !card.includes("amount_check_seen") && !card.includes("Got it"));
  assert.ok(!/commit\(|plan[A-Z]\w+\(|data-action="(?!amount-ok")/.test(card), "the card's only button is This amount is right, and the card makes nothing");
  assert.ok(card.includes('<button class="act" data-action="amount-ok" data-id="${esc(r.id)}">This amount is right</button>'), "one per listed entry");
  assert.match(app, /case "amount-ok": await commit\(S\(\), M\.markAmountRight\(ledger\.settings, id\), \{ quiet: true \}\); renderScreen\(\); break;/, "the mark only changes settings: S() is saved as it is");
  assert.ok(!/\.replace\(\/,\/g, ""\)/.test(readFileSync(new URL("../src/model/money.js", import.meta.url), "utf8").replace(/m\[1\]\.replace\(\/,\/g, ""\)/, "")), "money.js drops commas only from a number that already matched the thousands pattern");
});

test("kept until resolved: each entry leaves the list only when it is corrected or marked right; nothing else hides it", () => {
  const s = state();
  spend(s, "Kape", 6500); spend(s, "Kape", 7000); spend(s, "Kape", 6500);
  const a = spend(s, "Kape", 65000, { date: "2026-10-28" });
  spend(s, "Taho", 2000); spend(s, "Taho", 2500);
  const b = spend(s, "Taho", 25000, { status: "draft", date: "2026-10-29" });
  const before = JSON.stringify(s);
  let set = { amount_check_seen: true };   // the first version's "Got it" no longer hides anything
  assert.deepEqual(openAmountChecks(s, set).map((r) => r.id), [b, a], "two to check");
  set = markAmountRight(set, a);
  assert.deepEqual(set.amount_check_ok, [a]);
  assert.equal(markAmountRight(set, a), set, "marking twice changes nothing");
  assert.deepEqual(openAmountChecks(s, set).map((r) => r.id), [b], "the count goes down by one");
  assert.equal(JSON.stringify(s), before, "marking changes no entry");
  // the draft is corrected in Verify (its amount edited): it leaves the list by itself
  for (const e of s.entries) if (e.transaction_id === b) e.amount = e.amount > 0 ? 2550 : -2550;
  assert.deepEqual(openAmountChecks(s, set), [], "the last one is resolved: nothing is left, so no card");
  // a verified entry put right at the Weekly review is cancelled, and so leaves the list
  const s2 = state(); spend(s2, "Kape", 6500); spend(s2, "Kape", 7000); const c = spend(s2, "Kape", 65000, { date: "2026-10-28" });
  assert.equal(openAmountChecks(s2, {}).length, 1);
  s2.transactions.push({ id: "rev:" + c, date: "2026-10-30", payee: "", memo: "", status: "verified", source: "correction", reverses: c, created_at: "2026-10-30T09:00:00+08:00", verified_at: "2026-10-30T09:00:00+08:00" });
  s2.entries.push({ transaction_id: "rev:" + c, account_id: "chk", amount: 65000 }, { transaction_id: "rev:" + c, category_id: "food", amount: -65000 });
  assert.equal(openAmountChecks(s2, {}).length, 0);
});

test("only entries saved before the fix are asked about: a large amount typed since is what the owner meant", () => {
  assert.equal(AMOUNT_FIX_BEFORE, "2026-11-13T00:00:00+08:00");
  const s = state(); spend(s, "Kape", 6500); spend(s, "Kape", 7000); spend(s, "Kape", 6500); spend(s, "Kape", 6000);
  const old = spend(s, "Kape", 65000, { date: "2026-11-12" });
  s.transactions.find((t) => t.id === old).created_at = "2026-11-12T23:59:00+08:00";
  const late = spend(s, "Kape", 70000, { date: "2026-11-13" });
  s.transactions.find((t) => t.id === late).created_at = "2026-11-13T00:00:00+08:00";
  assert.deepEqual(openAmountChecks(s, {}).map((r) => r.id), [old]);
  assert.ok(suspectAmounts(s).some((r) => r.id === late), "the rule itself still sees it; only the card leaves it out");
});

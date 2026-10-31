import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as M from "../src/model/index.js";
import { makeState } from "./fixtures.js";

// P0-5 fix 6 (docs/ACCOUNTING.md, principle 10): one definition per figure. Spent today and This month both count VERIFIED entries only and show the entries still
// waiting in Verify apart; the Unlogged gauge uses the same period rule as the spending reports (a held gap and the entry that cancels it are not in it). Invented figures.
const NOW = new Date("2026-10-09T12:00:00+08:00"), DAY = "2026-10-09", MONTH = "2026-10", UNL = "unl";
function base() {
  let s = makeState();
  s = { ...s, categories: [...s.categories, { id: UNL, name: "Unlogged", kind: "expense" }] };
  s = M.applyDrafts(s, M.planExpense(s, { transaction_id: "lunch", date: DAY, payee: "Cafe", category_id: "food", amount: 5000, account_id: "chk" }, NOW).drafts);
  return M.verifyDraft(s, "lunch", NOW).state;
}
const withDraft = (s) => M.applyDrafts(s, M.planExpense(s, { transaction_id: "wait", date: DAY, payee: "Kiosk", category_id: "food", amount: 7000, account_id: "chk" }, NOW).drafts);
function count(s, id, counted_balance, why) {
  const p = M.planCheckIn(s, { id: "c" + id, transaction_id: "ct" + id, date: DAY, account_id: "chk", counted_balance, unlogged_category_id: UNL, ...(why ? { why } : {}) }, NOW);
  return { ...s, checkIns: [...(s.checkIns ?? []), p.checkIn], transactions: [...s.transactions, p.transaction], entries: [...s.entries, ...p.entries] };
}
const week = { start: "2026-10-04", end: "2026-10-10" };

test("Spent today and This month agree: verified only, and the entries waiting in Verify are the same figure on both", () => {
  const s = withDraft(base()), d = M.dayTotal(s, DAY), m = M.spendingByCategory(s, { month: MONTH });
  assert.equal(d.verified, 5000); assert.equal(m.total, 5000, "the day and the month count the same verified spending");
  assert.equal(d.draft, 7000); assert.equal(m.pending, 7000, "and show the same waiting amount");
  assert.equal(d.drafts, 1);
  assert.equal(M.spendingByRange(s, { from: DAY, to: DAY }).pending, d.draft, "a one-day range says the same as the day");
});
test("the waiting amount leaves out a held gap, as the totals do", () => {
  const s = count(withDraft(base()), "1", 80000, "later");
  assert.equal(M.dayTotal(s, DAY).draft, 7000); assert.equal(M.spendingByCategory(s, { month: MONTH }).pending, 7000);
});
test("the Unlogged gauge skips a held gap and the entry that cancels it, but counts a gap booked as spent and an ordinary Unlogged entry", () => {
  const held = count(base(), "1", 80000, "later");
  assert.equal(M.unloggedTotal(held, UNL, week.start, week.end), 0, "held: not in the gauge");
  assert.equal(M.unloggedByWeek(held, UNL, DAY, 1)[0].amount, 0, "the week was counted and nothing is unexplained spending");
  const spent = count(base(), "1", 80000);
  assert.equal(M.unloggedTotal(spent, UNL, week.start, week.end), M.spendingByCategory(spent, { month: MONTH }).rows.find((r) => r.category_id === UNL).amount, "booked as spent: the same figure as Category");
  const cancelled = M.applyCorrection(spent, M.planCorrection(spent, { id: "ct1", redo_id: "r1", today: DAY }, NOW));
  assert.equal(M.unloggedTotal(cancelled, UNL, week.start, week.end), 0, "cancelled: nets to zero");
});
test("the Unlogged gauge counts verified entries only, like every spending report", () => {
  let s = base();
  s = M.applyDrafts(s, M.planExpense(s, { transaction_id: "ud", date: DAY, payee: "Mystery", category_id: UNL, amount: 3000, account_id: "chk" }, NOW).drafts);
  assert.equal(M.unloggedTotal(s, UNL, week.start, week.end), 0, "a draft is not counted until verified");
  s = M.verifyDraft(s, "ud", NOW).state;
  assert.equal(M.unloggedTotal(s, UNL, week.start, week.end), 3000);
});
test("homeSummary uses the same definitions: a held gap is not spent, and spent equals the month's spending", () => {
  const s = count(base(), "1", 80000, "later"), r = M.homeSummary(s, { from: MONTH + "-01", to: MONTH + "-31" });
  assert.equal(r.spent, M.spendingByCategory(s, { month: MONTH }).total);
  assert.equal(r.spent, 5000);
});
test("the Log screen shows the verified figure with the waiting amount apart, on Spent today and on This month", () => {
  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
  const day = app.slice(app.indexOf("function dayCard()"), app.indexOf("function monthGlance()")), month = app.slice(app.indexOf("function monthGlance()"), app.indexOf("// The day's entries stay out of sight"));
  assert.match(day, /peso\(d\.verified\)/, "Spent today is the verified figure"); assert.doesNotMatch(day, /peso\(d\.total\)/);
  assert.match(day, /d\.draft/, "the waiting amount is shown"); assert.match(month, /\.pending/, "This month shows the waiting amount too");
});

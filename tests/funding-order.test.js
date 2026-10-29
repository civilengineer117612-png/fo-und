import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestPlan, resolveSettings, SUGGEST_DEFAULTS } from "../src/model/index.js";
import { UNLOGGED_CATEGORY_ID } from "../src/model/seed.js";
import { makeState, account } from "./fixtures.js";

// The order of funding (owner, Oct 29): (1) fixed commitments, (2) needs at their usual level, (3) the savings floor, (4) the buffer, (5) wants from what is left,
// at most 30% of the base income. Every number is invented and worked by hand; amounts are centavos (100000 is 1,000.00).
// History every month: rent 8,000.00 (role rent), food 7,000.00, essentials 3,000.00, transport 1,500.00 (needs: 11,500.00), and "Misc" (no role, no bucket).
const TS = "2026-01-01T09:00:00.000+08:00", TODAY = "2026-10-05", MONTH = "2026-10";
const PAYDAYS = [{ id: "first", label: "1st payday", day: 15 }, { id: "second", label: "2nd payday", day: "last" }];
const MONTHS = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
let n = 0;
function history(misc, subscription = 0) {
  const s = makeState();
  s.accounts = [account({ id: "chk", name: "Test Checking", class: "asset", opening_balance: 100000000 })];
  s.categories = [
    { id: "rent", name: "Rent", kind: "expense", role: "rent" }, { id: "food", name: "Food", kind: "expense", role: "food" }, { id: "ess", name: "Essentials", kind: "expense", role: "essentials" },
    { id: "trn", name: "Transport", kind: "expense", role: "transport" }, { id: "misc", name: "Misc", kind: "expense" }, { id: "sub", name: "Streaming", kind: "expense", role: "subscription" },
    { id: UNLOGGED_CATEGORY_ID, name: "Unlogged", kind: "expense" }, { id: "pay", name: "Pay", kind: "income" },
  ];
  s.payslips = []; s.payslipLines = []; s.subscriptions = []; s.goals = [];
  const spend = (date, cat, amount) => {
    const id = "t" + ++n;
    s.transactions.push({ id, date, payee: "", memo: "", status: "verified", source: "manual", created_at: TS, verified_at: TS });
    s.entries.push({ transaction_id: id, category_id: cat, amount }, { transaction_id: id, account_id: "chk", amount: -amount });
  };
  for (const m of MONTHS) {
    spend(`${m}-01`, "rent", 800000);
    for (let i = 0; i < 12; i++) spend(`${m}-${String(2 + i).padStart(2, "0")}`, "food", 700000 / 12 | 0 ? 58333 + (i === 11 ? 4 : 0) : 0);   // 12 entries adding to 700,000 exactly
    spend(`${m}-15`, "ess", 300000); spend(`${m}-16`, "trn", 150000);
    if (misc) spend(`${m}-20`, "misc", misc);
    if (subscription) spend(`${m}-10`, "sub", subscription);
  }
  return s;
}
// income: total for the month in centavos, shared as two equal paydays
const run = (misc, income, o = {}, subscription = 0) => suggestPlan({ state: history(misc, subscription), paydays: PAYDAYS, today: TODAY, month: MONTH, income: [income / 2, income / 2], ...o });
const total = (r, name) => r.paydays.reduce((a, p) => a + (p.lines.find((l) => l.name === name)?.amount ?? 0), 0);
const balances = (r) => r.paydays.every((p) => p.lines.reduce((a, l) => a + l.amount, 0) + p.unallocated - p.short === p.income);
const needsOf = (r) => ({ food: total(r, "Food"), ess: total(r, "Essentials"), trn: total(r, "Transport"), rent: total(r, "Rent") });
const USUAL = { food: 700000, ess: 300000, trn: 150000, rent: 800000 };

test("TIGHT: an unclassified category with 5,000.00 of history never displaces a need or the rent; it takes what is left, here nothing", () => {
  // income 20,000.00: fixed 8,000.00 + needs 11,500.00 = 19,500.00; floor 0; buffer = the 5% share, 1,000.00, but only 500.00 is left; wants get 0.00
  const r = run(500000, 2000000);
  assert.ok(r.ok, r.message);
  assert.deepEqual(needsOf(r), USUAL, "every need and the rent are at their usual level");
  assert.equal(total(r, "Misc"), 0, "Misc is funded last, and nothing is left for it");
  assert.equal(total(r, "Overrun buffer"), 50000, "the buffer takes only what fixed payments and needs leave: 500.00");
  assert.equal(r.funding.shortBy, 0); assert.equal(r.funding.wants, 0);
  assert.ok(balances(r));
});

test("TIGHT with a bucket map that puts Misc in Other and the needs in Needs: the same result", () => {
  const buckets = new Map([["rent", "need"], ["food", "need"], ["ess", "need"], ["trn", "need"], ["misc", "other"]]);
  const r = run(500000, 2000000, { buckets });
  assert.deepEqual(needsOf(r), USUAL); assert.equal(total(r, "Misc"), 0); assert.ok(balances(r));
});

test("ROOM: wants keep their usual level when fixed, needs, floor and buffer leave enough, and savings take their share", () => {
  // income 40,000.00: fixed 8,000 + needs 11,500 = 19,500; buffer 5% = 2,000 -> 18,500 left; wants cap 30% = 12,000; Misc 5,000 fits
  const r = run(500000, 4000000);
  assert.equal(total(r, "Misc"), 500000); assert.deepEqual(needsOf(r), USUAL); assert.equal(total(r, "Overrun buffer"), 200000);
  assert.equal(r.funding.wantsCap, 1200000);
  assert.equal(r.funding.saving, 600000, "savings: up to 15% of 40,000.00 = 6,000.00, and 13,500.00 was left");
  assert.ok(balances(r));
});

test("CAP: wants never take more than 30% of the base income, even when the money is there", () => {
  // Misc history 20,000.00; income 40,000.00: left for wants 18,500.00, cap 12,000.00 -> Misc is lowered to 12,000.00
  const r = run(2000000, 4000000);
  assert.equal(total(r, "Misc"), 1200000); assert.deepEqual(needsOf(r), USUAL);
  assert.match(r.paydays[0].lines.find((l) => l.name === "Misc").reason, /wants cap: 30% of your base income/);
  assert.ok(balances(r));
});

test("SHORT: when fixed payments and needs do not fit the income, the shortfall is exact, no need is lowered, and the buffer and wants get nothing", () => {
  // income 18,000.00 against 19,500.00: short by 1,500.00
  const r = run(500000, 1800000);
  assert.equal(r.funding.shortBy, 150000);
  assert.deepEqual(needsOf(r), USUAL, "not one need is lowered");
  assert.equal(total(r, "Misc"), 0); assert.equal(total(r, "Overrun buffer"), 0);
  // each payday may be short or have room on its own (rent falls on one payday), but over the month the lines are exactly 1,500.00 more than the income
  assert.equal(r.paydays.reduce((a, p) => a + p.short - p.unallocated, 0), 150000, "over the month the paydays say the same 1,500.00 short");
  assert.ok(balances(r));
});

test("A SCHEDULED payment (a loan repayment, a family send) is a fixed commitment: it comes before the needs and is never lowered", () => {
  // income 20,000.00; scheduled 2,000.00 on day 5: fixed 10,000.00 + needs 11,500.00 = 21,500.00 -> short by 1,500.00
  const r = run(500000, 2000000, { scheduled: [{ name: "Test Loan", kind: "scheduled", amount: 200000, day: 5 }] });
  assert.equal(total(r, "Test Loan"), 200000); assert.deepEqual(needsOf(r), USUAL);
  assert.equal(r.funding.fixed, 1000000); assert.equal(r.funding.shortBy, 150000); assert.equal(total(r, "Misc"), 0);
  assert.ok(balances(r));
});

test("THE SAVINGS FLOOR is funded before the buffer and the wants", () => {
  // income 25,000.00, floor 3,000.00: fixed 8,000 + needs 11,500 + floor 3,000 = 22,500; 2,500 left: buffer (5% = 1,250) takes 1,250, wants get the other 1,250
  const r = run(500000, 2500000, { settings: { savings_floor: 300000 } });
  assert.equal(total(r, "Overrun buffer"), 125000); assert.equal(total(r, "Misc"), 125000); assert.equal(r.funding.saving, 300000);
  assert.deepEqual(needsOf(r), USUAL); assert.ok(balances(r));
  // and when the floor does not fit with fixed payments and needs, the shortfall counts it: income 22,000.00 -> short by 500.00
  const s = run(500000, 2200000, { settings: { savings_floor: 300000 } });
  assert.equal(s.funding.shortBy, 50000); assert.equal(total(s, "Misc"), 0); assert.equal(total(s, "Overrun buffer"), 0); assert.ok(balances(s));
});

test("a savings ratchet owns the savings: its amount is the floor", () => {
  const r = run(500000, 2500000, { ratchet: { amount: 300000 } });
  assert.equal(r.funding.floor, 300000); assert.equal(r.funding.saving, 300000);
});

test("a figure the owner pinned on a want is never lowered by the cap", () => {
  const r = run(500000, 4000000, { pinned: [{ name: "Misc", category_id: "misc", first: 1000000, second: 1000000 }] });
  assert.equal(total(r, "Misc"), 2000000, "the owner's 20,000.00 stays, even above the 30% cap");
});

test("the wants cap is one setting in the table, checked like the others", () => {
  assert.equal(SUGGEST_DEFAULTS.wants_cap_bps, 3000);
  assert.equal(resolveSettings({ wants_cap_bps: 10001 }).ok, false); assert.equal(resolveSettings({ wants_cap_bps: -1 }).ok, false);
  assert.equal(resolveSettings({ wants_cap_bps: 0 }).ok, true);
  const r = run(500000, 4000000, { settings: { wants_cap_bps: 1000 } });
  assert.equal(total(r, "Misc"), 400000, "with a 10% cap, wants take at most 4,000.00");
});

test("a category with the subscription role is a fixed commitment even with no subscription list: it is funded before the needs and never lowered", () => {
  // income 20,000.00: fixed 8,000 + 1,000 (streaming) + needs 11,500 = 20,500 -> short by 500.00; the streaming line stays 1,000.00
  const r = run(500000, 2000000, {}, 100000);
  assert.equal(total(r, "Streaming"), 100000); assert.equal(r.funding.fixed, 900000); assert.equal(r.funding.shortBy, 50000); assert.deepEqual(needsOf(r), USUAL); assert.ok(balances(r));
});

test("the window says how it was funded, in one short line, and 'Short by' when fixed payments, needs and the floor do not fit", () => {
  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
  assert.ok(app.includes("<b>Short by ${peso(r.short)}.</b> Fixed, needs and savings floor: ${peso(r.income.amount + r.short)}. Income: ${peso(r.income.amount)}."));
  assert.ok(app.includes("Funded in order: fixed, needs, savings floor, buffer, then wants (up to ${peso(r.funding.wantsCap)}). Left: <b>${peso(r.unallocated)}</b>."));
  const view = readFileSync(new URL("../src/model/budgetview.js", import.meta.url), "utf8");
  assert.match(view, /short: fit\.short, funding: r\.funding/, "the window gets the engine's funding figures");
});

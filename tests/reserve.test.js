import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as M from "../src/model/index.js";
import { makeState, cardPurchase, reserveSetAside, commit } from "./fixtures.js";

// The card reserve check (owner, Oct 31): the money set aside must cover EVERYTHING the card is owed, the pending charges AND the posted balance together (reserve >= pending + posted).
// The Checks screen was redrawn; these tests keep the rule itself. Invented figures, centavos (100000 is 1,000.00).
const warn = (r) => r.violations.find((v) => v.code === "RESERVE_BELOW_OUTSTANDING");
const owed = (s) => M.cardOutstanding(s.accounts.find((a) => a.id === "card"), M.countedEntries(s));
const rows = (s) => M.reserveShortfalls(s.accounts, M.countedEntries(s));
// A card that owes 20,000.00 posted (its opening balance) and 5,000.00 more pending, with `reserve` set aside.
function card(reserve) {
  const s = makeState();
  s.accounts.find((a) => a.id === "card").opening_balance = 2000000;   // posted
  s.accounts.find((a) => a.id === "chk").opening_balance = 9000000;
  commit(s, cardPurchase("pend", 500000, "pending"));
  if (reserve) commit(s, reserveSetAside("res1", reserve));
  return s;
}

test("the reserve must cover pending AND posted together: owed is their sum, and the shortfall is what the reserve lacks of that sum", () => {
  const s = card(2000000);   // covers the posted part only
  assert.deepEqual(owed(s), { posted: 2000000, pending: 500000, total: 2500000 });
  const [r] = rows(s);
  assert.equal(r.outstanding, 2500000, "what must be covered is posted + pending");
  assert.equal(r.reserve, 2000000); assert.equal(r.shortfall, 500000, "the pending charges are not covered");
});

test("exactly pending + posted passes (>=, not >), one centavo less is short by exactly one centavo", () => {
  const exact = card(2500000), under = card(2499999);
  assert.equal(rows(exact)[0].shortfall, 0); assert.equal(warn(M.checkTransactionSave(exact, cardPurchase("zz", 0, "pending"))), undefined);
  assert.equal(rows(under)[0].shortfall, 1);
  const w = warn(M.checkTransactionSave(under, reserveSetAside("tiny", 0)));
  assert.equal(w?.shortfall, 1, "the save check warns by the same one centavo");
});

test("a credit already posted on the card still leaves the pending charges to be covered to the pending: the owner's shape, 14,557.34 pending and 4,648.15 credit against 8,876.69 set aside", () => {
  const s = makeState();
  s.accounts.find((a) => a.id === "card").opening_balance = -464815;   // a credit of 4,648.15 already posted
  s.accounts.find((a) => a.id === "chk").opening_balance = 9000000;
  commit(s, cardPurchase("big", 1455734, "pending"));
  commit(s, reserveSetAside("res1", 887669));
  const [r] = rows(s);
  assert.deepEqual(owed(s), { posted: -464815, pending: 1455734, total: 990919 });
  assert.equal(r.outstanding, 990919); assert.equal(r.reserve, 887669); assert.equal(r.shortfall, 103250, "short by 1,032.50");
});

test("the Checks screen shows the model's own figures and recomputes nothing", () => {
  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8"), view = app.slice(app.indexOf("function viewChecks()"), app.indexOf("// ---------- pay plan ----------"));
  assert.match(view, /M\.reserveShortfalls\(S\(\)\.accounts, M\.countedEntries\(S\(\)\)\)/);
  assert.match(view, /peso\(r\.reserve\)/); assert.match(view, /peso\(r\.outstanding\)/); assert.match(view, /peso\(r\.shortfall\)/); assert.match(view, /const ok = r\.shortfall === 0/);
  assert.doesNotMatch(view, /o\.pending \+ o\.posted|o\.total/, "the screen never adds the two itself");
});

// WHAT THE SCREEN SAYS IS WHAT IS SAVED (owner, Nov 16; the M1 flaw: "screen says one thing, ledger another"). Since P0-7 everything typed is a DRAFT,
// yet two windows (Add to the buffer, Money received) still said "Saved as verified". This test reads every message in the app that claims an entry is
// VERIFIED and:
//   1. every such claim must be in CLAIMS below, with the model function that really saves it verified (and that function is run here, or its own
//      test is named); a NEW claim fails until it is proved and listed;
//   2. every save that goes through a function that makes a DRAFT (run here: each one returns status "draft") must not say verified, neither in its
//      message nor in the window it is saved from.
// Every figure is invented; amounts are centavos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as M from "../src/model/index.js";
import { makeState, account } from "./fixtures.js";

const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
const NOW = new Date("2026-10-20T03:00:00Z");
// Words that tell the owner an entry IS verified (a label such as "not verified yet" or "Nothing verified" is not a claim).
const CLAIM = /saved as verified|\bas verified\b|(?<!until it )\b(?:is|are|was|were) verified\b|verified by\b|verified, (?:since|because)/i;   // "until it is verified" speaks of a draft

// The only places the app may say an entry is verified, each with what makes it true.
const CLAIMS = [
  { says: "verified by your tap. Balances stay as they are.", fn: "planGapMove", why: "called with tap: true; tests/gaprepair.test.js" },
  { says: "It is verified by your tap, and both counts then match.", fn: "planProposedMove", why: "tests/gapmatch.test.js: status verified, verified by count" },
  { says: "The move is verified by this count.", fn: "planCheckInWithMove", why: "run below" },
  { says: "Counted. The move is verified by count.", fn: "planCheckInWithMove", why: "run below" },
  { says: '" is verified by count."', fn: "planGapMove|planProposedMove", why: "the two Weekly review buttons, as above" },
  { says: "verified by the statement.", fn: "planStatementVerify", why: "tests/entryrule.test.js" },
  { says: "Accepted. The entries from this month are verified.", fn: "acceptMonth", why: "tests/entryrule.test.js, tests/proof.test.js" },
];

test("every message that says an entry is verified is listed, with the model function that makes it true", () => {
  // every place in app.js where the claim words appear must sit inside one of the listed messages
  const spans = CLAIMS.flatMap((c) => { const t = c.says.replace(/^"|"$/g, ""), out = []; for (let i = app.indexOf(t); i >= 0; i = app.indexOf(t, i + 1)) out.push([i, i + t.length]); return out; });
  const re = new RegExp(CLAIM.source, "gi");
  let found = 0;
  for (const m of app.matchAll(re)) {
    if (/status (?:===|!==) "verified"|\.verified\b/.test(app.slice(m.index - 20, m.index + 30))) continue;   // code, not words
    if (app.slice(app.lastIndexOf("\n", m.index), m.index).includes("// ")) continue;   // a code comment, never shown
    found++;
    const line = app.slice(app.lastIndexOf("\n", m.index) + 1, app.indexOf("\n", m.index)).trim();
    assert.ok(spans.some(([a, b]) => m.index >= a && m.index < b), "a message says verified without proof; prove it and list it in CLAIMS: " + line.slice(Math.max(0, line.indexOf(m[0]) - 80), line.indexOf(m[0]) + 60));
  }
  assert.ok(found >= CLAIMS.length, "found the claims: " + found);
  for (const c of CLAIMS) {
    const at = app.indexOf(c.says.replace(/^"|"$/g, ""));
    assert.ok(at >= 0, "still in the app: " + c.says);
    for (const f of c.fn.split("|")) assert.equal(typeof M[f], "function", f);
  }
  // "Saved as verified" is in no CLAIMS entry, so the loop above fails on any shown copy of it (the code comment in invariants is not app.js text)
});

// A small invented ledger for the draft makers.
const ledger = () => {
  const s = makeState();
  s.accounts = [account({ id: "chk", name: "Checking", class: "asset", opening_balance: 1000000 }), account({ id: "sav", name: "Savings", class: "asset", opening_balance: 200000 }),
    account({ id: "wal", name: "Wallet", class: "asset", opening_balance: 100000 }), account({ id: "card", name: "Card", class: "liability", opening_balance: 20000 })];
  s.categories = [{ id: "food", name: "Food", kind: "expense" }, { id: M.UNLOGGED_CATEGORY_ID, name: "Uncategorized", kind: "expense" }];
  s.goals = [{ id: "g1", account_id: "sav", name: "Trip", hidden_by_default: false }];
  for (const k of ["payslips", "payslipLines", "payslipItems", "payslipItemChanges", "payslipRevisions", "checkIns", "rules", "categoryMaps", "tags", "subscriptions", "schedules", "scheduleChanges", "statementRecords", "statementLines", "statementAccepts"]) s[k] ??= [];
  return M.ensureIncomeCategories(s);
};
const statusOf = (r, id) => (r.state ?? r).transactions.find((t) => t.id === id)?.status;

test("the draft makers really make drafts, and no message or window that saves through one says verified", () => {
  const s = ledger();
  const env = M.planEnvelopeSetup(s, { gcash_account_id: "wal", allowance_envelope_id: "al", buffer_envelope_id: "bu", allowance_amount: 30000, buffer_amount: 20000, date: "2026-10-05", transaction_ids: ["b1", "b2"] }, NOW);
  const runs = {
    planPayReceived: [M.planPayReceived(s, { transaction_id: "x1", date: "2026-10-05", amount: 100000, account_id: "chk" }, NOW), "x1"],
    planRefund: [M.planRefund(s, { transaction_id: "x2", date: "2026-10-05", amount: 5000, account_id: "chk", category_id: "food" }, NOW), "x2"],
    planExpense: [{ state: M.applyDrafts(s, M.planExpense(s, { transaction_id: "x3", date: "2026-10-05", category_id: "food", amount: 5000, account_id: "chk", payee: "Shop" }, NOW).drafts) }, "x3"],
    planTransfer: [M.planTransfer(s, { transaction_id: "x4", date: "2026-10-05", from_account_id: "chk", to_account_id: "sav", amount: 5000, source: "manual" }, NOW), "x4"],
    planCardPayment: [M.planCardPayment(s, { card_id: "card", from_id: "chk", amount: 5000, date: "2026-10-05", newId: () => "x5", now: NOW }), "x5"],
    planGoalDeposit: [M.planGoalDeposit(s, { transaction_id: "x6", date: "2026-10-05", goal_id: "g1", from_account_id: "chk", amount: 5000 }, NOW), "x6"],
    planEnvelopeSetup: [env, "b1"],
    planBufferFunding: [M.planBufferFunding(env.state, { transaction_id: "x7", date: "2026-10-06", amount: 5000, from_account_id: "chk", gcash_account_id: "wal", buffer_envelope_id: "bu" }, NOW), "x7"],
  };
  for (const [fn, [r, id]] of Object.entries(runs)) assert.equal(statusOf(r, id), "draft", fn + " makes a draft");
  // every action that saves through one of them, and the window that holds its button
  let checked = 0;
  for (const m of app.matchAll(/\n    case "([a-z0-9-]+)": \{/g)) {
    const start = m.index, end = app.indexOf("\n    case \"", start + 10), block = app.slice(start, end > 0 ? end : undefined);
    const fns = Object.keys(runs).filter((fn) => block.includes("M." + fn + "("));
    if (!fns.length) continue;
    checked++;
    for (const t of block.match(/"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) ?? []) assert.ok(!CLAIM.test(t), `${m[1]} saves a draft (${fns.join(", ")}) but its message says verified: ${t.slice(0, 120)}`);
    const btn = app.indexOf(`data-action="${m[1]}"`);
    if (btn < 0) continue;
    const winStart = app.lastIndexOf("} else if (sh.type === ", btn), winEnd = app.indexOf("} else if (sh.type === ", btn);
    if (winStart < 0 || winEnd < 0 || winEnd - winStart > 20000) continue;
    const win = app.slice(winStart, winEnd);
    for (const t of win.match(/"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) ?? []) assert.ok(!CLAIM.test(t.replace(/\$\{[^}]*\}/g, " ")), `the window of ${m[1]} saves a draft but says verified: ${t.slice(0, 120)}`);
  }
  // the same for plain functions that save through a draft maker (Add expense, the scan saves)
  for (const m of app.matchAll(/\n(?:async )?function ([A-Za-z0-9]+)\(/g)) {
    const start = m.index, end = app.slice(start + 10).search(/\n(?:async )?function |\n\/\/ -{3,}/), body = app.slice(start, end > 0 ? start + 10 + end : undefined);
    const fns = Object.keys(runs).filter((fn) => body.includes("M." + fn + "("));
    if (!fns.length || body.includes('\n    case "')) continue;   // the click dispatcher: its case blocks are checked one by one above
    checked++;
    for (const t of body.match(/"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) ?? []) assert.ok(!CLAIM.test(t), `${m[1]} saves a draft (${fns.join(", ")}) but its message says verified: ${t.slice(0, 120)}`);
  }
  // 7 action handlers (money received and refund, Move money, two card payments, a goal deposit, the buffer's setup and top-up) and 3 functions
  // (logExpense, and the two scan saves of money received and a move)
  assert.ok(checked >= 10, "found the saves that make drafts: " + checked);
  for (const [w, save] of [["income", "save-income"], ["bufund", "save-bufund"]]) {
    const win = app.slice(app.indexOf(`} else if (sh.type === "${w}") {`), app.indexOf("} else if (sh.type === ", app.indexOf(`} else if (sh.type === "${w}") {`) + 10));
    assert.ok(win.includes(`data-action="${save}"`) && win.includes("Saved as a draft: it waits in Verify"), w + ": the window says it is saved as a draft");
  }
});

test("a claim of 'verified by count' is true: the move confirmed inside a count is verified", () => {
  const s = ledger();
  const r = M.planCheckInWithMove(s, { id: "c1", transaction_id: "ck1", date: "2026-10-12", account_id: "wal", counted_balance: 120000, unlogged_category_id: M.UNLOGGED_CATEGORY_ID }, { account_id: "sav", move_id: "mv1" }, NOW);
  assert.ok(r.ok, JSON.stringify(r.violations));
  assert.equal(statusOf(r, "mv1"), "verified");
});

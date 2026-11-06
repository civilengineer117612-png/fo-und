import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { emptyState, planRewards, validateState, selfCheck, verifyDraft } from "../src/model/index.js";

// P1-8 fix 6: a card statement's cashback is a CREDIT on the card: what is owed goes down. It is an income draft in Verify (source "statement"), never made twice.
// Invented accounts and amounts only (centavos).
const NOW = new Date("2026-10-20T09:00:00.000+08:00");
const acct = (id, name, extra = {}) => ({ id, name, class: "asset", role: "", hidden_by_default: false, archived: false, opening_balance: 0, opening_date: "2026-01-01", ...extra });
const base = () => ({ ...emptyState(), accounts: [acct("card", "Sample Card", { class: "liability" })], categories: [{ id: "cat-other-income", name: "Other income", kind: "income" }] });
const owed = (s) => -s.entries.filter((e) => e.account_id === "card").reduce((n, e) => n + e.amount, 0);
const REW = [{ date: "2026-10-09", name: "Cashback", amount: 1000 }, { date: "2026-10-20", name: "Cashback", amount: 250 }];
let n = 0; const id = () => "c" + ++n;

test("cashback on a card lowers what is owed, as a draft income entry, and the ledger stays balanced", () => {
  const s = { ...base(), transactions: [{ id: "p0", date: "2026-10-01", payee: "Shop", memo: "", status: "verified", source: "manual", created_at: "2026-10-01T09:00:00.000+08:00", verified_at: "2026-10-01T09:00:00.000+08:00" }],
    entries: [{ transaction_id: "p0", category_id: "cat-other-income", amount: 5000 }, { transaction_id: "p0", account_id: "card", amount: -5000, card_state: "posted" }] };
  assert.equal(owed(s), 5000);
  const r = planRewards(s, REW, { account_id: "card", newId: id, now: NOW });
  assert.ok(r.ok, r.message); assert.equal(r.count, 2);
  assert.equal(owed(r.state), 5000 - 1250, "the card owes less by the cashback");
  assert.deepEqual(r.state.transactions.filter((t) => t.source === "statement").map((t) => [t.status, t.payee]), [["draft", "Cashback"], ["draft", "Cashback"]]);
  assert.deepEqual(validateState(r.state).filter((v) => v.severity === "error"), []);
  assert.ok(selfCheck(r.state).ok !== false);
});

test("the same cashback again adds nothing; verifying a draft keeps the balance", () => {
  const r = planRewards(base(), REW, { account_id: "card", newId: id, now: NOW });
  const again = planRewards(r.state, REW, { account_id: "card", newId: id, now: NOW });
  assert.equal(again.count, 0); assert.equal(again.skipped, 2); assert.equal(again.state, r.state);
  const draft = r.state.transactions.find((t) => t.status === "draft"), v = verifyDraft(r.state, draft.id, NOW);
  assert.ok(v.ok, JSON.stringify(v.violations)); assert.equal(owed(v.state), owed(r.state));
});

test("a card entry carries card_state posted, and a bank account's cashback is unchanged (money in)", () => {
  const r = planRewards(base(), REW, { account_id: "card", newId: id, now: NOW });
  assert.ok(r.state.entries.filter((e) => e.account_id === "card").every((e) => e.card_state === "posted"));
  const bank = { ...base(), accounts: [acct("bk", "Sample Bank")] };
  const b = planRewards(bank, REW, { account_id: "bk", newId: id, now: NOW });
  assert.equal(b.state.entries.filter((e) => e.account_id === "bk").reduce((x, e) => x + e.amount, 0), 1250);
});

test("the import window says it", () => {
  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
  assert.match(app, /will be added as credits on the card \(what you owe goes down\), as drafts\./);
});

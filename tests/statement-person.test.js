import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyState, classifyLine, isTransferOut, previewImport, statementItems } from "../src/model/index.js";
import { parseStatement } from "../src/model/statement.js";
import { UNLOGGED_CATEGORY_ID } from "../src/model/seed.js";

// P1-8 fix 5: money sent to ANOTHER person is spending (a draft in Verify), only when the statement prints its holder's name (else your own transfers cannot
// be told apart and the line stays unsure). Its category: the payee book, else Uncategorized; a person's name is never read as a kind. Invented data only.
const t = (x, y, str, w = str.length * 5) => ({ x, y, w, str });
const money = (c) => (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
const rightAt = (edge, y, str) => t(edge - str.length * 5, y, str);
function page(rows, holder = "SAMPLE PEDRO OWNER") {
  const out = rows.reduce((n, r) => n + r[3], 0), open = 1000000;
  const items = [...(holder ? [t(49, 700, holder)] : []), t(230, 640, "01 OCT 2026 to 31 OCT 2026"),
    t(49, 608, "ACCOUNT"), t(146, 608, "STARTING BALANCE"), t(265, 608, "TOTAL OUTGOING"), t(376, 608, "TOTAL INCOMING"), t(477, 608, "ENDING BALANCE"),
    t(49, 567, "SAVINGS"), t(200, 567, money(open)), t(300, 567, money(out)), t(410, 567, money(0)), t(520, 567, money(open - out)),
    t(49, 457, "DATE"), t(169, 457, "TRANSACTION"), t(364, 457, "OUTGOING"), t(406, 457, "(PHP)"), t(485, 457, "INCOMING"), t(526, 457, "(PHP)")];
  let y = 430;
  for (const [date, payee, type, o] of rows) { items.push(t(169, y, payee), t(49, y - 7, date), t(169, y - 14, type), rightAt(425, y - 7, money(o))); y -= 46; }
  return [items];
}
const ROWS = [["14 OCT", "Sample Friend Kape", "Transfer", 150000], ["15 OCT", "Sample Mystery", "Other", 2000], ["16 OCT", "Sample P. Owner", "Transfer", 30000]];

test("with the holder's name printed: a transfer to another person is spending, your own is a move, money that says nothing stays unsure", () => {
  const r = parseStatement(page(ROWS));
  assert.deepEqual(r.lines.map((l) => [l.meaning, !!l.person, !!l.own]), [["spending", true, false], ["unsure", false, false], ["move", false, true]]);
  assert.deepEqual(statementItems(r.lines).map((i) => [i.name, i.meaning, !!i.person]), [["Sample Friend Kape", "spending", true], ["Sample Mystery", "unsure", false]]);
});

test("with no holder's name, a transfer out is not guessed: it stays unsure", () => {
  assert.deepEqual(parseStatement(page(ROWS, null)).lines.map((l) => l.meaning), ["unsure", "unsure", "unsure"]);
});

test("which lines are transfers: by their kind or their words, money out only", () => {
  for (const l of [{ type: "Transfer" }, { type: "Fund Transfer" }, { type: "InstaPay" }, { text: "Transfer to Sample Friend, Sample Bank" }, { text: "Sent GCash to Sample Bank with account ending in 1234" }, { text: "Transfer from 09170000000 to 09180000000" }])
    assert.ok(isTransferOut({ direction: "out", text: "", type: "", ...l }), JSON.stringify(l));
  assert.ok(!isTransferOut({ direction: "in", type: "Transfer", text: "" }), "money in is never spending");
  assert.ok(!isTransferOut({ direction: "out", type: "Other", text: "Sample Mystery" }));
});

test("its draft's category: your name for them first, else Uncategorized; never read from the person's name", () => {
  const s = { ...emptyState(), accounts: [{ id: "sav", name: "Sample Savings", class: "asset", role: "", hidden_by_default: false, archived: false, opening_balance: 0, opening_date: "2026-01-01" }],
    categories: [{ id: "cat-food", name: "Food", kind: "expense", role: "food" }, { id: "cat-family", name: "Family", kind: "expense" }, { id: UNLOGGED_CATEGORY_ID, name: "Uncategorized", kind: "expense" }] };
  const item = { dateRaw: "2026-10-14", name: "Sample Grocery", amount: 150000, meaning: "spending", person: true };
  assert.equal(previewImport(s, [item], "dmy", null, { accountId: "sav" }).lines[0].category_id, UNLOGGED_CATEGORY_ID);
  assert.equal(previewImport(s, [{ ...item, person: undefined }], "dmy", null, { accountId: "sav" }).lines[0].category_id, "cat-food", "(an ordinary shop line is still read by its name)");
  const book = { "sample grocery": { category_id: "cat-family" } };
  assert.equal(previewImport(s, [item], "dmy", book, { accountId: "sav" }).lines[0].category_id, "cat-family");
});

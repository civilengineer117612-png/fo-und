import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStatement } from "../src/model/statement.js";

// P1-8 fix 2: a table printed after the transactions (interest earned and tax withheld per period) is not read as transactions.
// The layout is INVENTED (Outgoing / Incoming columns); every name and figure is made up.
const t = (x, y, str, w = str.length * 5) => ({ x, y, w, str });
const money = (c) => (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
const rightAt = (edge, y, str) => t(edge - str.length * 5, y, str);
const ROWS = [["02 OCT", "Sample Grocer", "Card Payment", 125000, 0], ["06 OCT", "Sample Shop", "Payment", 90000, 0], ["OCT", "Interest", "Interest", 0, 1234]];
function page({ title = "INTEREST AND TAX DETAILS", columns = true, rows = ROWS, extraType = null } = {}) {
  const out = rows.reduce((n, r) => n + r[3], 0), inn = rows.reduce((n, r) => n + r[4], 0), open = 2000000;
  const items = [t(49, 700, "SAMPLE PEDRO OWNER"), t(230, 640, "01 OCT 2026 to 31 OCT 2026"),
    t(49, 608, "ACCOUNT"), t(146, 608, "STARTING BALANCE"), t(265, 608, "TOTAL OUTGOING"), t(376, 608, "TOTAL INCOMING"), t(477, 608, "ENDING BALANCE"),
    t(49, 567, "SAVINGS"), t(200, 567, money(open)), t(300, 567, money(out)), t(410, 567, money(inn)), t(520, 567, money(open - out + inn)),
    t(49, 457, "DATE"), t(169, 457, "TRANSACTION"), t(364, 457, "OUTGOING"), t(406, 457, "(PHP)"), t(485, 457, "INCOMING"), t(526, 457, "(PHP)")];
  let y = 430;
  for (const [date, payee, type, o, i] of rows) { items.push(t(169, y, payee), t(49, y - 7, date), t(169, y - 14, extraType && payee === "Interest" ? extraType : type)); items.push(o ? rightAt(425, y - 7, money(o)) : rightAt(545, y - 7, money(i))); y -= 46; }
  if (title) { y -= 20; items.push(t(49, y, title)); }
  y -= 20;
  if (columns) items.push(t(49, y, "PERIOD"), t(169, y, "RATE"), t(364, y, "GROSS INTEREST"), t(485, y, "WITHHOLDING TAX"));
  if (title || columns) { y -= 20; items.push(t(49, y, "01 OCT"), t(100, y, "31 OCT"), t(169, y, "1.00%"), rightAt(425, y, money(1542)), rightAt(545, y, money(308))); }
  items.push(t(500, 42, "page"), t(529, 42, "1"));
  return [items];
}

test("the interest-and-tax table after the transactions is not read as lines, and the statement adds up", () => {
  const r = parseStatement(page());
  assert.ok(r.ok, r.message);
  assert.deepEqual(r.lines.map((l) => [l.date, l.amount, l.direction]), [["2026-10-02", 125000, "out"], ["2026-10-06", 90000, "out"], ["2026-10-31", 1234, "in"]]);
  assert.ok(r.check.ok, r.check.message);
});

test("the table is known by its title alone, or by its column titles alone", () => {
  assert.equal(parseStatement(page({ columns: false })).lines.length, 3, "title only");
  assert.equal(parseStatement(page({ title: null })).lines.length, 3, "columns only");
  assert.equal(parseStatement(page({ title: "Tax Summary", columns: false })).lines.length, 3, "another title");
});

test("a transaction whose kind reads Withholding Tax stays a transaction", () => {
  const rows = [...ROWS, ["31 OCT", "Tax on interest", "Withholding Tax", 247, 0]];
  const r = parseStatement(page({ title: null, columns: false, rows }));
  assert.equal(r.lines.length, 4); assert.equal(r.lines[3].amount, 247); assert.equal(r.lines[3].type, "Withholding Tax");
});

test("on a Credits / Debits page, a transaction line that names gross interest and tax is still a transaction (it carries a date and amounts)", () => {
  const items = [t(40, 760, "Statement of Account"), t(40, 730, "Period: 01 Oct 2026 - 31 Oct 2026"),
    t(40, 600, "Date"), t(140, 600, "Details"), t(400, 600, "Credits"), t(470, 600, "Debits"), t(520, 600, "Running"), t(560, 600, "Balance"),
    t(40, 580, "05 Oct 2026"), t(140, 580, "Sample Cafe"), rightAt(430, 580, money(0)), rightAt(495, 580, money(18000)), rightAt(600, 580, money(82000)),
    t(40, 562, "31 Oct 2026"), t(140, 562, "Gross interest less withholding tax"), rightAt(430, 562, money(1234)), rightAt(495, 562, money(0)), rightAt(600, 562, money(83234)),
    t(40, 544, "31 Oct 2026"), t(140, 544, "Sample Shop"), rightAt(430, 544, money(0)), rightAt(495, 544, money(1000)), rightAt(600, 544, money(82234))];
  assert.equal(parseStatement([items]).lines.length, 3);
});

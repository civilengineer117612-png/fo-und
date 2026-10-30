import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { maskText, maskedLayout, layoutReport, KNOWN_WORDS } from "../src/model/index.js";
import { payrollItems } from "../e2e/payroll-table.mjs";

// Everything here is invented. The report keeps the app's own headings and the positions; everything else is hidden.
const letterRuns = (s) => s.match(/\p{L}+/gu) ?? [];
const onlySafe = (s) => letterRuns(s).every((w) => /^x+$/.test(w) || (/^[A-Za-z]+$/.test(w) && KNOWN_WORDS.has(w.toLowerCase())));
const noRealDigit = (s) => !/[0-8]/.test(s.replace(/\p{Nd}/gu, (d) => (d === "9" ? "9" : "!")).replace(/!/g, "0")) && ![...s.matchAll(/\p{Nd}/gu)].some(([d]) => d !== "9");

test("headings the app knows stay; every digit becomes 9; every other word becomes x's of the same length", () => {
  assert.equal(maskText("Gross"), "Gross"); assert.equal(maskText("Net Pay"), "Net Pay"); assert.equal(maskText("Deductions"), "Deductions");
  assert.equal(maskText("Hours and Earnings"), "Hours and Earnings");
  assert.equal(maskText("12,345.67"), "99,999.99"); assert.equal(maskText("₱ 1,000.50"), "₱ 9,999.99");
  assert.equal(maskText("Maria Santos"), "xxxxx xxxxxx"); assert.equal(maskText("Example Holdings Ltd"), "xxxxxxx xxxxxxxx xxx");
  assert.equal(maskText("1234-5678-90"), "9999-9999-99", "an account number keeps only its shape");
  assert.equal(maskText("16-Jan-2026"), "99-xxx-9999", "a date keeps only its shape");
  assert.equal(maskText("a.person@example.com"), "x.xxxxxx@xxxxxxx.xxx");
});

test("nothing real survives, in any script: no digit but 9, no letter run that is not x's or a known heading", () => {
  for (const s of ["Pay12345", "PhilHealth 123", "Ünïcode Nämé 42", "Ｘ１２ ٣٤٥", "SSS 0123456789", "Maria1Santos2", "Gross: 15,000.00 / Net: 12,000.00", "ñandú Ångström 7", "Employee ID EX-00123", "Tax 99.99 ok"]) {
    const m = maskText(s);
    assert.ok(onlySafe(m), s + " -> " + m); assert.ok(noRealDigit(m), s + " -> " + m);
    assert.equal([...m].length, [...s].length, "the length is kept: " + s);
  }
  assert.equal(maskText("Pay12345"), "Pay99999", "a known word next to digits keeps its word");
});

test("a word is kept only when it is a whole known word, never a part of an unknown one", () => {
  assert.equal(maskText("Grossman"), "xxxxxxxx"); assert.equal(maskText("Netty"), "xxxxx"); assert.equal(maskText("Taxi"), "xxxx"); assert.equal(maskText("GROSS"), "GROSS", "case does not matter");
});

test("positions and rows are kept: rounded, top row first, pieces of one row in reading order, empty pieces dropped", () => {
  const pages = [[{ x: 180.4, y: 640.2, w: 40.6, str: "17,000.00" }, { x: 25, y: 640, w: 30, str: "Gross" }, { x: 25, y: 700, w: 60, str: "Example Person" }, { x: 5, y: 640, w: 5, str: "   " }, { x: NaN, y: 1, str: "lost" }], [{ x: 10, y: 10, str: "Net Pay" }]];
  const m = maskedLayout(pages);
  assert.deepEqual(m, [{ page: 1, rows: [{ y: 700, items: [{ x: 25, w: 60, text: "xxxxxxx xxxxxx" }] }, { y: 640, items: [{ x: 25, w: 30, text: "Gross" }, { x: 180, w: 41, text: "99,999.99" }] }] }, { page: 2, rows: [{ y: 10, items: [{ x: 10, w: 0, text: "Net Pay" }] }] }]);
  const text = layoutReport(pages);
  assert.match(text, /^LAYOUT REPORT/); assert.match(text, /\nPage 1\n700: 25\/60 xxxxxxx xxxxxx\n640: 25\/30 Gross; 180\/41 99,999.99\n/); assert.match(text, /\nPage 2\n10: 10\/0 Net Pay$/);
});

test("a whole invented payroll PDF: its headings survive, its names and figures do not", () => {
  const items = payrollItems(), text = layoutReport([items]);
  for (const h of ["Payslip", "Gross", "Net Pay", "Hours and Earnings", "Pre-Tax Deductions", "Net Pay Distribution"]) assert.ok(text.includes(h), h + " is kept");
  for (const secret of ["Example", "Person", "17,000.00", "15,200.00", "12,000.00", "1,200.00", "2026", "Jan"]) assert.ok(!text.includes(secret), secret + " is hidden");
  assert.ok(!/[0-8]/.test(text.split("\n").slice(1).filter((l) => l && !/^Page \d+$/.test(l)).map((l) => l.replace(/^\d+:\s*/, "").replace(/\d+\/\d+ /g, "")).join("\n")), "no digit but 9 in any text");
  assert.ok(onlySafe(text.split("\n").slice(1).join("\n").replace(/Page \d+/g, "")), "only x's and known headings");
});

test("the screen copies only the masked report, made when the PDF is read, and only for a PDF", () => {
  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8"), pdf = readFileSync(new URL("../app/pdftext.js", import.meta.url), "utf8");
  assert.match(app, /layoutText: layout \? M\.layoutReport\(layout\) : ""/, "masked when the form opens: the raw pieces are not kept in the form");
  assert.match(app, /case "copy-layout": \{[^]*?writeText\(ui\.form\.layoutText \?\? ""\)/, "what is copied is the masked text");
  assert.match(app, /\$\{f\.layoutText \? `<p class="note small"><button class="link" data-action="copy-layout">Copy layout report/, "the link shows only when there is a report");
  assert.match(pdf, /layout\.push\(items\)/); assert.match(pdf, /blob: await canvasBlob\(preview\), layout \}/);
});

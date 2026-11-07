// Draws the invented payslip pictures once, in Chromium, and keeps the bytes in e2e/fixtures (every name and figure is invented).
// Why fixed bytes: each engine draws canvas text its own way, so a picture drawn in the test gave Chromium and WebKit different PICTURES, and a reading
// difference could not be told from a drawing difference. Read from the same bytes, a difference is the reader's. Run: python3 -m http.server 8124, then
// node e2e/make-fixtures.mjs. The pictures are only ever read by the tests; they hold no real person, employer or amount.
import { writeFileSync } from "node:fs";
import { launchBrowser } from "./engine.mjs";
import { photoRows } from "./payslip-photo.mjs";
const base = (process.env.BASE ?? "http://127.0.0.1:8124/").replace(/app\/index\.html.*$/, "");
const browser = await launchBrowser(), page = await (await browser.newContext()).newPage();   // ENGINE is chromium unless set: the fixtures are drawn there
await page.goto(base + "app/index.html");
const out = (name, b64) => { writeFileSync(new URL("./fixtures/" + name, import.meta.url), Buffer.from(b64, "base64")); console.log("wrote e2e/fixtures/" + name); };
// the payroll table, drawn as a screenshot would show it: white, black letters, the app's bundled font
const table = (rows) => page.evaluate(async (rows) => {
  const face = new FontFace("Slip", "url(fonts/ibm-plex-sans-latin-600-normal.woff2)"); await face.load(); document.fonts.add(face);
  const k = 1.5, c = document.createElement("canvas"); c.width = 1500; c.height = 1320;
  const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.fillStyle = "#000"; x.font = "600 21px Slip"; x.textBaseline = "middle";
  for (const r of rows) { x.textAlign = r.a === "r" ? "right" : "left"; x.fillText(r.t, r.x * k, r.y * k); }
  return c.toDataURL("image/png").split(",")[1];
}, rows);
out("sample-payslip-table.png", await table(photoRows()));
out("sample-payslip-table-nosummary.png", await table(photoRows({ summary: false, distribution: false })));
// a payslip with the earnings on the left, the deductions on the right, photographed a little crooked
out("sample-payslip-crooked.png", await page.evaluate(() => {
  const c = document.createElement("canvas"); c.width = 1400; c.height = 1000;
  const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, 1400, 1000); x.fillStyle = "#000";
  x.translate(60, 40); x.rotate(0.05);
  x.font = "bold 36px sans-serif"; x.fillText("PHIL SAMPLE, INC.", 20, 60); x.fillText("PAYSLIP", 900, 60); x.font = "30px sans-serif"; x.fillText("Apr 16-30, 2026", 900, 110);
  x.fillText("Net Pay:  P 9,075.00", 900, 170);
  const left = [["EARNINGS", ""], ["Basic Salary", "9,000.00"], ["Rice Subsidy", "1,000.00"], ["Skills Allowance", "500.00"], ["Gross Earnings", "10,500.00"]];
  const right = [["DEDUCTIONS", ""], ["Withholding Tax", "650.00"], ["SSS Premium Cont.", "400.00"], ["Philhealth Premium Cont.", "225.00"], ["Pag-Ibig Premium Cont.", "100.00"], ["Absences", "50.00"], ["Total Deductions", "1,425.00"]];
  left.forEach(([l, a], i) => { x.fillText(l, 20, 260 + i * 55); if (a) x.fillText(a, 400, 260 + i * 55); });
  right.forEach(([l, a], i) => { x.fillText(l, 560, 240 + i * 55); if (a) x.fillText(a, 1060, 240 + i * 55); });
  return c.toDataURL("image/png").split(",")[1];
}));
await browser.close();

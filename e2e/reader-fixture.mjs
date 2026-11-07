// The stronger photo reader on ONE fixed, invented picture (e2e/fixtures/sample-payslip-photo.png: a made-up payslip drawn once), in the engine under test.
// Why: Safari's engine once gave the reader different pixels from Chromium for the same picture bytes (the canvas resamples differently), so lines like "Pay date" came out
// as "Pa、Per：l」" on WebKit only. The reader now resamples in our own code (src/model/resample.js); this check keeps it so, on both engines. Serve the repo on port 8124 first.
import { launchBrowser, ENGINE } from "./engine.mjs";
const browser = await launchBrowser();
const ctx = await browser.newContext({ serviceWorkers: "block" });
const page = await ctx.newPage();
const origin = (process.env.BASE ?? "http://127.0.0.1:8124/app/index.html").replace(/app\/index\.html.*$/, "");
await page.goto(origin);
const lines = await page.evaluate(async (o) => {
  const blob = await (await fetch(o + "e2e/fixtures/sample-payslip-photo.png")).blob();
  const { readBoxes } = await import(o + "app/paddle.js");
  return (await Promise.race([readBoxes(blob), new Promise((_, no) => setTimeout(() => no(new Error("no answer in 150 s")), 150000))])).map((b) => b.text);
}, origin);
await browser.close();
console.log("reader: " + ENGINE + ": " + lines.join(" / "));
const text = lines.join("\n");
let failed = 0;
const check = (ok, label) => { console.log((ok ? "  ok   " : "  FAIL ") + label); if (!ok) failed++; };
for (const [re, label] of [[/Sample Employer Inc/, "the employer"], [/Pay period: 01\/10\/2026 - 02\/10\/2026/, "the pay period"], [/Pay date: .ct 2, 2026/, "the pay date"], [/EARNINGS/, "the EARNINGS heading"],
  [/Basic Salary 9,000\.00/, "Basic Salary and its amount"], [/Rice Subsidy 1,000\.00/, "Rice Subsidy and its amount"], [/11,500\.00/, "the gross"], [/Gross Pay/, "the Gross Pay label"], [/DEDUCTIONS/, "the DEDUCTIONS heading"],
  [/Withholding Tax/, "Withholding Tax"], [/SSS 300\.00/, "SSS and its amount"], [/PhilHealth/, "PhilHealth"], [/Pag-IBIG/, "Pag-IBIG"], [/10,300\.00/, "the net"], [/Net Pay/, "the Net Pay label"]]) check(re.test(text), `${ENGINE} reads ${label} from the fixed picture`);
check(lines.length >= 15 && lines.length <= 24, `about as many lines as the page has (${lines.length})`);
if (failed) { console.log(failed + " check(s) FAILED"); process.exit(1); }

// An INVENTED two-column payslip, laid out like a payroll table printed from an HR system and then photographed or screenshotted
// (owner's report, Nov 1: the layout only; every name, figure and date here is made up). One spec serves two uses:
//   - `photoBoxes(opts)`: what the on-phone reader hands over (one box per printed piece, in pixels, the page tilted), for the unit tests;
//   - `PHOTO_ROWS`: the same pieces, drawn into a picture by the e2e test and read by the real reader.
// Hand-worked figures: earnings 500 + 1,000 + 400 + 100 + 400 + 300 + 6,000 + 1,500 + 500 = 10,700.00 (gross);
// pre-tax 100 + 250 + 450 = 800.00; tax 150.00; net 10,700 - 950 = 9,750.00 (also the deposit).
// Units: a page 1000 wide, y down, letters 12 high. `a` is the alignment: "l" (x = left edge) or "r" (x = right edge).
const L = (t, x, y) => ({ t, x, y, a: "l" }), R = (t, x, y) => ({ t, x, y, a: "r" });

export const PHOTO_FIGURES = { gross: 1070000, preTax: 80000, tax: 15000, net: 975000, deposit: 975000, payDate: "2026-01-16", from: "2026-01-01", to: "2026-01-14" };
export const PHOTO_EARNINGS = [   // [label, hours, amount]; the hours are printed in their own column and are never money
  ["Holiday Pay", "8.00", "500.00"], ["Holiday Pay Worked", "8.00", "1,000.00"], ["Meal Allowance Non Taxable", "0.00", "400.00"],
  ["ND Holiday", "4.00", "100.00"], ["ND Regular Work Day", "32.00", "400.00"], ["Program Allowance", "0.00", "300.00"],
  ["Regular", "64.00", "6,000.00"], ["Retro Regular", "16.00", "1,500.00"], ["Rice Subsidy", "0.00", "500.00"],
];
export const PHOTO_DEDUCTIONS = [["HDMF EE Contribution", "100.00"], ["PHILHEALTH EE Contribution", "250.00"], ["SSS EE Contribution", "450.00"], ["Tax Deduction", "150.00"]];

// opts: summary (false = the Summary table is not on the page), distribution (false = no Net Pay Distribution), glued (the reader drops the space
// inside some labels, as it did on the owner's page: "TaxDeduction", "ProgramAllowance").
export function photoRows({ summary = true, distribution = true, glued = false } = {}) {
  const g = (t) => (glued ? t.replace(/^Tax Deduction$/, "TaxDeduction").replace(/^Program Allowance$/, "ProgramAllowance") : t);
  const r = [L("Payslip", 450, 30), L("Example Employer Inc.", 40, 70)];
  r.push(L("Employer Name", 520, 110), L("Example Employer Inc.", 680, 110), L("Pay Basis", 520, 130), L("Monthly Non Exempt", 680, 130));
  r.push(L("Pay Period and Salary", 40, 180));
  ["Pay Period", "Payment Date", "Pay Begin Date", "Pay End Date", "Pay Rate"].forEach((t, i) => r.push(L(t, [40, 220, 400, 580, 800][i], 200)));
  ["Bi-Week", "16-Jan-2026", "01-Jan-2026", "14-Jan-2026", "12,000.00"].forEach((t, i) => r.push(L(t, [40, 220, 400, 580, 800][i], 220)));
  if (summary) {
    r.push(L("Summary", 40, 260));
    ["Gross", "Pre-Tax", "Taxes", "Deductions", "Net Pay"].forEach((t, i) => r.push(R(t, [330, 500, 670, 820, 960][i], 280)));
    r.push(L("Current", 40, 300));
    ["10,700.00", "800.00", "150.00", "9,750.00"].forEach((t, i) => r.push(R(t, [330, 500, 670, 960][i], 300)));
  }
  r.push(L("Hours and Earnings", 40, 340), L("Pre-Tax Deductions", 520, 340));
  r.push(L("Description", 40, 360), R("Hours", 330, 360), R("Amount", 480, 360), L("Description", 520, 360), R("Amount", 960, 360));
  PHOTO_EARNINGS.forEach(([t, h, v], i) => r.push(L(g(t), 40, 380 + i * 20), R(h, 330, 380 + i * 20), R(v, 480, 380 + i * 20)));
  PHOTO_DEDUCTIONS.slice(0, 3).forEach(([t, v], i) => r.push(L(t, 520, 380 + i * 20), R(v, 960, 380 + i * 20)));
  r.push(L("Tax Deductions", 520, 460), L("Description", 520, 480), R("Amount", 960, 480), L(g("Tax Deduction"), 520, 500), R("150.00", 960, 500));
  r.push(L("After Tax Deductions", 520, 540), L("Description", 520, 560), R("Amount", 960, 560));
  r.push(L("Accruals", 40, 580), L("Absences", 520, 580), L("Description", 40, 600), R("Current", 330, 600), R("Balance", 480, 600), L("Description", 520, 600));
  r.push(L("PTO", 40, 620), R("0.00", 330, 620), R("0.00", 480, 620));
  if (distribution) {
    r.push(L("Net Pay Distribution", 40, 660));
    r.push(L("Deposit/Cheque", 40, 680), L("Bank Name", 230, 680), L("Account Type", 420, 680), R("Amount", 960, 680), L("Number", 40, 700));
    r.push(L("Direct Deposit", 40, 720), L("Example Bank", 230, 720), L("SA", 420, 720), R("9,750.00", 960, 720));
  }
  r.push(L("Other Information", 40, 760), L("Description", 40, 780), L("Value", 420, 780));
  [["Non Taxable Earnings YTD", "900.00"], ["Pre Tax Deductions YTD", "800.00"], ["Tax Deductions YTD", "150.00"], ["Total Earnings YTD", "10,700.00"]].forEach(([t, v], i) => r.push(L(t, 40, 800 + i * 20), L(v, 420, 800 + i * 20)));
  return r;
}
export const PHOTO_ROWS = photoRows();

// The boxes the stronger reader would hand over: pixels (`scale` per page unit), the page turned by `tilt` (radians, about its top left), each box
// as tall as the letters, `th` its own baseline angle. Width is measured as 6.2 units per letter (close enough for any plain font).
// `dots`: the reader's own habits seen on a real run (Nov 1): a thousands comma read as a dot ("1.000.00"), a decimal point read as a comma ("4,00"),
// and both read as spaces on the deposit ("9 750 00").
export function photoBoxes({ tilt = 0, scale = 2, dots = false, ...opts } = {}) {
  const c = Math.cos(tilt), s = Math.sin(tilt), out = [];
  const misread = (t) => (dots ? t.replace(/^(\d{1,3}),(\d{3}\.\d{2})$/, "$1.$2").replace(/^(\d{1,2})\.00$/, "$1,00") : t);
  for (const p0 of photoRows(opts)) {
    const p = { ...p0, t: dots && p0.t === "9,750.00" && p0.y === 720 ? "9 750 00" : misread(p0.t) };
    const w = p.t.length * 6.2, x0 = p.a === "l" ? p.x : p.x - w, y0 = p.y - 6, y1 = p.y + 6;
    const turn = (x, y) => [scale * (x * c - y * s), scale * (x * s + y * c)];
    const [ax, ay] = turn(x0, y0), [bx, by] = turn(x0 + w, y1);
    out.push({ text: p.t, x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by), th: tilt });
  }
  return out;
}

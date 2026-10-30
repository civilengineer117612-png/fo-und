// A privacy-safe LAYOUT REPORT of a PDF payslip (owner, Oct 29): when the reader cannot read a real payslip, the owner can copy a skeleton of its text and paste
// it to the build agent. Every digit becomes 9 and every word that is not in the heading list below becomes x's of the same length, so no real figure, name,
// employer, account number or date leaves the phone. Positions (x and y of each piece of text, rounded) and the line structure are kept, because they are
// what the reader works from. Pure; nothing is stored or sent.

// The headings and labels the app itself knows (lower case, letters only). A word is kept ONLY when it is on this list.
export const KNOWN_WORDS = new Set((
  "payslip pay slip gross net deductions deduction earnings earning pre tax taxes after hours amount description summary current accruals absences distribution " +
  "deposit cheque check bank name account type direct other information value ytd total basic salary rate regular overtime allowance non taxable retro period " +
  "basis date begin end payment employer employee full annual monthly bi week semi message and of page pto leave sss philhealth pag ibig hdmf pagibig loan loans " +
  "advance advances lates undertime late rice subsidy transportation clothing skills thirteenth month bonus withholding contribution premium cont sick vacation " +
  "holiday night differential days day number no id paid unpaid statement to from for the"
).split(/\s+/));

// One piece of text with its digits and unknown words hidden. Letters of any script that are not a known word become x; every digit becomes 9;
// punctuation, spaces and the currency sign stay, so the shape of an amount (12,345.67 -> 99,999.99) is still visible.
export function maskText(text) {
  return String(text ?? "").replace(/\p{Nd}/gu, "9").replace(/\p{L}+/gu, (w) => (/^[A-Za-z]+$/.test(w) && KNOWN_WORDS.has(w.toLowerCase()) ? w : "x".repeat([...w].length)));
}

// pages: [[{x, y, w?, str}]] (the pieces of text on each page, as the PDF reader gives them). Returns [{page, rows: [{y, items: [{x, w, text}]}]}], top row first.
export function maskedLayout(pages) {
  return (pages ?? []).map((items, i) => {
    const rows = new Map();
    for (const it of items ?? []) {
      if (typeof it?.str !== "string" || !it.str.trim() || !Number.isFinite(it.x) || !Number.isFinite(it.y)) continue;
      const y = Math.round(it.y), row = rows.get(y) ?? [];
      row.push({ x: Math.round(it.x), w: Number.isFinite(it.w) ? Math.round(it.w) : 0, text: maskText(it.str.trim()) });
      rows.set(y, row);
    }
    return { page: i + 1, rows: [...rows].sort((a, b) => b[0] - a[0]).map(([y, list]) => ({ y, items: list.sort((a, b) => a.x - b.x) })) };
  });
}

// The text to copy: one line per row, "y: x/width text; x/width text". Plain text, nothing else.
export function layoutReport(pages) {
  const out = ["LAYOUT REPORT (every digit is 9; every word not in the app's heading list is x)"];
  for (const p of maskedLayout(pages)) {
    out.push("", "Page " + p.page);
    for (const r of p.rows) out.push(r.y + ": " + r.items.map((i) => `${i.x}/${i.w} ${i.text}`).join("; "));
  }
  return out.join("\n");
}

// Section HEADINGS on a read payslip (owner, Nov 7; the photo reader on Safari's engine once garbled "DEDUCTIONS" into "Dithr' ou", and the lines under it could land in the
// wrong section without a word). Two guards, both here:
//  1. A heading is matched to a KNOWN heading word or phrase only, never an amount and never a line's label, and only within an allowed difference of
//     min(2, one third of the word's letters, rounded down): a 3, 4 or 5 letter heading may differ by 1 letter, a 6 letter one or longer by 2. So "TAX" does not become "BOX".
//  2. A line that LOOKS like a heading but matches none is an unreadable heading; the reader then says "Check this: section headings unclear" when a line was placed by it,
//     and the payslip is saved as a draft (src/model/scan.js, income.js).
export const SECTIONS_UNCLEAR = "Check this: section headings unclear";

// The known headings for the fuzzy match, as printed words. (The exact patterns in scan.js are tried first and stay as they were.)
export const HEADING_VOCAB = [
  ["earning", "earnings"], ["earning", "income"], ["earning", "gross earnings"], ["earning", "hours and earnings"],
  ["deduction", "deductions"], ["deduction", "pre tax deductions"], ["deduction", "after tax deductions"], ["deduction", "tax deductions"],
  ["employer", "employer share"], ["employer", "employers share"], ["employer", "employer contributions"],
];
// The titles of a payroll TABLE (a PDF or a photo of one) and the part of it each opens.
export const TABLE_VOCAB = [
  ["earning", "hours and earnings"], ["pre-tax", "pre tax deductions"], ["taxes", "tax deductions"], ["deductions", "after tax deductions"],
  ["employer", "employer share"], ["employer", "employers share"], ["employer", "employer contributions"],
];

const letters = (s) => String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");
export const allowedDifference = (word) => Math.min(2, Math.floor(letters(word).length / 3));

// The number of single-letter changes (insert, delete, change) from a to b.
export function editDistance(a, b) {
  const m = a.length, n = b.length; let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

// Could this text be a heading at all? No digit (so no amount and no date), a few words, enough letters. A line with a figure on it is a line, never a heading.
export const headingShaped = (text) => {
  const t = String(text ?? "").trim();
  return t.length > 0 && t.length <= 40 && !/\d/.test(t) && t.split(/\s+/).length <= 5 && letters(t).length >= 3;
};

// The heading it is, or null. {section, word, distance}. Nothing is guessed: two different sections equally close is null.
export function matchHeading(text, vocab = HEADING_VOCAB) {
  if (!headingShaped(text)) return null;
  const typed = letters(text); let best = null, tie = false;
  for (const [section, word] of vocab) {
    const w = letters(word), d = editDistance(typed, w);
    if (d > allowedDifference(word)) continue;
    if (!best || d < best.distance) { best = { section, word, distance: d }; tie = false; }
    else if (d === best.distance && section !== best.section) tie = true;
  }
  return best && !tie ? best : null;
}

// A heading-shaped line that no known heading explains, and that looks like a printed heading that was read badly: it has marks no heading has, or it is mostly capitals.
// (A plain word line such as "Overtime" or "Hot meal" is a label, not a heading.) The caller leaves out the lines it knows are labels or titles.
export function unreadableHeading(text, vocab = HEADING_VOCAB) {
  const t = String(text ?? "").trim(), L = t.replace(/[^A-Za-z]/g, "");
  // The shape is looser than for a match: the reader often turns a letter into a digit ("Deduct1ons"), so up to two digits are allowed, but never a printed figure.
  if (!t || t.length > 40 || t.split(/\s+/).length > 5 || L.length < 4 || (t.match(/\d/g) ?? []).length > 2 || /\d[\d,]*\.\d{2}/.test(t) || matchHeading(t, vocab)) return false;
  const odd = /[^A-Za-z \-&/]/.test(t), upper = L.length >= 4 && (L.match(/[A-Z]/g) ?? []).length >= L.length * 0.7;
  return odd || upper;
}

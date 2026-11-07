import { test } from "node:test";
import assert from "node:assert/strict";
import { matchHeading, unreadableHeading, allowedDifference, editDistance, headingShaped, HEADING_VOCAB, TABLE_VOCAB } from "../src/model/headings.js";

// Guard 1 (owner, Nov 7): a heading matches only a KNOWN heading word, only within min(2, one third of its letters rounded down) different, never an amount, never a label.
test("the allowed difference is min(2, one third of the letters, rounded down)", () => {
  assert.deepEqual(["tax", "less", "net", "income", "earnings", "hours and earnings", "pre tax deductions"].map(allowedDifference), [1, 1, 1, 2, 2, 2, 2]);
  assert.equal(allowedDifference("ab"), 0, "a 2 letter word must match exactly");
  assert.equal(allowedDifference("Pre-Tax"), 2, "only letters count");
  assert.equal(editDistance("tax", "tex"), 1); assert.equal(editDistance("tax", "box"), 2); assert.equal(editDistance("", "abc"), 3); assert.equal(editDistance("kitten", "sitting"), 3);
});

test("long headings: one or two letters wrong still read; three wrong do not", () => {
  for (const [typed, section] of [["DEDUCTIONS", "deduction"], ["Deductons", "deduction"], ["Dedxctons", "deduction"], ["EARNLNGS", "earning"], ["Earnngs", "earning"], ["Pre-Tax Deductons", "deduction"], ["Employer Shre", "employer"], ["INCOME", "earning"]]) {
    assert.equal(matchHeading(typed)?.section, section, typed);
  }
  for (const typed of ["Dedxctxns", "Earxxxgs", "Dithr' ou", "Deductions and fees", "Overtime", "Basic Salary", "Net Pay", "Withholding Tax"]) assert.equal(matchHeading(typed), null, typed + " is no heading");
});

test("short headings: one letter off reads, two off does NOT, and a 3 letter heading never becomes a different word", () => {
  const V = [["tax", "tax"], ["net", "net"], ["less", "less"]];
  assert.equal(matchHeading("TAX", V).distance, 0); assert.equal(matchHeading("Tex", V)?.section, "tax", "one letter");
  assert.equal(matchHeading("Taz", V)?.section, "tax");
  assert.equal(matchHeading("BOX", V), null, "TAX is not BOX: two letters differ");
  assert.equal(matchHeading("TEA", V), null, "TAX is not TEA: two letters differ");
  assert.equal(matchHeading("TAB", V)?.section, "tax", "one letter off is still read (that is the rule)");
  assert.equal(matchHeading("NIP", V), null, "NET vs NIP: two letters"); assert.equal(matchHeading("NUT", V)?.section, "net", "NET vs NUT: one letter, read"); assert.equal(matchHeading("LOSE", V)?.section ?? "none", "none", "LESS vs LOSE is two letters: not read");
  assert.equal(matchHeading("Loss", V)?.section, "less", "one letter off a 4 letter word");
  assert.equal(matchHeading("t", V), null); assert.equal(matchHeading("ta", V), null, "fewer than 3 letters is never a heading");
});

test("never an amount, a date or a line's label: a line with a figure is not heading-shaped, and a long line is not either", () => {
  for (const t of ["Earnings 1,500.00", "DEDUCTIONS 300.00", "Earnings 15", "Oct 15, 2026", "Pay date: Oct 15, 2026", "PHP 100.00", "Income 2026"]) { assert.equal(headingShaped(t), false, t); assert.equal(matchHeading(t), null, t); }
  assert.equal(headingShaped("Earnings and deductions of the whole month of October for the employee"), false);
  assert.equal(headingShaped("A"), false); assert.equal(headingShaped("Earningsearningsearningsearningsearningsx"), false, "longer than 40 characters is not a heading"); assert.equal(headingShaped("Earnings"), true);
  assert.equal(matchHeading("Basic Salary"), null); assert.equal(matchHeading("Holiday Pay"), null);
});

test("two different sections equally close: nothing is guessed", () => {
  const V = [["a", "tax"], ["b", "tab"]];
  assert.equal(matchHeading("tae", V), null);
  assert.equal(matchHeading("tax", V)?.section, "a", "an exact word wins");
  assert.equal(matchHeading("Tax Deductions", TABLE_VOCAB)?.section, "taxes");
  assert.equal(matchHeading("After Tax Deductons", TABLE_VOCAB)?.section, "deductions", "After and Pre are four letters apart: never confused");
  assert.equal(matchHeading("Pre-Tax Dedxctons", TABLE_VOCAB)?.section, "pre-tax");
  assert.ok(HEADING_VOCAB.length >= 10);
});

// Guard 2's helper: a heading-shaped line that no known heading explains and that looks like a badly read heading.
test("an unreadable heading is a heading-shaped line with odd marks or mostly capitals that no known heading explains; a plain label is not one", () => {
  assert.equal(unreadableHeading("Dithr' ou"), true); assert.equal(unreadableHeading("Paypoct，，"), true); assert.equal(unreadableHeading("XQZVWK PLNTS"), true);
  assert.equal(unreadableHeading("Deduct1ons"), true, "a letter read as a digit is still a heading read badly"); assert.equal(unreadableHeading("DEDUCT10NS"), true);
  for (const t of ["Overtime", "Hot meal", "Holiday pay", "DEDUCTIONS", "Dedxctons", "Basic Salary 9,000.00", "Pay date 2026", "ab", "Earnings 1,500.00"]) assert.equal(unreadableHeading(t), false, t);
});

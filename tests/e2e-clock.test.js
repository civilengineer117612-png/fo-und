import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// Found Nov 1, 2026 (Manila): the e2e "Goals in the flat look" block took today's date from the REAL clock while every page runs at the fixed test
// date (T0, Oct 3). The seeded budgets started on the 1st of the real month, so on Nov 1 they started AFTER the page's own today and four checks failed
// for every pull request. Dates the e2e scripts make in Node must come from the test clock (T0) or be fixed; only code run inside the page may ask Date.
test("no e2e script makes a date from the real clock outside the page", () => {
  const dir = new URL("../e2e/", import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".mjs"))) {
    readFileSync(new URL(f, dir), "utf8").split("\n").forEach((line, i) => {
      if (/new Date\(\)|new Date\(Date\.now\(\)|Date\.now\(\)\s*[+-]\s*\d+\s*\*/.test(line) && !/evaluate\(/.test(line))
        assert.fail(`e2e/${f}:${i + 1} makes a date from the real clock; use the test clock (T0) or a fixed date`);
    });
  }
});

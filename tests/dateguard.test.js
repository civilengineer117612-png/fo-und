// DATE GUARD (owner, Nov 12, L9). The unit tests are run again as if today were other days (tools/test-dates.mjs, `npm run test:dates`, a CI step),
// so a test that passes only this year or this month fails now. These tests keep the guard itself honest.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { DAYS } from "../tools/test-dates.mjs";

const here = (p) => new URL(p, import.meta.url);
test("the guard's days cover the end of a year, a leap day, a month's first minute and a later year", () => {
  const manila = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new (globalThis.RealDate ?? Date)(iso));
  const days = DAYS.map(manila);
  assert.ok(days.some((d) => d.startsWith("2026-12-31, 23:59")), "the last minute of the year in Manila");
  assert.ok(days.some((d) => d.startsWith("2027-01-01, 00:01")), "the first minute of the next year in Manila");
  assert.ok(days.some((d) => d.startsWith("2028-02-29")), "a leap day");
  assert.ok(days.some((d) => /-01, 00:01$/.test(d) && !d.startsWith("2027-01")), "the first minute of a month");
  assert.ok(days.some((d) => Number(d.slice(0, 4)) >= 2030), "a later year");
});

test("the fixed clock moves today, and only today", () => {
  const run = (code, env = {}) => execFileSync(process.execPath, ["--import", here("./helpers/fixed-clock.mjs").href, "-e", code], { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "", ...env } }).trim();
  const AT = "2028-02-29T03:00:00.000Z";
  assert.equal(run("console.log(new Date().toISOString(), new Date(Date.now()).toISOString())", { TEST_NOW: AT }), AT + " " + AT);
  assert.equal(run("console.log(new Date(2026, 0, 5).getFullYear(), new Date('2026-03-04T00:00:00Z').toISOString(), Date.UTC(2026, 0, 1), new Date() instanceof Date)", { TEST_NOW: AT }), "2026 2026-03-04T00:00:00.000Z 1767225600000 true");
  assert.equal(run("const a = performance.now(); setTimeout(() => console.log(performance.now() - a >= 15), 20)", { TEST_NOW: AT }), "true", "timers and performance.now keep real time, so a speed test still measures");
  assert.equal(run("console.log(Math.abs(Date.now() - Number(process.env.T)) < 60000, typeof globalThis.RealDate)", { TEST_NOW: "", T: String(Date.now()) }).replace("true undefined", "ok"), globalThis.RealDate ? "false undefined" : "ok", "with no TEST_NOW the preload does nothing");
  assert.throws(() => run("1", { TEST_NOW: "not a date" }));
});

test("the guard runs in CI right after the unit tests, and reaches helper processes", () => {
  const yml = readFileSync(here("../.github/workflows/test.yml"), "utf8"), tool = readFileSync(here("../tools/test-dates.mjs"), "utf8");
  assert.match(yml, /      - run: npm test\n(      #[^\n]*\n)?      - run: npm run test:dates\n/);
  assert.equal(JSON.parse(readFileSync(here("../package.json"), "utf8")).scripts["test:dates"], "node tools/test-dates.mjs");
  assert.ok(tool.includes("NODE_OPTIONS") && tool.includes("--import ./tests/helpers/fixed-clock.mjs") && tool.includes('process.exit(bad ? 1 : 0)'));
});

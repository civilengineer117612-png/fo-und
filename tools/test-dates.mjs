// DATE GUARD (owner, Nov 12, L9): runs the unit tests again as if today were each of these days, so a test that only passes "this year" or "this
// month" fails NOW, not on the day the calendar turns. `npm run test:dates` (also a CI step). Times are Manila midnight edges on purpose.
import { spawnSync } from "node:child_process";
export const DAYS = [
  "2026-12-31T15:59:00Z",   // Dec 31, 11:59 pm in Manila: the last minute of the year
  "2026-12-31T16:01:00Z",   // Jan 1, 12:01 am in Manila
  "2027-03-01T03:00:00Z",   // the day after a short February
  "2028-02-29T03:00:00Z",   // a leap day
  "2027-06-30T16:01:00Z",   // the first minute of a month, mid-year
  "2031-10-05T03:00:00Z",   // years from now
];
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  let bad = 0;
  for (const day of DAYS) {
    const r = spawnSync("npm", ["test"], { encoding: "utf8", env: { ...process.env, TEST_NOW: day, NODE_OPTIONS: ((process.env.NODE_OPTIONS ?? "") + " --import ./tests/helpers/fixed-clock.mjs").trim() }, maxBuffer: 1 << 28 });
    const out = r.stdout + r.stderr, fail = /^# fail (\d+)/m.exec(out)?.[1], pass = /^# pass (\d+)/m.exec(out)?.[1];
    const ok = r.status === 0 && fail === "0";
    console.log(`${ok ? "ok  " : "FAIL"} as if today were ${day}: ${pass ?? "?"} pass, ${fail ?? "?"} fail`);
    if (!ok) { bad++; console.log(out.split("\n").filter((l) => l.startsWith("not ok")).join("\n")); }
  }
  process.exit(bad ? 1 : 0);
}

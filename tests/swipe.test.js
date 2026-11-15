// SWIPE BETWEEN PERIODS (owner, Nov 15, overhaul A2): a swipe exists exactly where period arrows or period tabs exist, steps them the same way,
// never taps what is under the finger, and never starts on a part that scrolls or drags sideways. The behaviour itself is proved in e2e/swipe.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/index.html", import.meta.url), "utf8");

test("a swipe steps exactly what the arrows and the payday tabs step, and the Log day", () => {
  assert.match(app, /scr\.querySelector\(`\[data-action="period-step"\]\[data-step="\$\{dir\}"\], \[data-action="budget-month"\]\[data-step="\$\{dir\}"\]`\)/, "the same arrows, by a real click");
  assert.match(app, /if \(arrow\) return arrow\.disabled \? null : \(\) => arrow\.click\(\);/, "an arrow that is off (at this month) means no swipe");
  assert.match(app, /\[\.\.\.scr\.querySelectorAll\('\[data-action="bv-payday"\]'\)\]/, "the payday tabs, never the Month / Per payday / Per week switch");
  assert.ok(!/bv-view[^\n]*swipeStep|swipeStep[^\n]*bv-view/.test(app), "the view switch is never a swipe");
  assert.match(app, /const t = today\(\), next = M\.addDays\(ui\.dayPick \?\? t, dir\);\s*return next > t \? null/, "Log goes back in days and stops at today");
});

test("a swipe never starts on a window, a box, a sideways row, the Trends line or anything being arranged, and never taps", () => {
  assert.match(app, /const SWIPE_NOT = "\.sheet, #menu, input, textarea, select, \.swipe, svg\.spendline, \.lbstage, \.stage, \.tiles\.arranging, \.sortlist\.arranging, \[data-noswipe\]";/);
  assert.match(app, /suppressClick = true;   \/\/ a swipe never taps/);
  assert.match(css, /#screen \{ touch-action: pan-y pinch-zoom; \}/, "the page still scrolls up and down and still zooms");
  assert.match(css, /#screen\.swiping :is\(button, [^)]+\):active \{ transform: none; background: inherit; filter: none; \}/, "nothing looks pressed during a swipe");
});

test("motion: the next period slides in with the move token; Reduce Motion shows it at once", () => {
  assert.match(css, /#screen\.swipe-next \{ animation: swipenext var\(--t-move\) var\(--ease-out\); \}/);
  assert.match(css, /#screen\.swipe-next, #screen\.swipe-prev, #scrim\.enter/, "in the one Reduce Motion rule");
  assert.match(app, /const swipeReduced = \(\) => window\.matchMedia\?\.\("\(prefers-reduced-motion: reduce\)"\)\.matches;/, "the screen does not follow the finger under Reduce Motion");
});

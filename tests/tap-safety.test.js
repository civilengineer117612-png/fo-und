// TAP SAFETY (owner, Nov 1): Safari's engine loses a tap when the button under the finger is replaced, removed or moved between the press and the
// release. The app never redraws under a finger, writes a button's text or a part with buttons only when it changes, and every e2e script holds each
// click like a finger and fails if the tapped button changed under it. These lines keep that wiring in place.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
const engine = readFileSync(new URL("../e2e/engine.mjs", import.meta.url), "utf8");
const body = (name) => { const s = app.indexOf("function " + name + "() {"); return app.slice(s, app.indexOf("\n", app.indexOf("{", s) + 1) + 200); };

test("the redraws wait while a finger is down on something that waits for its click (a hold gesture is not held back)", () => {
  assert.match(app, /const holdingTap = \(\) => fingerDown && !suppressClick;/);
  for (const name of ["renderAll", "renderScreen", "renderSheet"]) assert.match(body(name), new RegExp("if \\(holdingTap\\(\\)\\) \\{ afterTap\\(" + name + "\\); return; \\}"), name + " must wait for the tap");
  assert.match(app, /document\.addEventListener\("pointerup", fingerUp, true\); document\.addEventListener\("pointercancel", fingerUp, true\);/);
});

test("parts that hold a button are rebuilt only when they change", () => {
  assert.match(app, /const setHtml = \(el, html\) => \{ if \(el && lastHtml\.get\(el\) !== html\) \{ el\.innerHTML = html; lastHtml\.set\(el, html\); \} \};/);
  assert.match(app, /setHtml\(box, \(less \? `<button data-action="count-paid"/, "I paid the card");
  assert.match(app, /afterTap\(\(\) => \{ const l = \$\("entries-list"\); if \(l\) setHtml\(l, entriesListHtml\(\)\); \}\)/, "the search list");
  assert.match(app, /setText\(te, peso\(t\.gross\)\); setText\(td, peso\(t\.deductions\)\);/, "the payslip totals in the fold headers");
});

test("every e2e click holds like a finger, and a tapped button that changed under it fails the script", () => {
  assert.match(engine, /export const TAP_HOLD_MS = 80, TAP_MAX_MS = 300;/);
  assert.match(engine, /if \(performance\.now\(\) - d\.t0 > MAX\) return;   \/\/ a hold gesture, not a tap/);
  assert.match(engine, /proto\.click = function \(selector, options = \{\}\) \{ return click\.call\(this, selector, \{ delay: TAP_HOLD_MS, \.\.\.options \}\); \};/);
  assert.match(engine, /if \(tapSafety\.size\) \{ console\.log\("  FAIL tap-safety: "/);
  assert.match(engine, /process\.exitCode = 1;/);
});

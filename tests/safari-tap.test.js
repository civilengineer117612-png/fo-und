// Safari's engine drops a tap when the inside of the pressed button is replaced between the press and the release. Proved on WebKit (Nov 1, P0): leaving
// the last box of the payslip window re-ran the refresh, which rewrote the Save button's text, and Save did nothing (no save, no message).
// So the refresh writes a button's text only through setText, which leaves it alone when it is already right.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");

test("a Save button's text is written only when it changes (setText), never rewritten on every refresh", () => {
  assert.match(app, /const setText = \(el, text\) => \{ if \(el && el\.textContent !== text\) el\.textContent = text; \};/);
  const start = app.indexOf("function refreshSave() {"), body = app.slice(start, app.indexOf("\n}\n", start));
  const direct = body.split("\n").filter((l) => /\bbtn\.(?:textContent|innerHTML|innerText)\s*=[^=]/.test(l));
  assert.deepEqual(direct, [], "inside refreshSave, write the Save button's text with setText(btn, ...)");
});

test("the refresh that runs when a box loses focus touches the Save button only through setText", () => {
  const start = app.indexOf("function refreshSave() {"), end = app.indexOf("\n}\n", start);
  const body = app.slice(start, end);
  assert.ok(start > 0 && body.includes("setText(btn"), "refreshSave uses setText");
  assert.ok(!/\$\("f-save"\)\.(?:textContent|innerHTML)\s*=/.test(app), "no direct write to the Save button anywhere");
});

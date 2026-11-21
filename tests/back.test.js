// L13 (owner, Nov 21): Back closes the open window, not the app. The behaviour is proved on an Android-size phone in e2e/android.mjs; these
// pin the two rules that keep the app's own history step from doing harm: the browser never restores a scroll position on it (a quiet step back
// threw a tapped button 2,000 px away, run.mjs 5n, 1 run in 3), and only one quiet step back is ever on its way (two left the app).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");

test("the app's own history step never moves the page", () => {
  assert.match(app, /if \("scrollRestoration" in history\) history\.scrollRestoration = "manual";/);
});
test("one quiet step back at a time, and Back closes the top layer the way a tap outside does", () => {
  const fn = app.slice(app.indexOf("function syncBack() {"), app.indexOf("let backQueued"));
  assert.match(fn, /if \(backSkip > 0\) return;/, "nothing more while a quiet step back is on its way");
  assert.match(fn, /history\.pushState\(\{ foLayer: 1 \}, ""\)/);
  const pressed = app.slice(app.indexOf("function backPressed() {"), app.indexOf("window.addEventListener(\"popstate\""));
  assert.match(pressed, /\$\("scrim"\)\?\.click\(\)/, "a window closes through its scrim, so typed text asks first");
  assert.match(pressed, /warn-cancel/, "a warning takes its quiet answer");
});

// ANDROID READY (owner, Nov 21: friends install from Chrome on Android, no APK): what the app SAYS works on any phone. No text the app can show
// names one brand of phone, its browser or its face unlock: "this phone", "your phone's files app", "face or fingerprint". Code comments may name
// the engine a fix was found on (Safari's WebKit); the What's new history keeps its true past lines ("Fixed: on the iPhone ...").
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { QUICK_NOTES, FIRST_RUN_NOTICE, HELP_TOPICS, CHANGES } from "../src/model/index.js";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const BRAND = /\biPhone\b|\bFace ID\b|\bSafari\b|\biOS\b|\bAndroid\b|the Files app/;
// The text a file can show: its string literals, with comments taken out first (a `//` after a space or at the start of a line, and /* ... */).
const shown = (src) => {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/(^|\s)\/\/.*$/, "")).join("\n");
  return [...code.matchAll(/"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1] ?? m[2]);
};

test("Help, the first-run notice and every topic speak of this phone, never one brand", () => {
  for (const line of [...QUICK_NOTES, FIRST_RUN_NOTICE.title, ...FIRST_RUN_NOTICE.lines, ...HELP_TOPICS.flatMap((t) => t.lines)]) assert.doesNotMatch(line, BRAND, line);
});

test("no string the app can show names one brand of phone (screens, the lock, reminders, the device check)", () => {
  for (const file of ["app/app.js", "app/lock.js", "app/voice.js", "app/ocr.js", "src/model/device.js", "src/model/reminders.js", "src/model/applock.js", "src/model/firstrun.js", "src/model/intros.js", "src/model/howto.js", "src/model/help.js"]) {
    const bad = shown(read(file)).filter((s) => BRAND.test(s));
    assert.deepEqual(bad, [], file);
  }
});

test("a new What's new line is device-neutral too (the older ones stay as they were)", () => {
  const i = CHANGES.findIndex((c) => c.id === "2026-11-21-android");
  assert.ok(i >= 0, "the Android-ready line is in the list");
  for (const c of CHANGES.slice(0, i + 1)) assert.doesNotMatch(c.text, BRAND, c.text);
});

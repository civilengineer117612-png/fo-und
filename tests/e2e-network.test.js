// NOTHING LEAVES THE TEST MACHINE (owner, Nov 12, L12): every window an e2e script opens stops requests to the outside unless the script plays the
// service itself. e2e/network.mjs proves it in a browser; these tests keep the rule in the engine and every script on the engine.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const engine = read("e2e/engine.mjs");

test("the engine stops outside requests in every window it makes, before anything else is added", () => {
  const wrap = engine.slice(engine.indexOf("browser.newContext = async"), engine.indexOf("return browser;"));
  assert.match(wrap, /const context = await make\(\.\.\.args\);\n\s+await blockOutside\(context\);/, "the rule is the first thing a new window gets, so a script's own route (added later) is asked first");
  assert.match(engine, /const blockOutside = \(context\) => context\.route\(\(url\) => isOutside\(url\.href\), \(route\) => \{[^\n]*return route\.abort\(\); \}\);/);
  assert.ok(!/route\.continue\(\)|route\.fetch\(\)/.test(engine), "the engine never lets a request through to the internet");
});

test("what counts as outside", async () => {
  const src = /const LOCAL = [^\n]+\nexport const isOutside = [^\n]+/.exec(engine)[0].replace("export const", "const");
  const isOutside = new Function(src + "\nreturn isOutside;")();
  for (const u of ["https://icon.horse/icon/a.com", "http://example.com", "https://localhost.example.com/", "wss://example.com/x", "http://10.0.0.5/", "https://127.0.0.1.example.org/"]) assert.equal(isOutside(u), true, u);
  for (const u of ["http://localhost:8124/app/index.html", "http://127.0.0.1:8125/", "http://[::1]:8124/", "data:text/plain,hi", "blob:http://localhost:8124/abc", "about:blank", "not a url"]) assert.equal(isOutside(u), false, u);
});

test("no script opens a window around the engine, and none lets an outside request through", () => {
  for (const f of readdirSync(new URL("../e2e/", import.meta.url)).filter((n) => n.endsWith(".mjs") && n !== "engine.mjs")) {
    const s = read("e2e/" + f);
    assert.ok(!/\b(chromium|webkit|firefox)\.launch(PersistentContext)?\(/.test(s), f + " gets its browser from the engine");
    // a script's own catch-all route may pass on only what is on the served app's own origin
    for (const m of s.matchAll(/\.route\("\*\*\/\*", ([^\n]*)/g)) assert.ok(/origin === new URL\(base\)\.origin \? r(oute)?\.continue\(\) : r(oute)?\.abort\(\)/.test(m[1]) || /return route\.abort\(\); \}\);|route\.abort\(\)/.test(s.slice(m.index, m.index + 2500)), f + ": a catch-all route ends in abort for the outside");
  }
});

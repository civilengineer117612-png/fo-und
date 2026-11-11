import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// docs/UI.md (owner, Nov 11, P1-9): an action is always a button. An underlined text link may appear only inside Help.
const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8"), css = readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
const helpStart = app.indexOf("function viewHelp("), helpEnd = app.indexOf("\nfunction ", helpStart + 10);

test("no action is a bare text link outside Help", () => {
  assert.ok(helpStart > 0 && helpEnd > helpStart, "the Help screen is found");
  const outside = app.slice(0, helpStart) + app.slice(helpEnd);
  // PENDING (owner, Nov 11): the Setup account row is not approved in its new form yet, so its old link buttons stay; they are the only ones allowed.
  const PENDING = ["edit-last4", "remove-account", "hide-account"];
  const links = [...outside.matchAll(/<button class="link[ "][^>]*data-action="([^"]+)"[^>]*>/g)].filter((m) => !PENDING.includes(m[1])).map((m) => m[0].slice(0, 90));
  assert.deepEqual(links, [], "every action outside Help is a button (class act or a plain button), never class link");
  assert.doesNotMatch(outside, /<a\s[^>]*href=/, "no anchor is used as an action outside Help");
  assert.match(css, /button\.act \{[^}]*border: 1px solid var\(--line\)[^}]*text-decoration: none/, "an action button is outlined and not underlined");
  assert.doesNotMatch(css.slice(css.indexOf("button.act {")), /button\.act[^{]*\{[^}]*text-decoration: underline/, "nothing underlines an action button again");
});

test("the Setup account row is the old one until the owner approves a new design", () => {
  assert.doesNotMatch(app, /acct-more/, "no account window yet");
  const row = app.slice(app.indexOf("const rows = orderedAccts("), app.indexOf("const rows = orderedAccts(") + 2600);
  for (const a of ["edit-last4", "remove-account", "hide-account"]) assert.ok(row.includes(`data-action="${a}"`), a + " is still on the row");
});

test("the rendered audit (e2e/ui-audit.mjs) checks both rules on every screen, in light and dark, and runs in both browser jobs", () => {
  const audit = readFileSync(new URL("../e2e/ui-audit.mjs", import.meta.url), "utf8");
  assert.match(audit, /button\.link, a\[href\]/, "rule A looks for link-styled actions");
  assert.match(audit, /textDecorationLine\.includes\("underline"\)/, "rule A also finds an underlined tappable thing of any class");
  assert.match(audit, /querySelectorAll\("button\.primary"\)/);
  assert.match(audit, /filled\.length <= 1/, "rule B: at most one filled main button");
  assert.match(audit, /for \(const scheme of \["light", "dark"\]\)/);
  assert.ok((audit.match(/^  \[?"/gm) ?? []).length > 20 || (audit.match(/\["[A-Z][^"]*", \[/g) ?? []).length >= 25, "the screen list covers the whole app");
  for (const f of [".github/workflows/test.yml", ".github/workflows/webkit.yml"]) assert.match(readFileSync(new URL("../" + f, import.meta.url), "utf8"), /ui-audit/, f + " runs it");
  assert.match(css, /\.modebar button \{ display: inline-flex;[^}]*text-decoration: none/, "the list and chart switch is an icon with no underline");
  assert.ok(app.includes("ui.asList ? CHARTICO : LISTICO"), "and it draws a picture, not the word List");
});

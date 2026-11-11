import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// docs/UI.md (owner, Nov 11, P1-9): an action is always a button. An underlined text link may appear only inside Help.
const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8"), css = readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
const helpStart = app.indexOf("function viewHelp("), helpEnd = app.indexOf("\nfunction ", helpStart + 10);

test("no action is a bare text link outside Help", () => {
  assert.ok(helpStart > 0 && helpEnd > helpStart, "the Help screen is found");
  const outside = app.slice(0, helpStart) + app.slice(helpEnd);
  const links = [...outside.matchAll(/class="link[ "][^>]*>/g)].map((m) => m[0].slice(0, 90));
  assert.deepEqual(links, [], "every action outside Help is a button (class act or a plain button), never class link");
  assert.doesNotMatch(outside, /<a\s[^>]*href=/, "no anchor is used as an action outside Help");
  assert.match(css, /button\.act \{[^}]*border: 1px solid var\(--line\)[^}]*text-decoration: none/, "an action button is outlined and not underlined");
  assert.doesNotMatch(css.slice(css.indexOf("button.act {")), /button\.act[^{]*\{[^}]*text-decoration: underline/, "nothing underlines an action button again");
});

test("a row with several actions has ONE More button, not scattered ones (Setup accounts)", () => {
  assert.match(app, /data-action="acct-more"/);
  const row = app.slice(app.indexOf("const rows = orderedAccts("), app.indexOf("const rows = orderedAccts(") + 2600);
  for (const a of ["edit-last4", "remove-account", "hide-account"]) assert.ok(!row.includes(`data-action="${a}"`), a + " is inside the More window, not on the row");
});

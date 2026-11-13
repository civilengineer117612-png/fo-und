import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// F2 (overhaul, Nov 13): ONE pressed look. Every :active rule darkens the surface (the line colour, or a filled surface's brightness at 92%);
// nothing shrinks, fades or moves under a finger (a moving button also loses taps on Safari's engine, see TAP SAFETY).
const css = readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
const rules = [...css.matchAll(/([^{}]*:active[^{}]*)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2].trim() }));

test("F2: every pressed rule darkens the surface, the one way", () => {
  assert.ok(rules.length >= 20, "the pressed rules are found (" + rules.length + ")");
  for (const r of rules) assert.ok(/^background: var\(--line\);$/.test(r.body) || /^(background: var\(--(ink|accent)\); )?filter: brightness\(\.92\);$/.test(r.body) || /^background: var\(--line\); box-shadow: /.test(r.body),
    "one pressed look: " + r.sel + " { " + r.body + " }");
});
test("F2: nothing shrinks, fades or moves when pressed", () => {
  for (const r of rules) assert.doesNotMatch(r.body, /transform|opacity|scale|translate/, r.sel + " { " + r.body + " }");
});

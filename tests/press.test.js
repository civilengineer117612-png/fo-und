import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// F2 (overhaul, Nov 13): ONE pressed look. Every :active rule darkens the surface (the line colour, or a filled surface's brightness at 92%).
// ONE PRESS (owner, Nov 15, felt on his iPhone): the darken now comes with ONE slight shrink (0.97) for every button and tile, quick on touch and
// eased back; while pressed an invisible 8 px margin keeps the touched area (a finger at the edge still lands its tap); Reduce Motion takes the
// shrink away; a pressed row in a rounded card is rounded; Safari's tap highlight is off for the whole page. Before Nov 15 this file said
// "nothing shrinks, fades or moves when pressed"; the owner changed that rule.
const css = readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
const rules = [...css.matchAll(/([^{}]*:active[^{}]*)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2].trim() }));

test("F2: every pressed rule darkens the surface, the one way", () => {
  assert.ok(rules.length >= 20, "the pressed rules are found (" + rules.length + ")");
  const PRESS = ':is(button, .tile, .gcard, .row.tapcard, .swcard[data-action], [role="button"])';
  const onePress = (r) => (r.sel === PRESS + ":active" && r.body === "transform: scale(.97); transition-duration: var(--t-touch);")
    || (r.sel === PRESS + ":active::before" && r.body === 'content: ""; position: absolute; inset: -8px;')
    || (r.sel.endsWith(PRESS + ":active") && r.body === "transform: none !important;")
    || (/^\.catcard button\.catrow:active, \.setlist \.setrow:active, /.test(r.sel) && r.body === "border-radius: 10px;");
  for (const r of rules) assert.ok(onePress(r) || /^background: var\(--line\);$/.test(r.body) || /^(background: var\(--(ink|accent)\); )?filter: brightness\(\.92\);$/.test(r.body) || /^background: var\(--line\); box-shadow: /.test(r.body),
    "one pressed look: " + r.sel + " { " + r.body + " }");
});
test("ONE PRESS: the only thing that moves when pressed is the one shrink of 0.97, for every button and tile; nothing fades or slides", () => {
  const moving = rules.filter((r) => /transform|opacity|scale|translate/.test(r.body));
  assert.deepEqual(moving.map((r) => r.body), ["transform: scale(.97); transition-duration: var(--t-touch);", "transform: none !important;"], "one shrink, and Reduce Motion taking it away");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ :is\(button, \.tile, \.gcard, \.row\.tapcard, \.swcard\[data-action\], \[role="button"\]\):active \{ transform: none !important; \} \}/, "Reduce Motion: darken only");
  assert.match(css, /--t-touch: \.07s;/, "quick on touch: 70 ms");
  assert.ok(rules.some((r) => r.sel.endsWith(":active::before") && r.body === 'content: ""; position: absolute; inset: -8px;'), "while pressed, an invisible 8 px margin keeps the area that was touched (e2e/tap-safety.mjs taps at the very edge)");
  assert.match(css, /html \{ -webkit-tap-highlight-color: transparent; \}/, "Safari's tap highlight is off for the whole page (it is inherited), not only on buttons");
  assert.match(css, /:where\(button, \.tile, \.gcard, \.row\.tapcard, \.swcard\[data-action\], \[role="button"\]\) \{ position: relative; transition: transform var\(--t-move\) var\(--ease-out\)/, "eased back on release; the margin is placed on the button itself (a class that places a button elsewhere still wins)");
});

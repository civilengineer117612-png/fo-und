// FEEL (owner, Nov 12, overhaul F1, F6, F7): a press shows within 100 ms, anything that moves takes 200 ms (the brief allows 150 to 250),
// the page does not rubber-band at its ends, there is no double-tap zoom, and Reduce Motion stops every slide, fade and ease.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>") + 8);
const seconds = (t) => (t.endsWith("ms") ? Number(t.slice(0, -2)) / 1000 : Number(t.slice(0, -1)));

test("two motion tokens: press 100 ms, move 200 ms", () => {
  assert.match(css, /--t-press: \.1s; --t-move: \.2s; --ease-out: cubic-bezier\(\.2,\.8,\.2,1\);/);
});

test("every transition and every one-shot animation uses a token, so no motion is slower than 250 ms or a press slower than 100 ms", () => {
  const bad = [];
  for (const m of css.matchAll(/transition:\s*([^;}]+)[;}]/g)) {
    const v = m[1].trim();
    if (v === "none" || v === "" ) continue;
    for (const t of v.match(/(?<![\w-])\d*\.?\d+m?s\b/g) ?? []) bad.push("transition " + v + " (" + t + ")");
  }
  for (const m of css.matchAll(/animation:\s*([\w-]+)\s+([^;}]+)[;}]/g)) {
    const [name, rest] = [m[1], m[2]];
    if (name === "none" || /infinite/.test(rest)) continue;   // loops (how-to clips, intro drawings, the wave, arranging) have their own Reduce Motion rules
    const t = rest.match(/^\s*(\d*\.?\d+m?s)\b/);
    if (t && !(seconds(t[1]) >= 0.15 && seconds(t[1]) <= 0.25)) bad.push("animation " + name + " " + t[1]);
  }
  assert.deepEqual(bad, []);
  assert.match(css, /button \{ transition: transform var\(--t-press\) ease, background-color var\(--t-press\) ease;/, "a button's pressed look shows within 100 ms");
});

test("no rubber band at the page's ends and no double-tap zoom anywhere", () => {
  assert.match(css, /html \{ -webkit-text-size-adjust: 100%; overflow-x: hidden; overscroll-behavior: none; touch-action: manipulation; \}/);
  assert.match(css, /-webkit-tap-highlight-color: transparent; touch-action: manipulation;/, "buttons keep their own rule too");
});

test("Reduce Motion: every transition is instant and every sliding or fading entrance is off", () => {
  const rm = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce) { *, *::before, *::after"));
  assert.match(rm, /\*, \*::before, \*::after \{ transition-duration: 0s !important; transition-delay: 0s !important; \}/);
  const named = (/\{ \*, [^}]+\}\s*([^{]+)\{ animation: none !important; \}/.exec(rm)?.[1] ?? "").split(",").map((x) => x.trim());
  for (const sel of ["#screen.swap", ".viewbody.fade", ".sheet.enter", ".sheet.center.enter", "#scrim.enter", "#menu .drawer.enter", "#menu .scrim.enter", "#menu.leaving .drawer", "#menu.leaving .scrim", ".chev.up.flip", "#entries-list.drop"]) assert.ok(named.includes(sel), sel);
  // every one-shot animation in the page is either on that list or under its own Reduce Motion rule
  for (const m of css.matchAll(/([^{}]+)\{[^{}]*animation:\s*([\w-]+)\s[^;}]*[;}]/g)) {
    if (/infinite/.test(m[0]) || m[2] === "none" || /@keyframes/.test(m[1])) continue;
    for (const sel of m[1].split(",").map((x) => x.trim()).filter(Boolean)) {
      if (/^\.hw|^\.wl-|^\.in-|^@/.test(sel) || /\.tiles\.arranging/.test(sel)) continue;
      assert.ok(named.includes(sel) || new RegExp("prefers-reduced-motion: reduce\\)[^@]*" + sel.replace(/[.*+?^${}()|[\]\\#]/g, "\\$&")).test(css), "Reduce Motion stops " + sel);
    }
  }
});

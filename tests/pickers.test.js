import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Category, account and "what it looks like" choices are dropdown rows (picker, categoryPicker, accountPicker, kindPicker in app/app.js). These
// checks read the screens' source so a list of chips cannot creep back, and every choice closes its list.
const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
const calls = (name) => app.split("\n").flatMap((l, i) => (l.match(new RegExp("\\b" + name + "\\(", "g")) ?? []).map(() => i + 1));

test("the only list of chips left that is built with chips() is the one-tap tile payment, where choosing the account logs at once", () => {
  const lines = app.split("\n").map((l, i) => [i + 1, l]).filter(([, l]) => /\bchips\(/.test(l) && !/^\s*function chips\(/.test(l));
  assert.equal(lines.length, 1, "other chips() calls: " + lines.map(([n]) => n).join(", "));
  assert.match(lines[0][1], /chips\(accountsFor\(p\.id\), null, "pay"\)/);
});

test("From, To, Take it from, What it is and the second category are dropdown rows, with the right actions", () => {
  assert.ok((app.match(/accountPicker\([^\n]*"pick-from", "from"/g) ?? []).length >= 3, "From in Move money, the scan form and a transfer in Verify");
  assert.ok((app.match(/accountPicker\([^\n]*"pick-to", "to"/g) ?? []).length >= 3, "To in the same three");
  assert.ok((app.match(/<label>Take it from\$\{REQ\}<\/label>\$\{accountPicker\(/g) ?? []).length >= 2, "Take it from (two screens)");
  assert.match(app, /<label>What it is\$\{REQ\}<\/label>\$\{categoryPicker\(incomeCategories\(\)/);
  assert.match(app, /categoryPicker\(incomeCategories\(\), f\.category_id, "cat", "pick-cat", "Choose what it is"\)/);
  assert.match(app, /categoryPicker\(pickCategories\(\)\.filter\(\(c\) => c\.id !== f\.category_id\), f\.split_cat, "split", "pick-split"/);
  assert.match(app, /accountPicker\(accountsFor\(null\)\.filter\(\(a\) => a\.id !== p\.account_id\), ui\.form\.account_id\)/, "where the free part of a payslip goes");
});

test("choosing in any dropdown closes its list", () => {
  for (const action of ["pick-cat", "pick-acct", "pick-kind", "pick-from", "pick-to", "pick-split"]) {
    const line = app.split("\n").find((l) => l.includes(`case "${action}":`));
    assert.ok(line, action);
    assert.ok(line.includes("ui.sheet.pick = null"), action + " closes the list");
  }
  assert.match(app, /case "pick-toggle": if \(ui\.sheet\) \{ ui\.sheet\.pick = ui\.sheet\.pick === el\.dataset\.key \? null : el\.dataset\.key;/);
});

test("a dropdown list of more than 8 choices has a Search box that filters it, and Money received starts with What it is empty", () => {
  assert.match(app, /\$\{all\.length > 8 \? `<div class="picksearchrow">/);
  assert.match(app, /classList\?\.contains\("picksearch"\)/);
  assert.match(app, /type: "income" \}; ui\.form = \{ amount: "", date: today\(\), account_id: accountsFor\(null\)\[0\]\?\.id \?\? null, category_id: null \}/);
  assert.match(app, /btn\.disabled = !\(a\.ok && a\.centavos > 0 && f\.account_id && f\.category_id && f\.date\);/);
});

// THE WINDOW JUMP ON WEBKIT (Nov 16; e2e-webkit red on main since #357, e2e/sheet-scroll.mjs 16 to 18 of 20): opening a dropdown list rebuilt the
// whole window, and Safari's engine then put the new window back at a scroll position it could not hold yet, so a tall window jumped up.
test("opening or closing a list changes only the lists, never rebuilds the window; a rebuilt window that is held short tries once more", () => {
  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
  const toggle = app.slice(app.indexOf('case "pick-toggle":'), app.indexOf("\n", app.indexOf('case "pick-toggle":')));
  assert.ok(toggle.includes("showPickLists()") && !toggle.includes("renderSheet"), "pick-toggle shows or hides the lists in place");
  const fn = app.slice(app.indexOf("function showPickLists() {"), app.indexOf("const byName = (list) =>"));
  assert.ok(fn.includes('row.setAttribute("aria-expanded", String(on))') && fn.includes("list.hidden = !on"), "each row says whether its list is open, and only the chosen one shows");
  assert.ok(fn.includes('q.value = ""') && fn.includes("n.hidden = false"), "a list that opens starts with its search empty and every choice shown, as a rebuilt one did");
  assert.match(app, /if \(box && keepAt && box\.scrollTop < keepAt - 1\) requestAnimationFrame\(\(\) => \{ if \(box\.isConnected && box\.scrollTop < keepAt - 1\) box\.scrollTop = keepAt; \}\);/, "a rebuilt window held short of its place tries once more on the next frame");
});

// A7 (overhaul, owner's yes Nov 16): the Buffer menu screen is folded into Budget's Buffer row. Its window keeps EVERY action the old screen had
// (P7 of the brief: setup and funding are never lost), shows ONE monthly figure (`buffer_monthly`, never an old Pay plan line), and the menu
// entry, its Help topic and its popup are gone. The money rules behind it (src/model/buffer.js) are unchanged and tested in tests/buffer.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as M from "../src/model/index.js";

const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
const win = app.slice(app.indexOf('} else if (sh.type === "buffer-view") {'), app.indexOf('} else if (sh.type === "buffer-monthly") {'));

test("the window holds every action of the old Buffer screen", () => {
  assert.ok(win.length > 500, "found the window");
  for (const a of ["open-bufsetup", "open-bufund", "sweep-buffer", "open-sweep", "open-buffer-monthly"]) assert.ok(win.includes(`"${a}"`), a + " is in the window");
  for (const a of ["open-bufsetup", "save-bufsetup", "open-bufund", "save-bufund", "sweep-buffer", "open-sweep", "save-sweep", "open-buffer-monthly", "save-buffer-monthly", "clear-buffer-monthly"])
    assert.ok(app.includes(`case "${a}":`), a + " still runs");
  assert.match(win, /class="primary" data-action="open-bufsetup"/, "before it is set up: ONE filled button, Set up the buffer");
  assert.match(win, /class="primary" data-action="open-bufund"/, "once set up: ONE filled button, Add to the buffer");
  assert.equal((win.match(/class="primary"/g) ?? []).length, 2, "one filled button in each state, never two");
});

test("one figure: the window and the setup read buffer_monthly; no old Pay plan line is read for the buffer", () => {
  assert.match(win, /const g = gcashOf\(\), bm = ledger\.settings\.buffer_monthly/);
  assert.ok(!win.includes("planOf()"), "the window never reads a Pay plan");
  const setup = app.slice(app.indexOf('case "open-bufsetup": {'), app.indexOf('case "save-bufsetup": {'));
  assert.ok(setup.includes("ledger.settings.buffer_monthly") && !setup.includes("planOf()"), "Set up the buffer starts from the same monthly figure");
});

test("the rows are the app's standard rows, the same as the draws under them (owner's mark, Nov 16)", () => {
  assert.ok(!win.includes('class="gvrow"') && (win.match(/barCard\(/g) ?? []).length >= 3, "barCard rows, not the goal window's own rows");
  assert.match(win, /fig: peso\(d\.amount \|\| d\.pending\)/, "a draw still waiting in Verify shows its own figure, never 0.00");
  assert.ok(win.includes('"Waiting in Verify"') && !win.includes("not verified"), "in the app's own words");
});

test("Budget's Buffer row opens the window; the menu entry, its screen, Help topic and popup are gone", () => {
  assert.ok(app.includes('case "open-buffer": ui.sheet = { type: "buffer-view" }'));
  assert.ok(app.includes('r.kind === "buffer" ? { action: "open-buffer", id: "buffer" }') && app.includes('barCard([{ id: "buffer", action: "open-buffer", name: BUFFER_NAME'), "set or not set, the row opens it");
  assert.ok(!app.includes("function viewBuffer") && !app.includes('ui.tab === "buffer"'), "no Buffer screen is left");
  assert.ok(!M.MENU_GROUPS.some(([, ids]) => ids.includes("buffer")), "not in the menu");
  assert.ok(!M.HELP_TOPICS.some((t) => t.tab === "buffer") && !M.INTROS.buffer, "no Help topic or popup of its own");
  assert.ok(M.HELP_TOPICS.find((t) => t.tab === "budget").lines.some((l) => l.startsWith("The Buffer row opens the buffer")), "Budget's Help says where it went");
  const sweep = app.slice(app.indexOf('case "sweep-buffer": {'), app.indexOf('case "open-trip":'));
  assert.ok(sweep.includes('if (ui.sheet?.type === "buffer-view") { ui.sheet = null; renderSheet(); }'), "a sweep from the window closes it, so nothing stale stays on screen");
});

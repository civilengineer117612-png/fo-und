import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MENU_GROUPS, SCREEN_NAMES, STRIP_NAMES } from "../src/model/names.js";
import { QUICK_NOTES, FIRST_RUN_NOTICE, TOPICS, checklist } from "../src/model/help.js";

const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");

test("the five quick notes are there, in the owner's words", () => {
  assert.equal(QUICK_NOTES.length, 5);
  assert.match(QUICK_NOTES[0], /still being built/);
  assert.match(QUICK_NOTES[1], /only on your phone/);
  assert.match(QUICK_NOTES[2], /Setup, then Backup/); assert.match(QUICK_NOTES[2], /passphrase/); assert.match(QUICK_NOTES[2], /can't be opened/); assert.match(QUICK_NOTES[2], /keep it in Passwords on your phone/);
  assert.match(QUICK_NOTES[3], /Home Screen icon, not a Safari tab/);
  assert.match(QUICK_NOTES[4], /screenshot/); assert.match(QUICK_NOTES[4], /Never send your backup file/);
});

test("every screen in the menu, and the bottom bar, has a help topic (so adding a screen means writing its help)", () => {
  assert.match(app, /const MENU = M\.MENU_GROUPS\.map/, "the menu is built from the shared names");
  const screens = MENU_GROUPS.flatMap(([, ids]) => ids);
  assert.ok(screens.length >= 10, "found the menu screens: " + screens.join());
  const have = new Set(TOPICS.map((t) => t.tab));
  for (const id of [...screens, "setup", "log", "verify", "income"]) assert.ok(have.has(id), "a help topic for " + id);
  for (const t of TOPICS) { assert.ok(t.label && t.lines.length >= 1 && t.lines.every((l) => l.length < 260), t.tab + " is short and has words"); }
  assert.equal(new Set(TOPICS.map((t) => t.tab)).size, TOPICS.length, "no screen twice");
});

test("every topic opens a screen the app really has", () => {
  const known = new Set([...app.matchAll(/ui\.tab === "([a-z]+)"/g)].map((m) => m[1]));
  for (const t of TOPICS) assert.ok(known.has(t.tab) || t.tab === "log", t.tab + " is a screen in app.js");
});

test("the getting-started steps tick themselves from the data", () => {
  const empty = checklist({ accounts: [], transactions: [] }, {});
  assert.deepEqual(empty.map((s) => s.done), [false, false, false]);
  const some = checklist({ accounts: [{ id: "a" }], transactions: [{ id: "t" }] }, { last_backup_at: "2026-10-05T09:00:00.000+08:00" });
  assert.deepEqual(some.map((s) => s.done), [true, true, true]);
  assert.deepEqual(checklist({ accounts: [{ id: "a" }], transactions: [] }, {}).map((s) => s.done), [true, false, false]);
});

test("the first-run notice says the six plain things: a verified entry is final, data stays here, nothing recovers a lost phone or passphrase, back up now, iPhone Home Screen, Android site data", () => {
  const all = FIRST_RUN_NOTICE.lines.join(" ");
  assert.equal(FIRST_RUN_NOTICE.lines.length, 6);
  assert.match(FIRST_RUN_NOTICE.lines[0], /^Once you verify an entry it is final/); assert.match(FIRST_RUN_NOTICE.lines[0], /Weekly review/);
  assert.match(FIRST_RUN_NOTICE.lines[1], /stays on this phone/);
  assert.match(FIRST_RUN_NOTICE.lines[2], /lost phone/); assert.match(FIRST_RUN_NOTICE.lines[2], /forgotten backup passphrase/); assert.match(FIRST_RUN_NOTICE.lines[2], /cannot be recovered/);
  assert.match(FIRST_RUN_NOTICE.lines[3], /backup now/);
  assert.match(FIRST_RUN_NOTICE.lines[4], /^iPhone: add this app to the Home Screen first/);
  assert.match(FIRST_RUN_NOTICE.lines[5], /^Android: clearing the browser's site data erases the ledger/);
  assert.ok(all.length < 680, "short enough to read at a glance");
});

test("Help words never name an owner-specific goal or category, and the goals topic speaks of roles", () => {
  const words = TOPICS.flatMap((t) => t.lines).join(" ") + QUICK_NOTES.join(" ") + FIRST_RUN_NOTICE.lines.join(" ");
  for (const owner of ["Mole", "Lakat", "Upskill"]) assert.ok(!words.includes(owner), owner);
  assert.match(TOPICS.find((t) => t.tab === "goals").lines.join(" "), /Choose which goal is your emergency fund/);
});

test("Budget help: one topic with the three views, the one income and the move of an old Pay plan; there is no separate Pay plan topic or menu entry", () => {
  const t = TOPICS.find((x) => x.tab === "budget"), text = t.lines.join(" ");
  assert.equal(t.label, "Plan & Save");
  for (const w of ["Month, Per payday or Per week", "12 / 52", "same income as this screen", "moves it into Budget once"]) assert.ok(text.includes(w), w);
  assert.ok(!TOPICS.some((x) => x.tab === "plan") && !MENU_GROUPS.some(([, ids]) => ids.includes("plan")), "the Pay plan is no longer a screen of its own");
});

test("loading and viewing a plan does not change it: an invented plan file parses to the same plan, the same totals and the same cutoff progress as before the words changed", async () => {
  const { parsePlan, addPlan, planInEffect, planTotals } = await import("../src/model/index.js");
  const file = { schema_version: 1, unit: "PHP_whole_pesos", effective_from: "2026-10-01", paydays: [{ day: 15, expected_income: 1000 }, { day: "last", expected_income: 2400 }],
    lines: [{ name: "Food", kind: "expense", first: 600, second: 600 }, { name: "Rent", kind: "expense", first: 0, second: 500 }, { name: "Savings", kind: "goal", first: 400, second: 1300 }] };
  const r = parsePlan(JSON.stringify(file));
  assert.equal(r.ok, true);
  const before = JSON.stringify(r.plan);
  const stored = addPlan([], r.plan).plans;
  assert.equal(JSON.stringify(planInEffect(stored, "2026-10-20")), before);
  assert.deepEqual(planTotals(r.plan), { first: 100000, second: 240000, month: 340000 });
  assert.deepEqual(r.plan.paydays.map((p) => p.income), [100000, 240000]);
});

test("Budget and Goals are two tabs: nothing is hidden from the menu, and the Pay plan screen is no longer routed", async () => {
  const { menuHidden, HUBS } = await import("../src/model/index.js");
  assert.equal(menuHidden({}).size, 0); assert.equal(menuHidden(undefined).size, 0); assert.equal(menuHidden({ try_new_budget: true }).size, 0, "even an old ledger that still holds the setting hides nothing");
  assert.deepEqual(HUBS.budget, ["budget", "goals"]);
  assert.equal(SCREEN_NAMES.budget, "Plan & Save", "the menu and Help say Plan & Save"); assert.equal(STRIP_NAMES.budget, "Budget", "the tab in the strip says Budget");
  assert.ok(!app.includes('ui.tab === "plan" ? viewPlan()'), "the Pay plan screen is not routed");
});

test("the old Pay plan is not typed in any more: no By payday section on Budget, and no plan section on Setup", () => {
  assert.ok(!app.includes("function byPaydaySection") && !app.includes("By payday"), "the plan is not repeated inside Budget");
  assert.ok(!app.includes("<h2>Pay plan</h2>\n    <p class=\"note\">A plan is in effect."), "Setup has no Pay plan section any more");
  assert.match(app, /3 \\u00d7 \(Fixed \+ Needs\) of your budgets/, "the emergency fund hint points at the budgets, not at loading a plan");
});

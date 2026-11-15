// First-run setup (owner, Nov 15, overhaul A1): which step shows, the payday rule shared with Budget, step 5's figures read back from the ledger,
// and the Log's backup reminder. Every name and figure is invented; no test reads today's date.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as M from "../src/model/index.js";

const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/index.html", import.meta.url), "utf8");

test("which step shows: a brand-new phone starts at 1, a step left half way comes back, done or an existing ledger shows none", () => {
  assert.equal(M.firstRunStep({}, { brandNew: true }), 1);
  assert.equal(M.firstRunStep({}, { brandNew: false }), null, "a ledger already in use never sees it");
  assert.equal(M.firstRunStep({ notice_seen_at: "2026-10-01T08:00:00.000+08:00" }, { brandNew: true }), null, "an install that already saw the old notice is not new");
  assert.equal(M.firstRunStep({ firstrun_step: 3 }, { brandNew: false }), 3, "closed at step 3: opens at step 3");
  assert.equal(M.firstRunStep({ firstrun_step: 4, firstrun_done: "2026-11-15T10:00:00.000+08:00" }, { brandNew: false }), null, "done wins over a step left in a backup");
  for (const bad of [0, 6, 2.5, "3", null]) assert.equal(M.firstRunStep({ firstrun_step: bad }, { brandNew: false }), null, "a step that cannot be is ignored: " + bad);
});

test("the paydays typed in the setup follow Budget's rule, and say what is wrong", () => {
  assert.deepEqual(M.scheduleFromForm({ kind: "twice", d1: "15", d2: "last" }), { ok: true, schedule: { kind: "twice", days: [15, "last"] } });
  assert.deepEqual(M.scheduleFromForm({ kind: "twice", d1: " 10 ", d2: "25" }).schedule, { kind: "twice", days: [10, 25] });
  assert.deepEqual(M.scheduleFromForm({ kind: "once", d1: "LAST" }).schedule, { kind: "monthly", days: ["last"] });
  assert.deepEqual(M.scheduleFromForm({ kind: "biweekly", start: "2026-11-06" }).schedule, { kind: "biweekly", start: "2026-11-06" });
  assert.deepEqual(M.scheduleFromForm({ kind: "weekly", weekday: "5" }).schedule, { kind: "weekly", weekday: 5 });
  assert.equal(M.scheduleFromForm({ kind: "twice", d1: "30", d2: "last" }).message, "Type the payday as a day from 1 to 28.");
  assert.equal(M.scheduleFromForm({ kind: "twice", d1: "last", d2: "last" }).ok, false, "only a once-a-month payday can be the first as last");
  assert.equal(M.scheduleFromForm({ kind: "twice", d1: "20", d2: "10" }).message, "Type the 2nd payday as a day after the first, or last.");
  assert.equal(M.scheduleFromForm({ kind: "biweekly", start: "" }).message, "Choose the date of one of your paydays.");
  assert.equal(M.scheduleFromForm({ kind: "weekly", weekday: 7 }).message, "Choose the weekday you are paid.");
});

test("the paydays in words", () => {
  assert.equal(M.paydaysWords({}), null);
  assert.equal(M.paydaysWords({ pay_schedule: { kind: "twice", days: [15, "last"] } }), "On the 15th and the last day");
  assert.equal(M.paydaysWords({ pay_schedule: { kind: "monthly", days: [1] } }), "Once a month, on the 1st");
  assert.equal(M.paydaysWords({ pay_schedule: { kind: "biweekly", start: "2026-11-06" } }), "Every 2 weeks");
  assert.equal(M.paydaysWords({ pay_schedule: { kind: "weekly", weekday: 5 } }), "Every Friday");
});

test("step 5 reads back what the setup made: money held apart from what the cards are owed, Owed to me and hidden accounts left out", () => {
  const s = M.emptyState();
  const acct = (id, name, cls, opening, o = {}) => ({ id, name, class: cls, role: "", opening_balance: opening, opening_date: "2026-11-15", hidden_by_default: false, archived: false, ...o });
  s.accounts.push(acct("cash", "Sample Cash", "asset", 100000), acct("chk", "Sample Checking", "asset", 6283100), acct("card", "Sample Card", "liability", 245000),
    acct("owed", "Owed to me", "asset", 0, { role: "owed" }), acct("old", "Sample Old", "asset", 0, { archived: true }));
  const r = M.firstRunSummary(s, { pay_schedule: { kind: "twice", days: [15, "last"] }, income_base_pin: 5000000, backup_reminder: false }, { lockOn: true });
  assert.deepEqual(r, { accounts: 2, have: 6383100, cards: 1, owed: 245000, paydays: "On the 15th and the last day", pay: 5000000, lock: true, reminder: false, categories: r.categories });
  const cats = { ...s, categories: [{ id: "cat-food", name: "Food", kind: "expense" }, { id: "cat-fun", name: "Fun", kind: "expense" }, { id: M.UNLOGGED_CATEGORY_ID, name: "Uncategorized", kind: "expense" }, { id: "cat-salary", name: "Salary", kind: "income" }] };
  assert.equal(M.firstRunSummary(cats, {}).categories, 2, "Food and Fun: Uncategorized is not one you choose, and income is not spending");
  const none = M.firstRunSummary(M.emptyState(), {});
  assert.equal(none.accounts, 0); assert.equal(none.pay, null); assert.equal(none.paydays, null); assert.equal(none.reminder, true, "the reminder is on unless turned off");
});

test("the backup reminder: on by default, from 7 days or with no backup yet, never when turned off", () => {
  assert.equal(M.BACKUP_REMINDER_DAYS, 7);
  assert.equal(M.backupReminderDue({}, null), true, "no backup yet");
  assert.equal(M.backupReminderDue({}, 6), false);
  assert.equal(M.backupReminderDue({}, 7), true);
  assert.equal(M.backupReminderDue({ backup_reminder: true }, 30), true);
  assert.equal(M.backupReminderDue({ backup_reminder: false }, 30), false);
  assert.equal(M.backupReminderDue({ backup_reminder: false }, null), false);
  assert.match(app, /M\.backupReminderDue\(ledger\.settings, age\) \? \{ id: "backup"/, "Log's line follows the switch");
  assert.match(app, /id="backup-reminder"[\s\S]{0,300}data-action="toggle-backup-reminder"/, "Setup, Backup and restore has the switch");
});

test("the setup replaces the notice and the welcome card on a new install only, needs one account at step 2, and every restore ends it", () => {
  assert.match(app, /const frStep = device\.allowEntry && !setupRestored \? M\.firstRunStep\(ledger\.settings, \{ brandNew: boot\.status === "NONE" \}\) : null;/);
  assert.ok(!/ui\.sheet = \{ type: "notice" \}; renderSheet\(\); \}\n/.test(app) && !app.includes('welcome_pending: true'), "a new install is not sent to the notice or the welcome card");
  assert.match(app, /if \(n === 2 && !activeAccounts\(\)\.length\) \{ ui\.fr\.err = "Add at least one account to go on, even Cash with 0\."/, "owner, Nov 15: step 2 needs one account");
  assert.match(app, /if \(kind === "restore"\) \{ try \{ sessionStorage\.setItem\(SETUP_RESTORED, "1"\)/, "every restore marks the setup finished");
  assert.match(app, /if \(!sh && ui\.fr\) \{ ui\.sheet = \{ type: "firstrun" \}; ui\.form = ui\.fr\.form;/, "a window opened from a step closes back onto that step");
  assert.match(app, /const \{ firstrun_step, \.\.\.rest \} = ledger\.settings;\s*ui\.fr = null;/, "Done removes the step and keeps the moment it finished");
});

test("motion: the step slides with the move token and stands still under Reduce Motion; nothing counts money up", () => {
  assert.match(css, /\.frpage\.fr-fwd \{ animation: frfwd var\(--t-move\) var\(--ease-out\); \}/);
  assert.match(css, /\.frbar span \{[^}]*transition: width var\(--t-move\) var\(--ease-out\);/);
  assert.match(css, /\.sheet\.full\.enter, \.frpage\.fr-fwd, \.frpage\.fr-back,[^}]*animation: none !important;/, "listed in the one Reduce Motion rule");
  assert.match(css, /button\.chip\.frchip \{ min-width: 56px; min-height: 44px;/, "the switches are big enough to tap");
  const body = app.slice(app.indexOf("function frBody()"), app.indexOf("async function frGo("));
  assert.ok(body.length > 1000 && !/requestAnimationFrame|setInterval/.test(body), "figures are written once, never counted up");
});

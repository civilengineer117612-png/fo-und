// First-run setup (owner, Nov 15, overhaul A1; data version unchanged). A brand-new install no longer shows the first-run notice and the
// "Make it yours" card: it shows five steps instead, 1 Welcome, 2 What do you pay from?, 3 When are you paid?, 4 Keep it safe, 5 You are set.
// Its progress has its own setting, `firstrun_step` (the step to show, 1 to 5), so closing the app half way brings you back to the same step;
// `firstrun_done` (a timestamp) ends it for good. Both are optional settings: an existing ledger has neither and never sees the setup.
// Accounts are added by the same rule as Setup (`planAccount`), the paydays by the same rule as Budget's "Your paydays" window.
import { naturalBalance, countedEntries, holdsMoney } from "./balances.js";
import { scheduleOf } from "./budgetsplit.js";
import { ordinal } from "./planform.js";
import { UNLOGGED_CATEGORY_ID } from "./seed.js";

export const FIRSTRUN_STEPS = 5;
// Step 1's three rows, from the first-run notice (which Help still shows in full).
export const FIRSTRUN_WELCOME = [
  { icon: "phone", title: "Your data stays on this phone.", sub: "No sign-up and no server. Nobody else can see it." },
  { icon: "check", title: "You check every entry.", sub: "Nothing counts until you verify it, and once verified it is final." },
  { icon: "lock", title: "Backups are yours.", sub: "One encrypted file, kept where you choose. A lost passphrase cannot be recovered." },
];

// Which step to show at start, or null. A brand-new phone (nothing saved yet) starts at 1; a setup left half way resumes where it was.
export function firstRunStep(settings, { brandNew }) {
  if (settings.firstrun_done) return null;
  if (Number.isInteger(settings.firstrun_step) && settings.firstrun_step >= 1 && settings.firstrun_step <= FIRSTRUN_STEPS) return settings.firstrun_step;
  return brandNew && !settings.notice_seen_at ? 1 : null;
}

// The paydays typed in the setup or in Budget's "Your paydays" window, as a pay schedule, or the reason it cannot be one. `kind` is
// "twice" | "once" | "biweekly" | "weekly"; d1, d2 are days of the month (or "last"), `start` a date, `weekday` 0 (Sunday) to 6.
export function scheduleFromForm(f) {
  const k = f.kind ?? "twice", dayOf = (v) => (String(v ?? "").trim().toLowerCase() === "last" ? "last" : Number(String(v ?? "").trim()));
  if (k === "biweekly") return /^\d{4}-\d{2}-\d{2}$/.test(f.start ?? "") ? { ok: true, schedule: { kind: "biweekly", start: f.start } } : { ok: false, message: "Choose the date of one of your paydays." };
  if (k === "weekly") { const w = Number(f.weekday); return Number.isInteger(w) && w >= 0 && w <= 6 ? { ok: true, schedule: { kind: "weekly", weekday: w } } : { ok: false, message: "Choose the weekday you are paid." }; }
  const d1 = dayOf(f.d1), d2 = dayOf(f.d2), ok1 = d1 === "last" ? k === "once" : Number.isInteger(d1) && d1 >= 1 && d1 <= 28;
  if (!ok1) return { ok: false, message: "Type the payday as a day from 1 to 28" + (k === "once" ? ", or last." : ".") };
  if (k === "twice" && !(d2 === "last" || (Number.isInteger(d2) && d2 > d1 && d2 <= 28))) return { ok: false, message: "Type the 2nd payday as a day after the first, or last." };
  return { ok: true, schedule: k === "twice" ? { kind: "twice", days: [d1, d2] } : { kind: "monthly", days: [d1] } };
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const dayWord = (d) => (d === "last" ? "the last day" : "the " + ordinal(Number(d)));
// The paydays in words: "15th and last day", "Every 2 weeks", "Every Friday", or null when none are set.
export function paydaysWords(settings) {
  const s = scheduleOf(settings);
  if (!s) return null;
  if (s.kind === "biweekly") return "Every 2 weeks";
  if (s.kind === "weekly") return "Every " + WEEKDAYS[s.weekday];
  return s.days.length === 1 ? "Once a month, on " + dayWord(s.days[0]) : "On " + dayWord(s.days[0]) + " and " + dayWord(s.days[1]);
}

// Step 5, "You are set": what the setup made, read back from the ledger itself (nothing is remembered apart).
// Money is a plain figure in centavos; the screen formats it and never counts it up.
export function firstRunSummary(state, settings, { lockOn = false } = {}) {
  const counted = countedEntries(state), open = (state.accounts ?? []).filter((a) => !a.archived);
  const money = open.filter(holdsMoney), cards = open.filter((a) => a.class === "liability");
  const sum = (list) => list.reduce((s, a) => s + naturalBalance(a, counted), 0);
  return {
    accounts: money.length,
    have: sum(money),
    cards: cards.length,
    owed: sum(cards),
    paydays: paydaysWords(settings),
    pay: Number.isInteger(settings.income_base_pin) && settings.income_base_pin > 0 ? settings.income_base_pin : null,
    lock: Boolean(lockOn),
    reminder: settings.backup_reminder !== false,
    categories: (state.categories ?? []).filter((c) => c.kind === "expense" && c.id !== UNLOGGED_CATEGORY_ID).length,   // Uncategorized is not one you choose
  };
}

// The Log's backup reminder (owner, Nov 15): one line when the last backup is 7 or more days old, or there is none yet. It goes away when a backup
// is made. On unless the owner turned it off (setting `backup_reminder: false`, Setup, Backup and restore; also step 4 of the setup).
export const BACKUP_REMINDER_DAYS = 7;
export const backupReminderOn = (settings) => settings.backup_reminder !== false;
export function backupReminderDue(settings, ageDays) {
  return backupReminderOn(settings) && (ageDays === null || ageDays >= BACKUP_REMINDER_DAYS);
}

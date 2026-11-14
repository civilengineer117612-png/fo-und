// SPLIT AND "OWED TO ME" (owner, Nov 14, overhaul A4; data version 12). You paid for others: the WHOLE amount leaves the account you paid from, YOUR SHARE is
// spending in its category, and the rest is owed to you, kept per person on ONE account of its own kind (role "owed", made at the first split). Their pay-back is a
// MOVE from that account into the account that received it: never income, never a refund, never less spending. A person who will not pay: what they still owe
// becomes your spending, in the category it came from (the owner: "if a paid amount is divided by three and one does not pay, I got two shares").
// Rules kept here and checked by tests/owed.test.js and the audit rule OWED TO ME:
//   - your share + what each person owes = what left the account, to the centavo;
//   - what the people owe adds up to the account's balance (a leg on that account always names its person: `checkOwed` in invariants.js);
//   - the account holds no money: it is in no "in your accounts" figure, no net worth, no picker, no count (`holdsMoney`).
// Everything typed here is a DRAFT that waits in Verify, like every typed entry. Nothing verified is ever edited. Pure.
import { checkTransactionSave } from "./index.js";
import { planExpense, applyDrafts } from "./drafts.js";
import { countedEntries, OWED_ROLE, isOwed, holdsMoney } from "./balances.js";
import { phTimestamp } from "./util.js";
import { UNLOGGED_CATEGORY_ID } from "./seed.js";

export const OWED_NAME = "Owed to me";
export { OWED_ROLE, isOwed, holdsMoney };   // a bank, wallet, cash or pocket holds money you can spend; what people owe you is not money yet
// The account starts long before any entry, so an entry dated before the first split still counts on it (an account skips entries dated before its start).
export const OWED_OPENING_DATE = "2000-01-01";
export const owedAccount = (state) => (state.accounts ?? []).find(isOwed) ?? null;
export const personKey = (name) => String(name ?? "").trim().replace(/\s+/g, " ").toLowerCase();   // "ana", " Ana " and "ANA" are one person
const cleanName = (name) => String(name ?? "").trim().replace(/\s+/g, " ");
export const personName = (state, id) => (state.people ?? []).find((p) => p.id === id)?.name ?? "Someone";

const fail = (code, message) => ({ ok: false, violations: [{ code, severity: "error", message }] });
const sum = (xs) => xs.reduce((n, x) => n + x, 0);

// Who owes what of ONE payment. input: {total (centavos paid), shares: [{name, amount}], ids: {account, people: [..]}}: fresh ids, used only when the "Owed to me"
// account or a person does not exist yet (the model makes no ids). Returns {ok, state (with the account and the new people, nothing else), owed_account_id,
// shares: [{person_id, amount}], yours}. Your own share must be more than zero: a payment that is ALL someone else's is not a split.
export function planShares(state, { total, shares, ids = {} }) {
  if (!Number.isSafeInteger(total) || total <= 0) return fail("BAD_AMOUNT", "amount must be more than zero");
  if (!Array.isArray(shares) || shares.length === 0) return fail("NO_SHARES", "add at least one person");
  let people = state.people ?? [], used = 0;
  const seen = new Set(), out = [];
  for (const s of shares) {
    const key = personKey(s.name);
    if (!key) return fail("NO_NAME", "each person needs a name");
    if (seen.has(key)) return fail("SAME_PERSON", "each person can be listed once");
    seen.add(key);
    if (!Number.isSafeInteger(s.amount) || s.amount <= 0) return fail("BAD_SHARE", "each person's part must be more than zero");
    let p = people.find((x) => personKey(x.name) === key);
    if (!p) {
      const id = ids.people?.[used++];
      if (!id) return fail("NO_ID", "no id for a new person");
      p = { id, name: cleanName(s.name) };
      people = [...people, p];
    }
    out.push({ person_id: p.id, amount: s.amount });
  }
  const owed = sum(out.map((s) => s.amount));
  if (owed >= total) return fail("NO_SHARE_LEFT", "the others cannot owe the whole amount: your own share must be more than zero");
  let accounts = state.accounts, account = owedAccount(state);
  if (!account) {
    if (!ids.account) return fail("NO_ID", "no id for the Owed to me account");
    account = { id: ids.account, name: OWED_NAME, class: "asset", role: OWED_ROLE, hidden_by_default: false, archived: false, opening_balance: 0, opening_date: OWED_OPENING_DATE, last4: "" };
    accounts = [...accounts, account];
  }
  return { ok: true, violations: [], state: { ...state, accounts, people }, owed_account_id: account.id, shares: out, yours: total - owed };
}

// A purchase's lines with the others' parts taken out of its ONE category line and put on the Owed to me account, one line per person. The account side (what
// left the account, a card's pending mark, the buffer's envelopes) is untouched. Null when the purchase has no single category line (a receipt split in two kinds).
export function shareEntries(entries, transactionId, owedAccountId, shares) {
  const cats = entries.filter((e) => e.category_id != null);
  if (cats.length !== 1) return null;
  const owed = sum(shares.map((s) => s.amount));
  return [{ ...cats[0], amount: cats[0].amount - owed }, ...entries.filter((e) => e.category_id == null),
    ...shares.map((s) => ({ transaction_id: transactionId, account_id: owedAccountId, person_id: s.person_id, amount: s.amount }))];
}

// One purchase split with others. input: planExpense's fields (amount = the WHOLE amount paid) plus `shares` and `ids` as in planShares.
// Returns {ok, violations, state (the account and people added; the drafts are NOT yet in it), drafts}: apply the drafts to `state` to save.
export function planSharedExpense(state, input, now = new Date()) {
  const { shares, ids, ...rest } = input;
  const who = planShares(state, { total: rest.amount, shares, ids });
  if (!who.ok) return { ok: false, violations: who.violations, state, drafts: [] };
  const base = planExpense(who.state, rest, now);
  if (!base.ok) return { ok: false, violations: base.violations, state, drafts: [] };
  const [main, ...others] = base.drafts;
  const entries = shareEntries(main.entries, main.transaction.id, who.owed_account_id, who.shares);
  const result = checkTransactionSave(applyDrafts(who.state, others), { transaction: main.transaction, entries });
  return { ok: result.ok, violations: result.violations, state: who.state, drafts: [{ transaction: main.transaction, entries }, ...others] };
}

// Every line on the Owed to me account, with its entry. Lines count as every balance counts them (drafts too).
function owedLegs(state) {
  const account = owedAccount(state);
  if (!account) return [];
  const tx = new Map(state.transactions.map((t) => [t.id, t]));
  return countedEntries(state).filter((e) => e.account_id === account.id).map((e) => ({ e, t: tx.get(e.transaction_id) })).filter((x) => x.t);
}
const byDay = (a, b) => a.t.date.localeCompare(b.t.date) || a.t.created_at.localeCompare(b.t.created_at) || a.t.id.localeCompare(b.t.id);

// What one person still owes, piece by piece: their pay-backs settle the OLDEST debt first. An entry that was cancelled, and the entry that cancels it, are
// left out (the pair adds to nothing). Each piece: {transaction_id, date, payee, amount (still owed), category_id (the spending it was part of, or null)}.
export function owedPieces(state, personId) {
  const cancelled = new Set(state.transactions.filter((t) => t.reverses != null).map((t) => t.reverses));
  const legs = owedLegs(state).filter((x) => x.e.person_id === personId && x.t.reverses == null && !cancelled.has(x.t.id)).sort(byDay);
  let paid = -sum(legs.filter((x) => x.e.amount < 0).map((x) => x.e.amount));
  const expense = new Set(state.categories.filter((c) => c.kind === "expense").map((c) => c.id)), out = [];
  for (const x of legs.filter((x) => x.e.amount > 0)) {
    const take = Math.min(paid, x.e.amount), left = x.e.amount - take;
    paid -= take;
    if (left > 0) out.push({ transaction_id: x.t.id, date: x.t.date, payee: x.t.payee, amount: left,
      category_id: state.entries.find((e) => e.transaction_id === x.t.id && e.category_id != null && expense.has(e.category_id))?.category_id ?? null });
  }
  return out;
}

// What every person owes now: {account_id, total (the account's balance), people: [{person_id, name, amount, pieces}], unassigned}. People who owe nothing are
// left out; the biggest first. `unassigned` is what the account holds that no person explains: always 0 (the save check refuses a line without a person).
export function owedSummary(state) {
  const account = owedAccount(state);
  if (!account) return { account_id: null, total: 0, people: [], unassigned: 0 };
  const by = new Map();
  for (const { e } of owedLegs(state)) by.set(e.person_id ?? "", (by.get(e.person_id ?? "") ?? 0) + e.amount);
  const total = account.opening_balance + sum([...by.values()]);
  const people = [...by].filter(([id, amount]) => id !== "" && amount !== 0)
    .map(([id, amount]) => ({ person_id: id, name: personName(state, id), amount, pieces: amount > 0 ? owedPieces(state, id) : [] }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
  return { account_id: account.id, total, people, unassigned: total - sum(people.map((p) => p.amount)) };
}
export const owedBy = (state, personId) => owedSummary(state).people.find((p) => p.person_id === personId)?.amount ?? 0;

// One person's lines, newest first: {transaction_id, date, payee, amount (+ they owe more, - they owe less), status, kind}.
// kind: "owes" (a split), "paid" (a pay-back), "unpaid" (counted as your spending), "cancel" (a correction and the entry it cancels).
export function personHistory(state, personId) {
  const cancelled = new Set(state.transactions.filter((t) => t.reverses != null).map((t) => t.reverses)), rows = new Map();
  for (const { e, t } of owedLegs(state)) {
    if (e.person_id !== personId) continue;
    const row = rows.get(t.id) ?? { transaction_id: t.id, date: t.date, payee: t.payee, amount: 0, status: t.status, t };
    row.amount += e.amount;
    rows.set(t.id, row);
  }
  const hasCategory = new Set(state.entries.filter((e) => e.category_id != null).map((e) => e.transaction_id));
  return [...rows.values()].sort((a, b) => byDay(b, a)).map(({ t, ...r }) => ({ ...r,
    kind: t.reverses != null || cancelled.has(t.id) ? "cancel" : r.amount > 0 ? "owes" : hasCategory.has(t.id) ? "unpaid" : "paid" }));
}

const draftOf = (id, date, payee, memo, now) => ({ id, date, payee, memo, status: "draft", source: "manual", created_at: phTimestamp(now) });
const saved = (state, transaction, entries) => {
  const result = checkTransactionSave(state, { transaction, entries });
  return result.ok ? { ok: true, violations: result.violations, transaction, entries, state: applyDrafts(state, [{ transaction, entries }]) } : { ok: false, violations: result.violations, state };
};

// They paid you back: ONE draft move from Owed to me into the account that received it. Never more than they owe (more than that is not a pay-back).
// input: {transaction_id, person_id, amount, to_account_id, date}.
export function planPayBack(state, input, now = new Date()) {
  const { transaction_id: id, person_id, amount, to_account_id, date } = input;
  const account = owedAccount(state), owes = owedBy(state, person_id);
  if (!account || !(state.people ?? []).some((p) => p.id === person_id)) return { ...fail("UNKNOWN_PERSON", "no person " + person_id), state };
  if (!Number.isSafeInteger(amount) || amount <= 0) return { ...fail("BAD_AMOUNT", "amount must be more than zero"), state };
  if (amount > owes) return { ...fail("MORE_THAN_OWED", "that is more than they owe you"), state };
  const to = state.accounts.find((a) => a.id === to_account_id);
  if (!holdsMoney(to) || to.archived) return { ...fail("UNKNOWN_ACCOUNT", "choose the account the money arrived in"), state };
  return saved(state, draftOf(id, date, personName(state, person_id), "", now), [
    { transaction_id: id, account_id: to.id, amount },
    { transaction_id: id, account_id: account.id, person_id, amount: -amount },
  ]);
}

// They will not pay: ONE draft that makes everything this person still owes YOUR spending, each piece in the category of the purchase it was part of
// (a piece with none goes to Uncategorized). input: {transaction_id, person_id, date}.
export function planNotPaid(state, input, now = new Date()) {
  const { transaction_id: id, person_id, date } = input;
  const account = owedAccount(state);
  if (!account || !(state.people ?? []).some((p) => p.id === person_id)) return { ...fail("UNKNOWN_PERSON", "no person " + person_id), state };
  const pieces = owedPieces(state, person_id), total = sum(pieces.map((p) => p.amount));
  if (total <= 0 || total !== owedBy(state, person_id)) return { ...fail("NOTHING_OWED", "this person owes you nothing"), state };
  const byCategory = new Map();
  for (const p of pieces) { const c = p.category_id ?? UNLOGGED_CATEGORY_ID; byCategory.set(c, (byCategory.get(c) ?? 0) + p.amount); }
  return saved(state, draftOf(id, date, personName(state, person_id), "Not paid back", now), [
    ...[...byCategory].map(([category_id, amount]) => ({ transaction_id: id, category_id, amount })),
    { transaction_id: id, account_id: account.id, person_id, amount: -total },
  ]);
}

// What kind of Owed to me entry a transaction is, for the screens: null (it is none), or
//   {kind: "shared", total, yours, owed: [{person_id, name, amount}]}   a purchase split with others
//   {kind: "paid", person_id, name, amount, to_id}                      a pay-back
//   {kind: "unpaid", person_id, name, amount}                           counted as your spending
export function owedKind(state, transactionId) {
  const account = owedAccount(state);
  if (!account) return null;
  const es = state.entries.filter((e) => e.transaction_id === transactionId), mine = es.filter((e) => e.account_id === account.id);
  if (!mine.length) return null;
  const cats = es.filter((e) => e.category_id != null), others = es.filter((e) => e.account_id != null && e.account_id !== account.id);
  const named = (e) => ({ person_id: e.person_id, name: personName(state, e.person_id), amount: Math.abs(e.amount) });
  if (mine.every((e) => e.amount > 0) && cats.length && others.length) {
    const owed = sum(mine.map((e) => e.amount)), yours = sum(cats.map((e) => e.amount));
    return { kind: "shared", total: owed + yours, yours, owed: mine.map(named) };
  }
  if (mine.length === 1 && mine[0].amount < 0 && !cats.length && others.length === 1) return { kind: "paid", ...named(mine[0]), to_id: others[0].account_id };
  if (mine.length === 1 && mine[0].amount < 0 && cats.length && !others.length) return { kind: "unpaid", ...named(mine[0]) };
  return null;
}

// LOANS (owner, Nov 23; data version 13). A loan is money owed to a lender: an account of its own class "loan", never a credit card, so no card rule
// (pending or posted, the reserve, "I paid the card", due drafts, statements) ever touches it. One generic kind, named by the user.
//   - What you owe is the account's balance, the same rule as every debt: the opening amount owed minus what was paid in (positive = owed).
//   - Paid BY YOU (bank or other): a move from one of your accounts into the loan (planTransfer). Never spending.
//   - Paid FROM YOUR PAY: a payslip deduction line linked to the loan (`loan_id` on the printed line). The payslip's own entry gets two more legs: the loan goes
//     down by the line's amount, against the category "Paid to loans from pay" of kind "withheld". That kind is in no income and no spending figure, so the
//     deposit stays the money in, every income figure is unchanged, and cancelling the payslip cancels the repayment with it.
//   - Money RECEIVED from a loan: a move from the loan into the account that received it. Never income.
//   - INTEREST is never typed per repayment. At a count of the lender's balance, a lender figure higher than the ledger's is interest: ONE entry (the loan owed
//     goes up, the expense "Loan interest" goes up), made only by the owner's tap and so verified by count. A lower figure is not interest: the screen offers
//     to log the payment the ledger is missing.
//   - A loan counts in net worth (what you have minus what you owe), not in Cards' "free" figure, which stays what is in your accounts minus the cards.
import { naturalBalance, countedEntries } from "./balances.js";
import { checkTransactionSave } from "./index.js";
import { settle, EVIDENCE } from "./entryrule.js";
import { phTimestamp } from "./util.js";

export const LOAN_PAY_CATEGORY_ID = "cat-loanpay";
export const LOAN_PAY_NAME = "Paid to loans from pay";
export const LOAN_INTEREST_CATEGORY_ID = "cat-loan-interest";
export const LOAN_INTEREST_NAME = "Loan interest";

const fail = (code, message) => ({ ok: false, violations: [{ code, message }] });

export const isLoan = (a) => !!a && a.class === "loan";
// The loans to show and to choose from: not hidden away (archived).
export const loansOf = (state) => (state.accounts ?? []).filter((a) => isLoan(a) && !a.archived);
// What is owed on a loan now (drafts count, as on every balance).
export const loanOwed = (state, loan) => naturalBalance(loan, countedEntries(state));

// The two categories a loan needs are made on first use, never by the update.
function ensureCategory(state, id, name, kind, role) {
  if (state.categories.some((c) => c.id === id)) return state;
  return { ...state, categories: [...state.categories, { id, name, kind, ...(role ? { role } : {}) }] };
}
export const ensureLoanPay = (state) => ensureCategory(state, LOAN_PAY_CATEGORY_ID, LOAN_PAY_NAME, "withheld");
export const ensureLoanInterest = (state) => ensureCategory(state, LOAN_INTEREST_CATEGORY_ID, LOAN_INTEREST_NAME, "expense", "interest_fees");

// The legs a payslip adds for its deduction lines linked to a loan: the loan goes down by the line, against "Paid to loans from pay". A line whose loan is
// missing or is not a loan adds nothing (it stays an ordinary deduction). Returns the legs and the state with the category made when needed.
export function loanPayLegs(state, items, transactionId) {
  const byId = new Map((state.accounts ?? []).map((a) => [a.id, a]));
  const linked = (items ?? []).filter((i) => i.section === "deduction" && i.category === "loans" && i.loan_id && isLoan(byId.get(i.loan_id)) && i.amount > 0);   // only a Loan repayments line lowers a loan
  if (!linked.length) return { state, legs: [] };
  const next = ensureLoanPay(state), totals = new Map();
  for (const i of linked) totals.set(i.loan_id, (totals.get(i.loan_id) ?? 0) + i.amount);
  const legs = [];
  for (const [loan, amount] of totals) legs.push({ transaction_id: transactionId, account_id: loan, amount }, { transaction_id: transactionId, category_id: LOAN_PAY_CATEGORY_ID, amount: -amount });
  return { state: next, legs };
}

// The payslip lines that lowered a loan, and by how much in all (for the loan's window and the tests).
export function paidFromPay(state, loanId) {
  const slipTx = new Map((state.payslips ?? []).map((p) => [p.transaction_id, p]));
  return state.entries.filter((e) => e.account_id === loanId && slipTx.has(e.transaction_id)).reduce((n, e) => n + e.amount, 0);
}

// A count of the lender's balance. `lender` is what the lender says is owed (centavos). Returns what the count means, never changes anything:
//   { kind: "match" }                          the ledger agrees
//   { kind: "interest", amount }               the lender says more: the difference is interest, booked by planLoanInterest on the owner's tap
//   { kind: "lower", amount }                  the lender says less: a payment is missing from the ledger (offer to log it as a move)
export function loanCount(state, loanId, lender) {
  const loan = (state.accounts ?? []).find((a) => a.id === loanId);
  if (!isLoan(loan)) return { ok: false, reason: "not a loan" };
  if (!Number.isSafeInteger(lender) || lender < 0) return { ok: false, reason: "the lender's balance must be zero or more" };
  const owed = loanOwed(state, loan), diff = lender - owed;
  return { ok: true, owed, lender, ...(diff === 0 ? { kind: "match", amount: 0 } : diff > 0 ? { kind: "interest", amount: diff } : { kind: "lower", amount: -diff }) };
}

// The owner's tap on "Book it as interest": ONE verified entry (verified by count): the loan owed goes up by the difference and "Loan interest" goes up by it.
export function planLoanInterest(state, { id, loan_id, lender, date }, now = new Date()) {
  const c = loanCount(state, loan_id, lender);
  if (!c.ok) return fail("NOT_A_LOAN", c.reason);
  if (c.kind !== "interest") return fail("NO_INTEREST", c.kind === "match" ? "The lender's balance matches; there is no interest to book." : "The lender says less than the ledger; that is a payment, not interest.");
  const next = ensureLoanInterest(state), stamp = phTimestamp(now);
  const transaction = settle({ id, date, payee: "Loan interest", memo: "Lender's balance " + lender, source: "manual", created_at: stamp }, EVIDENCE.count, stamp);
  const entries = [{ transaction_id: id, account_id: loan_id, amount: -c.amount }, { transaction_id: id, category_id: LOAN_INTEREST_CATEGORY_ID, amount: c.amount }];
  const check = checkTransactionSave(next, { transaction, entries });
  if (!check.ok) return { ok: false, violations: check.violations, state };
  return { ok: true, violations: check.violations, amount: c.amount, transaction, entries, state: { ...next, transactions: [...next.transactions, transaction], entries: [...next.entries, ...entries] } };
}

// What you owe on loans in all (for net worth and the Loans list).
export function loansSummary(state) {
  const rows = loansOf(state).map((a) => ({ account_id: a.id, name: a.name, owed: loanOwed(state, a), from_pay: paidFromPay(state, a.id) }));
  return { rows, owed: rows.reduce((n, r) => n + r.owed, 0) };
}

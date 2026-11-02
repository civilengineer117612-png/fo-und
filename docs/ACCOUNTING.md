# Accounting charter

fo/und borrows well-known accounting and auditing principles so that its figures can be trusted and checked. It does **not** claim to follow any
reporting standard (no IFRS, no GAAP, no tax rule). Every principle below says the rule, how the app applies it, and the test that guards it
(`tests/audit.test.js` unless another file is named). All examples use invented numbers. Amounts are kept in centavos.

If a principle and a screen ever disagree, the principle wins and the screen is a bug.

## Recognition rules (decided by the owner)
- **Income** is recognised when the money reaches the account (the deposit date). The pay period is kept as a label.
- **A card purchase** is spending when it is made, and is owed at once (a liability).
- **Paying a card** is a transfer. It is never spending.
- **Moving money between your own accounts** is never income and never spending. Only its fee is spending.
- **A refund** reduces spending in the category it came back to. It is not income.
- **Spending** is counted from verified entries only. Drafts are shown apart, never added in silently.

## The principles

### 1. Double entry and the accounting equation
- **Rule.** Every entry has at least two legs and the legs add to exactly zero. What you have minus what you owe equals its opening figure plus income
  minus expenses.
- **In the app.** Each transaction is saved as legs: an account leg (a bank, wallet, cash or card) or a category leg (an income or expense category).
  Sign: debit +, credit -. Opening balances sit on the account. `checkEntriesBalance` refuses a save that does not add to zero.
- **Guarded by.** "TRIAL BALANCE", "EQUATION", "DOUBLE ENTRY at the door".

### 2. Trial balance
- **Rule.** The sum of all entries is zero to the centavo, every transaction is zero, no entry points at a missing transaction, and every transaction has at least two legs.
- **In the app.** `selfCheck` (after an update) and the checks at every save. Setup, About this app shows one quiet line from `ledgerProblems`, computed from the ledger as it is now (so it covers a load and a restore): "Ledger check: OK" or "Ledger check: N problems (tell the project chat)". It counts an entry that does not add to zero, amounts that belong to no entry, an entry with fewer than two sides, a missing account or category, a correction naming a missing entry, and an entry cancelled twice. It is a report only: a ledger with a problem still opens and still backs up.
- **Guarded by.** `tests/ledgercheck.test.js`, `e2e/ledger-check.mjs`, "TRIAL BALANCE REPORT" and "TRIAL BALANCE" after each kind of operation: log, transfer, card purchase, card payment, refund, payslip, Add the breakdown, count (plain,
  held, as a move, card), correction, gap repair, restore.

### 3. Account balance
- **Rule.** A balance is its opening figure plus its own movements, nothing else. It is never stored, so it cannot drift.
- **In the app.** `naturalBalance` over `countedEntries`. A card shows what is owed (opening minus movements).
- **Guarded by.** "ACCOUNT BALANCE".
- **Stated exception.** An entry dated **before** an account's opening date does not change that account's balance (the opening figure is what it held
  on that day, so the earlier entry is already inside it). History, reports and budgets still count the entry. So the equation in principle 1 holds for
  every entry on or after its account's opening date. This is deliberate; it is not planned to change.

### 4. Suspense
- **Rule.** An amount we cannot explain is held in a suspense account. It is never spending, up or down, and it is cleared only by an explanation.
- **In the app.** "Not yet explained": a weekly count with a gap that the owner did not explain is flagged `adjustment`; the balance is corrected but the
  gap is held (`heldIds`). It is cleared by a move, by money received, or by the entry that explains it ("This explains the gap"). The cancelling entry
  is held too.
- **Guarded by.** "SUSPENSE" (Category, This month, Accounts, Spent today, the Trends line, Who, the entries behind a Category row, the Budget view, trips and the suggestion), `tests/suspense.test.js`.

### 5. Reconciliation
- **Rule.** Counted money is compared with the ledger. A difference is one of: a missing entry, a transfer, timing (a pending card charge), or an error.
  Match before you record.
- **In the app.** The weekly count; a card is counted on what the bank posted or on all you owe; a short and an equal extra between your own accounts
  become one proposed move; a gap is never guessed. A real charge of exactly the missing amount, on that account, in that check-in's week, is offered the gap
  ("This explains the gap"), whether the gap is held or was booked as "I spent some of it": the gap is cancelled and the money counts once, in the charge.
- **Guarded by.** `tests/checkin.test.js`, `tests/checkin-gaps.test.js`, `tests/gapmatch.test.js`, `tests/countwhy.test.js`, `tests/suspense.test.js`; "RECONCILIATION", "MATERIALITY IS NOT USED".

### 6. Classification
- **Rule.** Every entry is classed once: income, expense, transfer, card payment. The employer's share of a payslip is shown and never reduces net pay.
- **In the app.** An entry with a category leg is income or an expense; an entry with only account legs is a transfer; a card payment is a transfer to a
  card. A refund is money in whose other leg is a credit to the spending category it came back to, so that spending goes down; it is not income (`planRefund`).
  Past refunds that were saved as income under "Refund" are counted as less spending through corrections, after the owner confirms each category and the app
  has kept a copy of the ledger (`planRefundRepair`).
- **Guarded by.** "TRANSFERS", "CARDS", "RECOGNITION", `tests/refund.test.js`, `tests/payslipitems.test.js` (employer share).

### 7. Reversing entries and the audit trail
- **Rule.** A verified entry is never edited or deleted. A mistake is put right by a new entry that reverses exactly one entry, once, with a reference to
  it, followed by a new correct entry. The old entry stays visible as cancelled.
- **In the app.** `planCorrection` makes `rev:<id>` (it `reverses` the entry); one entry can be cancelled once; a corrected expense also gets a fresh draft
  that `corrects` it. A save over a verified entry is refused (`ENTRY_FINAL`). The save check also refuses a correction that names a missing or unverified
  entry, an entry already cancelled, a correction itself, or legs that are not the exact opposite (`checkReversal`). Removing a payslip or an income entry,
  and changing the money of a payslip, are corrections too: the old entry stays, its reversal sits beside it, and a changed payslip gets a new pay entry.
  Only a draft is ever deleted. (Fixed forward on Oct 31: an earlier payslip change or removal had already rewritten or deleted the entry, and that
  history cannot be recovered.)
  **Stated exception (Oct 31):** before the app refused it (#271) a stale screen could cancel the same entry twice, which moves its money twice. A cancellation
  is still never itself cancelled. The repair puts the extra one right with an entry that names the cancelled entry in `restores` and holds its own legs, accepted
  only while that entry has more cancelling entries standing than it should (`checkRestore`); the same amount is kept apart as not yet explained, so every balance
  stays what it was. The ledger check no longer counts a second cancellation that was put right.
- **Guarded by.** "REVERSING ENTRIES" (twice), "AUDIT TRAIL" (three), `tests/audittrail.test.js`, `tests/doublecancel.test.js`.

### 8. Cutoff
- **Rule.** An item belongs to the period in which it happened. Money in belongs to the day the deposit arrives; the period worked is a label.
- **In the app.** Entries are dated by the day they happened; a card purchase by the purchase day. Pay from a payslip counts in the month its deposit arrived (the pay
  date); the pay period is only a label, used to find pay periods that have no payslip. Income shows a one-time note of the months this moved.
- **Guarded by.** "CUTOFF", `tests/refund.test.js`.

### 9. Non-recurring items
- **Rule.** One-off or variable income (back pay, holiday and night pay, overtime, bonus, 13th month, an extra payday) is kept apart from recurring income
  and never lifts the base used for budgets.
- **In the app.** The budget's base income counts stable pay (`stableOf`): the deposit minus the variable lines. A third payday in a month is an extra
  payday and is left out. An earnings line with no category counts only when a line with the same label (case and spacing ignored) was on at least 2 of the last
  3 payslips from that employer, this one included (`recurringLabels`); otherwise it is one-off. A category the owner chose decides instead. The exact labels
  "13th month" and "Bonus" are suggested as Bonus and 13th month.
- **Guarded by.** "NON-RECURRING INCOME" (twice), `tests/stablepay.test.js`, `tests/nonrecurring.test.js`.

### 10. Consistency and presentation
- **Rule.** One definition per figure, used on every screen. Two screens that show the same thing for the same period show the same number.
- **In the app.** Spending reads verified entries, leaves out held gaps and transfers, and groups categories the same way everywhere. Spent today and This
  month both show the verified figure, with what still waits in Verify apart ("+ P waiting in Verify"). The Unlogged gauge (weekly review, survey) reads
  verified entries only and leaves out a held gap and its cancelling entry. The home summary follows the same rule.
- **Guarded by.** "CONSISTENCY" (three times: the third is P0-6's one income), `tests/presentation.test.js`, `tests/daytotal.test.js`, `tests/oneincome.test.js`.

### 11. Control totals
- **Rule.** What is added up must equal what was printed or counted.
- **In the app.** A payslip's earnings must equal its gross, its deductions its printed total, gross minus deductions its net, and the deposit its net;
  a difference is marked "Check this", never hidden. Added lines for an old payslip must reconcile to what it holds.
  A control total is ONLY a figure read from the printed page (gross, net, deposit), never a total made from the lines themselves (that would
  compare a value with itself and always pass). When the printed gross or net is not found the payslip says "Not checked" and is saved as a draft
  (`totals_unchecked`), which no check ever counts as proven. A net of zero or below is always marked "Check this".
- **Guarded by.** "CONTROL TOTALS", `tests/income.test.js`, `tests/stablepay.test.js`, `tests/photo-payslip.test.js` (audit: changing a line never
  moves the figure it is checked against), `tests/totals-unchecked.test.js`, `e2e/photo-payslip.mjs`.

### 12. Materiality is not used
- **Rule.** No difference is too small to explain. Every centavo is explained or held in suspense; nothing is rounded away.
- **In the app.** Counts, matches and duplicates compare exact amounts. The only tolerance is a transfer fee of up to ₱100 between two statement lines, and
  it is shown as the fee, not dropped.
- **Guarded by.** "MATERIALITY IS NOT USED".

## The six audit assertions
| Assertion | In the app | Guarded by |
|---|---|---|
| Existence (it happened) | the photo kept with an entry; the bank statement, month by month; the weekly count | `tests/proof.test.js`, `tests/photo-drafts.test.js` |
| Completeness (nothing missing) | the weekly count; months proved against statements; missing pay periods | `tests/checkin.test.js`, `tests/proof.test.js` |
| Accuracy (the amount is right) | every entry balances; payslip checks; the overdraw warning | "DOUBLE ENTRY", "CONTROL TOTALS" |
| Cutoff (right period) | entries dated by the day they happened; pay by its deposit month | "CUTOFF" |
| Classification (right kind) | income, expense, transfer, card payment, refund | "TRANSFERS", "CARDS", "RECOGNITION" |
| Presentation (shown the same everywhere) | one definition per figure | "CONSISTENCY", "SUSPENSE" |

## Known gaps
None open. The audit's findings are fixed; the one stated exception is under principle 3. A new finding is added here, with its own fix task and audit test, and the line is removed when it is fixed.

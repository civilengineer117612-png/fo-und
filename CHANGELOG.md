# Changelog

The app's version notes, the one source for "What's new" and "See all versions" in the app (`node tools/make-changelog.mjs` copies this
file into `src/model/changelogtext.js`; a test keeps the two equal).

How a note is written (owner, Nov 21): every change a user sees or gets adds ONE plain line under "Unreleased", in its group: New, Improved
or Fixed. No PR numbers, no figures, no jargon, no brand of phone. When the owner says "release" in the project chat, "Unreleased" becomes
the next version with its date: MAJOR when it breaks habits or data, MINOR for new features, PATCH for fixes only (1.2.3, no padding).

## Unreleased

## 1.1.0 (2026-11-24)

### New
- Loans: add one in Setup, see what you owe under Cards, pay it from an account, and let a payslip's repayment line lower it.

### Improved
- Splitting a bill: tapping a name box shows the people you split with before, and typing narrows them.
- About has a button that asks the browser again to keep the app's data safe, and shows its answer.

### Fixed
- A dropdown list no longer slides sideways under your finger.
- On a phone where the app was first used in a browser tab, installing it now asks the browser again to keep its data safe.

## 1.0.0 (2026-11-22)

### New
- Log what you spend in a few taps: type it, say it, use a quick tile, or scan a receipt or payment screen.
- Verify every entry one at a time; once verified it is final, and a mistake is put right at the Weekly review.
- Cash flow shows where your money went this month: by category, by account, a trend line and who you paid.
- Cards shows what you have and what your cards are owed, with a net worth over time, account histories and paying a card.
- Plan & Save holds one Budget you can see by month, by payday or by week, and Goals with your own pictures.
- Scheduled payments wait in Verify on their day, and installments count as they are paid.
- The Weekly review counts every account, shows each gap side by side, and keeps what you cannot explain apart from spending.
- Payslips are read from a PDF or a photo, keep every printed line, and give your budget a steady income.
- Bank and card statements are read on your phone: already logged lines are left out, the rest wait as drafts, and the closing balance is checked.
- Split with others: only your share is spending, and what others owe you waits under Owed to me until they pay you back.
- Trips keep spending on the road together.
- One encrypted backup file holds your ledger and pictures; restoring keeps a copy of what was on your phone first.
- App lock with face or fingerprint, or a six-digit PIN.
- A dark look for the night, following your phone or set in Setup.
- Help has the quick notes, short how-to clips, a guide to each screen, and a preview of the first-run setup that keeps nothing.
- A new phone starts with five short setup steps.
- Works on any phone: add it to your Home Screen from the browser; in a browser tab, Log says how to install it so your phone keeps your data.
- Swipe to change the day, month or payday, pull a window down to close it, and Back closes an open window instead of the app.
- Spending can be exported as a spreadsheet file.
- Each version's notes show once after an update, and About this app lists every version.

### Improved
- Budget shows other money in (interest, cashback) on its own line, apart from pay.
- A split can be all someone else's: the money is lent, and none of it is your spending.
- Loan repayments taken from your pay say they were already deducted.
- Everything you type waits in Verify until you check it; only a document that proves it, like a payslip or a matching statement, is verified at once.
- The box you type in stays above the keyboard, and a tap outside a window you typed in asks before throwing it away.
- Amounts are read the careful way: a comma only between thousands, so a mistyped comma is refused, never guessed.
- Searching every entry answers as you type, even on a big ledger.
- Every screen shares one look: white cards, one thin bar per line, and an outlined button for every action.
- Screens say less: the Weekly review and the other screens keep figures, actions and warnings, and explanations moved into Help.
- Trips is one row per trip, newest first, with a picture of your choice; tap a trip for everything else.
- The weekly questions table fits on a phone without wrapping.

### Fixed
- A scheduled payment no longer links itself to an entry you logged: Verify suggests it, and your tap links them.
- A cash advance on a card statement is a move from the card, not spending.
- A backup now also holds the photos still waiting to be read, so a restore no longer loses them.
- With the app open in two windows, one can no longer erase what the other saved.
- A picture that cannot be kept never stops an entry from being saved.
- A tall window no longer jumps back up when you choose something near its bottom.
- Bank logos are only shown from copies kept on your phone, so no outside service learns which banks you use.

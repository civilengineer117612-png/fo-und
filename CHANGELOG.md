# Changelog

The app's version notes, the one source for "What's new" and "See all versions" in the app (`node tools/make-changelog.mjs` copies this
file into `src/model/changelogtext.js`; a test keeps the two equal).

How a note is written (owner, Nov 21): every change a user sees or gets adds ONE plain line under "Unreleased", in its group: New, Improved
or Fixed. No PR numbers, no figures, no jargon, no brand of phone. When the owner says "release" in the project chat, "Unreleased" becomes
the next version with its date: MAJOR when it breaks habits or data, MINOR for new features, PATCH for fixes only (1.2.3, no padding).

## Unreleased

These become version 1.0.0 at the end of the overhaul.

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
- Everything you type waits in Verify until you check it; only a document that proves it, like a payslip or a matching statement, is verified at once.
- The box you type in stays above the keyboard, and a tap outside a window you typed in asks before throwing it away.
- Amounts are read the careful way: a comma only between thousands, so a mistyped comma is refused, never guessed.
- Searching every entry answers as you type, even on a big ledger.
- Every screen shares one look: white cards, one thin bar per line, and an outlined button for every action.

### Fixed
- With the app open in two windows, one can no longer erase what the other saved.
- A picture that cannot be kept never stops an entry from being saved.
- A tall window no longer jumps back up when you choose something near its bottom.
- Bank logos are only shown from copies kept on your phone, so no outside service learns which banks you use.

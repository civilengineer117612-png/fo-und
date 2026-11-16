# Hand-over (updated Nov 16, 2026)

## What is built
- Log and Verify (bottom bar). A typed entry is a draft until you verify it; a verified entry is final and is put right only at the Weekly
  review ("Correct this entry": the old entry stays, marked corrected; the corrected one waits in Verify).
- Menu: Cash flow (spending by category, accounts, trends, income), Cards (accounts, transfers, Pay a card, Owed to me, net worth),
  Plan & Save (one Budget seen by Month, Per payday or Per week, with the Buffer row and its window; Goals), Scheduled, Weekly review
  (with Checks), Scan (receipts, payslips, statements and lists), Trips, Help, Setup.
- Split with others and Owed to me (data version 12), refunds that bring spending down, statement proof and import, the payslip reader
  that keeps every printed line, the app lock, swipe between periods, a five-step setup on a new phone, the backup reminder.
- Safe data upgrades (data version 12), one-file encrypted backups, safety copies before every upgrade, restore and repair.
- The Ledger Paper look, light and dark. The standard is `docs/UI.md`; accounting rules are `docs/ACCOUNTING.md`; every rule is in `CLAUDE.md`.

## What is not built yet
The open list with its order is `docs/WORKFLOW.md`, PART 7. In short (Nov 16): the rest of the overhaul's small fixes (L10, L11 speed;
L13, F5 windows and the keyboard; L15 stray dots; F8 the scanner ring; A8 titles; the rest of A11 test isolation; drag down to close a
window), the screens one at a time with less text, and the Weekly review with less text (waits on the owner's answer).

## Back up and restore
Setup, Back up now makes ONE encrypted file with the ledger and every picture (parts only past 50 MB). Keep the passphrase: it cannot be
recovered. Restore takes the file (or all its parts together) and first keeps a restore copy of the phone's data; "Undo last restore" puts
it back. Before every data upgrade the app keeps its own copy, read back and checked; Setup offers "Restore the copy from before the last
update". No owner backup step is needed before a merge.

## How a change reaches the phone
1. Work on a branch in a scratch copy: `npm test`, `npm run test:dates`, and the e2e scripts against `python3 -m http.server 8124`
   (the list is in `.github/workflows/test.yml`). Open a PR that starts with the MERGE CHECK block.
2. CI runs "test" and "e2e" (and "e2e-webkit", Safari's engine, in its own workflow). The build agent merges the PR itself as soon as
   both required checks are green on its current head, never on red or pending (owner's merge rule, `CLAUDE.md`).
3. The merge deploys to GitHub Pages; the phone loads the new copy on the next open; Setup shows the version and date, and What's new
   shows the latest three changes once.
4. Changing the shape of saved data: raise `LEDGER_VERSION`, add the step to `MIGRATIONS` (add fields only, never delete or rename), add a
   hand-written old-version backup to `tests/migrate.test.js`, and prove the safety copy is taken first.

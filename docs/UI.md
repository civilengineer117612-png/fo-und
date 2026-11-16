# UI standard (one page; updated Nov 16 after the overhaul)

Owner, Nov 11 (P1-9): every screen must look like the same product. This page is the standard; `docs/UI.md` wins over habit. It is written from
the Ledger Paper values already in `app/index.html`; nothing here adds a colour. A screen that differs from it is a deviation to fix, not a variant.

## Colour and type
- Colours: only the tokens on `:root` (ground, surface, ink, muted, line, track, accent, dashed), each with its night twin. A screen writes no colour.
  Red only on a budget chart that is strictly over. Never colour alone: a shape and words too.
- Face: IBM Plex Sans, bundled. Figures use tabular digits and never wrap. The balance on an account card is IBM Plex Mono (bundled with its
  OFL license like the Sans, never a network font).
- Sizes (px / weight): screen title 22 / 700. Window title 18 / 700. Section heading 15, capitals, muted, letter-spacing .04em. Row text 15 to 17.
  Body 15 on a 21 line. Secondary 14. Small 13. Bottom bar 12. ONE big figure per screen; no other figure is bigger or bolder than it.

## Spacing
- Side gutter 16. Inside a card 16. Related things 8 apart, blocks 16 apart, a section heading 22 above and 8 below. Everything on a 4 step.
- Works at 320 wide: nothing runs off the edge, no figure or date wraps, two-column grids stay two columns.

## Card
White surface, 1px line, 14 radius, 16 padding, no shadow, no side stripe, hairlines between its rows. One card style in the whole app.

## Account grid (Cards, Setup accounts)
Two columns, 12 gap, cards of equal height. Each card, top to bottom: the bank logo (or a plain line icon, or the first-letter tile), the name
(15), the balance (17 / 600, Plex Mono), the account type (13, muted). The whole card is one tap target and opens the account. A credit card
shows what is OWED, in words ("owes"), never a minus. Hidden amounts keep their room (five dots).

## List row
Rows live inside a white card, never loose on the ground. At least 56 high. Label at the left (one small muted line under it at most), figure at
the right, tabular, one line. Every label starts at the same x, every figure ends at the same x. A row that opens something is one button.

## Header
The menu button, then the screen title (22 / 700) at the left; at most two icon buttons at the right. A screen that belongs to a pair shows its
strip under the header and still has its title. Going back is a button in the header row, never an underlined word.

## Buttons (an action is always a button)
- Filled (the main action): accent, full width, 52 high, 16 / 600. Exactly ONE per screen, and one per window.
- Outlined (every other action): surface, 1px line, 10 radius, at least 48 high, ink text.
- Icon button: 44 by 44 at least, with a spoken label.
- Choice chips and the segmented switch choose between things; they are not actions. The pressed one is ink on surface, reversed.
- Several related actions sit in ONE row of outlined buttons, or behind ONE outlined "More" button that opens a list of rows. Never scattered.
- A destructive action is outlined and asks for a second tap. Never red.
- NO text links for actions. An underlined word appears only inside a sentence of Help.

## Empty state
One muted sentence (15) that says what will appear here, then the one button that makes it appear. No drawing, no second sentence.

## Toast
One line, 15, at the bottom above the bar. It states one fact once ("Saved. Waiting in Verify.") and goes away by itself. Never a question.

## Bar rows
Every list that shows a share or a spend uses ONE row, `barRow` inside `barCard` (app/app.js): the name at the left with at most one small muted
line under it, the figure at the right, ONE thin flat bar under both (none when there is nothing to measure). The rows of a window use it too (the
Buffer window, Nov 16), so two cards on one screen space alike. The percentage is not on the row: the bar is the share, the list twin has it.

## Motion and touch (overhaul, Nov 12 to 15)
- Two tokens: `--t-press` (.1s, a pressed look shows within 100 ms) and `--t-move` (.2s, anything that slides, fades or turns), with `--ease-out`.
  Every transition and one-shot animation uses them; the slide-up window keeps its .22s. No overshoot, no bounce.
- ONE press for every button and tile: it darkens and shrinks to 0.97, quick on touch (`--t-touch`, 70 ms) and eased back on release. A transform
  takes no room, so nothing else moves, and an invisible 8 px margin keeps the touched area while pressed. Safari's tap highlight is off.
- No rubber band (`overscroll-behavior: none`), no double-tap zoom.
- Reduce Motion: one rule at the end of the stylesheet makes every transition instant and turns off every slide and fade; a press only darkens.
- Never move, replace or rewrite a button while a finger may be on it (Safari then drops the tap): text goes through `setText`, parts holding
  buttons through `setHtml`, and redraws wait for a tap to land.

## Windows
- A window has its title, then its content, and ONE filled button at most; Cancel or Close is outlined at the bottom.
- A tap on the dark outside closes it; if something was typed, it first asks "Discard what you typed?" (Keep editing is the filled one).
- A background save never redraws behind an open window or a box with focus.
- The first-run setup is the one full-screen window; it has no outside to tap.

## Periods and swipe
A swipe exists exactly where period arrows or period tabs exist (Log's day, Cash flow, Income, Cards, Budget's Month and Per payday), and makes
the same step as the arrow or tab. Never on Per week, never between views, never on something that scrolls sideways. A swipe never taps what is
under the finger.

## Messages say what is saved
A message, toast or window note never says an entry is verified unless the code that saves it verifies it (owner, Nov 16). Typed entries are
drafts: say "Saved. Waiting in Verify." or "Saved as a draft: it waits in Verify and counts once you verify it." `tests/verifiedwords.test.js`
lists every message that claims verified with the code that makes it true.

## Never
No emojis, pills or badges added by the app. No gradients, glows or shadows (the Trends line keeps its one faint fill). No second filled button.
No row tints or group labels in the entry lists. No information said twice on one screen.

## How it is kept
`tests/theme.test.js` holds the colour and card rules today. After the P1-9 fixes an audit test fails when an action is a bare text link outside
Help, or a screen or window has more than one filled button. Before a screen is shown to the owner it goes through the `ui-inspector` skill at
320 and 390 wide, light and dark. `tests/press.test.js` and `tests/feel.test.js` keep the motion and press rules, `tests/swipe.test.js` the swipe,
`tests/verifiedwords.test.js` the messages, and `tests/theme.test.js` fails if a screen named under Bar rows draws its own bar.

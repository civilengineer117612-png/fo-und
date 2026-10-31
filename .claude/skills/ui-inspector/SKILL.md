---
name: ui-inspector
description: Design inspector for this app. Use BEFORE showing the owner any screen, preview, or visible change (new screen, list, form, wording). Checks the draft against the app's own Ledger Paper concept and the owner's recorded taste, from a screenshot of the REAL app, and fixes what it finds before the owner sees it.
---

The owner is not a UI designer but sees at once what is ugly. Do not rely on their eye to find inconsistency: inspect first, show second.

## Procedure (every visible change, no exceptions)
1. Draw it from the REAL app (seed an invented ledger, real CSS classes, a phone-size browser). Never a hand-made mock with its own sizes and colours.
2. Put it next to its closest sibling that already exists (a card next to the Who card and Goals rows; a form next to the payslip form; a list next to Cash flow). The new thing must look like the same product, not a cousin.
3. Run the checklist below on the screenshot. Fix every failure. Then run `.claude/skills/impeccable/scripts/impeccable detect --json app/index.html` once and fix real findings (ignore false positives that CLAUDE.md's rules explain).
4. Only then send the picture. Say in one line what you checked.

## Checklist (any NO is a fix, not a note)
- Colour: only the tokens on `:root` (both papers); no colour of its own; red only for strictly-over-budget charts; exactly ONE filled accent button per screen.
- Cards: white surface, 1px line, 14px radius, no shadow, no side stripe, hairlines between rows.
- Type scale: title 18 (600), row text 15-17, secondary 14, small 13. One figure style: tabular digits, never wrapping (`white-space: nowrap`), a figure never bolder or bigger than the figure above it unless it is THE figure of the card. Rows inside one card share one size: label muted at the left, figure in ink at the right (like Gross and Deductions).
- No repeated information: if a line says it, a second line must not say it again (a category under a label that already names it, a count next to the list it counts, a button repeating its heading).
- Words: plain, short, nothing a user must decode. Banned in visible text unless the owner used them: "lines" for pay items, "printed", "reconcile", "record", "ledger", "revision", any code word. Under a figure use a small picture or sign rather than a sentence. Say a fact once.
- Folds: a fold that is empty starts closed; a heading plus a button that both say "add" is one too many.
- Alignment: every row's label starts at the same x, every figure ends at the same x; nothing wraps in the middle of a figure or a date.
- Touch: targets at least 44px high; quiet text links still get their padding.
- States: empty, one item, very long name, long period, hidden amounts (the Cards eye), Dark paper. Look at each.
- Consistency with names: screen and menu names only from `src/model/names.js`.

## The owner's recorded taste (from their own marks)
Few words. Clean alignment. One thing per row. Cards like the rest of the app. Collapse instead of repeating. No jargon. Bigger only for what matters. If something looks ugly to them it is a failure of this inspection, so look harder before sending.

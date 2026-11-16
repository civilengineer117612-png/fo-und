// TEMPORARY (Nov 16, the bisect): switch off one ONE PRESS rule in app/index.html of the checked-out commit. Fails if the text is not found.
import { readFileSync, writeFileSync } from "node:fs";
const f = "app/index.html"; let h = readFileSync(f, "utf8");
const SEL = ':is(button, .tile, .gcard, .row.tapcard, .swcard[data-action], [role="button"])';
const cut = (s, t = "") => { if (!h.includes(s)) { console.error("not found: " + s); process.exit(1); } h = h.replace(s, t); };
const v = process.argv[2];
if (v === "no-transform" || v === "no-press") cut(`${SEL}:active { transform: scale(.97); transition-duration: var(--t-touch); }`);
if (v === "no-before" || v === "no-press") cut(`${SEL}:active::before { content: ""; position: absolute; inset: -8px; }`);
if (v === "no-relative" || v === "no-press") cut(`{ position: relative; transition: transform var(--t-move)`, `{ transition: transform var(--t-move)`);
if (v === "no-transition" || v === "no-press") {
  cut(`transition: transform var(--t-move) var(--ease-out), background-color var(--t-move) var(--ease-out), filter var(--t-move) var(--ease-out); }`, "}");
  cut(`button { transition: transform var(--t-move) var(--ease-out), background-color var(--t-move) var(--ease-out), filter var(--t-move) var(--ease-out);`, `button { transition: transform var(--t-press) ease, background-color var(--t-press) ease;`);
}
writeFileSync(f, h); console.log("patched: " + v);

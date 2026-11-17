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
const BASE = `:where(button, .tile, .gcard, .row.tapcard, .swcard[data-action], [role="button"]) { position: relative;`;
if (v === "scale-prop") { cut(`${SEL}:active { transform: scale(.97);`, `${SEL}:active { scale: .97;`); }
if (v === "will-change") cut(BASE, BASE + " will-change: transform;");
if (v === "base-transform") cut(BASE, BASE + " transform: scale(1);");
if (v === "no-shrink-in-sheet") h = h.replace("</style>", `#sheet ${SEL}:active { transform: none; }\n</style>`);
if (v === "no-active-duration") cut(`${SEL}:active { transform: scale(.97); transition-duration: var(--t-touch); }`, `${SEL}:active { transform: scale(.97); }`);
if (v === "instant-press") cut(`${SEL}:active { transform: scale(.97); transition-duration: var(--t-touch); }`, `${SEL}:active { transform: scale(.97); transition: none; }`);
writeFileSync(f, h); console.log("patched: " + v);

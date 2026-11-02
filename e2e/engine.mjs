// Which browser engine the e2e scripts drive. ENGINE=chromium (the default) or ENGINE=webkit (Safari's engine, the one on the owner's iPhone).
// Every script gets its browser from here, so the same checks run on both. A check may be skipped ONLY when the test TOOL itself does not exist
// in that engine: `skipped(label, tool)` says which one in one line. A check that fails on WebKit is never loosened to pass.
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
const require = createRequire(import.meta.url);

export const ENGINE = process.env.ENGINE ?? "chromium";
if (!["chromium", "webkit"].includes(ENGINE)) throw new Error("ENGINE must be chromium or webkit, not " + ENGINE);

export const playwright = () => require(process.env.PLAYWRIGHT_MODULE ?? execSync("npm root -g").toString().trim() + "/playwright");

// With E2E_SHOW_CONSOLE set (the WebKit job does), every page's console errors and uncaught errors are printed as they happen, so a step that
// times out says what the page itself complained about. Nothing else changes.
const showConsole = (context) => context.on("page", (page) => {
  page.on("pageerror", (e) => console.log("       page error: " + String(e.message).slice(0, 300)));
  page.on("console", (m) => { if (m.type() === "error" || (m.type() === "warning" && /reader/i.test(m.text()))) console.log("       page console: " + m.text().slice(0, 300)); });   // the reader's own warning says when it falls back
});

// TAP SAFETY (owner, Nov 1, after the Safari P0): Safari's engine drops a tap when the button under the finger changes between the press and the
// release (proved on WebKit: the payslip Save did nothing). A real finger stays down for about a tenth of a second, so anything the app runs when a
// box loses focus runs during the tap. Two things make every e2e click behave like that finger, on both engines:
//  - every click holds the press for TAP_HOLD_MS before the release (Playwright's `delay`), so timers and focus handlers run in between;
//  - a watcher in every page records, between the press and the release, what makes WebKit lose a tap: the tapped button or link (or anything
//    inside it) REPLACED (its contents rewritten), REMOVED from the page, or MOVED. Each place is printed once as "tap-unsafe: ..." and counted
//    (`tapSafety`). A changed attribute (the lift of a held tile, a pressed state) keeps the same element under the finger and is not counted.
//    Only a TAP counts: a press released within TAP_MAX_MS. A longer press is a hold gesture (arrange tiles or rows, play a how-to clip: the app's
//    holds start at 450 ms), which redraws on purpose and cancels its own click.
export const TAP_HOLD_MS = 80, TAP_MAX_MS = 300;
const TAP_WATCH = (MAX) => {
  const TARGET = "button, a, summary, label, [data-action], [role=button], .chip";
  const name = (b) => (b.id ? "#" + b.id : b.tagName.toLowerCase()) + (b.dataset && b.dataset.action ? "[data-action=" + b.dataset.action + "]" : "") + ' "' + (b.textContent || "").trim().replace(/\s+/g, " ").slice(0, 48) + '"';
  // where the button sits on the screen WITHOUT transforms (the pressed look, `button:active { transform: scale(.98) }`, is not a move): its layout
  // place (the offset chain) less every scroll above it, so a fold, a re-flow or a scroll during the tap counts, the squeeze of a pressed button does not
  const place = (el) => { let x = 0, y = 0; for (let n = el; n; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; } for (let n = el.parentElement; n; n = n.parentElement) { x -= n.scrollLeft; y -= n.scrollTop; } return { x, y }; };
  let down = null;
  addEventListener("pointerdown", (e) => {
    const el = e.target instanceof Element ? e.target : e.target && e.target.parentElement;
    const target = el && el.closest(TARGET);
    if (!target) { down = null; return; }
    const seen = new Set(), obs = new MutationObserver((ms) => { for (const m of ms) if (m.type === "childList") seen.add("its contents were replaced"); });
    obs.observe(target, { childList: true, subtree: true });
    down = { target, label: name(target), at: place(target), obs, seen, t0: performance.now() };
  }, true);
  addEventListener("pointerup", () => {
    const d = down; down = null;
    if (!d) return;
    for (const m of d.obs.takeRecords()) if (m.type === "childList") d.seen.add("its contents were replaced");
    d.obs.disconnect();
    if (performance.now() - d.t0 > MAX) return;   // a hold gesture, not a tap
    const why = [...d.seen];
    if (!d.target.isConnected) why.push("it was removed from the page");
    else { const r = place(d.target), dx = r.x - d.at.x, dy = r.y - d.at.y; if (Math.abs(dx) > 1 || Math.abs(dy) > 1) why.push("it moved " + (Math.abs(dy) >= Math.abs(dx) ? Math.round(dy) + " px " + (dy < 0 ? "up" : "down") : Math.round(dx) + " px " + (dx < 0 ? "left" : "right"))); }
    if (why.length) console.warn("tap-unsafe: " + d.label + ": " + why.join(", "));
  }, true);
};
export const tapSafety = new Map();   // "place: what happened" -> how many taps
const watchTaps = async (context) => {
  await context.addInitScript(TAP_WATCH, TAP_MAX_MS);
  context.on("page", (page) => page.on("console", (m) => { const t = m.text(); if (m.type() === "warning" && t.startsWith("tap-unsafe: ")) { const k = t.slice(12); if (!tapSafety.has(k)) console.log("  " + t); tapSafety.set(k, (tapSafety.get(k) ?? 0) + 1); } }));
};
let holdPatched = false;
const holdTaps = (page) => {   // every click (page.click and locator.click both go through Frame.click) holds the press like a finger
  if (holdPatched) return; holdPatched = true;
  const proto = Object.getPrototypeOf(page.mainFrame()), click = proto.click;
  proto.click = function (selector, options = {}) { return click.call(this, selector, { delay: TAP_HOLD_MS, ...options }); };
};
// The count is printed at the end of every script; any place found FAILS the script (owner, Nov 1: the sweep brought it to 0, and it stays 0).
process.on("exit", () => {
  if (!holdPatched) return;
  console.log("tap-safety: " + tapSafety.size + " place(s) where the tapped button changed or moved under the finger");
  if (tapSafety.size) { console.log("  FAIL tap-safety: " + [...tapSafety].map(([k, n]) => k + " (" + n + "x)").join(" | ")); process.exitCode = 1; }
});

export async function launchBrowser() {
  const browser = await playwright()[ENGINE].launch(ENGINE === "chromium" && process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const make = browser.newContext.bind(browser);
  browser.newContext = async (...args) => {
    const context = await make(...args);
    if (process.env.E2E_SHOW_CONSOLE) showConsole(context);
    await watchTaps(context);
    context.on("page", holdTaps);
    return context;
  };
  return browser;
}

// The test tools that only one engine has. Chromium has all of them; WebKit lacks the ones named here.
export const TOOLS = {
  virtualAuthenticator: ENGINE === "chromium",   // the Chrome DevTools "WebAuthn" virtual Face ID (applock.mjs)
  clipboardPermission: ENGINE === "chromium",    // ctx.grantPermissions(["clipboard-read", "clipboard-write"]): Playwright's WebKit has no such permission
  longScreenshot: ENGINE === "chromium",          // a full-page screenshot taller than 32767 px (the Help page): WebKit refuses it; the picture is for review only, never checked
  pictureStore: ENGINE === "chromium",            // IndexedDB keeping a picture (a Blob): Playwright's WebKit build refuses it (engine-probe.mjs: "write error")
  serviceWorkerNetwork: ENGINE === "chromium",   // staging the network (ctx.route) for requests a service worker makes: Playwright's WebKit cannot, so those requests reach the real internet
};

export const skipped = (label, tool) => console.log(`  skip ${label} (${ENGINE} has no ${tool})`);
// The owner's words for the checks that keep a picture (Nov 1): the test build cannot, the phone can.
export const PICTURE_STORE_REASON = "WebKit test build cannot store pictures in IndexedDB; the owner's iPhone does (pictures are saved and backed up there).";
export const skippedPictures = (label) => console.log(`  skip ${label} (${PICTURE_STORE_REASON})`);

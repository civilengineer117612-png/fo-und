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

export async function launchBrowser() {
  const browser = await playwright()[ENGINE].launch(ENGINE === "chromium" && process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  if (process.env.E2E_SHOW_CONSOLE) {
    const make = browser.newContext.bind(browser);
    browser.newContext = async (...args) => { const context = await make(...args); showConsole(context); return context; };
  }
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

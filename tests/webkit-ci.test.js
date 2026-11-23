import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const checks = read(".github/workflows/test.yml"), webkit = read(".github/workflows/webkit.yml"), pages = read(".github/workflows/pages.yml");
const pin = (yaml) => [...yaml.matchAll(/npm install -g playwright(@\S*)?/g)].map((m) => m[1]);

test("Playwright is pinned to the same exact version in both browser jobs", () => {
  const a = pin(checks), b = pin(webkit);
  assert.equal(a.length, 1); assert.equal(b.length, 1);
  assert.match(a[0] ?? "", /^@\d+\.\d+\.\d+$/, "an exact version, never latest or a range");
  assert.equal(a[0], b[0]);
});

test("e2e-webkit runs every script the e2e job runs, on WebKit, and never hides a failure", () => {
  const scripts = (yaml) => [...yaml.matchAll(/node e2e\/([\w-]+)\.mjs/g)].map((m) => m[1]);
  const wanted = scripts(checks).sort();
  assert.deepEqual(wanted, ["amounts", "android", "backup-roundtrip", "backup-share", "buffer-line", "firstrun", "ledger-check", "loans", "logo-privacy", "network", "owed", "payslip-items", "pdf-scan", "photo-payslip", "preview", "reader-fixture", "run", "sheet-scroll", "spending-details", "swipe", "tap-safety", "trial-isolation", "two-windows", "ui-audit", "window-feel"]);
  assert.match(webkit, /^  e2e-webkit:$/m);
  assert.match(webkit, /^      ENGINE: webkit$/m);
  assert.match(webkit, /npx playwright install --with-deps webkit/);
  const list = webkit.match(/for script in ([\w -]+); do/)?.[1].split(" ").sort();
  assert.deepEqual(list, wanted);
  const code = webkit.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");   // comments may say "not flaky"
  assert.doesNotMatch(code, /continue-on-error:|retries|flaky|\|\| true/i);
});

test("the WebKit install has its own time limit: a hung download fails fast, in a few tries, and never repeats a test", () => {
  // Nov 20: apt hung for 28 and 41 minutes in two runs of three, so the 45-minute job ran out before (or soon after) the tests began.
  const step = webkit.slice(webkit.indexOf("- name: Install Playwright and WebKit"), webkit.indexOf("- name: Serve the repository"));
  const limit = Number(step.match(/timeout-minutes: (\d+)/)?.[1]);
  const job = Number(webkit.match(/^    timeout-minutes: (\d+)$/m)?.[1]);
  const each = Number(step.match(/timeout (\d+) npx playwright install --with-deps webkit/)?.[1]);
  const tries = step.match(/for try in ([\d ]+); do/)?.[1].trim().split(/\s+/).length;
  assert.ok(each > 0 && tries >= 2 && tries <= 3, "each try is stopped after a fixed time, and there are at most three");
  assert.ok(limit >= (each / 60) * tries && limit <= job / 2, "the step's own limit covers its tries and leaves the tests most of the job (" + limit + " of " + job + " minutes)");
  assert.match(step, /exit 1\n/, "after the last try the step fails; it is never skipped");
  assert.doesNotMatch(webkit.slice(webkit.indexOf("- name: Run every e2e script on WebKit")), /for try in|timeout \d+ node/, "no test script is ever tried twice");
});

test("the deploy still waits for test and e2e only: WebKit is its own workflow, not part of the reusable checks", () => {
  assert.doesNotMatch(checks, /e2e-webkit|ENGINE/);
  assert.doesNotMatch(pages, /webkit/i);
  assert.match(pages, /uses: \.\/\.github\/workflows\/test\.yml$/m);
  assert.ok(readdirSync(new URL("../.github/workflows/", import.meta.url)).includes("webkit.yml"));
});

test("every script gets its browser from engine.mjs, and a skip names the missing tool", () => {
  for (const f of readdirSync(new URL("../e2e/", import.meta.url)).filter((n) => n.endsWith(".mjs") && n !== "engine.mjs")) {
    const s = read("e2e/" + f);
    assert.doesNotMatch(s, /\bchromium\.launch\b|\{ chromium \}/, f + " must not start Chromium by itself");
  }
  const engine = read("e2e/engine.mjs");
  assert.match(engine, /virtualAuthenticator: ENGINE === "chromium"/);
  assert.match(engine, /clipboardPermission: ENGINE === "chromium"/);
  assert.match(read("e2e/run.mjs"), /skipped\("App lock \(the virtual Face ID checks\)", "Chrome DevTools virtual authenticator \(WebAuthn\)"\)/);
  assert.match(read("e2e/pdf-scan.mjs"), /skipped\('Copy layout report \(the clipboard text\)', 'permission to read the clipboard'\)/);
  // the only tool-based skips in all of e2e: nothing else may be skipped on one engine
  const skips = readdirSync(new URL("../e2e/", import.meta.url)).filter((n) => n.endsWith(".mjs")).flatMap((n) => [...read("e2e/" + n).matchAll(/\bskipped\(/g)]);
  // Nov 23: Playwright's mobile WebKit has no mouse wheel; only window-feel's sideways-scroll step skips, its style check runs on both engines
  assert.match(engine, /mouseWheel: ENGINE === "chromium"/);
  assert.match(read("e2e/window-feel.mjs"), /skipped\("a sideways scroll with a row pressed", "mouse wheel"\)/);
  assert.equal(skips.length, 4, "engine.mjs defines it; run.mjs, pdf-scan.mjs and window-feel.mjs use it once each");
});

test("on WebKit the network fake cannot reach a service worker, so only the Offline section keeps one", () => {
  const run = read("e2e/run.mjs");
  assert.match(read("e2e/engine.mjs"), /serviceWorkerNetwork: ENGINE === "chromium"/);
  assert.match(run, /blockSw = !TOOLS\.serviceWorkerNetwork,/);
  const offline = run.match(/\(\{ ctx, page, errors \} = await open\(\{ blockSw: false \}\)\);[^\n]*\nawait page\.evaluate\(\(\) => navigator\.serviceWorker\.ready/);
  assert.ok(offline, "the Offline section opens with the service worker allowed");
  assert.equal([...run.matchAll(/navigator\.serviceWorker/g)].length, 2, "no other section tests the service worker");
});

test("run.mjs: every block runs and reports; one step that throws stops only its own block", () => {
  const run = read("e2e/run.mjs"), lines = run.split("\n");
  const marks = lines.map((l, i) => [l, i]).filter(([l]) => l.startsWith("// ===== "));
  assert.ok(marks.length > 50, "the blocks are still marked");
  for (const [l, i] of marks) assert.match(lines[i + 1], /^try \{ blockName = ".+";( if \(!TOOLS\.pictureStore\) skippedPictures\(blockName\); else \{)?$/, "the block after " + l + " runs in its own try");
  assert.equal([...run.matchAll(/^.*catch \(e\) \{ await blockFailed\(e\); \}$/gm)].length, marks.length + 2, "every block, the storage checks and the app lock end in the same catch");
  const first = marks[0][1];
  assert.deepEqual(lines.slice(first).filter((l) => /^(const|let|function|async function) /.test(l)), [], "a block's own top-level names are var, so the blocks after it still see them");
  assert.match(run, /const blockFailed = async \(e\) => \{ failures\+\+;/, "a stopped block counts as a failure");
});

test("checks that keep a picture are skipped on WebKit with the owner's reason, and only those", () => {
  const engine = read("e2e/engine.mjs"), run = read("e2e/run.mjs");
  assert.match(engine, /pictureStore: ENGINE === "chromium"/);
  assert.ok(engine.includes('"WebKit test build cannot store pictures in IndexedDB; the owner\'s iPhone does (pictures are saved and backed up there)."'), "the owner's words, exactly");
  const blocks = [...run.matchAll(/^try \{ blockName = "(.+)"; if \(!TOOLS\.pictureStore\) skippedPictures\(blockName\); else \{$/gm)].map((m) => m[1]);
  assert.equal([...run.matchAll(/skippedPictures\(/g)].length, 10, "the nine blocks, and 5f from saving its photo on");
  assert.match(run, /if \(!TOOLS\.pictureStore\) \{ skippedPictures\("5f from saving the photo on: /);
  assert.deepEqual(blocks, ["5f3. one receipt, two categories", "5f4. money moved between your own accounts: last 4 digits, the scan window, Verify, a repeat", "5f7. quick capture from the scanner button on the Log screen", "5f8. closing the app right after the photo: nothing is lost, it is read the next time the app opens", "5f9. when the paper does not name the account, the photo is kept and the app asks instead of guessing", "5k. Read now while the app is already reading by itself", "5x. old pictures are shrunk, recent ones are not", '5x2. \\"Shrink them now\\"', "5y. the Pictures file: back up, lose the pictures, put them back"]);
});

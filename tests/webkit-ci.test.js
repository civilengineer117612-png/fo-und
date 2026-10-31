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
  assert.deepEqual(wanted, ["ledger-check", "payslip-items", "pdf-scan", "run", "spending-details"]);
  assert.match(webkit, /^  e2e-webkit:$/m);
  assert.match(webkit, /^      ENGINE: webkit$/m);
  assert.match(webkit, /npx playwright install --with-deps webkit/);
  const list = webkit.match(/for script in ([\w -]+); do/)?.[1].split(" ").sort();
  assert.deepEqual(list, wanted);
  const code = webkit.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");   // comments may say "not flaky"
  assert.doesNotMatch(code, /continue-on-error:|retries|flaky|\|\| true/i);
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
  assert.equal(skips.length, 3, "engine.mjs defines it; run.mjs and pdf-scan.mjs use it once each");
});

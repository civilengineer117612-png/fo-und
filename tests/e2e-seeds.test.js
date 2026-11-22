// A11 (overhaul, Nov 20): a long e2e block is cut into sections, and each later section starts a fresh phone from its OWN ledger in
// e2e/fixtures/seeds/<name>.json (recorded once from the real screens with E2E_RECORD_SEEDS=1; invented data). These tests keep that honest:
// every seed a section asks for exists, none lies unused, each one is a ledger the app opens as it is, with no problem and nothing real in it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { parseLedger, LEDGER_VERSION, ledgerProblems, selfCheck } from "../src/model/index.js";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const run = read("e2e/run.mjs");
const asked = [...run.matchAll(/await fromSeed\("([^"]+)"/g)].map((m) => m[1]);
const files = readdirSync(new URL("../e2e/fixtures/seeds/", import.meta.url)).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));

test("every section that starts from a seed has its file, and no seed file lies unused", () => {
  assert.ok(asked.length >= 14, "the sections of 5e start from their own ledger (" + asked.length + ")");
  assert.equal(new Set(asked).size, asked.length, "each section has its own seed");
  assert.deepEqual([...files].sort(), [...asked].sort());
});

test("a seed section is its own block: it opens its own phone right after its own try line", () => {
  const lines = run.split("\n");
  for (const name of asked) {
    const at = lines.findIndex((l) => l.includes('await fromSeed("' + name + '"'));
    assert.match(lines[at - 1], /^try \{ blockName = ".+";( if \(!TOOLS\.pictureStore\) skippedPictures\(blockName\); else \{)?$/, name + " starts its block (a block that keeps a picture skips on WebKit before it opens a phone)");
    assert.match(lines[at - 2], /^\/\/ ===== /, name + " is a marked block");
  }
  assert.match(run, /async function fromSeed\(name, opts = \{\}\) \{\n  const file = new URL\("\.\/fixtures\/seeds\/" \+ name \+ "\.json", import\.meta\.url\);/);
  assert.match(run, /return open\(\{ \.\.\.opts, seed: ledger, now: new Date\(saved\.now\) \}\);/, "the clock starts where the section before left it");
});

test("the helpers every block shares are defined before the first block, not inside one", () => {
  const first = run.indexOf("\n// ===== ");
  for (const name of ["logPreset", "logOther", "verifyAll"]) {
    const at = run.indexOf("const " + name + " = async");
    assert.ok(at > 0 && at < first, name + " is defined before any block, so 5g and 5vd never need 5e to have run");
    assert.ok(!run.includes("var " + name + " ="), name + " is not defined again inside a block");
  }
});

test("5f is cut into its own blocks; the pictures it draws and the viewer's close live above the first block", () => {
  const first = run.indexOf("\n// ===== ");
  assert.equal([...run.matchAll(/^\/\/ ===== 5f[3-9]\. /gm)].length, 7, "5f3 to 5f9 are blocks of their own");
  for (const name of ["receiptPicture", "bankPicture", "closeViewer"]) {
    const at = run.search(new RegExp("^const " + name + " = ", "m"));
    assert.ok(at > 0 && at < first, name + " is defined before any block, so 5f2, 5j and 5k never need 5f to have run");
    assert.ok(!run.includes("var " + name + " ="), name + " is not defined again inside a block");
  }
});

test("6w is cut into its own blocks, and the invented ledgers they share live above the first block", () => {
  const first = run.indexOf("\n// ===== ");
  assert.ok([...run.matchAll(/^\/\/ ===== 6w\d*\. /gm)].length >= 19, "6w is 19 blocks");
  for (const name of ["waiting", "acct", "TSW", "seedW", "acc2", "seedC", "FX", "accS", "importer", "pkAcc", "mainG", "pocketSeed", "settingsOf"]) {
    const at = run.search(new RegExp("^const " + name + " = ", "m"));
    assert.ok(at > 0 && at < first, name + " is defined before any block, so a 6w block never needs another one to have run");
  }
});

for (const name of files) test("seed " + name + " is a current ledger the app opens, with no problem and only invented data", () => {
  const saved = JSON.parse(read("e2e/fixtures/seeds/" + name + ".json"));
  assert.ok(!Number.isNaN(Date.parse(saved.now)) && saved.now.startsWith("2026-"), "its clock is a fixed invented day");
  const parsed = parseLedger(JSON.stringify(saved.ledger));
  assert.ok(parsed.ok, "it loads: " + parsed.error);
  assert.equal(saved.ledger.v, LEDGER_VERSION, "it is in the current data version (record again after a migration)");
  assert.deepEqual(ledgerProblems(parsed.ledger.state), [], "the ledger check finds nothing");
  assert.deepEqual(selfCheck(parsed.ledger), [], "the self-check passes");
  const text = JSON.stringify(saved.ledger);
  assert.doesNotMatch(text, /https?:\/\//, "no outside address is kept (pictures are copies, data: only)");
  // A long number could be an account number. The only ones allowed are those the test itself invents: written in run.mjs (the
  // reference number on the drawn transfer picture) or the seed's own fixed clock in milliseconds (inside an id the app makes).
  const invented = new Set([...run.matchAll(/\b\d{10,}\b/g)].map((m) => m[0]).concat(String(Date.parse(saved.now))));
  assert.deepEqual([...text.matchAll(/\b\d{10,}\b/g)].map((m) => m[0]).filter((n) => !invented.has(n)), [], "no long number that could be an account number");
});

test("a seed stays as it was recorded when a later PR adds a What's new line: it is opened with the newest line already seen", () => {
  assert.match(run, /const ledger = opts\.whatsNew \? saved\.ledger : \{ \.\.\.saved\.ledger, settings: \{ \.\.\.saved\.ledger\.settings, whatsnew_seen: CHANGES\[0\]\.id, version_seen: \"999\.0\.0\" \} \};\n  return open\(\{ \.\.\.opts, seed: ledger, now: new Date\(saved\.now\) \}\);/);
});

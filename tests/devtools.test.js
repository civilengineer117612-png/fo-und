// GRAPHIFY (owner, Nov 12): a private developer tool that maps the code so the build agent can find things. It is never part of the app, the
// tests or CI: its output is ignored by git, and nothing the app, a test or a workflow runs may name it. The graph is never proof of anything.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";

const root = new URL("../", import.meta.url);
const files = (dir) => readdirSync(new URL(dir, root)).flatMap((n) => { const p = dir + n; return statSync(new URL(p, root)).isDirectory() ? files(p + "/") : [p]; });

test("graphify's output is ignored by git", () => {
  const ignore = readFileSync(new URL(".gitignore", root), "utf8").split("\n").map((l) => l.trim());
  for (const line of ["graphify-out/", ".graphifyignore", ".graphifyrc"]) assert.ok(ignore.includes(line), line);
});

test("nothing the app, a test or a workflow runs names graphify", () => {
  const used = [...files("app/"), ...files("src/model/"), ...files("e2e/"), ...files("tests/"), ...files("tools/"), ...files(".github/"), "package.json", "index.html", "sw.js"]
    .filter((p) => /\.(m?js|json|ya?ml|html)$/.test(p) && p !== "tests/devtools.test.js");
  const named = used.filter((p) => /graphify/i.test(readFileSync(new URL(p, root), "utf8")));
  assert.deepEqual(named, []);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BANKS } from "../src/model/index.js";

// The brag skill makes a video of the app. The repo is PUBLIC, so the rules that keep it safe are tested, not just written down.
const dir = new URL("../.claude/skills/brag/", import.meta.url), script = readFileSync(new URL("make-video.mjs", dir), "utf8"), skill = readFileSync(new URL("SKILL.md", dir), "utf8");

test("the skill has a name, a description that says when to use it, and the owner's rules", () => {
  const head = /^---\nname: brag\ndescription: (.+)\n---/.exec(skill);
  assert.ok(head && /brag/.test(head[1]) && /INVENTED/.test(head[1]), "front matter names the skill and says the data is invented");
  for (const rule of ["INVENTED data only", "No brand logos and no real bank names", "NEVER committed", "needs the owner's explicit yes", "No paid or AI service", "ui-inspector"]) assert.ok(skill.includes(rule), "the skill states: " + rule);
});

test("it refuses to write the video inside the repository (nothing is created, exit code 2)", () => {
  const repo = new URL("../", import.meta.url).pathname.replace(/\/$/, ""), inside = join(repo, ".brag-test-out");
  const r = spawnSync("node", [new URL("make-video.mjs", dir).pathname, "--out", inside], { encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 2); assert.match(r.stderr, /Refusing to write the video inside the repository/);
  assert.ok(!existsSync(inside), "the folder was not made");
  const out = mkdtempSync(join(tmpdir(), "brag-guard-")); rmSync(out, { recursive: true });   // an outside folder is allowed: the refusal is only about the repo
});

test("the script has no network address but its own scratch server, no bank or brand name, and the default folder is outside the repo", () => {
  const urls = [...script.matchAll(/https?:\/\/[^\s"'`)]+/g)].map((m) => m[0]);
  assert.deepEqual(urls.filter((u) => !/^http:\/\/(127\.0\.0\.1|x)\b/.test(u)), [], "only the local scratch server is ever addressed");
  assert.match(script, /route\("\*\*\/\*", \(route\) => new URL\(route\.request\(\)\.url\(\)\)\.origin === new URL\(base\)\.origin \? route\.continue\(\) : route\.abort\(\)\)/, "every request but the scratch server's is aborted");
  const text = script.toLowerCase();
  for (const b of BANKS) for (const name of [b.name, ...(b.aka ?? [])]) assert.ok(!text.includes(name.toLowerCase()), "no real bank or wallet name in the script: " + name);
  assert.match(script, /arg\("out", join\(tmpdir\(\), "brag"\)\)/, "the default output is the system temp folder");
  assert.ok(!/git (add|commit)/.test(script), "the script never commits anything");
});

test("the seeded names are invented: every account and payee starts with Sample or is a plain word", () => {
  const names = [...script.matchAll(/acct\("\w+", "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(names.sort(), ["Cash", "Sample Card", "Sample Savings", "Sample Wallet"]);
  const payees = [...script.matchAll(/(?:spend|income)\("[\d-]+", "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(payees.length >= 15);
  for (const p of payees) assert.ok(/^(Sample |Rent$|Dinner out$|Light and water$|Cleaning supplies$|Bus fare$|Ride$|Fuel$|Streaming$|Pharmacy$|Movie night$|Lunch$)/.test(p), "invented payee: " + p);
});

test("the claims on the title and end cards stay inside what CLAUDE.md allows", () => {
  const cards = [...script.matchAll(/card\(`([^`]+)`\)/g)].map((m) => m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
  assert.ok(cards.length >= 2);
  for (const c of cards) for (const banned of [/never leaves/i, /bank-grade/i, /\bAI\b/, /military/i, /100%/, /guarantee/i]) assert.ok(!banned.test(c), `card says ${banned}: ${c}`);
  assert.ok(cards.some((c) => /Free/.test(c)) && cards.some((c) => /stay on your phone/.test(c)));
});

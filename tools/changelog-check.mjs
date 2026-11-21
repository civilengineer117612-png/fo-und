// CI (owner, Nov 21, P2-13): a pull request that changes app/ or src/model/ adds one plain line under "Unreleased" in CHANGELOG.md, or says
// "no user-facing change" in its description. Run by the "test" job on a pull request: BASE_SHA is the base commit, PR_BODY the description.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { changelogCheck } from "../src/model/changelog.js";
const base = process.env.BASE_SHA;
if (!base) { console.log("changelog check: not a pull request, nothing to check"); process.exit(0); }
const git = (...a) => execFileSync("git", a, { encoding: "utf8" });
try { git("cat-file", "-e", base + "^{commit}"); } catch { git("fetch", "--depth=1", "origin", base); }
const files = git("diff", "--name-only", base, "HEAD").split("\n").filter(Boolean);
let before = null; try { before = git("show", base + ":CHANGELOG.md"); } catch { before = null; }
const after = existsSync("CHANGELOG.md") ? readFileSync("CHANGELOG.md", "utf8") : null;
const r = changelogCheck({ files, before, after, body: process.env.PR_BODY ?? "" });
console.log((r.ok ? "changelog check: ok, " : "changelog check: FAILED. ") + r.why);
process.exit(r.ok ? 0 : 1);

// VERSIONS AND RELEASE NOTES (owner, Nov 21, P2-13). CHANGELOG.md is the one source; the app ships a copy made by tools/make-changelog.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sinceLabel, parseChangelog, compareVersions, isVersion, nextVersion, cutRelease, missedReleases, currentVersion, versionLine, changelogCheck, noteCount, GROUPS } from "../src/model/changelog.js";
import { CHANGELOG_TEXT } from "../src/model/changelogtext.js";
import { changelogModule } from "../tools/make-changelog.mjs";
const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const LOG = read("CHANGELOG.md");
const sample = (u = "### Fixed\n- A fix.\n") => `# Changelog\n\n## Unreleased\n\n${u}\n## 1.1.0 (2026-12-20)\n\n### New\n- Trips by year.\n### Fixed\n- A date.\n\n## 1.0.0 (2026-12-01)\n\n### New\n- The first version.\n`;

test("the app ships exactly CHANGELOG.md (run node tools/make-changelog.mjs after editing it)", () => {
  assert.equal(CHANGELOG_TEXT, LOG);
  assert.equal(read("src/model/changelogtext.js"), changelogModule(LOG));
});
test("CHANGELOG.md reads cleanly, and its notes follow the owner's rules: plain lines, no figures, no PR numbers, no brand of phone", () => {
  const log = parseChangelog(LOG);
  assert.deepEqual(log.problems, []);
  const notes = [log.unreleased, ...log.releases.map((r) => r.notes)].flatMap((n) => GROUPS.flatMap(([k]) => n[k]));
  assert.ok(notes.length > 0);
  for (const n of notes) {
    assert.doesNotMatch(n, /\d/, "no figures or numbers: " + n);
    assert.doesNotMatch(n, /#\d|\bPR\b|pull request/i, "no PR numbers: " + n);
    assert.doesNotMatch(n, /\biPhone\b|\bAndroid\b|\bSafari\b|\biOS\b|Face ID/, "no brand of phone: " + n);
    assert.ok(n.length <= 170, "one plain line: " + n);
  }
});
test("versions compare as numbers, never as text", () => {
  assert.equal(compareVersions("1.10.0", "1.9.0"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("1.2.3", "2.0.0"), -1);
  assert.ok(isVersion("1.2.3") && !isVersion("1.02.3") && !isVersion("v1.2.3") && !isVersion("1.2"));
});
test("the next number follows the owner's rule: the first is 1.0.0, MAJOR breaks habits or data, MINOR has new features, PATCH is fixes only", () => {
  const notes = (n, i, f) => ({ new: Array(n).fill("x"), improved: Array(i).fill("x"), fixed: Array(f).fill("x") });
  assert.equal(nextVersion(null, notes(1, 0, 0)), "1.0.0");
  assert.equal(nextVersion("1.2.3", notes(1, 0, 1)), "1.3.0");
  assert.equal(nextVersion("1.2.3", notes(0, 1, 1)), "1.2.4", "Improved and Fixed only: a patch");
  assert.equal(nextVersion("1.2.3", notes(0, 0, 1), { major: true }), "2.0.0");
});
test("a release moves Unreleased under the new number, dated, leaves Unreleased empty, and refuses when there is nothing to release", () => {
  const r = cutRelease(sample("### New\n- Budget by year.\n### Fixed\n- A fix.\n"), { date: "2027-01-05" });
  assert.equal(r.version, "1.2.0");
  const log = parseChangelog(r.text);
  assert.deepEqual(log.problems, []);
  assert.equal(noteCount(log.unreleased), 0);
  assert.deepEqual(log.releases.map((x) => [x.version, x.date]), [["1.2.0", "2027-01-05"], ["1.1.0", "2026-12-20"], ["1.0.0", "2026-12-01"]]);
  assert.deepEqual(log.releases[0].notes, { new: ["Budget by year."], improved: [], fixed: ["A fix."] });
  assert.equal(cutRelease(sample(""), { date: "2027-01-05" }).ok, false);
  // RELEASED (owner, Nov 22): the overhaul's notes became 1.0.0, the first version (later lines under Unreleased do not change that).
  const live = parseChangelog(LOG);
  const first = live.releases.at(-1);
  assert.equal(first.version, "1.0.0", "the first version is 1.0.0");
  assert.equal(first.date, "2026-11-22");
  assert.ok(noteCount(first.notes) > 0, "1.0.0 carries the overhaul's notes");
});
test("What's new: every version missed, newest first; once seen, nothing; an older phone sees them all once; nothing while no version exists", () => {
  const log = parseChangelog(sample());
  assert.deepEqual(missedReleases(log, "1.0.0").map((r) => r.version), ["1.1.0"]);
  assert.deepEqual(missedReleases(log, "0.0.0").map((r) => r.version), ["1.1.0", "1.0.0"], "several missed: all of them, newest first");
  assert.deepEqual(missedReleases(log, undefined).map((r) => r.version), ["1.1.0", "1.0.0"], "a phone in use before versions began");
  assert.deepEqual(missedReleases(log, "1.1.0"), [], "shown once: the version seen is the newest");
  assert.deepEqual(missedReleases(parseChangelog(LOG), undefined).map((r) => r.version), ["1.0.0"], "the owner's phone, in use before versions began, sees 1.0.0 once");
  assert.deepEqual(missedReleases(parseChangelog("# Changelog\n\n## Unreleased\n\n### New\n- A thing.\n"), undefined), [], "no version released yet: no pop-up");
});
test("a new phone gets the first-run setup, never What's new: it starts having seen the current version", () => {
  const app = read("app/app.js");
  assert.match(app, /version_seen: M\.currentVersion\(M\.CHANGELOG\) \?\? "0\.0\.0"/);
  assert.match(app, /const missed = M\.missedReleases\(M\.CHANGELOG, ledger\.settings\.version_seen\);/);
  assert.match(app, /version_seen: M\.currentVersion\(M\.CHANGELOG\) \}/, "seen once it has opened");
  const log = parseChangelog(sample());
  assert.deepEqual(missedReleases(log, currentVersion(log)), [], "a phone set up on 1.1.0 sees nothing");
});
test("About this app tells builds apart: the version and the build date between releases", () => {
  const log = parseChangelog(sample());
  assert.equal(versionLine(log, { built: "Nov 21, 2026", build: "abc1234", dev: false }), "Version 1.1.0 · build of Nov 21, 2026 (abc1234)");
  assert.equal(versionLine(parseChangelog(LOG), { built: "Nov 22, 2026", build: "abc1234", dev: false }), "Version 1.0.0 · build of Nov 22, 2026 (abc1234)");
  assert.equal(versionLine(parseChangelog("# Changelog\n\n## Unreleased\n\n### New\n- A thing.\n"), { built: "Nov 21, 2026", build: "abc1234", dev: false }), "Not released yet (the first version is 1.0.0) · build of Nov 21, 2026 (abc1234)");
  assert.match(versionLine(log, { dev: true }), /development copy/);
});
test("CI: an app change needs a new line under Unreleased, unless the description says no user-facing change", () => {
  const before = sample(), withLine = sample("### Fixed\n- A fix.\n- Another fix.\n");
  assert.equal(changelogCheck({ files: ["app/app.js"], before, after: before, body: "" }).ok, false);
  assert.equal(changelogCheck({ files: ["src/model/money.js"], before, after: before, body: "" }).ok, false);
  assert.equal(changelogCheck({ files: ["app/app.js", "CHANGELOG.md"], before, after: withLine, body: "" }).ok, true);
  assert.equal(changelogCheck({ files: ["app/app.js"], before, after: before, body: "Tests only.\nNo user-facing change." }).ok, true);
  assert.equal(changelogCheck({ files: ["tests/x.test.js", "docs/WORKFLOW.md"], before, after: before, body: "" }).ok, true);
  assert.equal(changelogCheck({ files: ["app/app.js"], before: null, after: withLine, body: "" }).ok, true, "the first changelog counts");
  assert.equal(changelogCheck({ files: ["CHANGELOG.md", "src/model/changelogtext.js"], before: withLine, after: LOG, body: "" }).ok, true, "a release changes no app file, so it needs no new line");
  assert.equal(changelogCheck({ files: ["app/app.js"], before, after: "## 1.x (2026-01-01)\n", body: "" }).ok, false, "an unreadable changelog fails");
  const yml = read(".github/workflows/test.yml");
  assert.match(yml, /- name: A changelog line for a change users see\n\s+if: github\.event_name == 'pull_request'\n\s+env:\n\s+BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \}\}\n\s+PR_BODY: \$\{\{ github\.event\.pull_request\.body \}\}\n\s+run: node tools\/changelog-check\.mjs/, "the description reaches the script only as an environment value");
});
test("a release never blocks the browser tests: every e2e ledger that marks What's new seen also marks a version far ahead as seen", async () => {
  const { readdirSync } = await import("node:fs");
  const dir = new URL("../e2e/", import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".mjs"))) {
    const text = readFileSync(new URL(f, dir), "utf8");
    for (const m of text.matchAll(/whatsnew_seen: [^,}]+([,}])([^\n]{0,60})/g)) assert.match(m[2], /version_seen/, f + ": " + m[0].slice(0, 80));
  }
});

test("the heading over changes after the last version says since when, never 'not released' (every merge is already on the phone)", () => {
  assert.equal(sinceLabel(parseChangelog("## Unreleased\n\n### Fixed\n- A fix.\n")), "Before version 1.0.0");
  assert.equal(sinceLabel(parseChangelog("## Unreleased\n\n## 1.2.0 (2026-12-01)\n\n### New\n- A thing.\n")), "Since version 1.2.0");
});

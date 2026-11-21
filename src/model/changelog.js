// VERSIONS AND RELEASE NOTES (owner, Nov 21, P2-13). CHANGELOG.md is the one source: "Unreleased" collects one plain line per user-facing change
// in three groups (New, Improved, Fixed); the owner declares a release and it becomes "## 1.2.3 (2026-12-01)". Every merge still deploys at once
// (Option A): a version is a name the owner gives a set of merges, not a deploy. Pure functions only; the app reads the text from changelogtext.js.

export const GROUPS = [["new", "New"], ["improved", "Improved"], ["fixed", "Fixed"]];
const emptyNotes = () => ({ new: [], improved: [], fixed: [] });
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export const isVersion = (v) => VERSION.test(String(v ?? ""));
// -1, 0 or 1, like a sort: 1.10.0 is after 1.9.0 (numbers, never text).
export function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}

// The text of CHANGELOG.md -> { unreleased: {new, improved, fixed}, releases: [{version, date, notes}] newest first, problems: [...] }.
// A release heading is "## 1.2.3 (2026-12-01)"; a group heading "### New" / "### Improved" / "### Fixed"; a note is "- one line".
export function parseChangelog(text) {
  const out = { unreleased: emptyNotes(), releases: [], problems: [] };
  let section = null, group = null;
  for (const [i, raw] of String(text).split(/\r?\n/).entries()) {
    const line = raw.trimEnd();
    let m;
    if (/^## Unreleased\s*$/.test(line)) { section = out.unreleased; group = null; continue; }
    if ((m = /^## (\S+) \((\d{4}-\d{2}-\d{2})\)\s*$/.exec(line))) {
      if (!isVersion(m[1])) { out.problems.push(`line ${i + 1}: "${m[1]}" is not a version like 1.2.3`); section = null; continue; }
      const r = { version: m[1], date: m[2], notes: emptyNotes() };
      out.releases.push(r); section = r.notes; group = null; continue;
    }
    if (/^## /.test(line)) { out.problems.push(`line ${i + 1}: a heading the app cannot read: ${line}`); section = null; continue; }
    if ((m = /^### (New|Improved|Fixed)\s*$/.exec(line))) { group = m[1].toLowerCase(); continue; }
    if ((m = /^- (.+)$/.exec(line))) {
      if (!section || !group) { if (section) out.problems.push(`line ${i + 1}: a note outside New, Improved or Fixed`); continue; }
      section[group].push(m[1].trim());
    }
  }
  for (let k = 1; k < out.releases.length; k++) if (compareVersions(out.releases[k - 1].version, out.releases[k].version) <= 0) out.problems.push(`${out.releases[k - 1].version} must come above ${out.releases[k].version} (newest first)`);
  return out;
}

export const noteCount = (notes) => GROUPS.reduce((n, [k]) => n + (notes?.[k]?.length ?? 0), 0);
// The newest released version, or null while nothing has been released (the overhaul ends at 1.0.0).
export const currentVersion = (log) => log.releases[0]?.version ?? null;

// The next number by the owner's rule: MAJOR when habits or data change ("major"), MINOR for new features (any New line), PATCH for fixes only.
// The first release is 1.0.0 whatever its notes.
export function nextVersion(current, notes, { major = false } = {}) {
  if (!current) return "1.0.0";
  const [a, b, c] = current.split(".").map(Number);
  if (major) return `${a + 1}.0.0`;
  if (notes.new.length) return `${a}.${b + 1}.0`;
  return `${a}.${b}.${c + 1}`;
}

// The release step the agent runs when the owner says "release": "Unreleased" becomes the new version, dated, and an empty "Unreleased" is
// left for the next changes. Refuses when there is nothing to release.
export function cutRelease(text, { date, major = false }) {
  const log = parseChangelog(text);
  if (!noteCount(log.unreleased)) return { ok: false, error: "Nothing under Unreleased to release." };
  const version = nextVersion(currentVersion(log), log.unreleased, { major });
  const lines = String(text).split("\n"), at = lines.findIndex((l) => /^## Unreleased\s*$/.test(l));
  let end = lines.findIndex((l, i) => i > at && /^## /.test(l)); if (end < 0) end = lines.length;
  const body = GROUPS.filter(([k]) => log.unreleased[k].length).flatMap(([k, title]) => ["", `### ${title}`, ...log.unreleased[k].map((n) => `- ${n}`)]);
  const next = [...lines.slice(0, at), "## Unreleased", "", `## ${version} (${date})`, ...body, "", ...lines.slice(end)].join("\n").replace(/\n{3,}/g, "\n\n");
  return { ok: true, version, text: next };
}

// What "What's new" shows after an update: every released version newer than the one this phone last saw, newest first. A phone that never saw
// a version (it was in use before versions began) sees all of them, once. Nothing while no version is released.
export function missedReleases(log, seen) {
  if (!log.releases.length) return [];
  if (!isVersion(seen)) return log.releases;
  return log.releases.filter((r) => compareVersions(r.version, seen) > 0);
}

// The line Setup, About this app shows: the version and the build it came in, so two builds between releases can be told apart.
export function versionLine(log, { built, build, dev }) {
  const v = currentVersion(log);
  const name = v ? `Version ${v}` : "Not released yet (the first version is 1.0.0)";
  if (dev) return `${name} · development copy`;
  return `${name} · build of ${built}${build ? ` (${build})` : ""}`;
}

// CI (owner's rule): a pull request that changes app/ or src/model/ must add a line under Unreleased, unless its description says
// "no user-facing change". `files`: the changed paths; `before`/`after`: CHANGELOG.md on the base and on the pull request (text or null).
export function changelogCheck({ files, before, after, body }) {
  const touches = files.some((f) => /^(app|src\/model)\//.test(f) && f !== "src/model/changelogtext.js");
  if (!touches) return { ok: true, why: "no app file changed" };
  if (/no user-facing change/i.test(body ?? "")) return { ok: true, why: "the description says no user-facing change" };
  const a = parseChangelog(before ?? ""), b = parseChangelog(after ?? "");
  if (b.problems.length) return { ok: false, why: "CHANGELOG.md cannot be read: " + b.problems.join("; ") };
  const old = new Set(GROUPS.flatMap(([k]) => a.unreleased[k].map((n) => k + ":" + n)));
  const added = GROUPS.flatMap(([k]) => b.unreleased[k].filter((n) => !old.has(k + ":" + n)));
  return added.length ? { ok: true, why: added.length + " new line" + (added.length === 1 ? "" : "s") + " under Unreleased" }
    : { ok: false, why: 'This changes the app but adds no line under "Unreleased" in CHANGELOG.md (New, Improved or Fixed). If nothing changes for a user, say "no user-facing change" in the pull request description.' };
}

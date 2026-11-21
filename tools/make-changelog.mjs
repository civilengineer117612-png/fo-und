// node tools/make-changelog.mjs : copies CHANGELOG.md into src/model/changelogtext.js, so the app ships the notes it shows (the site serves app/
// and src/model only). tests/changelog.test.js fails when the two differ, so a new line in CHANGELOG.md is never forgotten in the app.
import { readFileSync, writeFileSync } from "node:fs";
export const changelogModule = (text) => `// MADE BY tools/make-changelog.mjs FROM CHANGELOG.md: do not edit by hand (tests/changelog.test.js keeps the two equal).\nexport const CHANGELOG_TEXT = ${JSON.stringify(text)};\n`;
if (import.meta.url === `file://${process.argv[1]}`) {
  const root = new URL("../", import.meta.url);
  writeFileSync(new URL("src/model/changelogtext.js", root), changelogModule(readFileSync(new URL("CHANGELOG.md", root), "utf8")));
  console.log("src/model/changelogtext.js made from CHANGELOG.md");
}

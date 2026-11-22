// DECISION 5 (owner, Nov 22): a backup holds EVERYTHING the owner keeps on the phone. The pictures part of that: attached pictures AND photos waiting in the
// reading queue (settings.scan_queue), which were left out before (a restore then quietly dropped them). The whole ledger, every setting included, was
// already in the file; e2e/backup-roundtrip.mjs proves backup, wipe and restore give back every store.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { keptPictureIds, emptyLedger } from "../src/model/index.js";

test("keptPictureIds: attached pictures first, then photos waiting in the reading queue, each once", () => {
  const l = emptyLedger();
  l.state.attachments = [{ id: "p1" }, { id: "p2" }];
  l.settings = { scan_queue: [{ id: "q1", at: "2026-10-01T08:00:00+08:00" }, { id: "p2", at: "x" }] };
  assert.deepEqual(keptPictureIds(l), ["p1", "p2", "q1"]);
  assert.deepEqual(keptPictureIds(emptyLedger()), []);
  assert.deepEqual(keptPictureIds({ state: {}, settings: {} }), []);
});

test("the app backs up, checks and restores the pictures keptPictureIds names (never only the attached ones)", () => {
  const js = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
  assert.equal((js.match(/S\(\)\.attachments \?\? \[\]\)\.map\(\(a\) => a\.id\)/g) ?? []).length, 0, "no backup or restore path lists only the attached pictures");
  assert.ok((js.match(/M\.keptPictureIds\(/g) ?? []).length >= 5, "backup, pictures file, check and both restores use keptPictureIds");
});

test("the words match: Who's name is kept in your backups, and Help says a backup holds the photos", () => {
  const js = readFileSync(new URL("../app/app.js", import.meta.url), "utf8"), art = readFileSync(new URL("../src/model/helpart.js", import.meta.url), "utf8");
  assert.ok(js.includes("Who is this? (kept on this phone and in your backups)") && !js.includes("Who is this? (only on this phone)"));
  assert.ok(!art.includes("not the photos"));
});

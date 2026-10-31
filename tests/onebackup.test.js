import { test } from "node:test";
import assert from "node:assert/strict";
import * as M from "../src/model/index.js";
import { account } from "./fixtures.js";

// P1-6 (owner, Oct 31): one backup = one file; parts only when too big. Invented ledger and invented picture bytes only. Tests use the smallest allowed key-stretching
// (100,000 rounds) so they run fast; the real default (600,000) is checked from the header and the code.
const PASS = "invented pass phrase 1", FAST = 100000;
const ledger = () => { const l = M.emptyLedger(); l.rev = 3; l.saved_at = "2026-10-31T12:00:00.000+08:00"; l.state = { ...l.state, categories: M.defaultCategories(), accounts: [account({ id: "a1", name: "Invented Bank", class: "asset", opening_balance: 123456, opening_date: "2026-01-01" })] }; return l; };
const pic = (id, len, seed) => ({ id, bytes: Uint8Array.from({ length: len }, (_, i) => (i * 31 + seed * 7 + (i >> 8)) & 255) });
const PICS = [pic("p1", 5000, 1), pic("p2", 1, 2), pic("p3", 70000, 3)];
const file = (blob, name = "x.json") => Object.assign(blob, { name });
const collect = async (set) => { const got = new Map(); await set.eachPicture(async (id, bytes) => { got.set(id, bytes); }); return got; };
const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const seal = (opts) => M.sealBackupPart({ passphrase: PASS, iterations: FAST, savedAt: "2026-10-31", ...opts });
async function backupParts(l, pics, maxBytes, id = M.newBackupId()) {
  const text = JSON.stringify(l), plan = M.planBackupParts(new TextEncoder().encode(text).length, pics.map((p) => ({ id: p.id, size: p.bytes.length })), maxBytes), out = [];
  for (let i = 0; i < plan.length; i++) out.push(await seal({ ledger: plan[i].ledger ? text : null, items: plan[i].ids.map((x) => pics.find((p) => p.id === x)), id, part: i + 1, parts: plan.length }));
  return { plan, files: out, id };
}

test("one file: the ledger and three pictures go into ONE file, and restoring gives the identical ledger and pictures byte for byte", async () => {
  const l = ledger(), { plan, files } = await backupParts(l, PICS, M.BACKUP_PART_BYTES);
  assert.equal(plan.length, 1); assert.equal(files.length, 1);
  const set = await M.openBackupSet([file(files[0])], PASS);
  assert.equal(set.mode, "one"); assert.equal(set.parts, 1); assert.deepEqual(set.ledger, l);
  const got = await collect(set);
  assert.deepEqual([...got.keys()].sort(), ["p1", "p2", "p3"]);
  for (const p of PICS) assert.ok(sameBytes(got.get(p.id), p.bytes), p.id + " is byte for byte the same");
  assert.equal(set.pictures, 3);
});

test("a backup with no pictures is still one file", async () => {
  const { files } = await backupParts(ledger(), [], M.BACKUP_PART_BYTES);
  const set = await M.openBackupSet([files[0]], PASS);
  assert.equal(set.mode, "one"); assert.deepEqual(set.ledger, ledger()); assert.equal(set.pictures, 0);
});

test("parts: pictures above the limit make N files with one id, in any order they open together", async () => {
  const l = ledger(), pics = [pic("a", 4000, 1), pic("b", 4000, 2), pic("c", 4000, 3), pic("d", 9000, 4)];
  const { plan, files, id } = await backupParts(l, pics, 10000);
  assert.ok(plan.length >= 3, "cut into parts: " + plan.length); assert.equal(plan.filter((p) => p.ledger).length, 1, "the ledger is in one part only"); assert.equal(plan[0].ledger, true);
  const heads = []; for (const f of files) heads.push((await M.readBackupHeader(f)).header);
  assert.ok(heads.every((h) => h.id === id && h.parts === plan.length), "every file shares the id and the count"); assert.deepEqual(heads.map((h) => h.part), plan.map((_, i) => i + 1));
  assert.equal(new Set(heads.map((h) => h.salt)).size, plan.length, "each file has its own fresh salt");
  for (const order of [files, files.slice().reverse()]) {
    const set = await M.openBackupSet(order.map((f) => file(f)), PASS);
    assert.equal(set.mode, "parts"); assert.deepEqual(set.ledger, l);
    const got = await collect(set); for (const p of pics) assert.ok(sameBytes(got.get(p.id), p.bytes), p.id);
  }
  assert.ok(M.planBackupParts(10, [{ id: "big", size: 99999 }], 1000).some((p) => p.ids.includes("big")), "a picture bigger than the limit is never cut: it sits in a part of its own");
});

test("a missing part is named plainly and nothing opens; one part alone, or two of three, opens nothing", async () => {
  const pics = [pic("a", 4000, 1), pic("b", 4000, 2), pic("c", 4000, 3), pic("d", 9000, 4)], { files } = await backupParts(ledger(), pics, 10000);
  assert.ok(files.length >= 3);
  const n = files.length;
  await assert.rejects(M.openBackupSet([files[0], ...files.slice(2)], PASS), (e) => e.message.startsWith("Part 2 of " + n + " is missing.") && /Choose all/.test(e.message));
  await assert.rejects(M.openBackupSet([files[1]], PASS), (e) => /Parts 1 and 3/.test(e.message) || /Part 1/.test(e.message));
  await assert.rejects(M.openBackupSet([files[0]], PASS), (e) => /missing/.test(e.message));
});

test("parts from two different backups are refused, and so is the same part chosen twice", async () => {
  const pics = [pic("a", 4000, 1), pic("b", 4000, 2), pic("c", 4000, 3)], one = await backupParts(ledger(), pics, 6000), two = await backupParts(ledger(), pics, 6000);
  assert.notEqual(one.id, two.id);
  await assert.rejects(M.openBackupSet([one.files[0], two.files[1], ...one.files.slice(2)], PASS), /different backups/);
  await assert.rejects(M.openBackupSet([one.files[0], one.files[0], ...one.files.slice(1)], PASS), /chosen twice/);
  assert.equal(M.checkBackupSet([{ id: "x", part: 1, parts: 2 }, { id: "x", part: 2, parts: 3 }]).ok, false, "a different count means a different backup");
});

test("an older backup (ledger .json plus .fpics files) still restores and checks as it did", async () => {
  const l = ledger(), old = new Blob([JSON.stringify(await M.encryptLedgerBackup(l, PASS))]);
  const p1 = await M.sealPictures(PICS.slice(0, 2), PASS, { savedAt: "2026-10-31", part: 1, parts: 2, iterations: FAST }), p2 = await M.sealPictures(PICS.slice(2), PASS, { savedAt: "2026-10-31", part: 2, parts: 2, iterations: FAST });
  const set = await M.openBackupSet([file(p2, "finance-pictures-2026-10-31-part2of2.fpics"), file(old, "finance-backup-2026-10-31.json"), file(p1, "finance-pictures-2026-10-31-part1of2.fpics")], PASS);
  assert.equal(set.mode, "old"); assert.deepEqual(set.ledger, l); assert.equal(set.files, 2); assert.equal(set.total, 2);
  const got = await collect(set); for (const p of PICS) assert.ok(sameBytes(got.get(p.id), p.bytes), p.id);
  const only = await M.openBackupSet([file(old)], PASS); assert.equal(only.mode, "old"); assert.deepEqual(only.ledger, l); assert.equal(only.files, 0);
  await assert.rejects(M.openBackupSet([file(p1, "x.fpics")], PASS), /None of those is the backup file/);
  await assert.rejects(M.openBackupSet([file(old), file((await backupParts(ledger(), PICS, M.BACKUP_PART_BYTES)).files[0])], PASS), /different kinds of backup/);
});

test("a wrong passphrase and a damaged file give a plain message and open nothing", async () => {
  const { files } = await backupParts(ledger(), PICS, M.BACKUP_PART_BYTES), good = new Uint8Array(await files[0].arrayBuffer());
  await assert.rejects(M.openBackupSet([files[0]], "another pass phrase 22"), /^Error: Wrong passphrase, or the file is damaged\.$/);
  const flip = (at) => { const b = good.slice(); b[at] ^= 1; return new Blob([b]); };
  await assert.rejects(M.openBackupSet([flip(good.length >> 1)], PASS), /Wrong passphrase, or the file is damaged/);
  await assert.rejects(M.openBackupSet([new Blob([good.slice(0, good.length - 40)])], PASS), /cut off|Wrong passphrase|not a backup/);
  await assert.rejects(M.openBackupSet([new Blob([new TextEncoder().encode("hello, not a backup")])], PASS), /That file is not a backup/);
  const { header, at } = await M.readBackupHeader(files[0]); const idAt = new TextDecoder().decode(good.slice(12, at)).indexOf(header.id);
  const edited = good.slice(); edited[12 + idAt] = edited[12 + idAt] === 48 ? 49 : 48;   // the id is changed in the clear header: every piece is bound to the header, so it no longer opens
  await assert.rejects(M.openBackupSet([new Blob([edited])], PASS), /Wrong passphrase, or the file is damaged/);
  const extra = new Blob([good, new Uint8Array([1, 2, 3, 4])]); await assert.rejects(M.openBackupSet([extra], PASS));
  // a whole picture piece taken out of the middle: every piece is bound to its place, so the file no longer opens
  const lens = []; for (let p = at; p < good.length;) { const l = ((good[p] << 24) | (good[p + 1] << 16) | (good[p + 2] << 8) | good[p + 3]) >>> 0; lens.push([p, 4 + l]); p += 4 + l; }
  assert.ok(lens.length >= 5, "ledger, three pictures and the end piece");
  const [from, size] = lens[2]; const dropped = new Blob([good.slice(0, from), good.slice(from + size)]);
  await assert.rejects(M.openBackupSet([dropped], PASS), /Wrong passphrase, or the file is damaged/);
});

test("same strength as before: PBKDF2-SHA256 with 600,000 rounds, AES-GCM, a fresh salt and IV each time, and the passphrase rules are unchanged", async () => {
  const a = await M.sealBackupPart({ ledger: "x", items: [], passphrase: PASS, id: M.newBackupId() }), b = await M.sealBackupPart({ ledger: "x", items: [], passphrase: PASS, id: M.newBackupId() });
  const ha = (await M.readBackupHeader(a)).header, hb = (await M.readBackupHeader(b)).header;
  assert.equal(ha.iterations, 600000); assert.equal(ha.kdf, "PBKDF2-SHA256"); assert.notEqual(ha.salt, hb.salt);
  const bytes = async (blob) => new Uint8Array(await blob.arrayBuffer()); assert.notDeepEqual(await bytes(a), await bytes(b), "two backups of the same data look completely different");
  await assert.rejects(M.sealBackupPart({ ledger: "x", items: [], passphrase: "short", id: M.newBackupId() }), /at least 12/);
  assert.equal(await M.sniffBackupFile(a), "backup");
  assert.equal(M.BACKUP_PART_BYTES, 50 * 1024 * 1024, "the fixed limit chosen by the owner");
  assert.match(M.newBackupId(), /^[0-9a-f]{32}$/);
});

test("the file name is 'fo-und backup YYYY-MM-DD HH-MM', with '(1 of N)' when there are parts, and a file is known by what is inside, not its name", async () => {
  assert.equal(M.oneBackupFileName("2026-10-31T20:37:12.000+08:00"), "fo-und backup 2026-10-31 20-37.json");
  assert.equal(M.oneBackupFileName("2026-10-31T20:37:12.000+08:00", 2, 3), "fo-und backup 2026-10-31 20-37 (2 of 3).json");
  const { files } = await backupParts(ledger(), [], M.BACKUP_PART_BYTES);
  assert.equal(await M.sniffBackupFile(file(files[0], "holiday.pdf")), "backup");
  assert.equal(await M.sniffBackupFile(new Blob(["{\"v\":1}"])), "ledger"); assert.equal(await M.sniffBackupFile(new Blob([new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9, 9])])), "unknown");
});

import { readFileSync } from "node:fs";
test("the app wires it: Back up now makes one file (parts share ONE share action), restore and check read by content, the pictures come back before the ledger, and the safety copy path is untouched", () => {
  const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
  const make = app.slice(app.indexOf("async function makeBackup()"), app.indexOf("async function makePicturesBackup()"));
  assert.match(make, /oneBackupFiles\(ui\.form\.pass\)/); assert.match(make, /shareFiles\(made\.files, "Finance backup"\)/, "every part goes to the share sheet in one action");
  const one = app.slice(app.indexOf("async function oneBackupFiles"), app.indexOf("async function makeBackup()"));
  assert.match(one, /M\.planBackupParts\(/); assert.match(one, /M\.newBackupId\(\)/); assert.match(one, /M\.sealBackupPart\(/); assert.match(one, /M\.oneBackupFileName\(stamp, i \+ 1, plan\.length\)/);
  const open = app.slice(app.indexOf("async function openBackupFile()"), app.indexOf("async function restoreNow()")), now = app.slice(app.indexOf("async function restoreNow()"), app.indexOf("// Replacing the whole ledger"));
  assert.match(open, /M\.openBackupSet\(ui\.form\.files/, "restore and check read the chosen files by what is inside them");
  assert.ok(now.indexOf("eachPicture") < now.indexOf("replaceLedger("), "the pictures are put back first, then the ledger is replaced through the safety copy");
  assert.match(app, /data-action="open-backup" data-howto="backup" data-all="1">Back up now/); assert.match(app, /data-action="open-restore" data-all="1"[^>]*>Restore from a backup/); assert.match(app, /accept="\.json,\.fpics,application\/json,application\/octet-stream"/);
  assert.match(app, /showToast\(M\.backupDoneText\(\{ parts: made\?\.files\.length \?\? 1, pictures \}\)\)/);
  assert.equal(M.backupDoneText({ parts: 1, pictures: 0 }).startsWith("Backup file created."), true);
  assert.match(M.backupDoneText({ parts: 3, pictures: 9 }), /Backup made in 3 files\. Keep all 3 together: you need every one to restore\./);
  assert.match(M.backupDoneText({ parts: 1, pictures: 64 }), /your ledger and 64 pictures in one file/);
});
test("Help carries the one-line folder tip and says a backup is one file", () => {
  const all = M.HELP_TOPICS?.flatMap((t) => t.lines).join("\n") ?? readFileSync(new URL("../src/model/help.js", import.meta.url), "utf8");
  assert.ok(all.includes("Make a folder 'fo-und backups' in the Files app once and save every backup there."));
  assert.ok(/One backup is one file/.test(all));
});

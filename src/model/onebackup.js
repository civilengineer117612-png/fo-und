// ONE backup = ONE file (owner, Oct 31, P1-6). The ledger and the pictures go into a single encrypted file; only when that would be too big to build safely on a phone is
// it cut into parts, and every part carries the same backup id. Same strength as the older backups: PBKDF2-SHA256 with 600,000 rounds, AES-GCM, a fresh salt and a
// fresh IV for every piece. The older files (the ledger .json of backup.js and the .fpics pictures files of picturebackup.js) are still read exactly as before.
//
// THE LIMIT: BACKUP_PART_BYTES = 50 MB per file, fixed by the owner. Measured on a laptop with the same piece-by-piece build (Oct 31): the build holds about 2.7 times the file
// size in memory at its peak (a 120 MB file peaked at 343 MB, a 480 MB file at 1,316 MB; build and open each take a few seconds). So a 50 MB file peaks near 135 MB, far below
// what a phone can hold. A picture bigger than the limit is never cut: it sits alone in a part that is as big as it is. The phone itself was not measured.
//
// Layout of a file: the 8 bytes "FOUNDBK2", [4-byte length][header JSON {v:2, kind:"backup", id, part, parts, saved_at, kdf, iterations, salt}], then pieces
// [4-byte length][12-byte IV][encrypted piece]. A piece's plaintext is [4-byte length][meta JSON][bytes]; meta is {t:"ledger"} (the ledger text, in part 1 only),
// {t:"pic", id} (one picture) or {t:"end", count, ledger} (the last piece, so a cut-off file is noticed). Each piece is bound to the header and to its place
// (additional data = the header bytes + its number), so a changed header, a reordered or a dropped piece fails to open. The id and the part numbers sit in the header
// in the clear so a missing or foreign part can be named before the passphrase is asked for; they carry no secret and cannot be changed without breaking every piece.
import { MIN_PASSPHRASE, decryptLedgerBackup } from "./backup.js";
import { openPictures } from "./picturebackup.js";
import { parseLedger } from "./persist.js";

export const BACKUP_PART_BYTES = 50 * 1024 * 1024;
const MAGIC = new TextEncoder().encode("FOUNDBK2");
const ITERATIONS = 600000;
const enc = new TextEncoder(), dec = new TextDecoder();
const u32 = (n) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const readU32 = (b, at = 0) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const hex = (bytes) => [...bytes].map((x) => x.toString(16).padStart(2, "0")).join("");
const b64 = (bytes) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function keyFrom(passphrase, salt, iterations) {
  const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export const newBackupId = () => hex(crypto.getRandomValues(new Uint8Array(16)));

// "fo-und backup 2026-10-31 20-37.json", or "... (1 of 3).json" when it is in parts. `stamp` is a timestamp like 2026-10-31T20:37:00+08:00 (the phone's own clock).
export function backupFileName(stamp, part = 1, parts = 1) {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(String(stamp));
  const when = m ? `${m[1]} ${m[2]}-${m[3]}` : String(stamp).slice(0, 10);
  return `fo-und backup ${when}${parts > 1 ? ` (${part} of ${parts})` : ""}.json`;
}

// Which pictures go in which file: [{ledger: boolean, ids: [...]}]. The ledger takes its room in the first file. A file stays within `maxBytes` unless one picture alone is bigger.
export function planBackupParts(ledgerBytes, pictures, maxBytes = BACKUP_PART_BYTES) {
  const parts = [{ ledger: true, ids: [] }]; let size = ledgerBytes;
  for (const p of pictures) {
    if (size + p.size > maxBytes && (parts.at(-1).ledger || parts.at(-1).ids.length)) { parts.push({ ledger: false, ids: [] }); size = 0; }
    parts.at(-1).ids.push(p.id); size += p.size;
  }
  return parts;
}

// ledger: the ledger text (part 1) or null. items: [{id, bytes}] or functions giving one at a time, so only one picture is in memory besides the result. Returns a Blob.
export async function sealBackupPart({ ledger = null, items = [], passphrase, id, part = 1, parts = 1, savedAt = "", iterations = ITERATIONS }) {
  if (typeof passphrase !== "string" || passphrase.length < MIN_PASSPHRASE) throw new Error("passphrase must be at least " + MIN_PASSPHRASE + " characters");
  const salt = crypto.getRandomValues(new Uint8Array(16)), key = await keyFrom(passphrase, salt, iterations);
  const header = enc.encode(JSON.stringify({ v: 2, kind: "backup", id, part, parts, saved_at: savedAt, kdf: "PBKDF2-SHA256", iterations, salt: b64(salt) }));
  const out = [MAGIC, u32(header.length), header];
  let n = 0;
  const aad = (i) => { const a = new Uint8Array(header.length + 8); a.set(header, 0); a.set(enc.encode("|" + String(i).padStart(7, "0")), header.length); return a; };
  const put = async (meta, bytes) => {
    const m = enc.encode(JSON.stringify(meta)), plain = new Uint8Array(4 + m.length + bytes.length);
    plain.set(u32(m.length), 0); plain.set(m, 4); plain.set(bytes, 4 + m.length);
    const iv = crypto.getRandomValues(new Uint8Array(12)), ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(n) }, key, plain));
    out.push(u32(12 + ct.length), iv, ct); n++;
  };
  if (ledger != null) await put({ t: "ledger" }, enc.encode(ledger));
  let count = 0;
  for (const it of items) { const one = typeof it === "function" ? await it() : it; if (one) { await put({ t: "pic", id: one.id }, one.bytes); count++; } }
  await put({ t: "end", count, ledger: ledger != null }, new Uint8Array(0));
  return new Blob(out, { type: "application/octet-stream" });
}

const slice = async (blob, from, len) => { const b = new Uint8Array(await blob.slice(from, from + len).arrayBuffer()); if (b.length !== len) throw new Error("the file is cut off"); return b; };

// The plain header of a one-file or part-file backup, checked for its shape only (nothing is decrypted). Throws "that is not a backup file" for anything else.
export async function readBackupHeader(blob) {
  try {
    const magic = await slice(blob, 0, MAGIC.length);
    if (!magic.every((x, i) => x === MAGIC[i])) throw new Error("no");
    const hl = readU32(await slice(blob, MAGIC.length, 4));
    if (hl < 20 || hl > 4096) throw new Error("no");
    const header = JSON.parse(dec.decode(await slice(blob, MAGIC.length + 4, hl)));
    const ok = header?.v === 2 && header.kind === "backup" && /^[0-9a-f]{32}$/.test(header.id ?? "") && Number.isInteger(header.part) && Number.isInteger(header.parts) && header.part >= 1 && header.parts >= header.part && header.parts <= 999
      && Number.isInteger(header.iterations) && header.iterations >= 100000 && header.iterations <= 2000000 && typeof header.salt === "string";
    if (!ok) throw new Error("no");
    return { header, at: MAGIC.length + 4 + hl, headerBytes: await slice(blob, MAGIC.length + 4, hl) };
  } catch { throw new Error("that is not a backup file"); }
}

// Reads one file and checks every piece. onLedger(text) once (part 1), onPicture(id, bytes) for each picture. Throws on a wrong passphrase, a damaged, edited, reordered or cut-off file.
// Returns {id, part, parts, saved_at, count, ledger: boolean}.
export async function openBackupPart(blob, passphrase, { onLedger = async () => {}, onPicture = async () => {} } = {}) {
  const { header, at: start, headerBytes } = await readBackupHeader(blob);
  let key; try { key = await keyFrom(passphrase, unb64(header.salt), header.iterations); } catch { throw new Error("that is not a backup file"); }
  const aad = (i) => { const a = new Uint8Array(headerBytes.length + 8); a.set(headerBytes, 0); a.set(enc.encode("|" + String(i).padStart(7, "0")), headerBytes.length); return a; };
  let at = start, n = 0, count = 0, ended = false, ledger = false;
  while (at < blob.size) {
    if (ended) throw new Error("the file has extra data after its end");
    const len = readU32(await slice(blob, at, 4)); at += 4;
    if (len < 12 + 16 || at + len > blob.size) throw new Error("the file is cut off");
    const piece = await slice(blob, at, len); at += len;
    let plain;
    try { plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: piece.slice(0, 12), additionalData: aad(n) }, key, piece.slice(12))); }
    catch { throw new Error("could not decrypt: wrong passphrase or damaged file"); }
    const ml = readU32(plain), meta = JSON.parse(dec.decode(plain.slice(4, 4 + ml)));
    if (meta.t === "end") ended = true;   // every piece is bound to its place, so a dropped or swapped piece never gets this far
    else if (meta.t === "ledger") { if (n !== 0) throw new Error("that is not a backup file"); ledger = true; await onLedger(dec.decode(plain.slice(4 + ml))); }
    else if (meta.t === "pic") { await onPicture(meta.id, plain.slice(4 + ml)); count++; }
    else throw new Error("that is not a backup file");
    n++;
  }
  if (!ended) throw new Error("the file is cut off");
  return { id: header.id, part: header.part, parts: header.parts, saved_at: header.saved_at, count, ledger };
}

// What a chosen file is, by what is INSIDE it (never by its name): "backup" (this format), "ledger" (an older ledger backup, JSON text), "pictures" (an older .fpics file) or "unknown".
export async function sniffBackupFile(blob) {
  try { await readBackupHeader(blob); return "backup"; } catch { /* not this format */ }
  try {
    const head = dec.decode(await blob.slice(0, 64).arrayBuffer()).trimStart();
    if (head.startsWith("{")) return "ledger";
  } catch { /* fall through */ }
  try {
    const hl = readU32(await slice(blob, 0, 4));
    if (hl >= 20 && hl <= 4096 && JSON.parse(dec.decode(await slice(blob, 4, hl))).kind === "pictures") return "pictures";
  } catch { /* fall through */ }
  return "unknown";
}

// Do the headers of the chosen files make ONE complete backup? Nothing is decrypted. Returns {ok, error?, id, parts, missing: [part numbers]}.
export function checkBackupSet(headers) {
  if (!headers.length) return { ok: false, error: "Choose the backup file.", missing: [] };
  const first = headers[0];
  if (headers.some((h) => h.id !== first.id || h.parts !== first.parts)) return { ok: false, error: "These files are from different backups. Choose the files of one backup.", missing: [] };
  const seen = new Set();
  for (const h of headers) { if (seen.has(h.part)) return { ok: false, error: "Part " + h.part + " of " + first.parts + " was chosen twice. Choose each file once.", missing: [] }; seen.add(h.part); }
  const missing = []; for (let i = 1; i <= first.parts; i++) if (!seen.has(i)) missing.push(i);
  if (missing.length) {
    const which = missing.length === 1 ? "Part " + missing[0] + " of " + first.parts + " is missing." : "Parts " + missing.slice(0, -1).join(", ") + " and " + missing.at(-1) + " of " + first.parts + " are missing.";
    return { ok: false, error: which + " Choose all " + first.parts + " files of this backup together.", id: first.id, parts: first.parts, missing };
  }
  return { ok: true, id: first.id, parts: first.parts, missing: [] };
}

const WRONG = "Wrong passphrase, or the file is damaged.";
// The whole restore-side check, for a chosen set of files: one file of this format, several parts of one backup, or an older ledger file with its pictures files.
// Nothing is restored here and nothing on the phone is touched. Returns {mode: "one" | "parts" | "old", ledger (the parsed ledger), files, parts, total, saved_at,
// eachPicture(cb): async, calls cb(id, bytes) for every picture of every file again}. Throws Error(plain message).
export async function openBackupSet(files, passphrase) {
  const kinds = []; for (const f of files) kinds.push(await sniffBackupFile(f));
  if (kinds.some((k) => k === "unknown")) throw new Error("That file is not a backup.");
  const fail = (e) => { throw new Error(String(e.message).startsWith("could not decrypt") ? WRONG : e.message); };
  if (kinds.includes("backup")) {
    if (kinds.some((k) => k !== "backup")) throw new Error("These files are from different kinds of backup. Choose the files of one backup.");
    const headers = []; for (const f of files) headers.push((await readBackupHeader(f)).header);
    const set = checkBackupSet(headers);
    if (!set.ok) throw new Error(set.error);
    let text = null, count = 0, saved = "";
    try { for (const f of files) { const r = await openBackupPart(f, passphrase, { onLedger: async (t) => { text = t; } }); count += r.count; if (r.part === 1) saved = r.saved_at ?? ""; } } catch (e) { fail(e); }
    if (text == null) throw new Error("That backup has no ledger in it.");
    const parsed = parseLedger(text); if (!parsed.ok) throw new Error("The backup opened but its data is invalid: " + parsed.error);
    return { mode: set.parts > 1 ? "parts" : "one", ledger: parsed.ledger, files: files.length, parts: set.parts, total: set.parts, pictures: count, saved_at: saved,
      eachPicture: async (cb) => { for (const f of files) await openBackupPart(f, passphrase, { onPicture: cb }); } };
  }
  const ledgerFiles = files.filter((_, i) => kinds[i] === "ledger"), picFiles = files.filter((_, i) => kinds[i] === "pictures");
  if (!ledgerFiles.length) throw new Error("None of those is the backup file. Choose the backup file as well as the pictures files.");
  let ledger; try { ledger = await decryptLedgerBackup(JSON.parse(await ledgerFiles[0].text()), passphrase); } catch (e) { if (e instanceof SyntaxError) throw new Error("That file is not a backup."); fail(e); }
  let total = 0; try { for (const f of picFiles) { const r = await openPictures(f, passphrase); total = Math.max(total, r.parts ?? 0); } } catch (e) { fail(e); }
  return { mode: "old", ledger, files: picFiles.length, parts: picFiles.length, total, pictures: 0, saved_at: ledger.saved_at ?? "",
    eachPicture: async (cb) => { for (const f of picFiles) await openPictures(f, passphrase, cb); } };
}

// The words shown when a backup is finished (owner's wording preview, Oct 31). One file says what is inside it; parts say to keep every one together.
export function backupDoneText({ parts = 1, pictures = 0 }) {
  const keep = "Check that it is in Files or on your drive, and keep a second copy off this phone.";
  if (parts > 1) return "Backup made in " + parts + " files. Keep all " + parts + " together: you need every one to restore. " + keep.replace("it is", "they are");
  return "Backup file created" + (pictures ? ": your ledger and " + pictures + (pictures === 1 ? " picture" : " pictures") + " in one file" : "") + ". " + keep;
}

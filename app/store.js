// The only file that touches storage. The SAME text is written to localStorage and IndexedDB,
// so losing or failing one of them is noticed and repaired from the other (model/persist.js).
// A value of undefined means "that store could not be read at all".
import { ledgerHead, mayOverwrite } from "../src/model/persist.js";
let LS_KEY = "financialTracker.ledger", DB_NAME = "financialTracker";
const STORE = "kv", KEY = "ledger", PHOTOS = "photos", SAFETY = "safety";
let COPIES_KEY = "financialTracker.preupgrade";   // the copies kept from before an upgrade (see model/migrate.js)
let RESTORE_KEY = "financialTracker.restorecopy";   // the copies kept from before a restore (see model/restorecopy.js): a list of their own, never mixed with the one above

// A trial copy keeps everything under other names, so it can never touch (or be mistaken for) a real ledger.
export function useTrialStorage() { LS_KEY = "financialTracker.trial.ledger"; COPIES_KEY = "financialTracker.trial.preupgrade"; DB_NAME = "financialTracker-trial"; RESTORE_KEY = "financialTracker.trial.restorecopy"; }
export async function clearTrialStorage() {
  if (!DB_NAME.endsWith("-trial")) return;   // only ever the trial copy
  try { localStorage.removeItem(LS_KEY); } catch { /* nothing to remove */ }
  await new Promise((resolve) => { const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = r.onerror = r.onblocked = () => resolve(); });
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 3);   // version 2 added the store for photos of receipts, version 3 the one for copies from before an upgrade; the ledger store is untouched
    req.onupgradeneeded = () => { for (const name of [STORE, PHOTOS, SAFETY]) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet() {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const r = db.transaction(STORE).objectStore(STORE).get(KEY);
      r.onsuccess = () => resolve(r.result ?? null);
      r.onerror = () => reject(r.error);
    });
  } finally { db.close(); }
}
// TWO WINDOWS (L1): `base` is the head of the ledger this window last loaded or saved (null until the app has started: start-up writes are not judged).
// A save is a compare-and-swap inside ONE IndexedDB transaction: what is stored is read, and the new text is written only when the store still holds what
// this window saw (model: mayOverwrite). IndexedDB runs transactions of every window one after another, so two windows can never both pass.
let base = null, armed = false;   // armed once the app has started; a null base then means "this window started from an empty store"
export function setBase(ledger) { base = ledger ? { rev: ledger.rev, saved_at: ledger.saved_at } : null; armed = true; }
async function idbPut(text) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite"), st = tx.objectStore(STORE);
      let conflict = false;
      const g = st.get(KEY);
      g.onsuccess = () => { if (armed && !mayOverwrite(ledgerHead(g.result ?? null), base)) { conflict = true; return; } st.put(text, KEY); };   // nothing is written on a conflict
      tx.oncomplete = () => resolve({ conflict });
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
// Other windows are told about a save at once, so an out-of-date one can say so before anything is typed into it. (The compare-and-swap above is what
// protects the data; this only brings the news sooner.) The name follows the database, so a trial copy and a real one never hear each other.
let channel = null, onNews = null;
const tell = (head) => { try { channel?.postMessage(head); } catch { /* the save itself is not affected */ } };
export function watchOtherWindows(cb) {
  onNews = cb;
  try { channel = new BroadcastChannel(DB_NAME + ".saves"); channel.onmessage = (e) => { if (armed && e.data && !mayOverwrite(e.data, base)) onNews?.(); }; } catch { channel = null; }
}
// Has another window saved since this one loaded? Asked when the app comes back to the front (a window that was asleep hears no news).
export async function changedElsewhere() {
  if (!armed) return false;
  try { return !mayOverwrite(ledgerHead(await idbGet()), base); } catch { return false; }
}

export async function readBoth() {
  let local, idb;
  try { local = localStorage.getItem(LS_KEY); } catch { local = undefined; }
  try { idb = await idbGet(); } catch { idb = undefined; }
  return { local, idb };
}

// Saves are queued one after another so two quick taps can never write out of order.
let queue = Promise.resolve();
export function writeBoth(text, { local = true, idb = true } = {}) {
  const job = queue.then(async () => {
    const result = { local: !local, idb: !idb }, head = ledgerHead(text);
    // The main store first: it is the one that can compare and write in one step. On a conflict NOTHING is written anywhere.
    if (idb) { try { const r = await idbPut(text); if (r.conflict) return { local: false, idb: false, conflict: true }; result.idb = true; } catch { /* reported below */ } }
    if (local) {
      try {
        if (!result.idb || !idb) { let cur = null; try { cur = localStorage.getItem(LS_KEY); } catch { cur = null; } if (armed && !mayOverwrite(ledgerHead(cur), base)) return { local: false, idb: false, conflict: true }; }   // only the spare is being written: judge it the same way
        localStorage.setItem(LS_KEY, text); result.local = true;
      } catch { /* reported below */ }
    }
    if ((result.idb && idb) || (result.local && local)) { if (armed && head) base = head; tell(head); }
    return result;
  });
  queue = job.catch(() => {});
  return job;
}

// Photos of receipts and payslips: the picture files themselves, kept only on this phone, under the id the ledger's
// attachment row names. They are not part of the ledger text and not part of the backup file.
async function photoTx(mode, run) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTOS, mode);
      const r = run(tx.objectStore(PHOTOS));
      tx.oncomplete = () => resolve(r?.result ?? null);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export const putPhoto = (id, blob) => photoTx("readwrite", (st) => st.put(blob, id));
export const getPhoto = (id) => photoTx("readonly", (st) => st.get(id));
export const deletePhoto = (id) => photoTx("readwrite", (st) => st.delete(id));

// The copies of the data kept from before an upgrade (at most two, see model/migrate.js rotateCopies): the same list is written to localStorage and
// IndexedDB, and read back from whichever holds more.
async function idbCopies(mode, run) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(SAFETY, mode), r = run(tx.objectStore(SAFETY));
      tx.oncomplete = () => resolve(r?.result ?? null);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
// One list of copies under a localStorage name and an IndexedDB key: written to both, read from whichever holds more.
async function readList(lsKey, idbKey) {
  let a = [], b = [];
  try { a = JSON.parse(localStorage.getItem(lsKey) ?? "[]"); } catch { a = []; }
  try { b = (await idbCopies("readonly", (st) => st.get(idbKey))) ?? []; } catch { b = []; }
  const ok = (x) => (Array.isArray(x) ? x.filter((c) => c && typeof c.text === "string") : []);
  return ok(b).length >= ok(a).length ? ok(b) : ok(a);
}
async function writeList(lsKey, idbKey, copies) {
  const result = { local: false, idb: false };
  try { localStorage.setItem(lsKey, JSON.stringify(copies)); result.local = true; } catch { /* reported below */ }
  try { await idbCopies("readwrite", (st) => st.put(copies, idbKey)); result.idb = true; } catch { /* reported below */ }
  return result;
}
export const readCopies = () => readList(COPIES_KEY, "copies");
export const writeCopies = (copies) => writeList(COPIES_KEY, "copies", copies);
// The copies kept from before a restore: the ledger as it was, the last two.
export const readRestoreCopies = () => readList(RESTORE_KEY, "restore-copies");
export const writeRestoreCopies = (copies) => writeList(RESTORE_KEY, "restore-copies", copies);

// Claim once per browser storage bucket, in the existing database (no ledger
// field/version change). An IndexedDB transaction also serializes other tabs.
export async function claimPersistenceRequest() {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite"), st = tx.objectStore(STORE);
      let claimed = false;
      const request = st.get("persistence-requested");
      request.onsuccess = () => {
        if (request.result === true) return;
        st.put(true, "persistence-requested"); claimed = true;
      };
      tx.oncomplete = () => resolve(claimed);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

// The APP LOCK record (src/model/applock.js): device-only, in its own key of the same key-value store plus a spare in localStorage. It is never part of the
// ledger text, so no backup carries it and a restore neither brings a lock nor removes one. (A trial copy never reads it: the caller does not ask.)
const LOCK_KEY = "applock", LOCK_LS = "financialTracker.applock";
export async function readLock() {
  let ls = null, idb = null;
  try { ls = JSON.parse(localStorage.getItem(LOCK_LS) ?? "null"); } catch { ls = null; }
  try {
    const db = await openDb();
    try { idb = await new Promise((resolve, reject) => { const r = db.transaction(STORE).objectStore(STORE).get(LOCK_KEY); r.onsuccess = () => resolve(r.result ?? null); r.onerror = () => reject(r.error); }); }
    finally { db.close(); }
  } catch { idb = null; }
  return idb ?? ls;   // either store alone is enough to keep the lock
}
export async function writeLock(rec) {
  const result = { local: false, idb: false };
  try { localStorage.setItem(LOCK_LS, JSON.stringify(rec)); result.local = true; } catch { /* reported below */ }
  try {
    const db = await openDb();
    try { await new Promise((resolve, reject) => { const tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).put(rec, LOCK_KEY); tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error); }); result.idb = true; }
    finally { db.close(); }
  } catch { /* reported below */ }
  return result;
}
export async function clearLock() {
  try { localStorage.removeItem(LOCK_LS); } catch { /* nothing to remove */ }
  try {
    const db = await openDb();
    try { await new Promise((resolve, reject) => { const tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).delete(LOCK_KEY); tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error); }); }
    finally { db.close(); }
  } catch { /* nothing to remove */ }
}

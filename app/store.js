// The only file that touches storage. The SAME text is written to localStorage and IndexedDB,
// so losing or failing one of them is noticed and repaired from the other (model/persist.js).
// A value of undefined means "that store could not be read at all".
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
async function idbPut(text) {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(text, KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
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
    const result = { local: !local, idb: !idb };
    if (local) { try { localStorage.setItem(LS_KEY, text); result.local = true; } catch { /* reported below */ } }
    if (idb) { try { await idbPut(text); result.idb = true; } catch { /* reported below */ } }
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

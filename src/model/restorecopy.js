// A safety copy before ANY replacement of the whole ledger (owner, Oct 29; data version unchanged). Restoring a backup, or the copy from before an
// update, replaces everything on the phone. So first the CURRENT ledger is saved as a restore copy, read back and checked, and only then is it replaced;
// if the copy cannot be saved or does not check out, nothing is replaced. The last two restore copies are kept, apart from the copies kept before an
// upgrade (a different list under its own names), so one kind never pushes the other out. "Put it back" is just another replacement: it takes its own
// copy first, so it can be undone too.
// Pure: the storage is handed in as `io`, so every failure can be tested.
import { rotateCopies } from "./migrate.js";

export const RESTORE_COPIES_KEPT = 2;

// The parts of a ledger that are the data, without the bookkeeping that changes on every save (rev, saved_at).
const content = (l) => JSON.stringify({ v: l.v, state: l.state, settings: l.settings });

// A phone with nothing on it (accounts, entries) holds nothing worth a copy, and "putting it back" would wipe the restore.
export const holdsData = (ledger) => Boolean(ledger) && ((ledger.state?.accounts ?? []).length > 0 || (ledger.state?.transactions ?? []).length > 0);

// Does this stored copy hold exactly this ledger's data?
export function copyHolds(copy, ledger) {
  try { return Boolean(copy) && content(JSON.parse(copy.text)) === content(ledger); } catch { return false; }
}

const NOT_SAVED = "Your data was not replaced, because a safety copy of it could not be saved first. Nothing was changed.";
const NOT_MATCHING = "Your data was not replaced, because the safety copy did not match when it was read back. Nothing was changed.";

// current: the ledger on the phone now; next: the ledger to put in its place (both objects).
// io: { readCopies(), writeCopies(list) -> {local, idb}, writeLedger(text) -> whatever the caller needs to judge the save }.
// meta: what is kept about the copy ({at, from_version, build}).
// Returns { ok: true, copied, written } or { ok: false, stage: "copy" | "check" | "replace", message }. `copied` is false when the phone held nothing.
export async function replaceWithCopy({ current, next, io, meta, keep = RESTORE_COPIES_KEPT }) {
  if (!holdsData(current)) {   // an empty phone: nothing to lose, nothing to put back
    try { return { ok: true, copied: false, written: await io.writeLedger(JSON.stringify(next)) }; }
    catch { return { ok: false, stage: "replace", message: "The data could not be saved. Nothing was changed." }; }
  }
  const text = JSON.stringify(current);
  try {
    const list = rotateCopies(await io.readCopies(), text, meta, keep);
    const saved = await io.writeCopies(list);
    if (!saved || (!saved.local && !saved.idb)) return { ok: false, stage: "copy", message: NOT_SAVED };
    const back = await io.readCopies();
    if (!copyHolds(back?.[0], current)) return { ok: false, stage: "check", message: NOT_MATCHING };
  } catch { return { ok: false, stage: "copy", message: NOT_SAVED }; }
  try { return { ok: true, copied: true, written: await io.writeLedger(JSON.stringify(next)) }; }
  catch { return { ok: false, stage: "replace", message: "The data could not be saved. Nothing was changed, and the safety copy is kept." }; }
}

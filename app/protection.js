// The browser decides whether storage is persistent. Never infer it from an
// installation, a saved preference, or a previous request's answer.
import { claimPersistenceRequest } from "./store.js";

export async function storageProtected(storage = globalThis.navigator?.storage) {
  try { return typeof storage?.persisted === "function" && await storage.persisted() === true; }
  catch { return false; }
}

// installed: the app runs from the Home Screen (not a browser tab). It has its own single claim, so a request already used up in a tab
// (refused there) is made once more after the app is installed.
export async function requestStorageProtection({ storage = globalThis.navigator?.storage, claim = claimPersistenceRequest, installed = false } = {}) {
  try {
    if (typeof storage?.persist !== "function") return false;
    if (await storageProtected(storage)) return true;   // already protected: nothing to ask, no claim used
    // The durable claim is committed before asking. Separate tabs and later
    // sessions use the same claim, and restoring a ledger does not erase it.
    if (!await claim(installed ? "persistence-requested-installed" : "persistence-requested")) return storageProtected(storage);
    return await storage.persist() === true;
  } catch { return false; } // storage permission must never interrupt logging
}

// The owner's button in About (Nov 23): Chrome refused the one request made on a save and the app never asked again, so the line stayed
// "no". A tap asks the browser at once, every time (no claim: the owner asked), and returns the browser's own answer.
export async function askStorageProtection(storage = globalThis.navigator?.storage) {
  try {
    if (typeof storage?.persist !== "function") return false;
    if (await storageProtected(storage)) return true;
    return await storage.persist() === true;
  } catch { return false; }
}
export const PROTECT_REFUSED = "Storage protected: no. Asked just now: the browser decides, and may agree after more use.";

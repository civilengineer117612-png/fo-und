// Which device and which install the app is running in. The ledger lives ONLY on the phone it was made on (no server, no sync): every install
// of a web app has its own storage, so the app says which situation it is in instead of letting an empty screen look like lost data.
// ANDROID READY (owner, Nov 21: friends install from Chrome, no APK): any phone or computer may hold a ledger. The one place still stopped is
// an iPhone's Safari TAB: there Safari keeps a separate, empty storage from the Home Screen app, so a tab must never look like the real ledger.
// On Android (and a computer) the browser tab and the installed app share one storage, so both open the same ledger (the two-windows guard keeps
// two of them from overwriting each other).
//
// Pure logic: the caller passes what it can see (user agent string, whether it runs as a
// Home Screen app, whether each store holds data) and gets a status and a plain message.

export function detectPlatform(userAgent) {
  if (/android/i.test(userAgent)) return "android";
  if (/iphone|ipod/i.test(userAgent)) return "ios";
  return "other";   // includes iPad (reports as a Mac) and computers
}

const result = (status, message, allowEntry) => ({ status, message, allowEntry });

// A trial copy (the address with ?trial on the end) lets the app be tried in a browser, never in an installed (Home Screen) app, which holds
// the real ledger on any phone. The caller keeps a trial's data in its own separate storage, so it can never mix with a real ledger or be backed up as one.
export const trialAllowed = ({ standalone }) => !standalone;

// stores.local / stores.idb: true = holds data, false = empty, null = could not be read.
export function assessDevice({ platform, standalone, stores, trial = false }) {
  if (trial && trialAllowed({ platform, standalone })) {
    if (stores.local === null || stores.idb === null) return result("STORAGE_UNAVAILABLE", "This device's storage cannot be read, so even the trial cannot save.", false);
    return result("TRIAL", "Trial copy, not your real ledger. Do not enter real financial data.", true);
  }
  if (platform === "ios" && !standalone) {
    return result("BROWSER_TAB",
      "You are in a browser tab, which keeps separate storage from the Home Screen app. Open the app from its Home Screen icon.", false);
  }
  if (stores.local === null || stores.idb === null) {
    return result("STORAGE_UNAVAILABLE",
      "This device's storage cannot be read. Nothing can be saved safely until that is fixed.", false);
  }
  // IndexedDB is the main store and localStorage only its spare copy: an empty spare is brought up to date quietly at start.
  if (stores.idb && !stores.local) return result("OK", "", true);
  if (stores.local !== stores.idb) {
    const lost = stores.local ? "IndexedDB" : "localStorage";
    return result("PARTIAL_LOSS",
      "Only one of the two stores holds data (" + lost + " is empty). The phone may have cleared it. Restore from your encrypted backup.", false);
  }
  if (!stores.local) {
    return result("EMPTY",
      "No data on this device. This is expected on first run. If you have entered data here before, restore from your encrypted backup.", true);
  }
  return result("OK", "", true);
}

// APP LOCK (owner, Oct 29; data version unchanged). A privacy screen against someone using the unlocked phone, NOT encryption of the data.
// The lock is OFF by default. When on it asks at start and after the app has been away for more than a minute, and opens with Face ID (a passkey made on
// this phone) or a 6-digit PIN. The PIN is kept only as a salted PBKDF2 hash. Wrong PINs make the next try wait longer; NOTHING is ever erased or reset.
// Pure: the clock is passed in. The lock lives on the phone only (app/store.js, its own key), never in the ledger, a backup or the settings.
export const PIN_LENGTH = 6, AWAY_MS = 60_000, FREE_TRIES = 4, FIRST_WAIT = 30, LONGEST_WAIT = 3600, ITERATIONS = 150_000;

export const validPin = (pin) => typeof pin === "string" && /^\d{6}$/.test(pin);
export const lockOn = (rec) => Boolean(rec && rec.on === true && typeof rec.hash === "string" && typeof rec.salt === "string");

const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const newSalt = () => b64(crypto.getRandomValues(new Uint8Array(16)));

// The PIN becomes a hash with its own random salt: the same PIN on two phones gives two different hashes, and the PIN itself is never kept.
export async function hashPin(pin, salt, iterations = ITERATIONS) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  return b64(new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unb64(salt), iterations }, key, 256)));
}

// The record that is kept: whether the lock is on, the passkey's id, the salt and hash of the PIN, and the count of wrong tries with the time they wait until.
export async function makeRecord({ pin, cred }) {
  if (!validPin(pin)) throw new Error("The PIN must be 6 digits.");
  const salt = newSalt();
  return { v: 1, on: true, cred: cred ?? null, salt, iter: ITERATIONS, hash: await hashPin(pin, salt), fails: 0, until: 0 };
}

export async function checkPin(rec, pin) {
  if (!lockOn(rec) || !validPin(pin)) return false;
  const got = await hashPin(pin, rec.salt, rec.iter ?? ITERATIONS), want = rec.hash;
  let diff = got.length ^ want.length;   // compared in full, so the time does not say how far a wrong PIN got
  for (let i = 0; i < Math.max(got.length, want.length); i++) diff |= (got.charCodeAt(i) || 0) ^ (want.charCodeAt(i) || 0);
  return diff === 0;
}

// Seconds the NEXT try must wait after `fails` wrong tries in a row: none for the first four, then 30, 60, 120 ... never more than an hour.
export const waitSeconds = (fails) => (fails <= FREE_TRIES ? 0 : Math.min(LONGEST_WAIT, FIRST_WAIT * 2 ** (fails - FREE_TRIES - 1)));
export const secondsLeft = (rec, now) => Math.max(0, Math.ceil(((rec?.until ?? 0) - now) / 1000));
export function afterWrong(rec, now) { const fails = (rec.fails ?? 0) + 1; return { ...rec, fails, until: now + waitSeconds(fails) * 1000 }; }
export const afterRight = (rec) => ({ ...rec, fails: 0, until: 0 });

// Away for MORE than a minute locks again; exactly a minute does not.
export const shouldLock = (hiddenAt, now) => Number.isFinite(hiddenAt) && now - hiddenAt > AWAY_MS;

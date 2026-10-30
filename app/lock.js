// The phone's own Face ID through a passkey (WebAuthn, a platform authenticator, user verification required). Nothing is sent anywhere: the passkey lives
// on this phone and the check is local. A passkey tied to this site's address; if it is gone (deleted, a new phone, a changed address) the PIN still opens the app.
const bytes = (n) => crypto.getRandomValues(new Uint8Array(n));
const enc = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const dec = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export const passkeysAvailable = () => Boolean(window.PublicKeyCredential && navigator.credentials?.create && navigator.credentials?.get);

// Makes the passkey (needs a tap, so call it from a button). Resolves {ok: true, cred} or {ok: false, message}.
export async function createPasskey() {
  if (!passkeysAvailable()) return { ok: false, message: "This phone cannot make a passkey here." };
  try {
    const made = await navigator.credentials.create({ publicKey: {
      challenge: bytes(32), rp: { id: location.hostname, name: "fo/und" }, user: { id: bytes(16), name: "fo/und", displayName: "fo/und" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" }, timeout: 60000, attestation: "none",
    } });
    return made ? { ok: true, cred: enc(new Uint8Array(made.rawId)) } : { ok: false, message: "Face ID was not set up." };
  } catch (err) { return { ok: false, message: err?.name === "NotAllowedError" ? "Face ID was cancelled." : "Face ID could not be set up." }; }
}

// Asks for Face ID. Resolves {ok: true} only when the phone says the person was verified (the "user verified" bit of the answer is set).
export async function verifyPasskey(cred) {
  if (!passkeysAvailable() || !cred) return { ok: false, message: "No passkey on this phone." };
  try {
    const got = await navigator.credentials.get({ publicKey: {
      challenge: bytes(32), rpId: location.hostname, userVerification: "required", timeout: 60000,
      allowCredentials: [{ type: "public-key", id: dec(cred), transports: ["internal"] }],
    } });
    const flags = new Uint8Array(got.response.authenticatorData)[32] ?? 0;
    return (flags & 0x04) !== 0 ? { ok: true } : { ok: false, message: "Face ID did not verify you." };
  } catch { return { ok: false, message: "Face ID did not work." }; }
}

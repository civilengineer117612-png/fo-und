// FIXED (owner, Nov 8, P0-6 PR 4): the payments that come first every month. A spending category is Fixed when
//   - its role is rent or subscription (the role the owner stored; a role only guessed from the name counts outside the bucket Other), or
//   (A SCHEDULE NEVER MAKES A CATEGORY FIXED, owner Nov 13: a scheduled payment sets how much the category needs, at least the scheduled total, and the
//   category keeps the group its role or bucket gives it. Until Nov 13 a schedule made a category Fixed.)
//   - the owner turned it on (settings `fixed_overrides`, {category_id: true}).
// The owner can also turn a category OFF ({category_id: false}), which wins over the role and the schedule. A category in the bucket OTHER is never Fixed
// (a name nobody has read yet is not a commitment): it becomes Fixed only after its bucket is answered. A rent or subscription ROLE is Fixed regardless. Nothing is stored in the ledger: the roles stay as
// they are, and the setting is optional (absent is valid), so the data version does not change.
// (A role the owner stored is Fixed even when its name sits in Other.)
// COUNTED INSIDE THE 50 (owner, Nov 8): the 50 / 30 / 20 targets stay the default for new users and an owner's own split is never changed; a Fixed category is
// counted with Needs (buckets.js bucketRows, suggest.js), so a subscription that is Fixed comes out of the 50, not the 30. Fixed is also how the Budget lists it first.
import { bucketOf } from "./buckets.js";
import { guessType } from "./types.js";
import { UNLOGGED_CATEGORY_ID } from "./seed.js";

export const FIXED_LABEL = "Fixed";
export const FIXED_ROLES = ["rent", "subscription"];

// Category id -> why it is Fixed: "role" | "name" | "you". Only spending categories; Uncategorized and a hidden category are left out by the caller.
export function fixedMap(state, settings, today) {
  const overrides = settings?.fixed_overrides ?? {}, bucketOverrides = settings?.bucket_overrides ?? {};
  const out = new Map();
  for (const c of state.categories) {
    if (c.kind !== "expense" || c.id === UNLOGGED_CATEGORY_ID) continue;
    if (overrides[c.id] === false) continue;
    // A role the OWNER set (the stored `role`: rent or subscription) always wins over a name guess: the category is Fixed whatever its name reads as and whatever
    // bucket it sits in. A role only GUESSED from the name does not: it counts only outside the bucket Other. A schedule or the owner's switch cannot make a
    // category in the bucket Other Fixed either: a name nobody has read yet is not a commitment.
    if (FIXED_ROLES.includes(c.role)) { out.set(c.id, "role"); continue; }
    if (bucketOf(c, bucketOverrides) === "other") continue;   // Other is never Fixed
    if (overrides[c.id] === true) out.set(c.id, "you");
    else if (FIXED_ROLES.includes(guessType(c.name))) out.set(c.id, "name");
  }
  return out;
}

export const isFixed = (state, settings, categoryId, today) => fixedMap(state, settings, today).has(categoryId);

// The settings after the owner's choice: true (Fixed), false (not Fixed), null (back to what the role says). A category in Other cannot be turned on.
export function withFixed(state, settings, categoryId, value) {
  const c = state.categories.find((x) => x.id === categoryId && x.kind === "expense");
  if (!c) return { ok: false, message: "No such category." };
  if (value === true && bucketOf(c, settings?.bucket_overrides ?? {}) === "other") return { ok: false, message: "A category in Other is never Fixed. Choose Need or Want for it first." };
  const next = { ...(settings.fixed_overrides ?? {}) };
  if (value === null) delete next[categoryId]; else next[categoryId] = value === true;
  return { ok: true, settings: { ...settings, fixed_overrides: next } };
}

// The words that say why a category is Fixed (a quiet line under its name).
export const fixedWhy = (why) => (why === "role" || why === "name" ? "Fixed: rent or a subscription" : why === "you" ? "Fixed: you chose it" : "");

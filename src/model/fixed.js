// FIXED (owner, Nov 8, P0-6 PR 4): the payments that come first every month. A spending category is Fixed when
//   - its role is rent or subscription (the stored role, else the one its name reads as: kindOf), or
//   - it carries a schedule that still has a payment to come (an installment, a scheduled payment, a loan repayment, a scheduled family send), or
//   - the owner turned it on (settings `fixed_overrides`, {category_id: true}).
// The owner can also turn a category OFF ({category_id: false}), which wins over the role and the schedule. A category in the bucket OTHER is never Fixed
// (a name nobody has read yet is not a commitment): it becomes Fixed only after its bucket is answered. A rent or subscription ROLE is Fixed regardless. Nothing is stored in the ledger: the roles stay as
// they are, and the setting is optional (absent is valid), so the data version does not change.
// (A category holding the role rent or subscription is Fixed even when its name sits in Other: the role is the owner's own earlier choice.)
// The 50 / 30 / 20 bucket targets do NOT change: a Fixed category still counts in its own bucket (rent in Needs, a subscription in Wants). Fixed is how the
// Budget lists and funds it first, not a fourth target.
import { bucketOf } from "./buckets.js";
import { kindOf } from "./types.js";
import { suggestInputs } from "./schedules.js";
import { UNLOGGED_CATEGORY_ID } from "./seed.js";

export const FIXED_LABEL = "Fixed";
export const FIXED_ROLES = ["rent", "subscription"];

// Category id -> why it is Fixed: "role" | "schedule" | "you". Only spending categories; Uncategorized and a hidden category are left out by the caller.
export function fixedMap(state, settings, today) {
  const overrides = settings?.fixed_overrides ?? {}, bucketOverrides = settings?.bucket_overrides ?? {};
  const scheduled = new Set(suggestInputs(state, today).filter((x) => x.months_left !== 0).map((x) => x.category_id));
  const out = new Map();
  for (const c of state.categories) {
    if (c.kind !== "expense" || c.id === UNLOGGED_CATEGORY_ID) continue;
    if (overrides[c.id] === false) continue;
    // The role (rent or subscription) is the owner's own earlier word, so it makes a category Fixed whatever its name reads as. A schedule or the owner's switch
    // cannot make a category in the bucket Other Fixed: a name nobody has read yet is not a commitment.
    if (FIXED_ROLES.includes(kindOf(c))) { out.set(c.id, "role"); continue; }
    if (bucketOf(c, bucketOverrides) === "other") continue;   // Other is never Fixed
    if (overrides[c.id] === true) out.set(c.id, "you");
    else if (scheduled.has(c.id)) out.set(c.id, "schedule");
  }
  return out;
}

export const isFixed = (state, settings, categoryId, today) => fixedMap(state, settings, today).has(categoryId);

// The settings after the owner's choice: true (Fixed), false (not Fixed), null (back to what the role and the schedule say). A category in Other cannot be turned on.
export function withFixed(state, settings, categoryId, value) {
  const c = state.categories.find((x) => x.id === categoryId && x.kind === "expense");
  if (!c) return { ok: false, message: "No such category." };
  if (value === true && bucketOf(c, settings?.bucket_overrides ?? {}) === "other") return { ok: false, message: "A category in Other is never Fixed. Choose Need or Want for it first." };
  const next = { ...(settings.fixed_overrides ?? {}) };
  if (value === null) delete next[categoryId]; else next[categoryId] = value === true;
  return { ok: true, settings: { ...settings, fixed_overrides: next } };
}

// The words that say why a category is Fixed (a quiet line under its name).
export const fixedWhy = (why) => (why === "role" ? "Fixed: rent or a subscription" : why === "schedule" ? "Fixed: it has a scheduled payment" : why === "you" ? "Fixed: you chose it" : "");

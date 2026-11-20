// Search the ledger's entries (owner, Oct 18). Every word typed must be found somewhere in the entry: its payee or item, its note, its category,
// its account, its date, or its amount ("245", "245.00" and "1,245.00" all find an amount of 245 or 1,245 pesos). Nothing is stored and nothing changes.
import { formatPesos } from "./money.js";

const norm = (s) => String(s ?? "").toLowerCase();
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

// The words each entry can be found by, and the amounts it holds (whole pesos or with centavos, no commas: "1245", "1245.5"), worked out ONCE
// per set of lists (L10, overhaul, Nov 20: it was worked out again for every transaction on every key typed, a pass over all the entries each
// time; 4,000 entries took about 300 ms a key on a laptop). The state is never edited in place (a change makes new arrays), so the answer is
// kept while the same transactions, entries, categories and accounts arrays are in use, and dropped when any of them changes, grows or shrinks.
let cache = null;
function partsIndex(state) {
  if (cache && cache.tx === state.transactions && cache.en === state.entries && cache.cats === state.categories && cache.accts === state.accounts && cache.n === state.transactions.length + ":" + state.entries.length) return cache.parts;
  const cat = new Map(state.categories.map((c) => [c.id, c.name])), acct = new Map(state.accounts.map((a) => [a.id, a.name]));
  const legs = new Map();
  for (const e of state.entries) { const l = legs.get(e.transaction_id); if (l) l.push(e); else legs.set(e.transaction_id, [e]); }
  const parts = new Map();
  for (const t of state.transactions) {
    const amounts = new Set(), bits = [t.payee, t.memo, t.date, MONTHS[Number(t.date.slice(5, 7)) - 1] + " " + Number(t.date.slice(8)) + " " + t.date.slice(0, 4)];
    for (const e of legs.get(t.id) ?? []) {
      if (e.category_id) bits.push(cat.get(e.category_id));
      if (e.account_id) bits.push(acct.get(e.account_id));
      amounts.add(plain(formatPesos(Math.abs(e.amount))));
    }
    parts.set(t, { text: norm(bits.join(" | ")), amounts });
  }
  cache = { tx: state.transactions, en: state.entries, cats: state.categories, accts: state.accounts, n: state.transactions.length + ":" + state.entries.length, parts };
  return parts;
}
// Builds the index ahead of the first key (the search window calls it just after it opens); nothing is returned and nothing changes.
export const warmSearch = (state) => { partsIndex(state); };

const plain = (s) => String(s).replace(/[^0-9.]/g, "").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");   // "₱1,245.00" -> "1245", "245.50" -> "245.5"

// state, query: the words typed; options: {from, to} dates (inclusive, either may be left out), limit: how many to return (newest first), skip: (transaction) => true to leave one out.
// Returns {rows: [transactions], total: how many matched}. An empty query matches nothing here: the caller shows its own list then.
export function searchEntries(state, query, { from = "", to = "9999-12-31", limit = 200, skip = () => false } = {}) {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return { rows: [], total: 0 };
  const index = partsIndex(state);
  const hits = state.transactions.filter((t) => t.date >= from && t.date <= to && !skip(t)).filter((t) => { const p = index.get(t); return words.every((w) => (/^[\d,.]+$/.test(w) && p.amounts.has(plain(w))) || p.text.includes(w)); })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.created_at < b.created_at ? 1 : -1));
  return { rows: hits.slice(0, limit), total: hits.length };
}

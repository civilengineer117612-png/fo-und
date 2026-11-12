import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { BANKS, logosToFetch } from "../src/model/index.js";

// LOGO PRIVACY (owner, Nov 12, P1): no network request may carry the owner's data or reveal it. The bank logos are the app's only outside requests.
// Before this, a logo that could only be linked was loaded from the outside service every time one of the owner's accounts was drawn, and removing a logo
// changed which banks were asked for: both told a third party which banks the owner uses. Every name and figure here is invented.
const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8"), html = readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
const policy = (html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/) ?? [])[1] ?? "";
const part = (name) => (policy.split(";").map((x) => x.trim()).find((x) => x.startsWith(name + " ")) ?? "").split(/\s+/).slice(1);
const PNG = "data:image/png;base64,AAAA", T = "2026-11-12";

test("which logos are asked for depends only on the bank list, on what was already copied and on when it was tried: never on the owner", () => {
  const all = logosToFetch(BANKS, {}, {}, T).map((b) => b.id);
  assert.deepEqual(all, BANKS.map((b) => b.id), "a phone with no logos yet asks for every listed bank, whatever accounts it has");
  assert.equal(logosToFetch.length <= 5 && !/accounts|state|ledger|blocked/i.test(logosToFetch.toString()), true, "the rule takes no accounts, no ledger and no list of removed logos");
  const some = { [BANKS[0].id]: { icon: PNG }, [BANKS[1].id]: { icon_url: "https://example.invalid/logo.png" } };
  assert.deepEqual(logosToFetch(BANKS, some, {}, T).map((b) => b.id), BANKS.slice(1).map((b) => b.id), "a bank with a copy on the phone is not asked for again; one with only an outside address still is");
  const tried = Object.fromEntries(BANKS.map((b) => [b.id, "2026-11-08"]));
  assert.deepEqual(logosToFetch(BANKS, {}, tried, T), [], "tried 4 days ago: nothing is asked");
  assert.equal(logosToFetch(BANKS, {}, tried, "2026-11-15").length, BANKS.length, "after 7 days all the missing ones are asked again, together");
  assert.equal(logosToFetch(BANKS, {}, tried, T, true).length, BANKS.length, "Try again asks for all the missing ones");
});

test("a picture is drawn only from a copy kept on the phone; an outside address is never drawn, linked or newly saved", () => {
  assert.doesNotMatch(app, /src="\$\{esc\(a\.icon_url\)\}"/, "no <img> is pointed at a logo's outside address");
  assert.doesNotMatch(app, /icon_url: (src|r\.icon_url)/, "no outside address is saved as a logo any more");
  assert.doesNotMatch(app, /LINK_SOURCES|apple-touch-icon|gstatic|duckduckgo/, "the show-only sources (a bank's own site, search-engine icons) are gone");
  assert.match(app, /if \(a\.icon\?\.startsWith\("data:image\/"\)\) return `<img class="ico" src="\$\{esc\(a\.icon\)\}"/, "the one place that draws an account or bank picture draws a data: picture");
  assert.match(app, /return l\?\.icon\?\.startsWith\("data:image\/"\) \? \{ icon: l\.icon \} : null;/, "a bank's logo is its copy or nothing");
  assert.match(app, /const todo = M\.logosToFetch\(M\.BANKS, have, tried, t, force\);/, "the lookup asks for exactly what the rule gives");
  assert.match(app, /if \(key && bankLogo\(key\)\) settings = \{ \.\.\.settings, bankLogosBlocked: \{ \.\.\.\(settings\.bankLogosBlocked \?\? \{\}\), \[key\]: true \} \};/, "Remove the picture hides the logo and keeps its copy, so nothing is asked again because of it");
  assert.match(app, /img\.crossOrigin = "anonymous"; img\.referrerPolicy = "no-referrer";/, "a logo request carries no cookie and no page address");
  assert.match(app, /credentials: "omit", referrerPolicy: "no-referrer"/, "nor does the Wikipedia lookup");
});

test("every outside address in the app's code is one of the four logo hosts, and the page's own rule allows no other", () => {
  const allowed = ["https://icon.horse/", "https://api.faviconkit.com/", "https://en.wikipedia.org/", "https://upload.wikimedia.org/"];
  const found = [];
  for (const dir of ["../app/", "../src/model/"]) for (const f of readdirSync(new URL(dir, import.meta.url)).filter((n) => /\.(js|html)$/.test(n))) {
    const code = readFileSync(new URL(dir + f, import.meta.url), "utf8");
    for (const m of code.matchAll(/https?:\/\/[A-Za-z0-9.$\{\}-]+\/?/g)) found.push([f, m[0]]);
  }
  const strange = found.filter(([, u]) => !allowed.some((a) => (u.endsWith("/") ? u : u + "/").startsWith(a)) && !/^https?:\/\/(www\.)?w3\.org/.test(u) && u !== "https://" && u !== "http://");
  assert.deepEqual(strange, [], "no other outside address is written anywhere in the app or its model");
  assert.deepEqual(part("img-src"), ["'self'", "data:", "blob:", "https://icon.horse", "https://api.faviconkit.com", "https://upload.wikimedia.org"], "pictures: this site and the three hosts logos are copied from");
  assert.deepEqual(part("connect-src"), ["'self'", "data:", "blob:", "https://en.wikipedia.org"], "requests: this site and the Wikipedia lookup");
  assert.ok(!/\shttps:(;|\s|$)/.test(policy), "nothing is allowed from any https address in general");
  assert.match(html, /<meta name="referrer" content="no-referrer">/, "the page never tells another site its own address");
});

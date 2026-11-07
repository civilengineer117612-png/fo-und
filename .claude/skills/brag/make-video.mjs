// The brag video: a short phone-size tour of the REAL app, recorded in a browser, with INVENTED data only.
//   node .claude/skills/brag/make-video.mjs [--out <folder>] [--ref <git ref>] [--no-pdf]
// What it does, in order:
//   1. copies the app from git (`git archive <ref>`, default HEAD) into a scratch folder and serves THAT copy, so the repo folder is never the one being served;
//   2. seeds an invented ledger (accounts called "Sample ...", made-up amounts, no logos, no network: everything but the scratch server is blocked);
//   3. records the tour as real 2x screenshots (crisp text; the browser's own video recorder only captures 1x), with captions and tap marks drawn over the page
//      (video chrome only: the app is untouched, apart from a blank band at the top that the caption sits in);
//   4. stitches the frames at their real timings into brag.mp4 (H.264, plays on a phone) plus a few poster frames, all OUTSIDE the repo.
// Nothing here is ever committed: the output goes to --out (default: the system temp folder), and the owner decides what leaves the machine.
import { execSync, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url)), root = execSync("git rev-parse --show-toplevel", { cwd: here }).toString().trim();
const arg = (name, def) => { const i = process.argv.indexOf("--" + name); return i >= 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : true) : def; };
const ref = arg("ref", "HEAD"), noPdf = arg("no-pdf", false) === true, voiceArg = arg("voice", null), voice = typeof voiceArg === "string" ? resolve(voiceArg) : null;
if (voiceArg === true || (voice && !existsSync(voice))) { console.error("--voice needs the path of a voice recording that exists."); process.exit(2); }
if (voice && noPdf) { console.error("--voice and --no-pdf cannot be used together: the voice script has a line for the statement."); process.exit(2); }
const out = resolve(arg("out", join(tmpdir(), "brag")));
if (out.startsWith(root + "/") || out === root) { console.error("Refusing to write the video inside the repository: use --out outside it."); process.exit(2); }
mkdirSync(out, { recursive: true });

// ---- 1. a scratch copy of the app, served on its own port ----
const copy = mkdtempSync(join(tmpdir(), "brag-app-"));
execSync(`git archive ${ref} | tar -x -C ${JSON.stringify(copy)}`, { cwd: root, shell: "/bin/bash" });
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff", ".pdf": "application/pdf", ".wasm": "application/wasm", ".webmanifest": "application/manifest+json" };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname); if (p.endsWith("/")) p += "index.html";
  const file = join(copy, p);
  if (!file.startsWith(copy) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" }); res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/app/index.html`;

// ---- 2. the invented ledger ----
const model = await import(pathToFileURL(join(copy, "src/model/index.js")).href);
const { emptyLedger, defaultCategories, CHANGES, UNLOGGED_CATEGORY_ID } = model;
const TS = "2026-10-31T03:00:00Z", AT = "2026-10-20T09:00:00.000+08:00";   // "today" is Oct 31, 2026 (the second payday), so the video never goes stale
function ledger() {
  const l = emptyLedger(); l.rev = 1; l.saved_at = TS;
  const s = l.state;
  const acct = (id, name, cls, opening, extra = {}) => ({ id, name, class: cls, role: "", hidden_by_default: false, archived: false, opening_balance: opening, opening_date: "2026-01-01", ...extra });
  s.accounts.push(acct("sav", "Sample Savings", "asset", 8500000), acct("wal", "Sample Wallet", "asset", 1200000), acct("cash", "Cash", "asset", 150000), acct("card", "Sample Card", "liability", 0));
  s.categories = [...defaultCategories()];
  if (!s.categories.some((c) => c.id === UNLOGGED_CATEGORY_ID)) s.categories.push({ id: UNLOGGED_CATEGORY_ID, name: "Uncategorized", kind: "expense" });
  for (const c of [{ id: "cat-salary", name: "Salary", kind: "income" }, { id: "cat-interest", name: "Interest", kind: "income" }, { id: "cat-other-income", name: "Other income", kind: "income" }]) if (!s.categories.some((x) => x.id === c.id)) s.categories.push(c);
  const cat = (name) => s.categories.find((c) => c.kind === "expense" && c.name === name)?.id ?? UNLOGGED_CATEGORY_ID;
  let n = 0;
  const tx = (date, payee, legs, status = "verified") => { const id = "b" + ++n; s.transactions.push({ id, date, payee, memo: "", status, source: "manual", created_at: AT, ...(status === "verified" ? { verified_at: AT } : {}) }); for (const [k, v, a] of legs) s.entries.push({ transaction_id: id, [k]: v, amount: a, ...(v === "card" ? { card_state: "posted" } : {}) }); };
  const spend = (date, payee, category, amount, account, status) => tx(date, payee, [["category_id", cat(category), amount], ["account_id", account, -amount]], status);
  const income = (date, payee, amount, account) => tx(date, payee, [["account_id", account, amount], ["category_id", "cat-salary", -amount]]);
  income("2026-10-31", "Sample Employer", 1600000, "sav"); income("2026-10-15", "Sample Employer", 1600000, "sav"); income("2026-09-30", "Sample Employer", 1600000, "sav");
  spend("2026-10-01", "Rent", "Rent", 800000, "sav"); spend("2026-10-02", "Sample Grocer", "Food", 185000, "wal"); spend("2026-10-03", "Sample Cafe", "Food", 12000, "wal"); spend("2026-10-05", "Sample Bakery", "Food", 9500, "cash");
  spend("2026-10-07", "Dinner out", "Food", 64000, "wal"); spend("2026-10-09", "Sample Market", "Food", 98000, "wal"); spend("2026-10-12", "Lunch", "Food", 18000, "wal"); spend("2026-10-16", "Sample Grocer", "Food", 142000, "wal");
  spend("2026-10-04", "Light and water", "Essentials", 124000, "sav"); spend("2026-10-10", "Cleaning supplies", "Essentials", 46000, "wal");
  spend("2026-10-03", "Bus fare", "Transport", 4500, "cash"); spend("2026-10-08", "Ride", "Transport", 21000, "wal"); spend("2026-10-14", "Fuel", "Transport", 80000, "wal"); spend("2026-10-19", "Bus fare", "Transport", 4500, "cash");
  spend("2026-10-06", "Streaming", "Subscription", 39900, "card"); spend("2026-10-11", "Sample Shoes", "Shopping", 129900, "card"); spend("2026-10-13", "Pharmacy", "Health", 45000, "wal"); spend("2026-10-17", "Movie night", "Fun", 50000, "wal");
  spend("2026-10-21", "Sample Cafe", "Food", 13500, "wal", "draft"); spend("2026-10-21", "Bus fare", "Transport", 4500, "cash", "draft"); spend("2026-10-20", "Sample Market", "Food", 76000, "wal", "draft");
  const budget = (name, amount) => s.rules.push({ id: "rule-" + name, kind: "budget", subject_id: cat(name), amount, effective_from: "2026-10-01", created_at: AT });
  budget("Food", 600000); budget("Essentials", 250000); budget("Transport", 150000); budget("Rent", 800000); budget("Subscription", 80000); budget("Shopping", 250000); budget("Health", 100000); budget("Fun", 150000);
  s.presets = [{ id: "pl", name: "Lunch", amount: 18000, category_id: cat("Food") }, { id: "pc", name: "Coffee", amount: 12000, category_id: cat("Food") }, { id: "pf", name: "Fare", amount: 4500, category_id: cat("Transport") }];
  l.settings = { notice_seen_at: TS, whatsnew_seen: CHANGES[0].id, welcome_off: true, start_rule_seen: TS, cat_card_seen: TS, intro_off: { scan: true, income: true, log: true, money: true, cards: true, budget: true, goals: true, plan: true, scheduled: true, checks: true, trips: true, buffer: true, checkin: true },
    income_base_pin: 3200000, pay_schedule: { kind: "twice", days: [15, "last"] } };
  return l;
}

// ---- 3. the recording ----
const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_MODULE ?? execSync("npm root -g").toString().trim() + "/playwright");
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1";
const W = 390, H = 844, framesDir = mkdtempSync(join(tmpdir(), "brag-frames-"));
const browser = await pw.chromium.launch();
const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE });
await ctx.route("**/*", (route) => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());   // no network: no logos, no lookups
await ctx.addInitScript(() => { Object.defineProperty(navigator, "standalone", { get: () => true }); sessionStorage.setItem("logOpen", "1"); });
const page = await ctx.newPage(), problems = [];
page.on("pageerror", (e) => problems.push("page error: " + e.message));
await page.clock.setFixedTime(new Date(TS));
await page.goto(base); await page.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 });
await page.evaluate(async (text) => { localStorage.setItem("financialTracker.ledger", text); await new Promise((res) => { const r = indexedDB.open("financialTracker", 3); r.onupgradeneeded = () => { for (const n of ["kv", "photos", "safety"]) if (!r.result.objectStoreNames.contains(n)) r.result.createObjectStore(n); }; r.onsuccess = () => { const tx = r.result.transaction("kv", "readwrite"); tx.objectStore("kv").put(text, "ledger"); tx.oncomplete = () => { r.result.close(); res(); }; }; }); }, JSON.stringify(ledger()));
await page.reload(); await page.locator("#nav button").first().waitFor({ state: "visible", timeout: 60000 });
await page.waitForTimeout(800);
// the overlay: a green caption bar at the top, a full card for the title and the end, and a tap mark. Drawn over the page; the app itself is not changed.
await page.evaluate(() => {
  const css = document.createElement("style");
  css.textContent = `body{padding-top:68px !important}
  #brag-cap{position:fixed;left:14px;right:14px;top:max(14px,env(safe-area-inset-top));z-index:99999;background:#1E5B47;color:#fff;font:600 17px/1.3 "IBM Plex Sans",system-ui,sans-serif;text-wrap:balance;padding:12px 16px;border-radius:14px;opacity:0;transform:translateY(-8px);transition:opacity .35s,transform .35s;pointer-events:none}
  #brag-cap.on{opacity:1;transform:none}
  #brag-card{position:fixed;inset:0;z-index:100000;background:#fff;color:#1E5B47;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:32px;font-family:"IBM Plex Sans",system-ui,sans-serif;opacity:0;transition:opacity .5s;pointer-events:none}
  #brag-card.on{opacity:1}
  #brag-card b{font-size:56px;letter-spacing:-1px;font-weight:600} #brag-card p{font-size:21px;line-height:1.4;margin:14px 0 0;color:#2b3a35;text-wrap:balance} #brag-card small{font-size:15px;margin-top:22px;color:#5b6b65;line-height:1.5;text-wrap:balance}
  .brag-tap{position:fixed;z-index:99998;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;background:rgba(30,91,71,.28);border:2px solid #1E5B47;pointer-events:none;animation:bragtap .6s ease-out forwards}
  @keyframes bragtap{from{transform:scale(.5);opacity:1}to{transform:scale(1.5);opacity:0}}`;
  document.head.append(css);
  const cap = Object.assign(document.createElement("div"), { id: "brag-cap" }), card = Object.assign(document.createElement("div"), { id: "brag-card" });
  document.body.append(cap, card);
  addEventListener("pointerdown", (e) => { const d = document.createElement("div"); d.className = "brag-tap"; d.style.left = e.clientX + "px"; d.style.top = e.clientY + "px"; document.body.append(d); setTimeout(() => d.remove(), 700); }, true);
  window.__brag = { cap: (t) => { cap.textContent = t || ""; cap.classList.toggle("on", !!t); }, card: (html) => { card.innerHTML = html || ""; card.classList.toggle("on", !!html); } };
});
// the recorder: a loop of real 2x screenshots, each with its time; frames are stitched at their real timings afterwards
const rec = { on: false, list: [], t0: 0, loop: null };
const record = async () => { while (rec.on) { const t = Date.now(), buf = await page.screenshot({ type: "jpeg", quality: 88, scale: "device" }).catch(() => null); if (!buf) continue; const f = join(framesDir, String(rec.list.length).padStart(5, "0") + ".jpg"); writeFileSync(f, buf); rec.list.push({ f, t }); } };
const cap = (t) => page.evaluate((x) => window.__brag.cap(x), t), card = (h) => page.evaluate((x) => window.__brag.card(x), h), wait = (ms) => page.waitForTimeout(voice ? Math.round(ms * 0.5) : ms);   // with a voice the scenes are recorded briskly, then stretched or squeezed to each spoken line
const scene = async (name, fn) => { try { await fn(); } catch (e) { problems.push(`scene "${name}": ${e.message.split("\n")[0]}`); await cap(""); await card(""); } };
const menuGo = async (tab) => { await page.click("#menuBtn"); await page.click(`#menu .item[data-tab="${tab}"]`); await page.waitForFunction(() => !document.querySelector("#menu .drawer"), null, { timeout: 8000 }); await wait(500); };

const marks = []; const mark = (name) => marks.push([name, +((Date.now() - rec.t0) / 1000).toFixed(1)]);
rec.on = true; rec.t0 = Date.now(); rec.loop = record();
mark("start");
await scene("title", async () => { await card(`<b>fo/und</b><p>Your money.<br>Only on your phone.</p><small>A personal finance app.<br>Free. No account. No server.</small>`); await wait(3200); await card(""); await wait(600); });
await scene("log", async () => {
  mark("log"); const slow = voice ? 1.9 : 1;   // the log scene has the longest spoken lines
  await cap("Log a spend in two taps."); await wait(1600 * slow);
  await page.click('button.tile:has-text("Lunch")'); await wait(900 * slow);
  await page.click('#sheet .chip:has-text("Sample Wallet")'); await page.locator("#toast").filter({ hasText: "Saved" }).first().waitFor({ timeout: 6000 }).catch(() => {}); await wait(2200 * slow);
});
await scene("cash flow", async () => {
  mark("cash flow"); await cap("See where it went, at a glance."); await menuGo("money"); await wait(2600);
  await page.evaluate(() => window.scrollBy({ top: 420, behavior: "smooth" })); await wait(2400);
});
await scene("budget", async () => {
  mark("budget"); await cap("One budget: month, payday, week."); await menuGo("budget"); await wait(2200);
  await page.click('button[data-action="bv-view"][data-id="payday"]'); await wait(2400);
  await page.click('button[data-action="bv-view"][data-id="week"]'); await wait(2200);
});
await scene("cards", async () => {
  mark("cards"); await cap("Amounts stay hidden. Tap the eye."); await menuGo("cards"); await wait(2200);
  await page.click('[data-action="cards-eye"]'); await wait(2800);
});
if (!noPdf) await scene("statement", async () => {
  mark("statement"); await cap("Import a statement. Nothing doubled."); await page.click('#nav button:has-text("Log")').catch(() => {}); await wait(500);
  await page.click('button[data-action="open-scan-pick"]'); await wait(900);
  await page.setInputFiles("input[data-import]", join(copy, "e2e/fixtures/sample-open.pdf")); await page.locator("#sheet").getByText("Balance check").first().waitFor({ timeout: 30000 }); await wait(2600);
  await page.evaluate(() => { const s = document.querySelector("#sheet"); s?.scrollBy({ top: 360, behavior: "smooth" }); }); await wait(2600);
  await page.click('#sheet button:has-text("Cancel")').catch(() => {}); await wait(600);
});
await scene("verify", async () => {
  mark("verify"); await cap("Check once. Then it is final."); await page.click('#nav button:has-text("Verify")'); await wait(3200);
});
await scene("end", async () => {
  mark("end"); await cap(""); await card(`<b>fo/und</b><p>Reads receipts and statements<br>on the phone itself.</p><small>Encrypted backups.<br>Your ledger and photos stay on your phone.<br>Free for good. No ads, no subscription.</small>`); await wait(4200);
});
rec.on = false; await rec.loop;
await ctx.close(); await browser.close(); server.close();

// ---- 3b. with a voice: each scene starts when its spoken line starts ----
// The recording is cut at its pauses. The script (see SKILL.md) has 14 phrases; the phrase that opens each scene is fixed below.
const SCENE_PHRASE = { start: 0, log: 2, "cash flow": 4, budget: 5, cards: 6, statement: 7, verify: 9, end: 10 };
let warp = null, voiceSeconds = 0;
if (voice) {
  voiceSeconds = Number(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 ${JSON.stringify(voice)}`).toString().trim());
  const sd = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", voice, "-af", "silencedetect=n=-38dB:d=0.2", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const starts = [0, ...[...sd.matchAll(/silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/g)].filter((m) => Number(m[2]) >= 0.35).map((m) => Number(m[1])).filter((t) => t < voiceSeconds - 0.3)];   // a pause between lines is at least a third of a second
  if (starts.length !== 14) problems.push(`voice: found ${starts.length} phrases, the script has 14; the scenes were not timed to the voice`);
  else {
    const names = marks.map(([n]) => n), target = names.map((n) => starts[SCENE_PHRASE[n]]); target.push(voiceSeconds + 0.6);
    const actual = marks.map(([, t]) => t); actual.push((rec.list[rec.list.length - 1].t - rec.t0) / 1000);
    warp = { names, target, actual };
    names.forEach((n, i) => { const f = (target[i + 1] - target[i]) / (actual[i + 1] - actual[i]); if (!["start", "end"].includes(n) && (f < 0.6 || f > 1.8)) problems.push(`scene "${n}" had to be played at ${f.toFixed(2)}x to fit its spoken line`); });
  }
}
const timeOf = (t) => { if (!warp) return t; const a = warp.actual; let i = a.findIndex((x, k) => t >= x && t < a[k + 1]); if (i < 0) i = t < a[0] ? 0 : a.length - 2; return warp.target[i] + (t - a[i]) * (warp.target[i + 1] - warp.target[i]) / (a[i + 1] - a[i]); };

// ---- 4. the file: frames at their real timings, an mp4 that plays everywhere, a few frames to inspect ----
const mp4 = join(out, "brag.mp4"), listFile = join(framesDir, "list.txt");
const tl = rec.list.map((r) => timeOf((r.t - rec.t0) / 1000)), tailEnd = warp ? warp.target[warp.target.length - 1] : tl[tl.length - 1] + 0.6;
writeFileSync(listFile, rec.list.map((r, i) => `file '${r.f}'\nduration ${Math.max(0.001, (tl[i + 1] ?? tailEnd) - tl[i]).toFixed(3)}`).join("\n") + `\nfile '${rec.list[rec.list.length - 1].f}'\n`);
const ff = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listFile, ...(voice ? ["-i", voice] : []), "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-crf", "22", "-preset", "medium", "-movflags", "+faststart", ...(voice ? ["-af", "apad", "-c:a", "aac", "-b:a", "128k", "-shortest"] : ["-an"]), mp4], { stdio: "inherit" });
if (ff.status !== 0) { console.error("ffmpeg failed"); process.exit(1); }
const dur = Number(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 ${JSON.stringify(mp4)}`).toString().trim());
const frames = join(out, "frames"); mkdirSync(frames, { recursive: true });
for (const [name, t] of marks) { const at = Math.min(dur - 0.2, t + 1.8).toFixed(2); spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", at, "-i", mp4, "-frames:v", "1", join(frames, name.replace(/\W+/g, "-") + ".png")]); }
rmSync(copy, { recursive: true, force: true }); rmSync(framesDir, { recursive: true, force: true });
console.log(JSON.stringify({ video: mp4, seconds: Math.round(dur), size_mb: +(statSync(mp4).size / 1e6).toFixed(1), screenshots: rec.list.length, fps_captured: +(rec.list.length / dur).toFixed(1), frames, scenes: marks.map(([n]) => n), problems }, null, 1));

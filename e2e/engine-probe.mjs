// Facts about the browser engine itself, printed as `probe: ...` lines (the WebKit job runs this first). They help tell an app problem from a
// limit of the test browser: for example, a save that keeps a picture needs IndexedDB to keep a Blob and a canvas to make one.
import { launchBrowser, ENGINE } from "./engine.mjs";
const browser = await launchBrowser();
const ctx = await browser.newContext({ serviceWorkers: "block" });
const page = await ctx.newPage();
await page.goto((process.env.BASE ?? "http://127.0.0.1:8124/app/index.html").replace(/app\/index\.html.*$/, ""));
const asked = (name, body) => page.evaluate(`(${body})()`).then((r) => console.log(`probe: ${ENGINE}: ${name}: ${r}`), (e) => console.log(`probe: ${ENGINE}: ${name}: threw ${String(e.message).slice(0, 120)}`));
const within = (ms, start) => `new Promise((resolve) => { const t = setTimeout(() => resolve("no answer in ${ms / 1000} s"), ${ms}); const done = (v) => { clearTimeout(t); resolve(v); }; ${start} })`;
await asked("IndexedDB keeps a Blob and gives it back", `() => ${within(8000, `
  try { const r = indexedDB.open("probe-db", 1); r.onupgradeneeded = () => r.result.createObjectStore("s"); r.onerror = () => done("open error " + r.error?.name);
    r.onsuccess = () => { try { const db = r.result, tx = db.transaction("s", "readwrite"); tx.objectStore("s").put(new Blob(["x".repeat(1000)], { type: "image/png" }), "k");
      tx.oncomplete = () => { const g = db.transaction("s").objectStore("s").get("k"); g.onsuccess = () => done(g.result instanceof Blob ? "yes" : "no, got " + typeof g.result); g.onerror = () => done("read error " + g.error?.name); };
      tx.onerror = tx.onabort = () => done("write error " + tx.error?.name); } catch (e) { done("threw " + e.name); } }; } catch (e) { done("threw " + e.name); }`)}`);
await asked("a canvas makes a PNG Blob", `() => ${within(8000, `
  try { const c = document.createElement("canvas"); c.width = c.height = 8; c.getContext("2d").fillRect(0, 0, 8, 8); c.toBlob((b) => done(b ? "yes, " + b.type + " " + b.size + " bytes" : "no (null)"), "image/png"); } catch (e) { done("threw " + e.name); }`)}`);
await asked("an image decodes from a data URL", `() => ${within(8000, `
  try { const c = document.createElement("canvas"); c.width = c.height = 4; const img = new Image(); img.onload = () => done("yes " + img.naturalWidth + "x" + img.naturalHeight); img.onerror = () => done("error"); img.src = c.toDataURL("image/png"); } catch (e) { done("threw " + e.name); }`)}`);
await asked("navigator.storage.persist exists", `() => typeof navigator.storage?.persist`);
await asked("Cache Storage keeps a response (the photo reader's own cache)", `async () => { try { const c = await caches.open("probe-cache"); await c.put(new Request("/probe-item"), new Response("x")); const r = await c.match("/probe-item"); return r ? "yes" : "no"; } catch (e) { return "threw " + e.name + ": " + e.message; } }`);
await asked("the stronger photo reader (PaddleOCR on ONNX Runtime) runs", `async () => { try {
  const { readBoxes } = await import(location.origin + "/app/paddle.js");
  const c = document.createElement("canvas"); c.width = 600; c.height = 160; const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, 600, 160); x.fillStyle = "#000"; x.font = "bold 48px sans-serif"; x.fillText("TOTAL 150.00", 30, 100);
  const blob = await new Promise((ok) => c.toBlob(ok, "image/png"));
  const boxes = await Promise.race([readBoxes(blob), new Promise((_, no) => setTimeout(() => no(new Error("no answer in 120 s")), 120000))]);
  return "yes, read: " + boxes.map((b) => b.text).join(" / ");
} catch (e) { return "no: " + (e && e.message ? e.message : String(e)).slice(0, 200); } }`);
await browser.close();

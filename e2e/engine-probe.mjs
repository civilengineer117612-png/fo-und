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
// The SAME picture bytes (an invented payslip drawn once, in Chromium, and kept as e2e/fixtures/sample-payslip-photo.png) read by the stronger reader in this engine.
// Chromium reads every line exactly; if this engine reads them differently from the same bytes, the difference is in how this engine prepares the picture or runs the reader, not in how the test page was drawn.
await asked("the invented payslip picture (fixed bytes) read by the stronger reader", `async () => { try {
  const bytes = await (await fetch(location.origin + "/e2e/fixtures/sample-payslip-photo.png")).blob();
  const { readBoxes } = await import(location.origin + "/app/paddle.js");
  const boxes = await Promise.race([readBoxes(bytes), new Promise((_, no) => setTimeout(() => no(new Error("no answer in 150 s")), 150000))]);
  return boxes.length + " lines: " + boxes.map((b) => b.text).join(" / ");
} catch (e) { return "no: " + (e && e.message ? e.message : String(e)).slice(0, 200); } }`);
// WHERE do the two engines part ways on the same bytes? Checksums of the pixels at each step the app's reader takes: decoding, the resize the finder gets, and one straightened strip.
await asked("reader path pixel checksums (decode | finder resize | strip of the 'Pay date' line)", `async () => { try {
  const blob = await (await fetch(location.origin + "/e2e/fixtures/sample-payslip-photo.png")).blob();
  const sum = (d) => { let a = 0, b = 0; for (let i = 0; i < d.length; i += 4) { a += d[i] + d[i + 1] + d[i + 2]; b = (b * 31 + d[i]) % 1000003; } return a + "/" + b; };
  const bmp = await createImageBitmap(blob), c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height; c.getContext("2d").drawImage(bmp, 0, 0);
  const decode = c.width + "x" + c.height + ":" + sum(c.getContext("2d").getImageData(0, 0, c.width, c.height).data);
  const w = Math.round(c.width / 32) * 32, h = Math.round(c.height / 32) * 32, r = document.createElement("canvas"); r.width = w; r.height = h; const rx = r.getContext("2d"); rx.drawImage(c, 0, 0, w, h);
  const resize = w + "x" + h + ":" + sum(rx.getImageData(0, 0, w, h).data);
  const tw = 700, strip = document.createElement("canvas"); strip.width = tw; strip.height = 48; const sx = strip.getContext("2d"); sx.imageSmoothingQuality = "high"; sx.fillStyle = "#fff"; sx.fillRect(0, 0, tw, 48);
  const k = 0.7; sx.setTransform(k, 0, 0, k, -30 * k, -(300) * k); sx.drawImage(c, 0, 0);
  return decode + " | " + resize + " | " + tw + "x48:" + sum(sx.getImageData(0, 0, tw, 48).data);
} catch (e) { return "no: " + String(e && e.message).slice(0, 150); } }`);
await browser.close();

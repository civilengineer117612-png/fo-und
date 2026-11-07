import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resizeRGB, warpStrip } from "../src/model/resample.js";

// The photo reader's resampling is plain arithmetic (owner's WebKit finding, Nov 7): the same input gives the same numbers in every engine. Invented pixels only.
const img = (w, h, f) => { const data = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = f(x, y); data.set([r, g, b, 255], (y * w + x) * 4); } return { width: w, height: h, data }; };
const at = (o, x, y) => [...o.data.slice((y * o.width + x) * 3, (y * o.width + x) * 3 + 3)];
const near = (a, b, eps = 1e-4) => a.every((v, i) => Math.abs(v - b[i]) < eps);

test("the same size is the same picture", () => {
  const p = img(5, 4, (x, y) => [x * 40, y * 50, (x + y) * 10]), r = resizeRGB(p, 5, 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) assert.ok(near(at(r, x, y), [x * 40, y * 50, (x + y) * 10]));
});
test("shrinking is an exact area average", () => {
  const p = img(4, 4, (x, y) => [x < 2 ? 0 : 200, y < 2 ? 100 : 0, 40]), r = resizeRGB(p, 2, 2);
  assert.ok(near(at(r, 0, 0), [0, 100, 40])); assert.ok(near(at(r, 1, 0), [200, 100, 40])); assert.ok(near(at(r, 1, 1), [200, 0, 40]));
  const odd = resizeRGB(img(3, 1, (x) => [x === 1 ? 300 : 0, 0, 0]), 2, 1);   // 3 pixels into 2: each covers one and a half pixels
  assert.ok(near(at(odd, 0, 0), [85, 0, 0]) && near(at(odd, 1, 0), [85, 0, 0]), "3 into 2: each takes one and a half pixels: (0 + half of 255) / 1.5 = 85" + at(odd, 0, 0));
  const flat = resizeRGB(img(7, 5, () => [90, 120, 30]), 3, 2); for (const [x, y] of [[0, 0], [2, 1], [1, 1]]) assert.ok(near(at(flat, x, y), [90, 120, 30]), "a flat picture stays flat");
});
test("growing is linear between pixel centres and keeps the edges", () => {
  const r = resizeRGB(img(2, 1, (x) => [x === 0 ? 0 : 100, 0, 0]), 4, 1);
  assert.ok(near(at(r, 0, 0), [0, 0, 0])); assert.ok(near(at(r, 1, 0), [25, 0, 0])); assert.ok(near(at(r, 2, 0), [75, 0, 0])); assert.ok(near(at(r, 3, 0), [100, 0, 0]));
});
test("a slight stretch (1500 to 1504, as the finder does) is linear: a step keeps its order and nothing overshoots", () => {
  const p = img(10, 1, (x) => [x < 5 ? 0 : 255, 0, 0]), r = resizeRGB(p, 11, 1), vals = Array.from({ length: 11 }, (_, x) => at(r, x, 0)[0]);
  assert.ok(vals.every((v, i) => i === 0 || v >= vals[i - 1] - 1e-6) && vals[0] === 0 && vals[10] === 255 && vals.every((v) => v >= 0 && v <= 255));
});
test("a strip: an identity map gives the picture back, outside is white, a half pixel shift averages two neighbours", () => {
  const p = img(4, 3, (x, y) => [x * 60, y * 80, 10]);
  const same = warpStrip(p, [1, 0, 0, 1, 0, 0], 4, 3, 1); for (const [x, y] of [[0, 0], [3, 2], [2, 1]]) assert.ok(near(at(same, x, y), [x * 60, y * 80, 10]));
  const shifted = warpStrip(p, [1, 0, 0, 1, 2, 0], 6, 3, 1);   // the picture moved two pixels right: the two left pixels are outside
  assert.ok(near(at(shifted, 0, 1), [255, 255, 255]) && near(at(shifted, 1, 1), [255, 255, 255]) && near(at(shifted, 2, 1), [0, 80, 10]) && near(at(shifted, 5, 1), [180, 80, 10]));
  const half = warpStrip(p, [1, 0, 0, 1, 0.5, 0], 4, 1, 1);   // 0.5 right: strip pixel 1 sits between picture pixels 0 and 1
  assert.ok(near(at(half, 1, 0), [30, 0, 10]), "half way between 0 and 60: " + at(half, 1, 0));
});
test("a strip can be turned and shrunk: a quarter turn puts the top row on the right, and halving keeps the average", () => {
  const p = img(3, 3, (x, y) => [x === 0 ? 255 : 0, y === 0 ? 255 : 0, 0]);
  const turned = warpStrip(p, [0, 1, -1, 0, 3, 0], 3, 3, 1);   // x' = -y + 3, y' = x: the top row (y = 0) goes to the right column
  assert.ok(near(at(turned, 2, 0), [255, 255, 0]) && near(at(turned, 2, 2), [0, 255, 0]) && near(at(turned, 0, 0), [255, 0, 0]));
  const flat = img(8, 8, () => [100, 50, 20]), small = warpStrip(flat, [0.25, 0, 0, 0.25, 0, 0], 2, 2, 3);
  assert.ok(near(at(small, 0, 0), [100, 50, 20]) && near(at(small, 1, 1), [100, 50, 20]));
});
test("same input, same numbers, every time (no engine in the loop)", () => {
  const p = img(9, 7, (x, y) => [(x * 29 + y * 7) % 256, (x * 13) % 256, (y * 41) % 256]);
  assert.deepEqual([...resizeRGB(p, 5, 3).data], [...resizeRGB(p, 5, 3).data]);
  assert.deepEqual([...warpStrip(p, [0.7, 0.2, -0.2, 0.7, 3, 1], 12, 6, 2).data], [...warpStrip(p, [0.7, 0.2, -0.2, 0.7, 3, 1], 12, 6, 2).data]);
});
test("the reader uses these and never lets the canvas resample", () => {
  const src = readFileSync(new URL("../app/paddle.js", import.meta.url), "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.match(src, /resizeRGB\(/); assert.match(src, /warpStrip\(/);
  assert.doesNotMatch(src, /drawImage\([^)]*,\s*0,\s*0,\s*\w+,\s*\w+\)|setTransform\(|imageSmoothingQuality/, "no canvas scaling or transform in the reader (it differs between engines)");
});

// Picture resampling done in OUR code, not by the browser's canvas (owner's WebKit finding, Nov 7: Safari's engine and Chromium resample the same picture
// differently, so the photo reader saw different pixels in each and read lines like "Pay date" worse on the iPhone). The probe on identical picture bytes showed the
// decoded pixels equal and the resize and the straightened strip different. Here every step is plain arithmetic, so every engine gives the same numbers.
// Pictures are {width, height, data} with data as RGBA bytes (what getImageData gives). Results are {width, height, data} with data as RGB floats 0 to 255.

// For one axis: each destination index gets the source indexes and weights it is made of. Shrinking is an AREA AVERAGE (each destination pixel covers a stretch of
// the source and takes the overlap of every source pixel it touches); growing or keeping the size is LINEAR between the two nearest pixel centres.
function axis(srcLen, dstLen) {
  const out = [], r = srcLen / dstLen;
  for (let i = 0; i < dstLen; i++) {
    if (r > 1) {
      const a = i * r, b = (i + 1) * r, idx = [], w = [];
      for (let s = Math.floor(a); s <= Math.min(srcLen - 1, Math.ceil(b) - 1); s++) { const ov = Math.min(b, s + 1) - Math.max(a, s); if (ov > 1e-9) { idx.push(s); w.push(ov); } }
      const sum = w.reduce((x, y) => x + y, 0);
      out.push({ idx, w: w.map((x) => x / sum) });
    } else {
      const c = (i + 0.5) * r - 0.5, s0 = Math.floor(c), f = c - s0, i0 = Math.min(Math.max(s0, 0), srcLen - 1), i1 = Math.min(Math.max(s0 + 1, 0), srcLen - 1);
      out.push(f === 0 || i0 === i1 ? { idx: [i0], w: [1] } : { idx: [i0, i1], w: [1 - f, f] });
    }
  }
  return out;
}

// The picture at another size (both sides at once, horizontal then vertical).
export function resizeRGB(img, dw, dh) {
  const { width: sw, height: sh, data } = img, ax = axis(sw, dw), ay = axis(sh, dh);
  const tmp = new Float32Array(sh * dw * 3);
  for (let y = 0; y < sh; y++) for (let x = 0; x < dw; x++) {
    const { idx, w } = ax[x]; let r = 0, g = 0, b = 0;
    for (let k = 0; k < idx.length; k++) { const p = (y * sw + idx[k]) * 4; r += data[p] * w[k]; g += data[p + 1] * w[k]; b += data[p + 2] * w[k]; }
    const o = (y * dw + x) * 3; tmp[o] = r; tmp[o + 1] = g; tmp[o + 2] = b;
  }
  const out = new Float32Array(dh * dw * 3);
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const { idx, w } = ay[y]; let r = 0, g = 0, b = 0;
    for (let k = 0; k < idx.length; k++) { const p = (idx[k] * dw + x) * 3; r += tmp[p] * w[k]; g += tmp[p + 1] * w[k]; b += tmp[p + 2] * w[k]; }
    const o = (y * dw + x) * 3; out[o] = r; out[o + 1] = g; out[o + 2] = b;
  }
  return { width: dw, height: dh, data: out };
}

// A straightened strip of tw by th pixels. m = [a, b, c, d, e, f] takes a point of the picture to the strip like the canvas call setTransform(a, b, c, d, e, f):
// X = a x + c y + e, Y = b x + d y + f (points in pixels, a pixel i covers i to i + 1). Each strip pixel is the average of ss by ss bilinear samples inside it; anything
// outside the picture is white.
export function warpStrip(img, m, tw, th, ss = 2) {
  const [a, b, c, d, e, f] = m, det = a * d - b * c, { width: sw, height: sh, data } = img, out = new Float32Array(tw * th * 3);
  const px = (x, y, ch) => (x < 0 || y < 0 || x >= sw || y >= sh ? 255 : data[(y * sw + x) * 4 + ch]);
  for (let oy = 0; oy < th; oy++) for (let ox = 0; ox < tw; ox++) {
    let r = 0, g = 0, bl = 0;
    for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) {
      const X = ox + (i + 0.5) / ss, Y = oy + (j + 0.5) / ss;
      const sx = (d * (X - e) - c * (Y - f)) / det - 0.5, sy = (-b * (X - e) + a * (Y - f)) / det - 0.5;
      const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
      for (let ch = 0; ch < 3; ch++) {
        const v = (px(x0, y0, ch) * (1 - fx) + px(x0 + 1, y0, ch) * fx) * (1 - fy) + (px(x0, y0 + 1, ch) * (1 - fx) + px(x0 + 1, y0 + 1, ch) * fx) * fy;
        if (ch === 0) r += v; else if (ch === 1) g += v; else bl += v;
      }
    }
    const o = (oy * tw + ox) * 3, n = ss * ss; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = bl / n;
  }
  return { width: tw, height: th, data: out };
}

// Generate icons/ — the rainbow ball rolling at three sparkly pins on a
// night-violet ground, with a rainbow trail behind it.
// Run: node tools/make-icons.js  (from the rainbow-bowling folder)
const fs = require("fs");
const path = require("path");
const { makeCanvas, downsample, encodePNG } = require("../lib/tools/png.js");

const OUT = path.join(__dirname, "..", "icons");
fs.mkdirSync(OUT, { recursive: true });
const RAINBOW = ["#ff3b5c", "#ff8a1f", "#ffd21f", "#3bd16f", "#2fa8ff", "#7b5cff", "#d94dff"];

function paint(size, pad) {
  const SS = 4, big = size * SS;
  const cv = makeCanvas(big);
  const u = big / 100, s = pad ? 0.72 : 1;
  const at = (v) => 50 * u + (v - 50) * u * s;
  const sz = (v) => v * u * s;

  // night-violet ground with a soft glow
  cv.fillRect(0, 0, big, big, "#1b0b45");
  for (let r = 70; r > 0; r -= 6) cv.fillCircle(50 * u, 38 * u, r * u, "#3a1490", 0.08);
  // pins: a little row of three at the back
  const pin = (x, y, k) => {
    cv.fillEllipse(at(x), at(y + 13), sz(4.6 * k), sz(1.4 * k), "#0f0630", 0.5);
    cv.fillEllipse(at(x), at(y + 6), sz(4.2 * k), sz(7 * k), "#fbf7ff");
    cv.fillEllipse(at(x), at(y - 4), sz(2.0 * k), sz(3.4 * k), "#fbf7ff");
    cv.fillRect(at(x - 2.1 * k), at(y - 1.2), sz(4.2 * k), sz(1.2 * k), "#ff3b8a");
    cv.fillRect(at(x - 2.1 * k), at(y + 0.6), sz(4.2 * k), sz(1.0 * k), "#2fa8ff");
    cv.fillCircle(at(x - 1.4 * k), at(y + 4), sz(0.9 * k), "#ffffff");
  };
  pin(36, 20, 1); pin(64, 20, 1); pin(50, 16, 1.08);
  // rainbow trail sweeping in from the bottom left
  for (let i = 0; i < 7; i++) {
    for (let k = 0; k < 26; k++) {
      const t = k / 26, x = 6 + t * 36 + i * 0.2, y = 96 - t * 30 + i * 2.1;
      cv.fillCircle(at(x), at(y), sz(1.5), RAINBOW[i], 0.25 + t * 0.7);
    }
  }
  // the rainbow ball
  const bx = 56, by = 62, br = 20;
  cv.fillEllipse(at(bx + 2), at(by + br - 1), sz(br * 0.95), sz(br * 0.25), "#0f0630", 0.6);
  for (let i = 0; i < 7; i++) {
    const y0 = by - br + (i / 7) * 2 * br, y1 = y0 + (2 * br) / 7;
    for (let y = y0; y < y1; y += 0.25) {
      const dy = y - by, half = Math.sqrt(Math.max(0, br * br - dy * dy));
      cv.fillRect(at(bx - half), at(y), sz(2 * half), sz(0.3), RAINBOW[i]);
    }
  }
  cv.fillCircle(at(bx - 7), at(by - 8), sz(6), "#ffffff", 0.45);
  cv.fillCircle(at(bx - 8), at(by - 9), sz(2.6), "#ffffff", 0.85);
  for (const [dx, dy] of [[-4, -3], [4, -3], [0, 4]]) cv.fillCircle(at(bx + dx), at(by + dy), sz(2.1), "#1b0b45", 0.75);
  // twinkles
  for (const [x, y, r] of [[22, 22, 2.4], [80, 30, 2], [84, 78, 1.6], [18, 50, 1.4]]) {
    cv.fillRect(at(x - r), at(y - r * 0.18), sz(2 * r), sz(r * 0.36), "#fff6c2");
    cv.fillRect(at(x - r * 0.18), at(y - r), sz(r * 0.36), sz(2 * r), "#fff6c2");
  }
  return encodePNG(size, size, downsample(cv.px, big, SS));
}

fs.writeFileSync(path.join(OUT, "icon-192.png"), paint(192, false));
fs.writeFileSync(path.join(OUT, "icon-512.png"), paint(512, false));
fs.writeFileSync(path.join(OUT, "maskable-512.png"), paint(512, true));
console.log("icons written to", OUT);

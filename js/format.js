// Plot helpers: note names, colours, frequency-axis helpers. Port of R/plot_helpers.R.

import { quantile, roundHalfEven } from "./stats.js";

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const mod = (a, n) => ((a % n) + n) % n;

// Nearest equal-tempered note (A4 = 440 Hz) and deviation in cents
export function noteName(f) {
  const m = 69 + 12 * Math.log2(f / 440), n = roundHalfEven(m);
  const c = Math.round(100 * (m - n)) + 0;
  return `${NAMES[mod(n, 12)]}${Math.floor(n / 12) - 1} ${c >= 0 ? "+" : "−"}${Math.abs(c)}¢`;
}
export function noteShort(f) {
  const n = roundHalfEven(69 + 12 * Math.log2(f / 440));
  return `${NAMES[mod(n, 12)]}${Math.floor(n / 12) - 1}`;
}
export const noteNum = (f) => roundHalfEven(69 + 12 * Math.log2(f / 440));

// Colour of difference (B - A) curves
export const DIFF_COL = "#377EB8";

// ColorBrewer Set1, as in the R app (its yellow darkened so it stays visible on white),
// then ggplot's default hue palette for more than nine series
const SET1 = ["#E41A1C", "#377EB8", "#4DAF4A", "#984EA3", "#FF7F00", "#D4B300", "#A65628", "#F781BF", "#999999"];
function hcl2hex(h, c, l) {
  const hr = h * Math.PI / 180, U = c * Math.cos(hr), V = c * Math.sin(hr);
  const Xn = 95.047, Yn = 100, Zn = 108.883;
  const Y = l > 8 ? Yn * Math.pow((l + 16) / 116, 3) : Yn * l / 903.3;
  const den = Xn + 15 * Yn + 3 * Zn, un = 4 * Xn / den, vn = 9 * Yn / den;
  const u = U / (13 * l) + un, v = V / (13 * l) + vn;
  const X = 9 * Y * u / (4 * v), Z = -X / 3 - 5 * Y + 3 * Y / v;
  const lin = [3.240479 * X - 1.537150 * Y - 0.498535 * Z, -0.969256 * X + 1.875992 * Y + 0.041556 * Z,
    0.055648 * X - 0.204043 * Y + 1.057311 * Z].map((t) => t / 100);
  return "#" + lin.map((t) => {
    const g = t > 0.00304 ? 1.055 * Math.pow(t, 1 / 2.4) - 0.055 : 12.92 * t;
    return Math.round(255 * Math.min(1, Math.max(0, g))).toString(16).padStart(2, "0");
  }).join("").toUpperCase();
}
export function seriesCols(n) {
  if (n <= 9) return SET1.slice(0, n);
  return Array.from({ length: n }, (_, i) => hcl2hex(15 + i * 360 / n, 100, 65));
}
export function rgba(hex, a) {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}

// Automatic lower y-limit: just below the lowest level, ignoring the deepest 1%
export function autoFloor(y) {
  const v = y.filter(Number.isFinite);
  return 5 * Math.floor((quantile(v, 0.01) - 2) / 5);
}

export const xMid = (a, b, lin) => (lin ? (a + b) / 2 : Math.sqrt(a * b));

// R's pretty(): about n+1 equally spaced round values covering [lo, hi]
export function pretty(lo, hi, n = 5) {
  const minN = Math.floor(n / 3), h = 1.5, h5 = 0.5 + 1.5 * h, eps = 1e-10;
  const dx = hi - lo;
  let cell, small;
  if (dx === 0 && hi === 0) { cell = 1; small = true; } else {
    cell = Math.max(Math.abs(lo), Math.abs(hi));
    const U = (1 + (h5 >= 1.5 * h + 0.5 ? 1 / (1 + h) : 1.5 / (1 + h5))) * Math.max(1, n) * Number.EPSILON;
    small = dx < cell * U * 3;
  }
  if (small) { if (cell > 10) cell = 9 + cell / 10; cell *= 0.75; if (minN > 1) cell /= minN; } else { cell = dx; if (n > 1) cell /= n; }
  const base = Math.pow(10, Math.floor(Math.log10(cell)));
  let unit = base;
  if (2 * base - cell < h * (cell - unit)) {
    unit = 2 * base;
    if (5 * base - cell < h5 * (cell - unit)) { unit = 5 * base; if (10 * base - cell < h * (cell - unit)) unit = 10 * base; }
  }
  let ns = Math.floor(lo / unit + eps), nu = Math.ceil(hi / unit - eps);
  while (ns * unit > lo + eps * unit) ns--;
  while (nu * unit < hi - eps * unit) nu++;
  let k = Math.floor(0.5 + nu - ns);
  if (k < minN) {
    k = minN - k;
    if (ns >= 0) { nu += Math.floor(k / 2); ns -= Math.floor(k / 2) + (k % 2); } else { ns -= Math.floor(k / 2); nu += Math.floor(k / 2) + (k % 2); }
  }
  const out = [];
  for (let i = ns; i <= nu; i++) out.push(+(i * unit).toPrecision(12));
  return out;
}

const fmtNum = (v) => String(+v.toPrecision(6));
// Plain Hz breaks for a zoomed log axis or any linear axis
export function plainBreaks(xr, n = 7) {
  const b = pretty(xr[0], xr[1], n).filter((v) => v >= xr[0] && v <= xr[1]);
  return { breaks: b, labels: b.map((v) => (v >= 1000 ? `${+(v / 1000).toPrecision(3)}k` : fmtNum(v))) };
}

// Which labels to draw: drop those outside the range, and on each row keep a label only
// if it lies at least minFrac of the axis width from the previous kept one
export function thinLabels(x, row, xr, lin, minFrac = 0.05) {
  const pos = x.map((v) => (lin ? (v - xr[0]) / (xr[1] - xr[0]) : Math.log(v / xr[0]) / Math.log(xr[1] / xr[0])));
  const keep = x.map(() => false);
  for (const r of [...new Set(row)]) {
    const idx = x.map((_, i) => i).filter((i) => row[i] === r && pos[i] >= 0 && pos[i] <= 1).sort((a, b) => pos[a] - pos[b]);
    let last = -Infinity;
    for (const j of idx) if (pos[j] - last >= minFrac) { keep[j] = true; last = pos[j]; }
  }
  return keep;
}

// Seconds a notification stays open: about 12 characters per second, at least `min`
export const readSecs = (text, min = 8) => Math.max(min, Math.ceil(String(text).replace(/<[^>]+>/g, "").length / 12));

// Neutralise spreadsheet formula injection in CSV text fields
export function safeCsvText(x) {
  const s = String(x);
  return /^\s*[=+@-]/.test(s) ? "'" + s : s;
}

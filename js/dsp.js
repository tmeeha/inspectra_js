// Signal processing: FFT sizes, Welch and tap spectra, double hits, mode damping, the
// undamped-string check, band powers, smoothing and group summaries. Port of R/dsp.R.
// Sample indices are 0-based throughout.

import { addPowerSpectrum } from "./fft.js";
import { B12, DW_LABELS } from "./config.js";
import { median, roundHalfEven, upperBound, lowerBound } from "./stats.js";

// FFT length with only small prime factors, nearest to n
function isSmooth(n) {
  for (const p of [2, 3, 5, 7]) while (n % p === 0) n /= p;
  return n === 1;
}
export function nearestSmooth(n) {
  n = Math.max(16, roundHalfEven(n));
  for (let d = 0; d <= n; d++) {
    if (isSmooth(n - d)) return n - d;
    if (isSmooth(n + d)) return n + d;
  }
  return n;
}

const hannCache = new Map();
export function hannPeriodic(n) {
  let w = hannCache.get(n);
  if (!w) {
    w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / n));
    hannCache.set(n, w);
  }
  return w;
}

// Scale an accumulated |FFT|^2 sum into single-sided power per bin (sum of the bins =
// mean-square signal value): average over frames, divide by n * sum(win^2), double
// all bins except DC and (for even n) Nyquist.
function scalePower(acc, nFrames, nfft, win) {
  let sw = 0;
  for (let i = 0; i < nfft; i++) sw += win[i] * win[i];
  const nb = acc.length, P = new Float64Array(nb);
  for (let k = 0; k < nb; k++) {
    P[k] = acc[k] / nFrames / (nfft * sw);
    if (k !== 0 && !(nfft % 2 === 0 && k === nb - 1)) P[k] *= 2;
  }
  return P;
}

// Welch-averaged power spectrum, periodic Hann window, 50% overlap. Optional gating
// discards frames whose RMS is far below the loudest frame. Optional `bad` (Uint8Array,
// one flag per sample): frames with more than 5% bad samples are dropped.
// Returns { pow, excluded } or null.
export function framePower(x, nfft, gateOn = false, gateDb = -40, bad = null) {
  const hop = Math.floor(nfft / 2);
  const nch = Math.floor((x.length - nfft) / hop) + 1;
  if (!(nch >= 1)) return null;
  const starts = new Array(nch), rms = new Float64Array(nch);
  let best = 0;
  for (let c = 0; c < nch; c++) {
    const s = c * hop; starts[c] = s;
    let a = 0;
    for (let i = s; i < s + nfft; i++) a += x[i] * x[i];
    rms[c] = Math.sqrt(a / nfft);
    if (rms[c] > rms[best]) best = c;
  }
  const thr = rms[best] * Math.pow(10, gateDb / 20);
  let keep = Array.from(rms, (r) => (gateOn ? r >= thr : true));
  keep[best] = true;
  let excluded = 0;
  if (bad) {
    const cs = new Float64Array(x.length + 1);
    for (let i = 0; i < x.length; i++) cs[i + 1] = cs[i] + bad[i];
    const okPitch = starts.map((s) => (cs[s + nfft] - cs[s]) / nfft <= 0.05);
    const nKeep = keep.filter(Boolean).length;
    excluded = keep.filter((k, c) => k && !okPitch[c]).length / Math.max(1, nKeep);
    keep = keep.map((k, c) => k && okPitch[c]);
    if (!keep.some(Boolean)) return null;
  }
  const win = hannPeriodic(nfft);
  const nb = Math.floor(nfft / 2) + 1;
  const acc = new Float64Array(nb), frame = new Float64Array(nfft);
  let used = 0;
  for (let c = 0; c < nch; c++) {
    if (!keep[c]) continue;
    const s = starts[c];
    for (let i = 0; i < nfft; i++) frame[i] = x[s + i] * win[i];
    addPowerSpectrum(frame, acc);
    used++;
  }
  return { pow: scalePower(acc, used, nfft, win), excluded };
}

// Second-impact detector for one tap frame (seg = the frame's samples, pre = samples
// before the onset). A second hit shows as a sudden re-rise: the 2 ms RMS envelope
// jumps by >= riseDb above its minimum over the previous 10 ms, to within |nearDb| of
// the tap's peak, at least 10 ms after the onset.
export function doubleHit(seg, fs, pre, riseDb = 12, nearDb = -10) {
  const b = Math.max(1, roundHalfEven(0.002 * fs)), n = Math.floor(seg.length / b);
  const env = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let a = 0;
    for (let i = k * b; i < (k + 1) * b; i++) a += seg[i] * seg[i];
    env[k] = 10 * Math.log10(a / b + 1e-30);
  }
  const m = Math.min(n, Math.ceil((pre + 0.03 * fs) / b));
  let top = -Infinity;
  for (let k = 0; k < m; k++) if (env[k] > top) top = env[k];
  for (let k = 0; k < n; k++) env[k] -= top;
  const start = Math.ceil((pre + 0.010 * fs) / b) + 1;   // 1-based, as in R
  if (start > n) return false;
  for (let k = start; k <= n; k++) {
    let lo = Infinity;
    for (let j = Math.max(1, k - 5); j <= k - 1; j++) if (env[j - 1] < lo) lo = env[j - 1];
    if (env[k - 1] >= nearDb && env[k - 1] - lo >= riseDb) return true;
  }
  return false;
}

// Averaged power spectrum of impact (tap) recordings. Each tap is detected by a
// threshold relative to the strongest tap, and one frame is taken starting 2 ms before
// it, multiplied by an exponential window that falls to endDb at the frame end
// (0 dB = rectangular). Frames past the file ends and double hits are skipped; clipped
// taps are skipped when skipClipped, unless every usable tap is clipped.
export function impactPower(x, nfft, fs, endDb = -40, trigDb = -20, clipIdx = new Int32Array(0), skipClipped = true) {
  let pk = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > pk) pk = a; }
  if (!Number.isFinite(pk) || pk <= 0 || x.length < nfft) return null;
  const thr = pk * Math.pow(10, trigDb / 20);
  const above = [];
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) >= thr) above.push(i);
  const onsets = [];
  let i = above[0];
  while (i !== undefined) {
    onsets.push(i);
    i = above[upperBound(above, i + nfft - 1)];       // first threshold crossing after this frame
  }
  const pre = roundHalfEven(0.002 * fs);
  const starts = onsets.map((o) => o - pre);
  const inFile = starts.map((s) => s >= 0 && s + nfft <= x.length);
  const dbl = starts.map((s, j) => inFile[j] && doubleHit(x.subarray(s, s + nfft), fs, pre));
  const clipped = starts.map((s) => {
    const j = lowerBound(clipIdx, s);
    return j < clipIdx.length && clipIdx[j] <= s + nfft - 1;
  });
  const good = starts.map((_, j) => inFile[j] && !dbl[j]);
  let useOk = good.map((g, j) => g && !(skipClipped && clipped[j]));
  const fallback = skipClipped && !useOk.some(Boolean) && good.some(Boolean);
  if (fallback) useOk = good.slice();
  const count = (f) => starts.reduce((a, _, j) => a + (f(j) ? 1 : 0), 0);
  const info = { total: onsets.length, edge: count((j) => !inFile[j]), double: count((j) => inFile[j] && dbl[j]),
    clipped_good: count((j) => good[j] && clipped[j]), fallback };
  const use = starts.filter((_, j) => useOk[j]);
  if (use.length === 0) return { pow: null, kept: 0, ...info };

  const win = new Float64Array(nfft);
  for (let k = 0; k < nfft; k++) win[k] = Math.pow(10, (endDb / 20) * k / (nfft - 1));
  const nb = Math.floor(nfft / 2) + 1;
  const acc = new Float64Array(nb), frame = new Float64Array(nfft);
  for (const s of use) {
    for (let k = 0; k < nfft; k++) frame[k] = x[s + k] * win[k];
    addPowerSpectrum(frame, acc);
  }
  return { pow: scalePower(acc, use.length, nfft, win), kept: use.length, ...info };
}

// Damping of one mode from an averaged tap power spectrum (f, P, bin width df), by the
// half-power (-3 dB) bandwidth of the highest peak between lo and hi, corrected for the
// broadening of the exponential window. Returns {f0, bw, Q, zeta, note}.
export function modeDamping(f, P, df, lo, hi, endDb) {
  const na = (why) => ({ f0: NaN, bw: NaN, Q: NaN, zeta: NaN, note: why });
  const idx = [];
  for (let j = 0; j < f.length; j++) if (f[j] >= lo && f[j] <= hi) idx.push(j);
  if (idx.length < 3) return na("range too narrow");
  const db = (j) => 10 * Math.log10(P[j] + 1e-30);
  let k = idx[0];
  for (const j of idx) if (db(j) > db(k)) k = j;
  if (k === idx[0] || k === idx[idx.length - 1]) return na("no peak in range");
  const a = db(k - 1), b = db(k), c = db(k + 1);
  const p = 0.5 * (a - c) / (a - 2 * b + c);           // parabolic peak refinement
  const f0 = f[k] + p * df, top = b - 0.25 * (a - c) * p, thr = top - 3;
  let j = k;
  while (db(j) >= thr) { j--; if (j < 0 || f0 - f[j] > 0.2 * f0) return na("not resolved"); }
  const fl = f[j] + (thr - db(j)) / (db(j + 1) - db(j)) * df;
  j = k;
  while (db(j) >= thr) { j++; if (j >= P.length || f[j] - f0 > 0.2 * f0) return na("not resolved"); }
  const fh = f[j - 1] + (db(j - 1) - thr) / (db(j - 1) - db(j)) * df;
  const bw = (fh - fl) - (endDb < 0 ? -Math.log(Math.pow(10, endDb / 20)) * df / Math.PI : 0);
  if (bw < 0.5 * df) return na("narrower than resolution");
  return { f0, bw, Q: f0 / bw, zeta: bw / (2 * f0), note: "" };
}

// Undamped-string check for tap recordings: the tap spectrum is recomputed with a
// rectangular window and each open string (+/-80 cents) is checked for a peak with
// Q above qMin standing at least 6 dB above its surroundings (+/-1/6 octave).
export const OPEN_STRINGS = { G: 196.00, D: 293.66, A: 440.00, E: 659.26 };
export function ringingStrings(x, nfft, fs, trigDb, clipIdx, skipClipped, qMin = 100) {
  const fp = impactPower(x, nfft, fs, 0, trigDb, clipIdx, skipClipped);
  if (!fp || !fp.pow) return [];
  const df = fs / nfft, n = fp.pow.length;
  const f = Float64Array.from({ length: n }, (_, k) => k * df);
  const db = Float64Array.from(fp.pow, (p) => 10 * Math.log10(p + 1e-30));
  const found = [];
  for (const [s, fS] of Object.entries(OPEN_STRINGS)) {
    const lo = fS * Math.pow(2, -80 / 1200), hi = fS * Math.pow(2, 80 / 1200);
    for (let k = 1; k < n - 1; k++) {
      if (f[k] < lo || f[k] > hi) continue;
      if (!(db[k] > db[k - 1] && db[k] >= db[k + 1])) continue;
      const a = f[k] * Math.pow(2, -1 / 6), b = f[k] * Math.pow(2, 1 / 6);
      const around = [];
      for (let j = 0; j < n; j++) if (f[j] >= a && f[j] <= b) around.push(db[j]);
      if (db[k] - median(around) < 6) continue;
      const d = modeDamping(f, fp.pow, df, f[k] - 1.5 * df, f[k] + 1.5 * df, 0);
      const sharp = d.note === "narrower than resolution" || (Number.isFinite(d.Q) && d.Q >= qMin);
      if (sharp) { found.push(`${s} (${(Number.isFinite(d.f0) ? d.f0 : f[k]).toFixed(0)} Hz)`); break; }
    }
  }
  return found;
}

// Power in arbitrary bands from FFT bins, allocating each bin's power in proportion to
// how much of the bin's width overlaps the band. f = k * df.
export function bandPower(P, df, lo, hi) {
  return lo.map((l, j) => {
    const h = hi[j];
    const k0 = Math.max(0, Math.floor(l / df) - 1), k1 = Math.min(P.length - 1, Math.ceil(h / df) + 1);
    let s = 0;
    for (let k = k0; k <= k1; k++) {
      const f = k * df;
      const ov = Math.min(f + df / 2, h) - Math.max(f - df / 2, l);
      if (ov > 0) s += P[k] * ov;
    }
    return s / df;
  });
}

// Dünnwald band levels: power in each region A-F, dB re total 188-7080 Hz power
export function bandShares(bp) {
  const tot = bp.reduce((a, b) => a + b, 0);
  return DW_LABELS.map((lab) => {
    let g = 0;
    B12.forEach((b, i) => { if (b.dw === lab) g += bp[i]; });
    return 10 * Math.log10(g / tot + 1e-30);
  });
}

// Constant-Q (fractional-octave) smoothing of a power spectrum (or density) on
// ascending frequencies f
export function smoothOctave(f, p, bandsPerOctave) {
  const r = Math.pow(2, 1 / (2 * bandsPerOctave));
  // compensated (double-double) running sum, rounded to double: R sums in extended
  // precision, which matters where tiny values are differenced against a large total
  const n = f.length, cs = new Float64Array(n + 1);
  let s = 0, e = 0;
  for (let i = 0; i < n; i++) {
    const t = s + p[i], bp = t - s;
    e += (s - (t - bp)) + (p[i] - bp);
    s = t + e; e -= s - t;
    cs[i + 1] = s;
  }
  const out = new Float64Array(n);
  let lo = 0, hi = 0;
  for (let i = 0; i < n; i++) {
    const a = f[i] / r, b = f[i] * r;
    while (lo < n && f[lo] < a) lo++;           // first index with f >= f_i / r
    while (hi < n && f[hi] <= b) hi++;          // one past the last index with f <= f_i * r
    const l = Math.min(lo, i), h = Math.max(hi - 1, i);
    out[i] = (cs[h + 1] - cs[l]) / (h - l + 1);
  }
  return out;
}

// Linear interpolation (R's approx), NaN outside the range of x
export function approx(x, y, xout) {
  const n = x.length, out = new Float64Array(xout.length);
  for (let i = 0; i < xout.length; i++) {
    const v = xout[i];
    if (!(n > 0 && v >= x[0] && v <= x[n - 1])) { out[i] = NaN; continue; }
    const j = upperBound(x, v) - 1;               // last index with x <= v
    out[i] = j >= n - 1 ? y[n - 1] : y[j] + (y[j + 1] - y[j]) * (v - x[j]) / (x[j + 1] - x[j]);
  }
  return out;
}

// Group summaries of rows of dB values, averaged in the POWER domain. Returns a Map
// group -> { mean, n, se } (in order of first appearance); the SE in dB uses the delta
// method, SE_dB = (10/ln 10) * SD(power) / (sqrt(n) * mean(power)).
export function summariseGroups(rows, grp) {
  const out = new Map();
  const levels = [...new Set(grp)];
  for (const g of levels) {
    const sel = rows.filter((_, i) => grp[i] === g);
    const n = sel.length, m = sel[0].length;
    const mean = new Float64Array(m), se = new Float64Array(m);
    for (let c = 0; c < m; c++) {
      let s = 0;
      for (const r of sel) s += Math.pow(10, r[c] / 10);
      const mu = s / n;
      mean[c] = 10 * Math.log10(mu);
      if (n > 1) {
        let v = 0;
        for (const r of sel) { const d = Math.pow(10, r[c] / 10) - mu; v += d * d; }
        se[c] = (10 / Math.LN10) * Math.sqrt(v / (n - 1)) / (Math.sqrt(n) * mu);
      } else se[c] = NaN;
    }
    out.set(g, { mean, n, se });
  }
  return out;
}

// Pitch tracking of played recordings, tuning offset, pitch range and note levels.
// Port of R/pitch.R. Frame indices `fr` are 0-based.

import { fft, nextPow2 } from "./fft.js";
import { hannPeriodic } from "./dsp.js";
import { median, quantile, roundHalfEven } from "./stats.js";

// Fundamental frequency per frame by normalized autocorrelation (Hann window, corrected
// for the window's own autocorrelation, parabolic lag refinement), in frames within
// 30 dB of the loudest. Returns the voiced frames: frame index, f0 (Hz), nearest note
// (MIDI), deviation from it (cents) and frame mean-square level; plus frame geometry.
export function pitchTrack(x, fs, hopS = 0.04, winS = 0.08, fmin = 180, fmax = 2200) {
  const N = roundHalfEven(winS * fs), H = roundHalfEven(hopS * fs);
  const out = { fr: [], f0: [], note: [], dev: [], pow: [], N, H, hop_s: hopS, n_frames: 0 };
  if (x.length < N + 10 * H) return out;
  const starts = [];
  for (let s = 0; s <= x.length - N - 1; s += H) starts.push(s);
  out.n_frames = starts.length;
  const ms = starts.map((s) => { let a = 0; for (let i = s; i < s + N; i++) a += x[i] * x[i]; return a / N; });
  const mx = ms.reduce((m, v) => Math.max(m, v), -Infinity);   // no spread: long files have many frames
  if (!Number.isFinite(mx) || mx <= 0) return out;
  const w = hannPeriodic(N);
  const L = nextPow2(2 * N);                  // zero padding >= 2N gives the linear autocorrelation
  const lo = Math.floor(fs / fmax), hi = Math.ceil(fs / fmin);
  const re = new Float64Array(L), im = new Float64Array(L);
  const autocorr = (fill) => {
    re.fill(0); im.fill(0); fill(re);
    fft(re, im);
    for (let k = 0; k < L; k++) { re[k] = re[k] * re[k] + im[k] * im[k]; im[k] = 0; }
    fft(re, im, true);
    return re.slice(0, hi + 2);               // index k = lag k
  };
  const acw = autocorr((r) => r.set(w));
  for (let fi = 0; fi < starts.length; fi++) {
    if (!(ms[fi] >= mx * Math.pow(10, -30 / 10))) continue;
    const s0 = starts[fi];
    const AC = autocorr((r) => { for (let i = 0; i < N; i++) r[i] = x[s0 + i] * w[i]; });
    if (!Number.isFinite(AC[0]) || AC[0] <= 0) continue;        // silent frame
    const ac = new Float64Array(hi + 2);
    for (let k = 0; k < hi + 2; k++) ac[k] = (AC[k] / AC[0]) / (acw[k] / acw[0]);
    // The window-corrected autocorrelation is close to 1 at every multiple of the
    // period: take the first local peak within 90% of the maximum, not the global one.
    let smax = -Infinity;
    for (let k = lo; k <= hi; k++) if (ac[k] > smax) smax = ac[k];
    let lag = -1;
    for (let k = lo + 1; k <= hi - 1; k++) {
      if (ac[k] >= ac[k - 1] && ac[k] >= ac[k + 1] && ac[k] >= 0.9 * smax) { lag = k; break; }
    }
    if (lag < 0) continue;
    if (ac[lag] < 0.8 || lag <= lo || lag >= hi) continue;
    const ca = ac[lag - 1], cb = ac[lag], cc = ac[lag + 1], den = ca - 2 * cb + cc;
    const f0 = fs / (lag + (den < 0 ? 0.5 * (ca - cc) / den : 0));
    if (!Number.isFinite(f0)) continue;
    const m = 69 + 12 * Math.log2(f0 / 440), n = roundHalfEven(m);
    out.fr.push(fi); out.f0.push(f0); out.note.push(n); out.dev.push(100 * (m - n)); out.pow.push(ms[fi]);
  }
  return out;
}

// Run id of each voiced frame: a new run starts at a gap or a change of nearest note
function runIds(tr) {
  const run = new Array(tr.fr.length);
  let r = 0;
  for (let i = 0; i < tr.fr.length; i++) {
    if (i > 0 && (tr.fr[i] - tr.fr[i - 1] !== 1 || tr.note[i] !== tr.note[i - 1])) r++;
    run[i] = r;
  }
  return run;
}
function groupBy(keys, idx) {                 // Map key -> indices, keys sorted ascending
  const m = new Map();
  idx.forEach((i) => { const k = keys[i]; if (!m.has(k)) m.set(k, []); m.get(k).push(i); });
  return new Map([...m.entries()].sort((a, b) => a[0] - b[0]));
}

// Runs of >= 6 consecutive voiced frames (0.24 s) on the same nearest note, with the
// pitch drift of each run (cents/s, linear fit).
export function pitchRuns(tr) {
  if (tr.fr.length < 6) return { runs: [], slope: [] };
  const run = runIds(tr);
  const runs = [...groupBy(run, tr.fr.map((_, i) => i)).values()].filter((i) => i.length >= 6);
  const slope = runs.map((i) => {
    const tt = i.map((j) => (tr.fr[j] - tr.fr[i[0]]) * tr.hop_s);
    const dv = i.map((j) => tr.dev[j]);
    const mt = tt.reduce((a, b) => a + b, 0) / tt.length, md = dv.reduce((a, b) => a + b, 0) / dv.length;
    let sxy = 0, sxx = 0;
    tt.forEach((t, k) => { sxy += (t - mt) * (dv[k] - md); sxx += (t - mt) * (t - mt); });
    return Math.abs(sxy / sxx);
  });
  return { runs, slope };
}

const circ = (d) => {                         // mean of exp(2 pi i d / 100)
  let re = 0, im = 0;
  for (const v of d) { re += Math.cos(2 * Math.PI * v / 100); im += Math.sin(2 * Math.PI * v / 100); }
  return { re: re / d.length, im: im / d.length };
};

// Pitch offset relative to equal temperament (A4 = 440 Hz) from held notes
export function pitchOffset(tr) {
  const na = { offset: NaN, spread: NaN, sliding: null };
  const pr = pitchRuns(tr);
  if (pr.runs.length < 3) return na;
  if (median(pr.slope) > 80) return { offset: NaN, spread: NaN, sliding: true };
  const held = pr.runs.filter((_, k) => pr.slope[k] <= 80);
  if (held.length < 3) return { offset: NaN, spread: NaN, sliding: false };
  const zAll = circ(held.flat().map((j) => tr.dev[j]));
  const zNote = circ(held.map((i) => median(i.map((j) => tr.dev[j]))));
  return {
    offset: Math.atan2(zAll.im, zAll.re) * 100 / (2 * Math.PI),
    spread: Math.sqrt(-2 * Math.log(Math.max(Math.hypot(zNote.re, zNote.im), 1e-6))) * 100 / (2 * Math.PI),
    sliding: false,
  };
}

// Pitch extent: 1st and 99th percentiles of voiced frames in runs of >= 3 frames
export function pitchExtent(tr) {
  const na = { lo: NaN, hi: NaN };
  if (tr.fr.length < 10) return na;
  const run = runIds(tr);
  const len = new Map();
  run.forEach((r) => len.set(r, (len.get(r) || 0) + 1));
  const f = tr.f0.filter((_, i) => len.get(run[i]) >= 3);
  if (f.length < 10) return na;
  return { lo: quantile(f, 0.01), hi: quantile(f, 0.99) };
}

// Note-by-note levels. Held notes: one point per note (MIDI number) with the median
// played frequency and the mean-square level of its held frames. Glissandi: one point
// per 1/24-octave pitch bin.
export function noteLevels(tr, glis = false) {
  let groups;
  if (glis) {
    if (tr.fr.length < 10) return [];
    const key = tr.f0.map((f) => roundHalfEven(24 * Math.log2(f / 440)));
    groups = groupBy(key, key.map((_, i) => i));
  } else {
    const pr = pitchRuns(tr);
    const held = pr.runs.filter((_, k) => pr.slope[k] <= 80);
    if (held.length === 0) return [];
    groups = groupBy(tr.note, held.flat());
  }
  const out = [];
  for (const [key, i] of groups) {
    if (i.length < 3) continue;
    out.push({ key, f: median(i.map((j) => tr.f0[j])),
      pow: i.reduce((a, j) => a + tr.pow[j], 0) / i.length, frames: i.length });
  }
  return out;
}

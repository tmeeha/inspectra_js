// Small numeric helpers matching R: rounding, searching, median, quantiles, SD, and the
// multipliers for error bands.

// R's round(): halves go to the even neighbour
export function roundHalfEven(x) {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

// Number of elements of ascending a that are < v (lowerBound) or <= v (upperBound)
export function lowerBound(a, v) {
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; }
  return lo;
}
export function upperBound(a, v) {
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] <= v) lo = m + 1; else hi = m; }
  return lo;
}

export const sum = (a) => { let s = 0; for (const v of a) s += v; return s; };
export const mean = (a) => sum(a) / a.length;

export function median(a) {
  const s = Array.from(a).sort((p, q) => p - q), n = s.length;
  if (n === 0) return NaN;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

// R's default (type 7) quantile
export function quantile(a, p) {
  const s = Array.from(a).sort((x, y) => x - y), n = s.length;
  const h = (n - 1) * p, lo = Math.floor(h), hi = Math.ceil(h);
  return s[lo] + (h - lo) * (s[hi] - s[lo]);
}

export function sd(a) {
  const n = a.length;
  if (n < 2) return NaN;
  const m = mean(a);
  let v = 0;
  for (const x of a) v += (x - m) * (x - m);
  return Math.sqrt(v / (n - 1));
}

// ---- Error multipliers ----------------------------------------------------------
// A 95% confidence interval is mean +/- 1.96 SE (normal approximation). With only a
// few replicates per group a t interval would be very wide (12.7 SE for n = 2), so the
// z multiplier is used for group means and for differences alike.
export const Z95 = 1.959963984540054;

// Multiplier applied to SE: 1 for +/- 1 SE, 1.96 for a 95% CI
export const errMult = (n, ci) => (ci ? Z95 : 1);

// Multipliers for a difference of two group means (one per element of Ase)
export const welchMult = (Ase, Bse, An, Bn, ci) => Array.from(Ase, () => (ci ? Z95 : 1));

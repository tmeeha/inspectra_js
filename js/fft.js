// Complex FFT of any length: iterative radix-2 for powers of two, Bluestein's chirp-z
// algorithm (built on radix-2) for other lengths. Plans are cached by length.

const radix2Plans = new Map();

function radix2Plan(n) {
  let p = radix2Plans.get(n);
  if (p) return p;
  const levels = Math.log2(n);
  if (!Number.isInteger(levels)) throw new Error("radix-2 length must be a power of 2");
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0, v = i; b < levels; b++, v >>= 1) r = (r << 1) | (v & 1);
    rev[i] = r >>> 0;
  }
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = Math.sin(2 * Math.PI * i / n); }
  p = { rev, cos, sin };
  radix2Plans.set(n, p);
  return p;
}

// In-place forward transform (sign -1) or unnormalised inverse (sign +1)
function radix2(re, im, inverse) {
  const n = re.length;
  if (n <= 1) return;
  const { rev, cos, sin } = radix2Plan(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  const sgn = inverse ? 1 : -1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = i, k = 0; j < i + half; j++, k += step) {
        const l = j + half;
        const wr = cos[k], wi = sgn * sin[k];
        const tr = re[l] * wr - im[l] * wi;
        const ti = re[l] * wi + im[l] * wr;
        re[l] = re[j] - tr; im[l] = im[j] - ti;
        re[j] += tr; im[j] += ti;
      }
    }
  }
}

const isPow2 = (n) => n > 0 && (n & (n - 1)) === 0;
export const nextPow2 = (n) => { let m = 1; while (m < n) m <<= 1; return m; };

const bluePlans = new Map();
function bluesteinPlan(n) {
  let p = bluePlans.get(n);
  if (p) return p;
  const m = nextPow2(2 * n - 1);
  const wr = new Float64Array(n), wi = new Float64Array(n);   // chirp exp(-i pi k^2 / n)
  for (let k = 0; k < n; k++) {
    const a = Math.PI * ((k * k) % (2 * n)) / n;
    wr[k] = Math.cos(a); wi[k] = -Math.sin(a);
  }
  const br = new Float64Array(m), bi = new Float64Array(m);   // conj chirp, wrapped
  br[0] = wr[0]; bi[0] = -wi[0];
  for (let k = 1; k < n; k++) { br[k] = br[m - k] = wr[k]; bi[k] = bi[m - k] = -wi[k]; }
  radix2(br, bi, false);
  p = { m, wr, wi, br, bi, ar: new Float64Array(m), ai: new Float64Array(m) };
  bluePlans.set(n, p);
  return p;
}

// In-place complex FFT of any length (forward, or unnormalised inverse)
export function fft(re, im, inverse = false) {
  const n = re.length;
  if (isPow2(n)) { radix2(re, im, inverse); return; }
  const { m, wr, wi, br, bi, ar, ai } = bluesteinPlan(n);
  // the inverse is the conjugate of the forward transform of the conjugate
  const s = inverse ? -1 : 1;
  ar.fill(0); ai.fill(0);
  for (let k = 0; k < n; k++) {
    const xr = re[k], xi = s * im[k];
    ar[k] = xr * wr[k] - xi * wi[k];
    ai[k] = xr * wi[k] + xi * wr[k];
  }
  radix2(ar, ai, false);
  for (let k = 0; k < m; k++) {
    const r = ar[k] * br[k] - ai[k] * bi[k];
    ai[k] = ar[k] * bi[k] + ai[k] * br[k];
    ar[k] = r;
  }
  radix2(ar, ai, true);
  for (let k = 0; k < n; k++) {
    const r = ar[k] / m, i = ai[k] / m;
    re[k] = r * wr[k] - i * wi[k];
    im[k] = s * (r * wi[k] + i * wr[k]);
  }
}

// Adds |FFT(frame)|^2 for bins 0..floor(n/2) to acc. `frame` is a real array of length n.
const work = new Map();
export function addPowerSpectrum(frame, acc) {
  const n = frame.length;
  let w = work.get(n);
  if (!w) { w = { re: new Float64Array(n), im: new Float64Array(n) }; work.set(n, w); }
  w.re.set(frame); w.im.fill(0);
  fft(w.re, w.im);
  const nb = Math.floor(n / 2) + 1;
  for (let k = 0; k < nb; k++) acc[k] += w.re[k] * w.re[k] + w.im[k] * w.im[k];
}

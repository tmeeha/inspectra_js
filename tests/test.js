// Compares the JavaScript analysis with the R app's results (tests/fixtures/reference.json,
// made by tests/make_reference.R). Open tests/test.html through a local web server.

import { readWav } from "../js/wav.js";
import { nearestSmooth, framePower, impactPower, modeDamping, ringingStrings, bandPower, bandShares,
  smoothOctave, approx, summariseGroups } from "../js/dsp.js";
import { pitchTrack, pitchOffset, pitchExtent, noteLevels } from "../js/pitch.js";
import { errMult } from "../js/stats.js";
import { pretty, noteName, seriesCols } from "../js/format.js";
import { defaultGroup, suggestType } from "../js/analysis.js";
import { B12, BAND_SETS, REGIONS, F_MIN, F_MAX, REF_FS } from "../js/config.js";

const out = document.getElementById("out");
let pass = 0, fail = 0;
const log = (s) => { out.textContent += s + "\n"; };
function check(label, ok, detail = "") {
  if (ok) pass++; else fail++;
  log(`${ok ? "ok  " : "FAIL"} ${label}${!ok && detail ? "  — " + detail : ""}`);
}
// max abs / relative difference of two arrays (nulls in R = NA)
function maxDiff(a, b, rel = false) {
  if (a == null || b == null) return a == b ? 0 : Infinity;
  if (!Array.isArray(b) && !(b instanceof Float64Array)) { a = [a]; b = [b]; }
  if (a.length !== b.length) return Infinity;
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    const xn = x == null || Number.isNaN(x), yn = y == null || Number.isNaN(y);
    if (xn || yn) { if (xn !== yn) return Infinity; continue; }
    const d = Math.abs(x - y) / (rel ? Math.max(1e-300, Math.abs(y)) : 1);
    if (d > m) m = d;
  }
  return m;
}
const near = (label, a, b, tol, rel = false) => {
  const d = maxDiff(a, b, rel);
  check(`${label} (max ${rel ? "rel " : ""}diff ${d.toExponential(1)})`, d <= tol);
};

async function run() {
  const ref = await (await fetch("fixtures/reference.json")).json();
  for (const [nm, r] of Object.entries(ref.files)) {
    log(`\n== ${nm} (${r.type})`);
    const t0 = performance.now();
    const w = readWav(await (await fetch("../" + r.path)).arrayBuffer());
    check("length, rate, clipped samples", w.x.length === r.n && w.fs === r.fs && w.clip.length === r.n_clip,
      `${w.x.length}/${r.n} ${w.fs}/${r.fs} ${w.clip.length}/${r.n_clip}`);
    near("samples", Array.from(w.x.subarray(999, 1009)), r.head, 1e-12);   // R's x[1000 + 0:9]
    near("sum of squares", w.x.reduce((a, v) => a + v * v, 0), r.sumsq, 1e-9, true);
    const nfft = nearestSmooth(w.fs * 16384 / REF_FS);
    check(`nfft ${nfft}`, nfft === r.nfft, `R ${r.nfft}`);
    let pow = null;
    if (r.type === "impact") {
      for (const key of ["-40_-20_1", "0_-20_1", "-40_-12_0"]) {
        const [e, t, s] = key.split("_").map(Number);
        const fp = impactPower(w.x, nfft, w.fs, e, t, w.clip, s === 1);
        const R = r["imp_" + key];
        const same = ["total", "kept", "edge", "double", "clipped_good", "fallback"].every((k) => fp[k] === R[k]);
        check(`taps ${key}: ${fp.kept} of ${fp.total} used, ${fp.double} double, ${fp.edge} edge, ${fp.clipped_good} clipped`, same,
          JSON.stringify(R));
        near(`taps ${key}: power`, fp.pow ? fp.pow.reduce((a, b) => a + b, 0) : null, R.pow_sum, 1e-9, true);
      }
      const fp = impactPower(w.x, nfft, w.fs, -40, -20, w.clip, true);
      if (fp.pow) {
        pow = fp.pow;
        const f = Float64Array.from(pow, (_, k) => k * w.fs / nfft);
        for (const d of r.damping) {
          const reg = REGIONS.find((x) => x.label === d.mode);
          const j = modeDamping(f, pow, w.fs / nfft, reg.xmin, reg.xmax, -40);
          check(`damping ${d.mode}: f0 ${j.f0.toFixed(2)} Q ${j.Q.toFixed(2)} "${j.note}"`,
            j.note === d.note && maxDiff([j.f0, j.Q], [d.f0, d.Q], true) < 1e-8, `R f0 ${d.f0} Q ${d.Q} "${d.note}"`);
        }
      }
      const rs = ringingStrings(w.x, nfft, w.fs, -20, w.clip, true);
      check(`ringing strings [${rs}]`, JSON.stringify(rs) === JSON.stringify(r.strings), JSON.stringify(r.strings));
    } else {
      const tr = pitchTrack(w.x, w.fs), p = r.pitch;
      check(`pitch frames ${tr.n_frames}, voiced ${tr.fr.length}`, tr.n_frames === p.n_frames && tr.fr.length === p.n_voiced,
        `R ${p.n_frames}, ${p.n_voiced}`);
      check("voiced frame indices", JSON.stringify(tr.fr.slice(0, 30)) === JSON.stringify(p.fr_head));
      near("f0 values", tr.f0.slice(0, 30), p.f0_head, 1e-9, true);
      near("f0 sum", tr.f0.reduce((a, b) => a + b, 0), p.f0_sum, 1e-9, true);
      const po = pitchOffset(tr), ex = pitchExtent(tr);
      near(`offset ${po.offset.toFixed?.(2)}, spread ${po.spread.toFixed?.(2)}`, [po.offset, po.spread], [p.offset, p.spread], 1e-8);
      near(`extent ${ex.lo.toFixed?.(1)}–${ex.hi.toFixed?.(1)} Hz`, [ex.lo, ex.hi], [p.lo, p.hi], 1e-8, true);
      const nl = noteLevels(tr, r.type === "glis");
      const keys = [].concat(p.notes.key ?? []);
      check(`note levels: ${nl.length} notes`, JSON.stringify(nl.map((n) => n.key)) === JSON.stringify(keys) &&
        JSON.stringify(nl.map((n) => n.frames)) === JSON.stringify([].concat(p.notes.frames ?? [])));
      near("note frequencies / levels", nl.map((n) => n.f).concat(nl.map((n) => n.pow)),
        [].concat(p.notes.f ?? []).concat([].concat(p.notes.pow ?? [])), 1e-9, true);
      const fp = framePower(w.x, nfft, true, -40);
      if (fp) pow = fp.pow;
      const fp2 = framePower(w.x, nfft, true, -20);
      near("gated −20 dB power", fp2 ? fp2.pow.reduce((a, b) => a + b, 0) : null, r.gate20_pow_sum, 1e-9, true);
      if (r.bad300) {
        const bad = new Uint8Array(w.x.length);
        tr.fr.forEach((fr, j) => {
          if (!(tr.f0[j] > 300)) return;
          bad.fill(1, Math.max(0, (fr - 1) * tr.H), Math.min(w.x.length - 1, fr * tr.H + tr.N + tr.H - 1) + 1);
        });
        const fb = framePower(w.x, nfft, true, -40, bad);
        near("pitch-range exclusion: share excluded, power", fb ? [fb.excluded, fb.pow.reduce((a, b) => a + b, 0)] : null,
          [r.bad300.excluded, r.bad300.pow_sum], 1e-9, true);
      }
    }
    if (pow && r.curves) {
      const df = w.fs / nfft, freq = Float64Array.from(pow, (_, k) => k * df);
      const bp = bandPower(pow, df, B12.map((b) => b.lo), B12.map((b) => b.hi));
      const tot = bp.reduce((a, b) => a + b, 0);
      near("Dünnwald band levels", bandShares(bp), r.bands_dw, 1e-9);
      for (const s of ["bark", "curtin4", "curtin5", "zones"]) {
        const cf = BAND_SETS[s].cfg;
        near(`${s} band levels`, bandPower(pow, df, cf.map((c) => c.xmin), cf.map((c) => c.xmax)).map((v) => 10 * Math.log10(v / tot + 1e-30)),
          r.bands_sets[s], 1e-9);
      }
      const by = REF_FS / 16384, n = Math.floor((F_MAX - F_MIN) / by + 1e-10) + 1;
      const grid = Float64Array.from({ length: n }, (_, k) => F_MIN + k * by);
      for (const [key, curve] of Object.entries(r.curves)) {
        const [sm, norm] = key.split("_");
        let d = Float64Array.from(pow, (p) => (norm === "inband" ? p / df / tot : 2 * p / df));
        if (Number(sm) > 0) d = smoothOctave(freq, d, Number(sm));
        // Compared within 120 dB of the curve's maximum: far below that, both are rounding
        // noise. Smoothed curves of synthetic pure tones may differ by up to ~1e-4 dB: R's
        // smoothing (a difference of running sums) is itself that far from the exact value.
        const top = Math.max(...curve.filter((v) => v != null));
        const js = Array.from(approx(freq, d, grid), (v) => 10 * Math.log10(v + 1e-30));
        const keep = curve.map((v) => v != null && v > top - 120);
        near(`curve smoothing 1/${sm}, ${norm}`, js.filter((_, i) => keep[i]), curve.filter((_, i) => keep[i]), 1e-3);
      }
    }
    log(`   (${(performance.now() - t0).toFixed(0)} ms)`);
  }

  log("\n== helpers");
  const s = ref.summ, gs = summariseGroups(s.mat, s.grp);
  near("group means and SE", [...gs.get("a").mean, ...gs.get("a").se, ...gs.get("b").mean], [...s.a_mean, ...s.a_se, ...s.b_mean], 1e-10);
  check("95% CI multiplier is z = 1.96", Math.abs(errMult(2, true) - 1.96) < 1e-3 && errMult(2, false) === 1);
  for (const p of ref.pretty) check(`pretty(${p.r}) = ${pretty(p.r[0], p.r[1])}`, JSON.stringify(pretty(p.r[0], p.r[1])) === JSON.stringify(p.b), JSON.stringify(p.b));
  const nn = ref.notes.f.map(noteName).map((x) => x.replace("−", "-"));
  check(`note names ${nn.join(", ")}`, JSON.stringify(nn) === JSON.stringify(ref.notes.name));
  const gg = ref.groups.names.map(defaultGroup);
  check(`default groups ${gg.join(", ")}`, JSON.stringify(gg) === JSON.stringify(ref.groups.g), JSON.stringify(ref.groups.g));
  check(`hue palette ${seriesCols(11).join(" ")}`, JSON.stringify(seriesCols(11)) === JSON.stringify(ref.hue), JSON.stringify(ref.hue));
  const ty = (n) => suggestType([n]).suggested;
  check("types from names", ty("a_semitones_1.wav") === "bowed" && ty("a_glissando_1.wav") === "bowed" &&
    ty("a_concerto_1.wav") === "bowed" && ty("a_taps_1.wav") === "impact" && ty("improv_take1.wav") === null);
  log(`\nDONE ${pass} passed, ${fail} failed`);
  document.title = `DONE ${pass}/${fail}`;
}
run().catch((e) => { log("ERROR " + e.stack); log("DONE with error"); });

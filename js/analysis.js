// Analysis pipeline (the non-UI part of R/server.R): file names and groups, pitch
// tracks, the common pitch range, spectra with user messages, band levels and
// normalised/smoothed curves, note-level data, the pitch box and the damping table.

import {
  F_MIN, F_MAX, REF_FS, B12, BAND_SETS, REC_KEYWORDS, GLIS_KEYWORD, REGIONS, DAMPING_MODES, Q_STRING,
  TUNE_WARN, TUNE_SPREAD_WARN, TUNE_SPREAD_MAX, ZONE_NAMES,
} from "./config.js";
import {
  nearestSmooth, framePower, impactPower, ringingStrings, modeDamping, bandPower, bandShares,
  smoothOctave, approx, summariseGroups,
} from "./dsp.js";
import { pitchTrack, pitchOffset, pitchExtent, noteLevels } from "./pitch.js";
import { sd, errMult } from "./stats.js";
import { noteShort, noteNum, seriesCols, DIFF_COL } from "./format.js";

export class ValidationError extends Error {}
export const need = (ok, msg) => { if (!ok) throw new ValidationError(msg); };

export const esc = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---- File names -----------------------------------------------------------------
export function makeUnique(names) {
  const seen = new Map(), used = new Set(names), out = [];
  for (const nm of names) {
    if (!seen.has(nm)) { seen.set(nm, 0); out.push(nm); continue; }
    let k = seen.get(nm), cand;
    do { k++; cand = `${nm}.${k}`; } while (used.has(cand));
    seen.set(nm, k); used.add(cand); out.push(cand);
  }
  return out;
}

// Default replicate group: file name without extension and trailing replicate number
// (_1, -02, _r1, _rep2, _replicate2, _take3). A number directly after letters is kept.
export function defaultGroup(name) {
  const base = String(name).replace(/\\/g, "/").split("/").pop().replace(/\.[a-zA-Z0-9]+$/, "");
  const g = base.replace(/[ _-]+((r|rep|replicate|take|t|run|trial)[ _-]?)?\d+$/i, "");
  return g.length ? g : base;
}

// Recording type suggested by the file names: { suggested, found }
export function suggestType(names) {
  const types = names.map((n) => {
    const hits = Object.keys(REC_KEYWORDS).filter((k) => REC_KEYWORDS[k].test(n.toLowerCase()));
    return hits.length === 1 ? hits[0] : null;
  });
  const found = [...new Set(types.filter(Boolean))];
  const suggested = found.length === 1 && types.every(Boolean) ? found[0] : null;
  return { suggested, found };
}

// ---- Pitch tracks ---------------------------------------------------------------
// The raw track, tuning and pitch range are cached on each file object.
export function trackOf(file) {
  if (!file.audio) return null;
  if (!file.track) {
    const tr = pitchTrack(file.audio.x, file.audio.fs);
    file.track = { tr, tune: pitchOffset(tr), ext: pitchExtent(tr), notes: null, glisNotes: null };
  }
  return file.track;
}

// Bowed recordings are treated as glissandi (note levels in 1/24-octave pitch bins, no
// tuning check) when most of them are: a file counts as a glissando if its name says so
// or if its pitch keeps sliding rather than holding notes.
export function isGlissandoSet(files, tracks) {
  const fs = files.filter((f) => tracks.has(f.name));
  if (!fs.length) return false;
  const sliding = fs.filter((f) => GLIS_KEYWORD.test(f.origName.toLowerCase()) || tracks.get(f.name).tune.sliding === true);
  return sliding.length > fs.length / 2;
}

// Note levels of a track, held notes or glissando pitch bins (cached)
export function notesOf(track, glis) {
  const k = glis ? "glisNotes" : "notes";
  if (!track[k]) track[k] = noteLevels(track.tr, glis);
  return track[k];
}

// Common pitch range of the visible files (Hz, widened by half a semitone)
export function commonInfo(tracks, visible) {
  const vis = visible.filter((n) => tracks.has(n));
  if (vis.length === 0) return { rng: null, unmeasured: [], n_measured: 0 };
  const ok = vis.filter((n) => Number.isFinite(tracks.get(n).ext.lo) && Number.isFinite(tracks.get(n).ext.hi));
  const unmeasured = vis.filter((n) => !ok.includes(n));
  if (ok.length === 0) return { rng: null, unmeasured, n_measured: 0 };
  const lo = Math.max(...ok.map((n) => tracks.get(n).ext.lo)), hi = Math.min(...ok.map((n) => tracks.get(n).ext.hi));
  if (lo >= hi) return { rng: null, unmeasured, n_measured: ok.length };
  return { rng: { lo: lo * Math.pow(2, -50 / 1200), hi: hi * Math.pow(2, 50 / 1200) }, unmeasured, n_measured: ok.length };
}

// ---- Stage 1: spectra -----------------------------------------------------------
// files: [{name, audio, error}], st: analysis settings. Returns { spec: Map, msgs }.
// `tick(i, name)` is awaited before each file (progress, cancellation).
export async function rawSpectra(files, { fftSize, st, rng, tracks }, tick = async () => {}) {
  const spec = new Map(), msgs = [], tapInfo = [];
  const add = (text, type = "warning", duration = 8, html = false) => msgs.push({ text, type, duration, html });
  for (let i = 0; i < files.length; i++) {
    const { name, audio } = files[i];
    await tick(i, name);
    if (!audio) { add(`Could not read ${name}${files[i].error ? ` (${files[i].error})` : ""}`); continue; }
    const { x, fs, clip } = audio;
    if (fs / 2 < F_MAX) { add(`${name}: sample rate too low (need Nyquist >= ${F_MAX} Hz)`); continue; }
    const nfft = nearestSmooth(fs * fftSize / REF_FS);      // fixed frame duration
    let fp;
    if (st.type === "exp") {
      fp = impactPower(x, nfft, fs, st.end_db, st.trig_db, clip, st.skip_clipped);
      if (!fp) { add(`${name} is silent or shorter than one FFT window`); continue; }
      const why = [];
      if (fp.double > 0) why.push(`${fp.double} double hit(s)`);
      if (fp.edge > 0) why.push(`${fp.edge} too near file ends`);
      if (fp.clipped_good > 0 && st.skip_clipped && !fp.fallback) why.push(`${fp.clipped_good} clipped`);
      tapInfo.push(`${esc(name)}: ${fp.kept} of ${fp.total} used${why.length ? ` (skipped: ${why.join(", ")})` : ""}`);
      if (fp.kept === 0) {
        add(`${name}: no usable taps (all were double hits or too near the file ends). ` +
            "Space taps at least one frame apart and let each one ring out."); continue;
      }
      if (fp.fallback || (!st.skip_clipped && fp.clipped_good > 0)) {
        add(`${name}: ${fp.clipped_good} of the ${fp.kept} taps used are clipped. Clipping adds spurious ` +
            "high-frequency content; re-record with lower input gain if possible." +
            (fp.fallback ? " Every usable tap in this file is clipped, so they were used anyway; it is not " +
              "comparable with files whose clipped taps were skipped (turn off Skip clipped taps to treat all files alike)." : ""), "warning", 20);
      }
      const rings = ringingStrings(x, nfft, fs, st.trig_db, clip, st.skip_clipped);
      if (rings.length) {
        add(`${name}: very sharp peak${rings.length > 1 ? "s" : ""} at the open-string pitch of ${rings.join(", ")}. ` +
            "The strings may not have been damped; a ringing string adds a sharp peak that can be mistaken " +
            "for a body mode. Damp the strings and re-record.");
      }
    } else {
      if (clip.length > 0) {
        add(`${name}: ${clip.length} clipped samples (${(100 * clip.length / x.length).toFixed(3)}% of the recording); ` +
            "clipping adds spurious high-frequency content.", "warning", 15);
      }
      if (x.length < nfft) { add(`${name} is shorter than one FFT window`); continue; }
      let bad = null;
      const tk = rng && tracks ? tracks.get(name) : null;
      if (tk) {
        // samples of frames whose pitch lies outside the common range (+/- one hop)
        const tr = tk.tr;
        bad = new Uint8Array(x.length);
        tr.fr.forEach((fr, j) => {
          if (tr.f0[j] >= rng.lo && tr.f0[j] <= rng.hi) return;
          const a = Math.max(0, (fr - 1) * tr.H), b = Math.min(x.length - 1, fr * tr.H + tr.N + tr.H - 1);
          bad.fill(1, a, b + 1);
        });
      }
      fp = framePower(x, nfft, st.gate_on, st.gate_db, bad);
      if (!fp) { add(`${name} has no frames inside the common pitch range`); continue; }
    }
    const nb = fp.pow.length, df = fs / nfft;
    spec.set(name, { freq: Float64Array.from({ length: nb }, (_, k) => k * df), pow: fp.pow, df, excluded: fp.excluded || 0 });
  }
  if (tapInfo.length) add("<b>Taps</b><br>" + tapInfo.join("<br>"), "message", 15, true);
  return { spec, msgs };
}

// ---- Stage 2: band levels, normalise, smooth, interpolate onto a common grid ----
export function processSpectra(raw, fftSize, smooth, inband) {
  need(raw.size > 0, "No usable audio files.");
  const by = REF_FS / fftSize;
  const nGrid = Math.floor((F_MAX - F_MIN) / by + 1e-10) + 1;
  const grid = Float64Array.from({ length: nGrid }, (_, k) => F_MIN + k * by);
  const bpo = Number(smooth);
  const names = [], mat = [], bands = [], sets = {};
  for (const s of Object.keys(BAND_SETS)) if (s !== "dw") sets[s] = [];
  const lo12 = B12.map((b) => b.lo), hi12 = B12.map((b) => b.hi);
  for (const [nm, r] of raw) {
    const bp = bandPower(r.pow, r.df, lo12, hi12);
    const tot = bp.reduce((a, b) => a + b, 0);
    if (!Number.isFinite(tot) || tot <= 0) continue;
    names.push(nm);
    bands.push(bandShares(bp));
    for (const s of Object.keys(sets)) {
      const cf = BAND_SETS[s].cfg;
      sets[s].push(bandPower(r.pow, r.df, cf.map((c) => c.xmin), cf.map((c) => c.xmax)).map((p) => 10 * Math.log10(p / tot + 1e-30)));
    }
    let d = Float64Array.from(r.pow, (p) => p / r.df);              // PSD, FS^2/Hz
    d = d.map((v) => (inband ? v / tot : 2 * v));                   // re in-band power, or re FS sine
    if (bpo > 0) d = smoothOctave(r.freq, d, bpo);
    mat.push(approx(r.freq, d, grid).map((v) => 10 * Math.log10(v + 1e-30)));
  }
  need(mat.length > 0, "All files were silent or unusable.");
  return { grid, names, mat, bands, sets, fftSize };
}

// Visible files of the processed spectra, with their groups
export function activeSet(p, visible, groupOf) {
  const keep = p.names.map((n, i) => [n, i]).filter(([n]) => visible.includes(n));
  need(keep.length > 0, "Select at least one audio layer.");
  const pick = (rows) => keep.map(([, i]) => rows[i]);
  const sets = {};
  for (const s of Object.keys(p.sets)) sets[s] = pick(p.sets[s]);
  return { grid: p.grid, names: keep.map(([n]) => n), mat: pick(p.mat), bands: pick(p.bands), sets,
    grp: keep.map(([n]) => groupOf(n)) };
}

// ---- Note-level view ------------------------------------------------------------
export function noteData(tracks, a, cr, inband, glis) {
  const rows = [];
  for (const [i, f] of a.names.entries()) {
    const tk = tracks.get(f);
    if (!tk) continue;
    let nl = notesOf(tk, glis);
    if (cr) nl = nl.filter((n) => n.f >= cr.lo && n.f <= cr.hi);
    if (nl.length === 0) continue;
    const m = nl.reduce((s, n) => s + n.pow, 0) / nl.length;
    for (const n of nl) {
      rows.push({ Series: f, Group: a.grp[i], key: n.key, f: n.f,
        lvl: inband ? 10 * Math.log10(n.pow / m) : 10 * Math.log10(2 * n.pow) });
    }
  }
  need(rows.length > 0, "No held notes found for the note-level view.");
  return rows;
}

// Group means by note (or pitch bin): power-mean level with delta-method SE
export function noteGroups(d) {
  const m = new Map();
  for (const r of d) {
    const k = `${r.Group}\u0000${r.key}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  const groupsOrder = [...new Set(d.map((r) => r.Group))];
  const out = [];
  for (const rows of m.values()) {
    const lin = rows.map((r) => Math.pow(10, r.lvl / 10)), n = rows.length;
    const mu = lin.reduce((a, b) => a + b, 0) / n;
    out.push({ Group: rows[0].Group, key: rows[0].key, f: rows.reduce((a, r) => a + r.f, 0) / n,
      lvl: 10 * Math.log10(mu), n, se: n > 1 ? (10 / Math.LN10) * sd(lin) / (Math.sqrt(n) * mu) : NaN });
  }
  // R's split() orders by group level (alphabetical), then key
  out.sort((p, q) => (p.key - q.key) || (p.Group < q.Group ? -1 : p.Group > q.Group ? 1 : 0));
  out.groupsOrder = groupsOrder;
  return out;
}

// Frequency-matched difference B - A: B's curve (linear in log f) read at A's notes
export function noteDiff(g, ref, cmp) {
  const A0 = g.filter((r) => r.Group === ref).sort((p, q) => p.f - q.f);
  const B = g.filter((r) => r.Group === cmp).sort((p, q) => p.f - q.f);
  need(A0.length >= 2 && B.length >= 2, "Too few notes for a note-level difference.");
  const A = A0.filter((r) => r.f >= B[0].f && r.f <= B[B.length - 1].f);
  need(A.length >= 1, "The two groups have no pitch range in common.");
  const lbx = B.map((r) => Math.log(r.f)), xa = A.map((r) => Math.log(r.f));
  const lb = approx(lbx, B.map((r) => r.lvl), xa);
  const seb = B.some((r) => Number.isFinite(r.se))
    ? approxNA(lbx, B.map((r) => r.se), xa) : A.map(() => NaN);
  return A.map((r, i) => {
    let best = 0;
    B.forEach((b, j) => { if (Math.abs(Math.log(b.f / r.f)) < Math.abs(Math.log(B[best].f / r.f))) best = j; });
    return { key: r.key, f: r.f, d: lb[i] - r.lvl, seA: r.se, seB: seb[i], nA: r.n, nB: B[best].n };
  });
}
// approx() that, like R's, ignores NA pairs
function approxNA(x, y, xout) {
  const ok = x.map((_, i) => Number.isFinite(y[i]));
  const xs = x.filter((_, i) => ok[i]), ys = y.filter((_, i) => ok[i]);
  if (xs.length < 2) return xout.map(() => NaN);
  return Array.from(approx(xs, ys, xout));
}

// ---- Pitch box ------------------------------------------------------------------
// Returns { html, warn } or null.
export function pitchBox({ tracks, a, glis, restrict, ci, raw }) {
  const files = a.names.filter((n) => tracks.has(n));
  if (files.length === 0) return null;
  const grp = files.map((f) => a.grp[a.names.indexOf(f)]);
  const nn = (f) => (Number.isFinite(f) ? noteShort(f) : "?");
  const groups = [...new Set(grp)];
  const ext = files.map((f) => tracks.get(f).ext);
  const rngTxt = groups.map((g) => {
    const e = ext.filter((_, i) => grp[i] === g);
    const lo = Math.min(...e.map((x) => x.lo)), hi = Math.max(...e.map((x) => x.hi));
    return `${esc(g)}: ${nn(lo)}–${nn(hi)}`;
  }).join(" · ");
  const loN = ext.map((e) => noteNum(e.lo)), hiN = ext.map((e) => noteNum(e.hi));
  const span = (v) => Math.max(...v) - Math.min(...v);
  const differ = [...loN, ...hiN].every(Number.isFinite) && (span(loN) >= 2 || span(hiN) >= 2);
  const cr = restrict ? ci.rng : null;
  const unm = restrict ? ci.unmeasured.filter((n) => files.includes(n)) : [];
  const unmTxt = unm.length ? ` No stable pitch range could be measured in ${unm.map(esc).join(", ")}, so it was not used to set the common range.` : "";
  let rngMsg = "";
  if (restrict && cr) {
    const exc = files.map((f) => raw?.get(f)?.excluded || 0);
    rngMsg = `Restricted to the common pitch range ${noteShort(cr.lo * Math.pow(2, 50 / 1200))}–${noteShort(cr.hi * Math.pow(2, -50 / 1200))} ` +
      `(${(100 * exc.reduce((s, v) => s + v, 0) / exc.length).toFixed(0)}% of frames excluded on average).` + unmTxt;
  } else if (restrict && ci.n_measured === 0) {
    rngMsg = "No stable pitch range could be measured in the visible recordings; the filter is not applied.";
  } else if (restrict) {
    rngMsg = "The visible recordings have no common pitch range; the filter is not applied.";
  } else if (differ) {
    rngMsg = "The pitch ranges differ, so the spectra include different notes. Tick “Restrict to common pitch range” " +
      "in Analysis settings to compare like with like.";
  }
  let html = `<b>Pitch range</b>: ${rngTxt}${rngMsg ? "<br>" + rngMsg : ""}`;
  let warn = (differ && !restrict) || (restrict && (!cr || unm.length > 0));

  if (glis) {
    html += "<br><b>Glissandi</b>: the pitch slides rather than holding notes, so note levels use 1/24-octave pitch bins and tuning is not assessed.";
  } else {
    const tn = new Map(files.map((f) => [f, tracks.get(f).tune]));
    const stable = (f) => tn.get(f) && Number.isFinite(tn.get(f).offset);
    const clear = (f) => tn.get(f) && Number.isFinite(tn.get(f).spread) && tn.get(f).spread <= TUNE_SPREAD_MAX;
    const fmt = (v) => { const r = Math.round(v) + 0; return `${r >= 0 ? "+" : "−"}${Math.abs(r)}¢`; };
    const tl = [], goff = new Map(), gspread = new Map();
    for (const g of groups) {
      const fg = files.filter((_, i) => grp[i] === g), ok = fg.filter(stable);
      if (ok.length === 0) { tl.push(`${esc(g)}: no stable pitches found`); continue; }
      gspread.set(g, Math.max(...ok.map((f) => tn.get(f).spread)));
      const okc = ok.filter(clear);
      let gtxt = "unclear";
      if (okc.length) {
        let re = 0, im = 0;
        okc.forEach((f) => { const o = tn.get(f).offset; re += Math.cos(2 * Math.PI * o / 100); im += Math.sin(2 * Math.PI * o / 100); });
        goff.set(g, Math.atan2(im, re) * 100 / (2 * Math.PI));
        gtxt = fmt(goff.get(g));
      }
      const per = fg.map((f) => (!stable(f) ? "n/a" : !clear(f) ? "unclear" : fmt(tn.get(f).offset)));
      tl.push(`${esc(g)}: <b>${gtxt}</b>${fg.length > 1 ? ` (${per.join(", ")})` : ""}, note-to-note ±${gspread.get(g).toFixed(0)}¢`);
    }
    const offs = [...goff.values()];
    let spread = NaN;
    if (offs.length > 1) {
      spread = 0;
      for (const x of offs) for (const y of offs) spread = Math.max(spread, Math.abs((((x - y + 50) % 100) + 100) % 100 - 50));
    }
    const warnOff = Number.isFinite(spread) && spread > TUNE_WARN;
    const maxSpread = gspread.size ? Math.max(...gspread.values()) : NaN;
    const warnInt = gspread.size > 0 && maxSpread > TUNE_SPREAD_WARN;
    html += "<br><b>Pitch offset vs A4 = 440 Hz</b> (tuning and intonation): " + tl.join(" &nbsp;·&nbsp; ");
    if (warnOff || warnInt) {
      html += "<br>" + (warnOff ? `Groups differ in average pitch by up to ${spread.toFixed(0)} cents. ` : "") +
        (warnInt ? `Intonation varies from note to note by up to ±${maxSpread.toFixed(0)} cents. ` : "") +
        "Note peaks therefore do not line up between recordings, so fine structure in spectrum comparisons " +
        "is unreliable; use 1/6- or 1/3-octave smoothing, or the Note levels view." +
        (warnOff ? " Tune to the same reference before recording." : "");
      warn = true;
    }
  }
  return { html, warn };
}

// ---- Mode damping (taps) --------------------------------------------------------
export function dampingRows(a, raw, endDb) {
  const md = DAMPING_MODES.map((m) => REGIONS.find((r) => r.label === m));
  const rows = [];
  a.names.forEach((fn, i) => {
    const r = raw.get(fn);
    if (!r) return;
    md.forEach((m) => {
      const d = modeDamping(r.freq, r.pow, r.df, m.xmin, m.xmax, endDb);
      rows.push({ file: fn, group: a.grp[i], mode: m.label, ...d });
    });
  });
  return rows;
}

// Table with three columns per mode (frequency, Q, damping ratio); a mode that could
// not be measured shows the reason across its three columns.
export function dampingBox(rows, endDb) {
  if (!rows.length) return "";
  const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
  const cells = (x) => {
    if (!Number.isFinite(x.f0)) return `<td colspan="3" class="mode-start muted">${x.note}</td>`;
    const sharp = x.Q > Q_STRING
      ? ' <span class="warn-text" title="Very sharp peak: probably a ringing string, not a body mode">⚠ string?</span>' : "";
    return `<td class="num mode-start">${x.f0.toFixed(1)}</td><td class="num">${x.Q.toFixed(0)}${sharp}</td>` +
      `<td class="num">${(100 * x.zeta).toFixed(1)}</td>`;
  };
  let body = "";
  for (const g of [...new Set(rows.map((r) => r.group))]) {
    const dg = rows.filter((r) => r.group === g);
    const files = [...new Set(dg.map((r) => r.file))];
    for (const fn of files) {
      body += `<tr><td class="name">${esc(fn)}</td>` + DAMPING_MODES.map((m) => cells(dg.find((r) => r.file === fn && r.mode === m))).join("") + "</tr>";
    }
    if (files.length > 1) {
      // group means leave out unmeasured modes and likely strings
      const gm = DAMPING_MODES.map((m) => {
        const v = dg.filter((r) => r.mode === m && Number.isFinite(r.Q) && r.Q <= Q_STRING);
        if (!v.length) return '<td colspan="3" class="mode-start muted">—</td>';
        const se = v.length > 1 ? ` ± ${(sd(v.map((r) => r.Q)) / Math.sqrt(v.length)).toFixed(0)}` : "";
        const nTxt = v.length < files.length ? ` <span class="muted">(n = ${v.length})</span>` : "";
        return `<td class="num mode-start">${mean(v.map((r) => r.f0)).toFixed(1)}</td>` +
          `<td class="num">${mean(v.map((r) => r.Q)).toFixed(0)}${se}${nTxt}</td>` +
          `<td class="num">${(100 * mean(v.map((r) => r.zeta))).toFixed(1)}</td>`;
      });
      body += `<tr class="mean-row"><td class="name">${esc(g)} (mean, n = ${files.length})</td>${gm.join("")}</tr>`;
    }
  }
  const head1 = `<tr><th rowspan="2">Recording</th>${DAMPING_MODES.map((m) => `<th colspan="3" class="mode-start group-head">${m}</th>`).join("")}</tr>`;
  const head2 = `<tr>${DAMPING_MODES.map(() => '<th class="num mode-start">f (Hz)</th><th class="num">Q</th><th class="num">ζ (%)</th>').join("")}</tr>`;
  return `<b>Mode damping</b>` +
    `<div class="table-wrap"><table class="damping"><thead>${head1}${head2}</thead><tbody>${body}</tbody></table></div>` +
    "f: peak frequency; Q: frequency ÷ half-power bandwidth (± SE for group means); ζ: damping ratio, 1/(2Q). " +
    `Half-power bandwidth of the highest peak in each mode's range, corrected for the exponential window (${endDb} dB). ` +
    "Reliable only with damped strings and clean, consistent taps; see the Read Me.";
}

// ---- Band summary (bowed strings) -------------------------------------------------
// Band levels of the chosen band set as a table: one row per recording (individual),
// per group with ± error (group mean), or B − A with ± error (difference). The values
// are those of the band panel below the spectra.
const hz = (v) => String(Math.round(v));
export function bandRows({ a, mode, ci, bandSet, sel }) {
  const bv = bandSet === "dw" ? a.bands : a.sets[bandSet];
  if (mode === "indiv") {
    const cols = seriesCols(a.names.length);
    return a.names.map((n, i) => ({ name: n, color: cols[i], val: Array.from(bv[i]), err: null }));
  }
  const bs = summariseGroups(bv, a.grp), m = errMult(0, ci);
  if (mode === "mean") {
    const lv = [...bs.keys()], cols = seriesCols(lv.length);
    return lv.map((g, i) => ({ name: g, n: bs.get(g).n, color: cols[i], val: Array.from(bs.get(g).mean),
      err: Array.from(bs.get(g).se, (s) => m * s) }));
  }
  const A = bs.get(sel.ref), B = bs.get(sel.cmp);
  return [{ name: `${sel.cmp} − ${sel.ref}`, color: DIFF_COL, val: Array.from(B.mean, (v, k) => v - A.mean[k]),
    err: Array.from(A.se, (s, k) => m * Math.sqrt(s ** 2 + B.se[k] ** 2)) }];
}

export function bandBox(c) {
  if (c.bandSet === "none") return "";
  const bset = BAND_SETS[c.bandSet], rows = bandRows(c);
  const diff = c.mode === "diff";
  const fmt = (v) => (diff && v >= 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1);
  const head = bset.cfg.map((b, i) => {
    const title = c.bandSet === "zones" ? ` title="${ZONE_NAMES[i]}"` : "";
    return `<th class="num"${title}>${b.Label}<span class="sub">${hz(b.xmin)}–${hz(b.xmax)}</span></th>`;
  }).join("");
  const body = rows.map((r) => `<tr><td class="name"><i class="swatch" style="background:${r.color}"></i>${esc(r.name)}` +
    (r.n ? ` <span class="muted">(n = ${r.n})</span>` : "") + "</td>" +
    r.val.map((v, k) => {
      const e = r.err ? r.err[k] : NaN;
      return `<td class="num">${fmt(v)}${Number.isFinite(e) ? `<span class="pm"> ± ${e.toFixed(1)}</span>` : ""}</td>`;
    }).join("") + "</tr>").join("");
  const errTxt = c.mode === "indiv" ? "" : `; ± ${c.ci ? "approx. 95% CI (1.96 SE)" : "1 SE"}` +
    (rows.some((r) => r.err && !r.err.some(Number.isFinite)) ? "; no error with one recording" : "");
  return `<b>Band levels</b> <span class="muted">${bset.name}: ${diff ? "change in level, B − A, " : ""}dB re total 188–7080 Hz power${errTxt}</span>` +
    `<div class="table-wrap"><table class="damping bands"><thead><tr><th>${c.mode === "indiv" ? "Recording" : diff ? "Difference" : "Group"}` +
    `<span class="sub">band (Hz)</span></th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export { summariseGroups, approx };

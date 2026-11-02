// Plotly figures for the spectrum view (spectra on top, band-level panel below) and the
// note-level view. Port of build_plot() and build_note_plot() in R/server.R.

import { F_MIN, F_MAX, REF_FS, BAND_SETS, REGIONS } from "./config.js";
import { summariseGroups } from "./dsp.js";
import { errMult, welchMult } from "./stats.js";
import { seriesCols, rgba, DIFF_COL, autoFloor, xMid, pretty, plainBreaks, thinLabels } from "./format.js";
import { esc } from "./analysis.js";

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
// Traditional plotting colours: white background, neutral greys
const GRID = "#e5e5e5", AXIS = "#8c8c8c", TXT = "#262626", SUB = "#595959";
const BG = "#ffffff", LABEL = "#4d4d4d", ZERO = "#666666";
const REGION = (a) => `rgba(102,102,102,${a})`;
const SKIP = { hoverinfo: "skip", showlegend: false };

const finite = (v) => Number.isFinite(v);
const maxOf = (a) => a.reduce((m, v) => (finite(v) && v > m ? v : m), -Infinity);
const minOf = (a) => a.reduce((m, v) => (finite(v) && v < m ? v : m), Infinity);

// Rough number of legend rows for names at the given plot width
function legendRows(names, width) {
  if (!names.length) return 0;
  let rows = 1, x = 0;
  for (const n of names) {
    const w = 46 + 7 * n.length;
    if (x > 0 && x + w > width) { rows++; x = 0; }
    x += w;
  }
  return rows;
}

function xTicks(xr, lin, wide, notes) {
  const ratio = xr[1] / xr[0];
  if (!lin && ratio >= wide) {
    const keep = notes.filter(([v]) => v >= xr[0] && v <= xr[1]);
    return { tickvals: keep.map(([v]) => v), ticktext: keep.map(([, t]) => t) };
  }
  const pb = plainBreaks(xr, lin ? 8 : 7);
  return { tickvals: pb.breaks, ticktext: pb.labels };
}
const SPEC_NOTES = [[196, "196<br>(G3)"], [294, "294<br>(D4)"], [440, "440<br>(A4)"], [659, "659<br>(E5)"], [1000, "1k"],
  [1319, "1.3k<br>(E6)"], [2000, "2k"], [3000, "3k"], [4000, "4k"], [5274, "5.3k<br>(E8)"], [7000, "7k"]];
const NOTE_NOTES = [[196, "196<br>(G3)"], [294, "294<br>(D4)"], [440, "440<br>(A4)"], [659, "659<br>(E5)"], [880, "880<br>(A5)"],
  [1319, "1.3k<br>(E6)"], [1760, "1.8k<br>(A6)"]];

// Break text into lines of at most maxChars characters (at spaces), joined by <br>
function wrap(text, maxChars) {
  const out = [];
  for (const para of String(text).split("<br>")) {
    let line = "";
    for (const w of para.split(" ")) {
      const plain = (line + " " + w).replace(/<[^>]+>|&[a-z]+;/g, "x");
      if (line && plain.length > maxChars) { out.push(line); line = w; } else line = line ? line + " " + w : w;
    }
    out.push(line);
  }
  return { text: out.join("<br>"), lines: out.length };
}

// Title, subtitle and caption wrapped to the figure width, with the margins they need
function texts(width, title, subtitle, caption) {
  const t = wrap(title, Math.floor((width - 90) / 9.6));
  const s = wrap(subtitle || "", Math.floor((width - 90) / 6.6));
  const c = caption ? wrap(caption, Math.floor((width - 60) / 6.1)) : { text: "", lines: 0 };
  return { t, s, c, mt: 22 + 21 * t.lines + 16 * s.lines + 16, capPx: c.lines ? 15 * c.lines + 8 : 0 };
}

function baseLayout({ width, height, mt, mb, ml, mr, tx, legendY, captionY }) {
  const annotations = [];
  if (tx.c.lines) {
    annotations.push({ xref: "paper", yref: "paper", x: 1, y: captionY, xanchor: "right", yanchor: "top", showarrow: false,
      align: "right", text: tx.c.text, font: { size: 11.5, color: SUB } });
  }
  return {
    width, height, autosize: false,
    font: { family: FONT, size: 13, color: TXT },
    paper_bgcolor: BG, plot_bgcolor: BG,
    margin: { t: mt, b: mb, l: ml, r: mr, pad: 0 },
    title: { text: `<b>${tx.t.text}</b>`, subtitle: { text: tx.s.text, font: { size: 12.5, color: SUB } },
      x: 0, xref: "paper", xanchor: "left", y: 1 - 12 / height, yref: "container", yanchor: "top", font: { size: 17 } },
    showlegend: true,
    legend: { orientation: "h", x: 0.5, xanchor: "center", y: legendY, yanchor: "top", font: { size: 12.5 },
      traceorder: "normal", itemclick: false, itemdoubleclick: false },
    hovermode: false, dragmode: "zoom",
    annotations,
  };
}

const axisCommon = { showgrid: true, gridcolor: GRID, zeroline: false, showline: true, linecolor: AXIS, ticks: "outside",
  tickcolor: AXIS, ticklen: 4, fixedrange: true };

// ---- Spectrum view -----------------------------------------------------------------
// c: { a, mode, ci, showReg, bandSet, normIn, lin, xZoom, sel, fftSize, winType, expDb,
//      smooth, gateOn, gateDb, restricted }
export function spectrumFigure(c, { width, height }) {
  const { a, mode, ci, lin } = c;
  let xr = c.xZoom || [F_MIN, F_MAX];
  xr = [Math.max(F_MIN, xr[0]), Math.min(F_MAX, xr[1])];
  if (xr[1] / xr[0] < 1.03) xr = [F_MIN, F_MAX];
  const full = xr[0] === F_MIN && xr[1] === F_MAX;
  const grid = a.grid, vis = Array.from(grid, (f) => f >= xr[0] && f <= xr[1]);
  const visVals = (y) => Array.from(y).filter((_, i) => vis[i]);
  const errName = ci ? "approx. 95% CI" : "± 1 SE";
  const showDw = c.bandSet !== "none";
  const bset = BAND_SETS[showDw ? c.bandSet : "dw"];
  const bv = showDw && c.bandSet !== "dw" ? a.sets[c.bandSet] : a.bands;

  let series, bars, dataHi, dataLo, ttl, ylab, ylab2 = "Band level (dB)", cap = [];
  if (mode === "indiv") {
    const cols = seriesCols(a.names.length);
    series = a.names.map((n, i) => ({ name: n, y: a.mat[i], err: null, color: cols[i] }));
    bars = a.names.map((n, i) => ({ name: n, val: Array.from(bv[i]), err: Array.from(bv[i], () => NaN), color: cols[i] }));
    const all = series.flatMap((s) => visVals(s.y));
    dataHi = maxOf(all) + 5; dataLo = autoFloor(all);
    ttl = "Violin Acoustic Spectrum Multi-Layer Comparison";
    ylab = c.normIn ? "Level (dB re in-band power per Hz)" : "PSD (dBFS/Hz)";
  } else if (mode === "mean") {
    const gs = summariseGroups(a.mat, a.grp), bs = summariseGroups(bv, a.grp);
    const lv = [...gs.keys()], cols = seriesCols(lv.length);
    series = lv.map((g, i) => { const s = gs.get(g), m = errMult(s.n, ci); return { name: g, y: s.mean, err: s.se.map((v) => m * v), color: cols[i], n: s.n }; });
    bars = lv.map((g, i) => { const s = bs.get(g), m = errMult(s.n, ci); return { name: g, val: Array.from(s.mean), err: Array.from(s.se, (v) => m * v), color: cols[i] }; });
    const all = series.flatMap((s) => visVals(s.y));
    dataHi = maxOf(all) + 5; dataLo = autoFloor(all);
    ttl = `Group Mean Spectra (${errName} across replicates)`;
    ylab = c.normIn ? "Mean level (dB re in-band power per Hz)" : "Mean PSD (dBFS/Hz)";
    cap.push("n = " + series.map((s) => `${esc(s.name)}: ${s.n}`).join(", ") + (series.some((s) => s.n < 2) ? "  (no error band for n = 1)" : ""));
  } else {
    const gs = summariseGroups(a.mat, a.grp), bs = summariseGroups(bv, a.grp);
    const A = gs.get(c.sel.ref), B = gs.get(c.sel.cmp), bA = bs.get(c.sel.ref), bB = bs.get(c.sel.cmp);
    const y = B.mean.map((v, i) => v - A.mean[i]);
    const wm = welchMult(A.se, B.se, A.n, B.n, ci);
    const err = y.map((_, i) => wm[i] * Math.sqrt(A.se[i] ** 2 + B.se[i] ** 2));
    const bwm = welchMult(bA.se, bB.se, bA.n, bB.n, ci);
    series = [{ name: "B − A", y, err, color: DIFF_COL }];
    bars = [{ name: "B − A", val: Array.from(bB.mean, (v, i) => v - bA.mean[i]),
      err: Array.from(bA.se, (s, i) => bwm[i] * Math.sqrt(s ** 2 + bB.se[i] ** 2)), color: DIFF_COL }];
    let r = maxOf(Array.from(y, (v, i) => (vis[i] ? Math.abs(v) + (finite(err[i]) ? err[i] : 0) : NaN))) * 1.15;
    r = Math.max(r, 1);
    dataHi = r; dataLo = -r;
    ttl = `Spectral Difference: ${esc(c.sel.cmp)} − ${esc(c.sel.ref)}`;
    ylab = "Δ level (dB), B − A"; ylab2 = "Δ band (dB)";
    cap.push(`n(A) = ${A.n}, n(B) = ${B.n}` + (A.n < 2 || B.n < 2 ? "  (no error band: needs n ≥ 2 in both groups)" : `  |  error: ${errName}`));
  }
  if (!finite(dataHi) || !finite(dataLo)) { dataHi = 0; dataLo = -60; }

  const fsMs = 1000 * c.fftSize / REF_FS;
  const winTxt = c.winType === "exp" ? (c.expDb === 0 ? "Rectangular, taps," : `Exp. (${c.expDb} dB), taps,`) : "Hann";
  const subtitle = `${winTxt} ${fsMs.toFixed(0)} ms (${c.fftSize} @ 48 kHz, ${(REF_FS / c.fftSize).toFixed(1)} Hz bins); ` +
    (c.normIn ? "in-band norm." : "no normalization") +
    (Number(c.smooth) > 0 ? `; 1/${c.smooth}-oct smoothing` : "") +
    (c.winType !== "exp" && c.gateOn ? `; gate ${c.gateDb} dB` : "") +
    (c.restricted ? "; common pitch range only" : "");
  if (showDw) cap.push(`Lower panel: ${bset.name}, ${mode === "diff" ? "change in " : ""}dB re total 188–7080 Hz power` +
    (mode !== "indiv" ? `; whiskers ${errName}` : ""));
  const xlab = full ? (lin ? "Frequency (Hz, linear scale)" : "Frequency (Hz, musical reference notes on log scale)")
    : `Frequency (Hz, ${lin ? "linear" : "log"} scale) — zoomed to ${xr[0].toFixed(0)}–${xr[1].toFixed(0)} Hz`;

  // ---- pixel layout
  const legendNames = mode === "diff" ? [] : series.map((s) => s.name);
  const lRows = legendRows(legendNames, width - 120);
  const tx = texts(width, ttl, subtitle, cap.join("<br>"));
  const mt = tx.mt, ml = 72, mr = showDw ? 70 : 24;
  const mb = 62 + lRows * 21 + tx.capPx + 6;
  const plotH = height - mt - mb;
  const nSer = bars.length;
  const bandPx = Math.max(90, Math.round(0.22 * plotH)), labelPx = 20, rowsPx = 14 * nSer + 8, gapPx = 10;
  const lowerPx = labelPx + bandPx + rowsPx;

  const H = dataHi - dataLo;
  const yLo = dataLo - 0.02 * H, yHi = dataHi + 0.02 * H;
  const data = [];
  const XL = F_MIN / 2, XH = F_MAX * 2;        // beyond the visible range; the plot clips them

  // band panel geometry
  let rng = null, k = 1, br2 = [];
  const bc = bset.cfg.map((b) => ({ ...b }));
  if (showDw) {
    const v = bars.flatMap((b) => b.val.flatMap((x, i) => [x, x - b.err[i], x + b.err[i]]));
    if (mode === "diff") v.push(0);
    rng = [minOf(v), maxOf(v)];
    if (rng[1] - rng[0] < 6) { const m = (rng[0] + rng[1]) / 2; rng = [m - 3, m + 3]; }
    const d = rng[1] - rng[0]; rng = [rng[0] - 0.1 * d, rng[1] + 0.1 * d];
    k = (rng[1] - rng[0]) / bandPx;
    br2 = pretty(rng[0], rng[1], 4).filter((b) => b >= rng[0] && b <= rng[1]);
    const xw = (dec) => (lin ? dec / 1.6 * (xr[1] - xr[0]) : dec);
    bc.forEach((b) => {
      b.xLab = xMid(Math.max(b.xmin, xr[0]), Math.min(b.xmax, xr[1]), lin);
      b.xs = lin ? b.xmin + xw(0.005) : b.xmin * 1.012;
      b.xe = lin ? b.xmax - xw(0.005) : b.xmax / 1.012;
      b.on = b.xmax > xr[0] && b.xmin < xr[1];
    });
    const thin = thinLabels(bc.map((b) => b.xLab), bc.map(() => 1), xr, lin, 0.035);
    bc.forEach((b, i) => { b.txt = b.on && thin[i]; });

    // panel background, gridlines, region boundaries, zero line
    const y2 = { xaxis: "x", yaxis: "y2" };
    data.push({ ...SKIP, ...y2, type: "scatter", mode: "lines", x: [XL, XH, XH, XL, XL], y: [rng[0], rng[0], rng[1], rng[1], rng[0]],
      fill: "toself", fillcolor: "#f5f5f5", line: { color: "#cccccc", width: 0.8 } });
    data.push({ ...SKIP, ...y2, type: "scatter", mode: "lines", x: br2.flatMap(() => [XL, XH, null]), y: br2.flatMap((b) => [b, b, null]),
      line: { color: "#dedede", width: 0.8 } });
    data.push({ ...SKIP, ...y2, type: "scatter", mode: "lines", x: bc.slice(1).flatMap((b) => [b.xmin, b.xmin, null]),
      y: bc.slice(1).flatMap(() => [rng[0], rng[1], null]), line: { color: "#bfbfbf", width: 0.8, dash: "dot" } });
    if (mode === "diff") {
      data.push({ ...SKIP, ...y2, type: "scatter", mode: "lines", x: [XL, XH], y: [0, 0], line: { color: ZERO, width: 1, dash: "dash" } });
    }
    const off = (s) => (s + 1 - (nSer + 1) / 2) * 0.012;
    bars.forEach((b, s) => {
      data.push({ ...SKIP, ...y2, type: "scatter", mode: "lines", x: bc.flatMap((x) => [x.xs, x.xe, null]),
        y: b.val.flatMap((v) => [v, v, null]), line: { color: b.color, width: 4 } });
      if (b.err.some(finite)) {
        data.push({ ...SKIP, ...y2, type: "scatter", mode: "markers",
          x: bc.map((x) => (lin ? x.xLab + xw(off(s)) : x.xLab * Math.pow(10, off(s)))), y: b.val,
          marker: { size: 1, color: b.color, opacity: 0 },
          error_y: { type: "data", array: b.err.map((e) => (finite(e) ? e : NaN)), visible: true, color: b.color, thickness: 1.2, width: 4 } });
      }
    });
    // band names above the panel, values below it (one row per series)
    const shown = bc.filter((b) => b.txt);
    data.push({ ...SKIP, ...y2, type: "scatter", mode: "text", x: shown.map((b) => b.xLab), y: shown.map(() => rng[1] + labelPx * k * 0.5),
      text: shown.map((b) => `<b>${b.Label}</b>`), textfont: { size: 12.5, color: LABEL }, cliponaxis: false });
    bars.forEach((b, s) => {
      const idx = bc.map((x, i) => (x.txt ? i : -1)).filter((i) => i >= 0);
      data.push({ ...SKIP, ...y2, type: "scatter", mode: "text", x: idx.map((i) => bc[i].xLab), y: idx.map(() => rng[0] - k * (14 * s + 11)),
        text: idx.map((i) => (mode === "diff" ? (b.val[i] >= 0 ? "+" : "") + b.val[i].toFixed(1) : b.val[i].toFixed(1))),
        textfont: { size: c.bandSet === "bark" ? 10 : 11, color: b.color }, cliponaxis: false });
    });
  }

  // resonance regions (spectrum panel)
  if (c.showReg) {
    for (const r of REGIONS) {
      data.push({ ...SKIP, type: "scatter", mode: "lines", x: [r.xmin, r.xmax, r.xmax, r.xmin, r.xmin], y: [yLo, yLo, yHi, yHi, yLo],
        fill: "toself", fillcolor: REGION(r.alpha), line: { width: 0 } });
    }
  }
  if (mode === "diff") {
    data.push({ ...SKIP, type: "scatter", mode: "lines", x: [XL, XH], y: [0, 0], line: { color: ZERO, width: 1, dash: "dash" } });
  }
  // error ribbons, then curves
  for (const s of series) {
    if (!s.err) continue;
    const idx = [];
    for (let i = 0; i < grid.length; i++) if (finite(s.err[i]) && finite(s.y[i])) idx.push(i);
    if (!idx.length) continue;
    const x = idx.map((i) => grid[i]);
    data.push({ ...SKIP, type: "scatter", mode: "lines", x, y: idx.map((i) => s.y[i] - s.err[i]), line: { width: 0 } });
    data.push({ ...SKIP, type: "scatter", mode: "lines", x, y: idx.map((i) => s.y[i] + s.err[i]), line: { width: 0 },
      fill: "tonexty", fillcolor: rgba(s.color, 0.2) });
  }
  for (const s of series) {
    data.push({ type: "scatter", mode: "lines", name: esc(s.name), x: Array.from(grid), y: Array.from(s.y, (v) => (finite(v) ? v : null)),
      line: { color: s.color, width: 1.3 }, hoverinfo: "skip", showlegend: mode !== "diff" });
  }
  // region names
  if (c.showReg) {
    const rx = REGIONS.map((r) => xMid(r.xmin, r.xmax, lin));
    const keep = thinLabels(rx, REGIONS.map((r) => r.row), xr, lin);
    const idx = REGIONS.map((_, i) => i).filter((i) => keep[i]);
    data.push({ ...SKIP, type: "scatter", mode: "text", x: idx.map((i) => rx[i]),
      y: idx.map((i) => dataHi - (yHi - yLo) * (REGIONS[i].row === 1 ? 0.03 : 0.07)),
      text: idx.map((i) => (REGIONS[i].italic ? `<i>${REGIONS[i].label}</i>` : REGIONS[i].label)),
      textfont: { size: 12, color: LABEL } });
  }

  const xt = xTicks(xr, lin, 4, SPEC_NOTES);
  const ax = (v) => (lin ? v : Math.log10(v));
  const layout = baseLayout({ width, height, mt, mb, ml, mr, tx, legendY: -62 / plotH, captionY: -(62 + lRows * 21 + 4) / plotH });
  layout.xaxis = { ...axisCommon, fixedrange: false, type: lin ? "linear" : "log", range: [ax(xr[0]), ax(xr[1])],
    tickvals: xt.tickvals, ticktext: xt.ticktext, tickmode: "array", anchor: showDw ? "y2" : "y",
    title: { text: xlab, standoff: 8 }, tickfont: { size: 11.5 } };
  const br1 = pretty(dataLo, dataHi).filter((b) => b >= dataLo && b <= dataHi);
  layout.yaxis = { ...axisCommon, domain: showDw ? [(lowerPx + gapPx) / plotH, 1] : [0, 1], range: [yLo, yHi],
    tickvals: br1, tickmode: "array", title: { text: ylab, standoff: 6 } };
  if (showDw) {
    layout.yaxis2 = { ...axisCommon, showgrid: false, domain: [0, lowerPx / plotH], anchor: "x", side: "right",
      range: [rng[0] - rowsPx * k, rng[1] + labelPx * k], tickvals: br2, tickmode: "array",
      title: { text: ylab2, standoff: 6, font: { size: 12 } }, showline: false };
  }
  return { data, layout, xr };
}

// ---- Note-level view ---------------------------------------------------------------
// c: { mode, ci, glis, normIn, lin, xZoom, showReg, restricted, sel, nd, ng, ndiff }
export function noteFigure(c, { width, height }) {
  const { mode, ci, glis, lin } = c;
  const errName = ci ? "approx. 95% CI" : "± 1 SE";
  const unit = c.normIn ? "dB re file mean" : "dBFS";
  let pd, lv, ttl, ylab, cap = null;
  if (mode === "indiv") {
    lv = [...new Set(c.nd.map((r) => r.Series))];
    pd = c.nd.map((r) => ({ f: r.f, y: r.lvl, s: r.Series, lo: NaN, hi: NaN }));
    ttl = glis ? "Glissando Level vs Pitch" : "Note Levels";
    ylab = `${glis ? "Level, 1/24-octave pitch bins" : "Note level"} (${unit})`;
  } else if (mode === "mean") {
    lv = [...new Set(c.nd.map((r) => r.Group))];
    pd = c.ng.map((g) => { const m = errMult(g.n, ci); return { f: g.f, y: g.lvl, s: g.Group, lo: g.lvl - m * g.se, hi: g.lvl + m * g.se }; });
    ttl = `${glis ? "Glissando Level vs Pitch" : "Note Levels"}, group means (${errName})`;
    ylab = `Mean ${glis ? "level" : "note level"} (${unit})`;
    cap = "Group means pool each note (or pitch bin) across the files of a group; error bars need at least two files.";
  } else {
    lv = ["diff"];
    // Welch multipliers use each note's own group sizes
    pd = c.ndiff.map((r) => {
      const se = Math.sqrt(r.seA ** 2 + r.seB ** 2);
      const m = welchMult([r.seA], [r.seB], r.nA, r.nB, ci)[0];
      return { f: r.f, y: r.d, s: "diff", lo: r.d - m * se, hi: r.d + m * se };
    });
    ttl = `${glis ? "Glissando Level Difference: " : "Note-Level Difference: "}${esc(c.sel.cmp)} − ${esc(c.sel.ref)}`;
    ylab = "Δ level (dB), B − A";
    cap = `Frequency-matched: B’s curve is read at A’s ${glis ? "pitch bins" : "note frequencies"}, so tuning differences do not misalign notes. Error bars: ${errName}.`;
  }
  pd.sort((p, q) => (lv.indexOf(p.s) - lv.indexOf(q.s)) || (p.f - q.f));
  const fs = pd.map((r) => r.f);
  const full = [Math.max(150, Math.min(...fs) / 1.08), Math.min(2500, Math.max(...fs) * 1.08)];
  let xr = c.xZoom || full;
  if (xr[1] / xr[0] < 1.03) xr = full;
  const vis = pd.filter((r) => r.f >= xr[0] && r.f <= xr[1]);
  let yy = vis.flatMap((r) => [r.y, r.lo, r.hi]).filter(finite);
  if (!yy.length) yy = pd.map((r) => r.y).filter(finite);
  let ylim = [Math.min(...yy) - 3, Math.max(...yy) + 3];
  if (mode === "diff") { const m = Math.max(Math.abs(ylim[0]), Math.abs(ylim[1]), 3); ylim = [-m, m]; }
  const ex = 0.05 * (ylim[1] - ylim[0]);
  const yLo = ylim[0] - ex, yHi = ylim[1] + ex;

  const subtitle = (glis ? "Levels of the glissando in 1/24-octave pitch bins" : "Each point is one held note at its measured (played) frequency") +
    (c.restricted ? "; common pitch range only" : "");
  const xlab = !c.xZoom ? (lin ? "Played frequency (Hz, linear scale)" : "Played frequency (Hz, log scale; open-string notes and octaves marked)")
    : `Played frequency (Hz, ${lin ? "linear" : "log"} scale) — zoomed to ${xr[0].toFixed(0)}–${xr[1].toFixed(0)} Hz`;

  const data = [];
  if (c.showReg) {
    const rg = REGIONS.filter((r) => r.xmax < 2500);
    for (const r of rg) {
      data.push({ ...SKIP, type: "scatter", mode: "lines", x: [r.xmin, r.xmax, r.xmax, r.xmin, r.xmin], y: [yLo, yLo, yHi, yHi, yLo],
        fill: "toself", fillcolor: REGION(r.alpha), line: { width: 0 } });
    }
    const rx = rg.map((r) => xMid(r.xmin, r.xmax, lin)), keep = thinLabels(rx, rg.map((r) => r.row), xr, lin);
    const idx = rg.map((_, i) => i).filter((i) => keep[i]);
    data.push({ ...SKIP, type: "scatter", mode: "text", x: idx.map((i) => rx[i]),
      y: idx.map((i) => ylim[1] - (ylim[1] - ylim[0]) * (rg[i].row === 1 ? 0.03 : 0.08)),
      text: idx.map((i) => (rg[i].italic ? `<i>${rg[i].label}</i>` : rg[i].label)), textfont: { size: 12, color: LABEL } });
  }
  const XL = 50, XH = 5000;
  if (mode === "diff") data.push({ ...SKIP, type: "scatter", mode: "lines", x: [XL, XH], y: [0, 0], line: { color: ZERO, width: 1, dash: "dash" } });
  const cols = mode === "diff" ? [DIFF_COL] : seriesCols(lv.length);
  lv.forEach((s, i) => {
    const r = pd.filter((p) => p.s === s), col = cols[i];
    data.push({ type: "scatter", mode: "lines+markers", name: esc(s), x: r.map((p) => p.f), y: r.map((p) => p.y),
      line: { color: col, width: 1.2 }, marker: { color: col, size: 6 }, hoverinfo: "skip", showlegend: mode !== "diff",
      error_y: { type: "data", symmetric: false, array: r.map((p) => p.hi - p.y), arrayminus: r.map((p) => p.y - p.lo),
        visible: true, color: rgba(col, 0.7), thickness: 1.1, width: 3 } });
  });

  const lRows = legendRows(mode === "diff" ? [] : lv, width - 120);
  const tx = texts(width, ttl, subtitle, cap);
  const mt = tx.mt, ml = 72, mr = 24;
  const mb = 62 + lRows * 21 + tx.capPx + 6;
  const plotH = height - mt - mb;
  const xt = xTicks(xr, lin, 3, NOTE_NOTES);
  const ax = (v) => (lin ? v : Math.log10(v));
  const layout = baseLayout({ width, height, mt, mb, ml, mr, tx, legendY: -62 / plotH, captionY: -(62 + lRows * 21 + 4) / plotH });
  layout.xaxis = { ...axisCommon, fixedrange: false, type: lin ? "linear" : "log", range: [ax(xr[0]), ax(xr[1])],
    tickvals: xt.tickvals, ticktext: xt.ticktext, tickmode: "array", title: { text: xlab, standoff: 8 }, tickfont: { size: 11.5 } };
  layout.yaxis = { ...axisCommon, range: [yLo, yHi], title: { text: ylab, standoff: 6 } };
  return { data, layout, xr };
}

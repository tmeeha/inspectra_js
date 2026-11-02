// Application controller: state, controls, file loading and playback, the analysis
// pipeline with progress, plot rendering, zoom and cursor readout, info boxes, exports.

import {
  MAX_FILES, MAX_FILE_MB, MAX_TOTAL_MB, F_MIN, F_MAX, B12, BAND_SETS, ZONE_NAMES, REC_DEFAULTS, REC_LABELS, ANALYSIS_FIXED,
  DEFAULT_FFT, FFT_CHOICES, SMOOTH_CHOICES, EXAMPLE_DIR, EXAMPLE_SETS, zonesCfg,
} from "./config.js";
import { readWav, isRiffWave } from "./wav.js";
import {
  ValidationError, need, esc, makeUnique, defaultGroup, suggestType, trackOf, isGlissandoSet, commonInfo, rawSpectra, processSpectra,
  activeSet, noteData, noteGroups, noteDiff, pitchBox, dampingRows, dampingBox, bandBox, summariseGroups, approx,
} from "./analysis.js";
import { spectrumFigure, noteFigure } from "./plot.js";
import { noteName, noteShort, seriesCols, DIFF_COL, readSecs, safeCsvText } from "./format.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// ---- State ---------------------------------------------------------------------
const DEFAULTS = {
  rec_type: "bowed", smooth: "12", gate_on: true, gate_db: -40, exp_db: -40, trig_db: -20, skip_clipped: true,
  restrict_pitch: false, fft_size: DEFAULT_FFT, norm_mode: "inband", view: "spec", plot_mode: "indiv", err_type: "se",
  band_set: "zones", x_scale: "log", file_type: "png",
};
const S = {
  ...DEFAULTS,
  files: [], load: 0, visible: [], groups: {}, ref: null, cmp: null, xZoom: null, cursorF: null,
};
const cache = { rawKey: null, raw: null, procKey: null, proc: null, shownMsgs: new Set() };
let last = null;            // what is currently drawn (for readout and exports)

const played = () => S.rec_type !== "impact";
const view = () => (played() ? S.view : "spec");
const groupOf = (name) => {
  const g = (S.groups[name] ?? "").trim();
  return g.length ? g : defaultGroup(S.files.find((f) => f.name === name)?.origName ?? name);
};
const groupsVisible = () => [...new Set(S.files.filter((f) => S.visible.includes(f.name)).map((f) => groupOf(f.name)))];
const settingsSt = () => (played()
  ? { type: "hann", gate_on: S.gate_on, gate_db: S.gate_on ? S.gate_db : -40 }
  : { type: "exp", end_db: S.exp_db, trig_db: S.trig_db, skip_clipped: S.skip_clipped });

// ---- Notifications ---------------------------------------------------------------
function toast(text, type = "message", minSecs = 8, html = false) {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  const body = document.createElement("div");
  if (html) body.innerHTML = text; else body.textContent = text;
  const close = document.createElement("button");
  close.type = "button"; close.setAttribute("aria-label", "Close"); close.textContent = "×";
  close.onclick = () => el.remove();
  el.append(body, close);
  $("#toasts").append(el);
  setTimeout(() => el.remove(), 1000 * readSecs(text, minSecs));
}

// ---- Controls --------------------------------------------------------------------
const SELECTS = ["fft_size", "smooth", "band_set"];
const CHECKS = ["restrict_pitch", "gate_on", "skip_clipped"];
const RANGES = ["gate_db", "exp_db", "trig_db"];

function syncControls() {
  SELECTS.forEach((id) => { $("#" + id).value = S[id]; });
  CHECKS.forEach((id) => { $("#" + id).checked = S[id]; });
  RANGES.forEach((id) => { $("#" + id).value = S[id]; $(`output[for="${id}"]`).textContent = S[id]; });
  $$(`input[name="norm_mode"]`).forEach((r) => { r.checked = r.value === S.norm_mode; });
  $$(".segmented").forEach((seg) => {
    const v = S[seg.dataset.name];
    seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.value === v)));
  });
  const show = { played: played(), impact: !played(), gate: S.gate_on, groups: S.plot_mode !== "indiv", diff: S.plot_mode === "diff" };
  $$("[data-show]").forEach((el) => { el.hidden = !show[el.dataset.show]; });
  $("#rec_type_help").textContent = {
    bowed: "Glissandi (preferred), scales, semitones or musical passages. Hann window, quiet-frame gate, 1/12-octave smoothing, pitch tracking and a tuning check; glissandi are recognised automatically.",
    impact: "Taps on the bridge. Exponential window on each detected tap, 1/24-octave smoothing and a mode-damping table (A0, B1−, B1+).",
  }[S.rec_type];
  $("#settings_summary").textContent = settingsSummary();
}

function settingsSummary() {
  const d = REC_DEFAULTS[S.rec_type];
  const parts = [`${S.fft_size} pts`, S.norm_mode === "inband" ? "in-band norm." : "no normalization",
    S.smooth === "0" ? "no smoothing" : `1/${S.smooth} oct`];
  let changed;
  if (!played()) {
    parts.push(`exp. ${S.exp_db} dB, trigger ${S.trig_db} dB${S.skip_clipped ? ", skip clipped" : ""}`);
    changed = S.smooth !== d.smooth || S.exp_db !== ANALYSIS_FIXED.exp_db || S.trig_db !== ANALYSIS_FIXED.trig_db || !S.skip_clipped;
  } else {
    parts.push(S.gate_on ? `gate ${S.gate_db} dB` : "no gate");
    if (S.restrict_pitch) parts.push("common pitch range");
    changed = S.smooth !== d.smooth || S.gate_on !== d.gate || (S.gate_on && S.gate_db !== ANALYSIS_FIXED.gate_db) || S.restrict_pitch;
  }
  changed = changed || S.fft_size !== ANALYSIS_FIXED.fft_size || S.norm_mode !== ANALYSIS_FIXED.norm_mode;
  return parts.join(" · ") + (changed ? "  (modified)" : "  (defaults)");
}

function bindControls() {
  SELECTS.forEach((id) => $("#" + id).addEventListener("change", (e) => {
    let v = e.target.value;
    if (id === "fft_size" && !FFT_CHOICES.includes(v)) v = DEFAULT_FFT;
    if (id === "smooth" && !SMOOTH_CHOICES.includes(v)) v = REC_DEFAULTS[S.rec_type].smooth;
    S[id] = v;
    refresh();
  }));
  CHECKS.forEach((id) => $("#" + id).addEventListener("change", (e) => { S[id] = e.target.checked; refresh(); }));
  RANGES.forEach((id) => {
    const el = $("#" + id);
    el.addEventListener("input", () => { $(`output[for="${id}"]`).textContent = el.value; });
    el.addEventListener("change", () => { S[id] = Number(el.value); refresh(); });
  });
  $$(`input[name="norm_mode"]`).forEach((r) => r.addEventListener("change", () => { S.norm_mode = r.value; refresh(); }));
  $$(".segmented").forEach((seg) => seg.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const name = seg.dataset.name;
    if (S[name] === b.value) return;
    S[name] = b.value;
    if (name === "view") S.xZoom = null;
    if (name === "rec_type") {
      S.smooth = REC_DEFAULTS[b.value].smooth; S.gate_on = REC_DEFAULTS[b.value].gate;
      if (!played()) S.view = "spec";
      S.xZoom = null;
    }
    if (name === "file_type") { syncControls(); return; }
    refresh();
  }));
  $("#reset_settings").addEventListener("click", (e) => {
    e.preventDefault();
    const d = REC_DEFAULTS[S.rec_type];
    Object.assign(S, { smooth: d.smooth, gate_on: d.gate, fft_size: ANALYSIS_FIXED.fft_size, norm_mode: ANALYSIS_FIXED.norm_mode,
      gate_db: ANALYSIS_FIXED.gate_db, exp_db: ANALYSIS_FIXED.exp_db, trig_db: ANALYSIS_FIXED.trig_db,
      skip_clipped: ANALYSIS_FIXED.skip_clipped, restrict_pitch: false });
    refresh();
  });
  $("#ref_grp").addEventListener("change", (e) => { S.ref = e.target.value; refresh(); });
  $("#cmp_grp").addEventListener("change", (e) => { S.cmp = e.target.value; refresh(); });
  $("#reset_zoom").addEventListener("click", () => { S.xZoom = null; refresh(); });
  $("#download_plot").addEventListener("click", exportChart);
  $("#download_csv").addEventListener("click", exportCsv);
}

// ---- Files -----------------------------------------------------------------------
const player = new Audio();
let playingBtn = null;
const PLAY_SVG = '<svg viewBox="0 0 12 12"><path d="M3 1.5v9l7.5-4.5z" fill="currentColor"/></svg>';
const STOP_SVG = '<svg viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8" rx="1" fill="currentColor"/></svg>';
function showPlaying(btn, on) {
  if (!btn) return;
  btn.innerHTML = on ? STOP_SVG : PLAY_SVG;
  btn.title = on ? "Stop" : "Play";
}
function stopPlayback() { player.pause(); showPlaying(playingBtn, false); playingBtn = null; }
player.addEventListener("ended", stopPlayback);
player.addEventListener("error", () => {
  if (playingBtn) { stopPlayback(); toast("This file cannot be played by the browser.", "warning"); }
});

// Checks a set of files against the limits before any of it is read: [{ name, size }]
const MB = 1024 * 1024;
function withinLimits(items) {
  if (items.length > MAX_FILES) {
    toast(`Please open no more than ${MAX_FILES} files at a time.`, "error"); return false;
  }
  if (items.some((f) => f.size > MAX_FILE_MB * MB)) {
    toast(`Each file must be no larger than ${MAX_FILE_MB} MB.`, "error"); return false;
  }
  const total = items.reduce((s, f) => s + f.size, 0);
  if (total > MAX_TOTAL_MB * MB) {
    toast(`The files together must be no larger than ${MAX_TOTAL_MB} MB (these are ${Math.round(total / MB)} MB).`, "error");
    return false;
  }
  return true;
}

let loading = false;
async function loadFiles(items, isExample = false) {
  // items: [{ name, size, blob }] (a File, or a fetched Blob) or [{ name, size, buf }]
  if (loading) { toast("Still opening the previous files; try again in a moment.", "warning"); return; }
  if (!withinLimits(items)) return;
  stopPlayback();
  // one file at a time, so at most one undecoded file is in memory
  const decoded = [], bad = [];
  loading = true;
  try {
    for (const [i, it] of items.entries()) {
      if (!/\.wav$/i.test(it.name)) { bad.push(it.name); continue; }
      setBusy(`Reading ${it.name} (${i + 1} of ${items.length})…`);
      await frame();
      let buf;
      try { buf = it.buf || await it.blob.arrayBuffer(); } catch (e) { bad.push(it.name); continue; }
      if (!isRiffWave(buf)) { bad.push(it.name); continue; }
      let audio = null, error = null;
      try { audio = readWav(buf); } catch (e) { error = e.message; }
      // a File is played from disk; only fetched or test files keep a copy in memory
      decoded.push({ origName: it.name, size: it.size, audio, error, blob: it.blob || new Blob([buf], { type: "audio/wav" }) });
    }
  } finally {
    loading = false;
    setBusy(null);
  }
  if (bad.length) {
    toast(`Skipped ${bad.length === 1 ? "a file that is" : bad.length + " files that are"} not a RIFF/WAVE .wav file: ` +
      bad.join(", "), "warning");
  }
  if (!decoded.length) return;

  S.files.forEach((f) => URL.revokeObjectURL(f.url));
  const names = makeUnique(decoded.map((f) => f.origName.replace(/\\/g, "/").split("/").pop()));
  S.files = decoded.map((f, i) => ({ name: names[i], origName: f.origName, size: f.size, audio: f.audio, error: f.error,
    track: null, url: URL.createObjectURL(f.blob) }));
  S.load++;
  cache.shownMsgs = new Set();

  // recording type from the file names; every new set starts from the defaults
  const { suggested, found } = suggestType(decoded.map((f) => f.origName));
  const target = suggested || "bowed";
  const changedType = target !== S.rec_type;
  const keepFormat = S.file_type;
  Object.assign(S, DEFAULTS, { rec_type: target, smooth: REC_DEFAULTS[target].smooth, gate_on: REC_DEFAULTS[target].gate,
    file_type: keepFormat });
  S.visible = S.files.map((f) => f.name);
  S.groups = {}; S.ref = null; S.cmp = null; S.xZoom = null; S.cursorF = null;

  if (isExample) {
    toast(isExample === "glis"
      ? "Loaded 4 example glissandi (violin 6, two before and two after an adjustment). Try Compare → Group mean, then Difference (B − A)."
      : `Loaded the example recording (${EXAMPLE_SETS[isExample].label}, violin 6).`);
  } else if (suggested && changedType) {
    toast(`Recording type set to “${REC_LABELS[suggested]}” from the file names; change it if that is wrong.`);
  } else if (!suggested && changedType && found.length <= 1) {
    toast(`Recording type reset to “${REC_LABELS.bowed}”. The file names do not show the type; choose it above if that is wrong.`, "warning");
  } else if (found.length > 1) {
    toast("The file names suggest both bowed and tap recordings. All files are analysed with one recording type, " +
      "so load one type at a time for meaningful results.", "warning", 12);
  }
  renderFileList();
  renderGroupInputs();
  $("#welcome").hidden = true;
  $("#plot-wrap").hidden = false; $("#toolbar").hidden = false; $("#plot-help").hidden = false;
  $("#layers-field").hidden = false;
  if (!$("#page-readme").hidden) showTab("analyzer");     // files dropped while reading the Read Me
  refresh();
}

const fileItems = (fileList) => [...fileList].map((f) => ({ name: f.name, size: f.size, blob: f }));

async function loadExample(set) {
  const ex = EXAMPLE_SETS[set];
  setBusy("Loading example recordings…");
  try {
    const items = await Promise.all(ex.files.map(async (name) => {
      const r = await fetch(`${EXAMPLE_DIR}/${name}`);
      if (!r.ok) throw new Error(r.statusText);
      const blob = await r.blob();
      return { name, size: blob.size, blob };
    }));
    setBusy(null);
    await loadFiles(items, set);
  } catch (e) {
    setBusy(null);
    toast("The example recordings could not be loaded" + (location.protocol === "file:" ? " (open the app through a web server, not as a local file)." : "."), "error");
  }
}

function renderFileList() {
  const box = $("#file_toggles");
  box.textContent = "";
  for (const f of S.files) {
    const row = document.createElement("div");
    row.className = "layer";
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "play-btn"; btn.innerHTML = PLAY_SVG; btn.title = "Play";
    btn.setAttribute("aria-label", `Play ${f.name}`);
    btn.onclick = () => {
      const same = playingBtn === btn;
      stopPlayback();
      if (same) return;
      playingBtn = btn; showPlaying(btn, true);
      player.src = f.url;
      player.play().catch((err) => { if (playingBtn === btn && err.name !== "AbortError") stopPlayback(); });
    };
    const lab = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.checked = S.visible.includes(f.name);
    cb.onchange = () => {
      S.visible = S.files.map((x) => x.name).filter((n) => (n === f.name ? cb.checked : S.visible.includes(n)));
      refresh();
    };
    const span = document.createElement("span");
    span.textContent = f.name; span.title = f.name + (f.error ? ` (could not be read: ${f.error})` : "");
    if (f.error) span.style.textDecoration = "line-through";
    lab.append(cb, span);
    row.append(btn, lab);
    box.append(row);
  }
}

let groupTimer = null;
function renderGroupInputs() {
  const box = $("#group_inputs");
  box.textContent = "";
  for (const f of S.files) {
    const lab = document.createElement("label");
    const span = document.createElement("span");
    span.textContent = f.name;
    const inp = document.createElement("input");
    inp.type = "text"; inp.value = defaultGroup(f.origName); inp.spellcheck = false;
    inp.oninput = () => {
      S.groups[f.name] = inp.value;
      clearTimeout(groupTimer);
      groupTimer = setTimeout(refresh, 350);
    };
    lab.append(span, inp);
    box.append(lab);
  }
}

function updateAB() {
  const g = groupsVisible();
  if (!g.length) return;
  if (!g.includes(S.ref)) S.ref = g[0];
  if (!g.includes(S.cmp)) S.cmp = g[Math.min(1, g.length - 1)];
  for (const [id, v] of [["#ref_grp", S.ref], ["#cmp_grp", S.cmp]]) {
    const sel = $(id);
    sel.textContent = "";
    for (const name of g) { const o = document.createElement("option"); o.value = o.textContent = name; sel.append(o); }
    sel.value = v;
  }
}

// ---- Busy indicator ---------------------------------------------------------------
function setBusy(text) {
  $("#busy").hidden = !text;
  if (text) $("#busy-text").textContent = text;
}
const frame = () => new Promise((r) => setTimeout(r, 0));
class Cancelled extends Error {}

// ---- Pipeline --------------------------------------------------------------------
let gen = 0;
async function refresh() {
  const my = ++gen;
  syncControls();
  if (!S.files.length) return;
  updateAB();
  try {
    const R = await compute(my);
    if (my !== gen) return;
    render(R);
  } catch (e) {
    if (e instanceof Cancelled) return;
    if (my !== gen) return;
    showPlotMessage(e instanceof ValidationError ? e.message : "Something went wrong: " + e.message);
    if (!(e instanceof ValidationError)) console.error(e);
  } finally {
    if (my === gen) setBusy(null);
  }
}

async function compute(my) {
  const check = async (text) => { setBusy(text); await frame(); if (my !== gen) throw new Cancelled(); };
  const isPlayed = played();
  let tracks = null;
  if (isPlayed) {
    tracks = new Map();
    for (const f of S.files) {
      if (!f.audio) continue;
      if (!f.track) await check(`Tracking pitch: ${f.name}`);
      tracks.set(f.name, trackOf(f));
    }
  }
  const glis = isPlayed && isGlissandoSet(S.files, tracks);
  const ci = isPlayed && S.restrict_pitch ? commonInfo(tracks, S.visible) : null;
  const rng = ci ? ci.rng : null;
  const fftSize = Number(S.fft_size), st = settingsSt();
  const rawKey = JSON.stringify([S.load, fftSize, st, rng]);
  if (cache.rawKey !== rawKey) {
    const res = await rawSpectra(S.files, { fftSize, st, rng, tracks }, (i, name) => check(`Computing spectra: ${name}`));
    cache.rawKey = rawKey; cache.raw = res; cache.procKey = null;
    for (const m of res.msgs) {
      if (cache.shownMsgs.has(m.text)) continue;
      cache.shownMsgs.add(m.text);
      toast(m.text, m.type, m.duration, m.html);
    }
  }
  const procKey = rawKey + S.smooth + S.norm_mode;
  if (cache.procKey !== procKey) {
    cache.proc = null;
    cache.procKey = procKey;
    try { cache.proc = processSpectra(cache.raw.spec, fftSize, S.smooth, S.norm_mode === "inband"); } catch (e) { cache.procErr = e; }
  }
  if (!cache.proc) throw cache.procErr;
  return { tracks, glis, ci, rng, raw: cache.raw.spec, proc: cache.proc };
}

function plotSize() {
  const el = $("#plot");
  return { width: Math.max(320, el.clientWidth || 900), height: el.clientHeight || 700 };
}

function showPlotMessage(msg) {
  const m = $("#plot-message");
  m.textContent = msg; m.hidden = false;
  $("#cursor").hidden = true;
  $("#cursor_readout").textContent = "";
  $("#tuning_note").hidden = true; $("#damping_box").hidden = true; $("#band_box").hidden = true;
  last = null;
}

const PLOT_CONFIG = { displayModeBar: false, responsive: false, doubleClick: false, scrollZoom: false, showTips: false };

function buildContext(R) {
  const a = activeSet(R.proc, S.visible, groupOf);
  let sel = null;
  if (S.plot_mode === "diff") {
    need(S.ref && S.cmp, "Choose groups A and B.");
    need(a.grp.includes(S.ref) && a.grp.includes(S.cmp), "Selected groups have no visible files.");
    need(S.ref !== S.cmp, "Choose two different groups for A and B.");
    sel = { ref: S.ref, cmp: S.cmp };
  }
  const restricted = played() && S.restrict_pitch && !!R.rng;
  const ctx = { R, a, sel, view: view(), mode: S.plot_mode, ci: S.err_type === "ci", lin: S.x_scale === "lin",
    normIn: S.norm_mode === "inband", showReg: true, xZoom: S.xZoom, restricted };
  if (ctx.view === "notes") {
    ctx.glis = R.glis;
    ctx.nd = noteData(R.tracks, a, S.restrict_pitch ? R.rng : null, ctx.normIn, R.glis);
    ctx.ng = noteGroups(ctx.nd);
    if (ctx.mode === "diff") ctx.ndiff = noteDiff(ctx.ng, sel.ref, sel.cmp);
  } else {
    Object.assign(ctx, { bandSet: S.band_set, fftSize: R.proc.fftSize, winType: played() ? "hann" : "exp", expDb: S.exp_db,
      smooth: S.smooth, gateOn: S.gate_on, gateDb: S.gate_db });
  }
  return ctx;
}
const figureFor = (ctx, size) => (ctx.view === "notes" ? noteFigure(ctx, size) : spectrumFigure(ctx, size));

function render(R) {
  const ctx = buildContext(R);
  const fig = figureFor(ctx, plotSize());
  ctx.xr = fig.xr;
  $("#plot-message").hidden = true;
  const gd = $("#plot");
  Plotly.react(gd, fig.data, fig.layout, PLOT_CONFIG);
  if (!gd.dataset.bound) { gd.dataset.bound = "1"; gd.on("plotly_relayout", onRelayout); }
  last = ctx;
  renderReadout();
  // pitch box (played recordings)
  const tn = $("#tuning_note");
  const pb = played() ? pitchBox({ tracks: R.tracks, a: ctx.a, glis: R.glis, restrict: S.restrict_pitch,
    ci: R.ci, raw: R.raw }) : null;
  tn.hidden = !pb;
  if (pb) { tn.innerHTML = pb.html; tn.classList.toggle("warn", pb.warn); }
  // band summary table (bowed strings)
  const bb = $("#band_box");
  const bhtml = played() ? bandBox({ a: ctx.a, mode: ctx.mode, ci: ctx.ci, bandSet: S.band_set, sel: ctx.sel }) : "";
  bb.hidden = !bhtml;
  if (bhtml) bb.innerHTML = bhtml;
  // damping table (taps)
  const db = $("#damping_box");
  const html = !played() ? dampingBox(dampingRows(ctx.a, R.raw, S.exp_db), S.exp_db) : "";
  db.hidden = !html;
  if (html) db.innerHTML = html;
}

// ---- Zoom and cursor --------------------------------------------------------------
function plotGeometry() {
  const gd = $("#plot");
  const fl = gd._fullLayout;
  if (!fl || !fl.xaxis) return null;
  const xa = fl.xaxis, sz = fl._size;
  return { xa, sz, log: xa.type === "log", r: xa.range };
}
function pxToFreq(clientX) {
  const g = plotGeometry();
  if (!g) return null;
  const rect = $("#plot").getBoundingClientRect();
  const frac = (clientX - rect.left - g.sz.l) / g.sz.w;
  if (frac < 0 || frac > 1) return null;
  const v = g.r[0] + frac * (g.r[1] - g.r[0]);
  return { f: g.log ? Math.pow(10, v) : v, x: clientX - rect.left, g };
}
function onPointer(e) {
  if (!last) return;
  const p = pxToFreq(e.clientX);
  const cur = $("#cursor");
  if (!p) { cur.hidden = true; return; }
  cur.hidden = false;
  cur.style.left = `${p.x}px`; cur.style.top = `${p.g.sz.t}px`; cur.style.height = `${p.g.sz.h}px`;
  S.cursorF = p.f;
  renderReadout();
}

function bindPlot() {
  const gd = $("#plot");
  gd.addEventListener("mousemove", onPointer);
  gd.addEventListener("click", onPointer);
  gd.addEventListener("mouseleave", () => { $("#cursor").hidden = true; });
  gd.addEventListener("dblclick", () => { S.xZoom = null; refresh(); });
}
function onRelayout(ev) {
  const r0 = ev["xaxis.range[0]"], r1 = ev["xaxis.range[1]"];
  if (r0 === undefined || r1 === undefined || !last) return;
  const log = S.x_scale !== "lin";
  let lo = log ? Math.pow(10, r0) : r0, hi = log ? Math.pow(10, r1) : r1;
  lo = Math.max(100, lo); hi = Math.min(8000, hi);
  if (Number.isFinite(lo) && Number.isFinite(hi) && hi / lo > 1.03) S.xZoom = [lo, hi];
  refresh();
}

function renderReadout() {
  const out = $("#cursor_readout");
  const f = S.cursorF;
  if (!last || f == null || !Number.isFinite(f)) { out.textContent = ""; return; }
  // frequency, note and band as fixed-colour labels; then one entry per curve with a
  // colour swatch, its name and its level
  const head = (hz, band) => `<span class="ro-freq">${hz} Hz</span><span class="ro-note">${noteName(f)}</span>` +
    (band ? `<span class="ro-band">${esc(band)}</span>` : "");
  const fmtVals = (names, v, fmt, cols) => `<span class="ro-vals">` + names.map((n, i) =>
    `<span class="ro-val"><i style="background:${cols[i]}"></i>${esc(n)} <b>${
      Number.isFinite(v[i]) ? fmt(v[i]) + " dB" : "—"}</b></span>`).join("") + "</span>";
  const f1 = (v) => v.toFixed(1), fs = (v) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(1);
  const mode = last.mode;
  if (last.view === "notes") {
    const at = (rows, key) => {
      const r = rows.slice().sort((p, q) => p.f - q.f).filter((x) => Number.isFinite(x[key]));
      if (r.length < 2 || f < r[0].f || f > r[r.length - 1].f) return NaN;
      return approx(r.map((x) => Math.log(x.f)), r.map((x) => x[key]), [Math.log(f)])[0];
    };
    let names, v, fmt = f1;
    if (mode === "indiv") {
      names = [...new Set(last.nd.map((r) => r.Series))];
      v = names.map((n) => at(last.nd.filter((r) => r.Series === n), "lvl"));
    } else if (mode === "mean") {
      names = [...new Set(last.nd.map((r) => r.Group))];
      v = names.map((n) => at(last.ng.filter((r) => r.Group === n), "lvl"));
    } else { names = ["B − A"]; v = [at(last.ndiff, "d")]; fmt = fs; }
    const cols = mode === "diff" ? [DIFF_COL] : seriesCols(names.length);
    out.innerHTML = head(f.toFixed(1), null) + fmtVals(names, v, fmt, cols);
    return;
  }
  if (f < F_MIN || f > F_MAX) { out.textContent = ""; return; }
  const a = last.a, bs = S.band_set;
  let band = null;
  if (bs === "zones") {
    const i = zonesCfg.findIndex((z) => z.xmin <= f && z.xmax > f);
    if (i >= 0) band = `zone ${i + 1} (${ZONE_NAMES[i]})`;
  } else if (["bark", "curtin4", "curtin5"].includes(bs)) {
    const b = BAND_SETS[bs].cfg.find((x) => x.xmin <= f && x.xmax > f);
    if (b) band = `${bs === "bark" ? "Bark band" : "Curtin band"} ${b.Label}`;
  } else if (bs === "dw") {
    const b = B12.find((x) => x.lo <= f && x.hi > f);
    if (b) band = `band ${b.dw}`;
  }
  const atGrid = (y) => approx(a.grid, y, [f])[0];
  let names, v, fmt = f1;
  if (mode === "indiv") { names = a.names; v = a.mat.map(atGrid); }
  else {
    const gs = summariseGroups(a.mat, a.grp);
    if (mode === "mean") { names = [...gs.keys()]; v = names.map((g) => atGrid(gs.get(g).mean)); }
    else {
      const A = gs.get(last.sel.ref).mean, B = gs.get(last.sel.cmp).mean;
      names = ["B − A"]; v = [atGrid(B.map((x, i) => x - A[i]))]; fmt = fs;
    }
  }
  const cols = mode === "diff" ? [DIFF_COL] : seriesCols(names.length);
  out.innerHTML = head(f < 1000 ? f.toFixed(1) : f.toFixed(0), band) + fmtVals(names, v, fmt, cols);
}

// ---- Exports ---------------------------------------------------------------------
const today = () => new Date().toISOString().slice(0, 10);
function download(blobOrUrl, filename) {
  const url = typeof blobOrUrl === "string" ? blobOrUrl : URL.createObjectURL(blobOrUrl);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove();
  if (typeof blobOrUrl !== "string") setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// The current chart as a file: PNG and PDF at 3000 x 1800 pixels (10 x 6 in at 300 dpi),
// SVG as vector graphics. Returns { blob | url, name }.
async function chartFile(fmt) {
  const size = { width: 1500, height: 900 };
  const fig = figureFor(last, size);
  const name = `violin-spectrum-${today()}.${fmt}`;
  const figure = { data: fig.data, layout: fig.layout, config: PLOT_CONFIG };
  if (fmt === "svg") return { url: await Plotly.toImage(figure, { format: "svg", ...size }), name };
  const png = await Plotly.toImage(figure, { format: "png", ...size, scale: 2 });
  if (fmt === "png") return { url: png, name };
  const pdf = new window.jspdf.jsPDF({ orientation: "landscape", unit: "in", format: [10, 6] });
  pdf.addImage(png, "PNG", 0, 0, 10, 6, undefined, "FAST");
  return { blob: pdf.output("blob"), name };
}

async function exportChart() {
  if (!last) { toast("Nothing to export yet.", "warning"); return; }
  setBusy("Preparing chart…");
  try {
    const f = await chartFile(S.file_type);
    download(f.blob || f.url, f.name);
  } catch (e) {
    toast("The chart could not be exported: " + e.message, "error");
  } finally { setBusy(null); }
}

function csv(rows, cols) {
  const cell = (v, isText) => {
    if (v == null || (typeof v === "number" && !Number.isFinite(v))) return "";
    if (isText) return `"${String(v).replace(/"/g, '""')}"`;
    return String(+Number(v).toPrecision(15));
  };
  const lines = [cols.map((c) => `"${c.name}"`).join(",")];
  for (const r of rows) lines.push(cols.map((c) => cell(r[c.name], c.text)).join(","));
  return lines.join("\n") + "\n";
}
const round2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN);

function exportCsv() {
  if (!last) { toast("Nothing to export yet.", "warning"); return; }
  const f = csvFile();
  download(new Blob([f.text], { type: "text/csv" }), f.name);
}

// The curves (spectrum view) or note levels (note view) as CSV: { text, name }
function csvFile() {
  const L = last;
  let rows, cols, base;
  if (L.view === "notes") {
    base = "violin-note-levels-";
    const label = (f) => (L.glis ? noteName(f) : noteShort(f));
    cols = [{ name: "Series", text: true }, { name: "Note", text: true }, { name: "Frequency_Hz" }, { name: "Level_dB" }, { name: "SE_dB" }];
    if (L.mode === "indiv") {
      rows = L.nd.map((r) => ({ Series: safeCsvText(r.Series), Note: label(r.f), Frequency_Hz: round2(r.f), Level_dB: round2(r.lvl), SE_dB: NaN }));
    } else if (L.mode === "mean") {
      cols.push({ name: "n" });
      rows = L.ng.map((g) => ({ Series: safeCsvText(g.Group), Note: label(g.f), Frequency_Hz: round2(g.f), Level_dB: round2(g.lvl), SE_dB: round2(g.se), n: g.n }));
    } else {
      rows = L.ndiff.map((r) => ({ Series: safeCsvText(`${L.sel.cmp} - ${L.sel.ref}`), Note: label(r.f), Frequency_Hz: round2(r.f),
        Level_dB: round2(r.d), SE_dB: round2(Math.sqrt(r.seA ** 2 + r.seB ** 2)) }));
    }
  } else {
    base = "violin-spectral-coordinates-";
    const a = L.a, grid = a.grid;
    cols = [{ name: "Frequency_Hz" }, { name: "Level_dB" }, { name: "SE_dB" }, { name: "Series", text: true }];
    rows = [];
    if (L.mode === "indiv") {
      a.names.forEach((n, i) => grid.forEach((f, k) => rows.push({ Frequency_Hz: f, Level_dB: a.mat[i][k], SE_dB: NaN, Series: safeCsvText(n) })));
    } else {
      const gs = summariseGroups(a.mat, a.grp);
      if (L.mode === "mean") {
        for (const [g, s] of gs) grid.forEach((f, k) => rows.push({ Frequency_Hz: f, Level_dB: s.mean[k], SE_dB: s.se[k], Series: safeCsvText(g) }));
      } else {
        const A = gs.get(L.sel.ref), B = gs.get(L.sel.cmp);
        grid.forEach((f, k) => rows.push({ Frequency_Hz: f, Level_dB: B.mean[k] - A.mean[k],
          SE_dB: Math.sqrt(A.se[k] ** 2 + B.se[k] ** 2), Series: safeCsvText(`${L.sel.cmp} - ${L.sel.ref}`) }));
      }
    }
  }
  return { text: csv(rows, cols), name: `${base}${today()}.csv` };
}

// ---- Tabs and Read Me -------------------------------------------------------------
let readmeLoaded = false;
async function showTab(which) {
  const readme = which === "readme";
  $("#tab-analyzer").setAttribute("aria-selected", String(!readme));
  $("#tab-readme").setAttribute("aria-selected", String(readme));
  $("#page-analyzer").hidden = readme;
  $("#page-readme").hidden = !readme;
  if (readme && !readmeLoaded) {
    try {
      const md = await (await fetch("content/readme.md")).text();
      $("#readme").innerHTML = marked.parse(md);
      readmeLoaded = true;
    } catch (e) {
      $("#readme").textContent = "The Read Me could not be loaded" + (location.protocol === "file:" ? " (open the app through a web server)." : ".");
    }
  }
  if (!readme && last) refresh();
  window.scrollTo(0, 0);
}

// ---- Start -----------------------------------------------------------------------
// Allowed values of the settings that a page URL may set
const CHOICES = {
  rec_type: Object.keys(REC_LABELS), smooth: SMOOTH_CHOICES, fft_size: FFT_CHOICES, norm_mode: ["inband", "none"],
  view: ["spec", "notes"], plot_mode: ["indiv", "mean", "diff"], err_type: ["se", "ci"],
  band_set: [...Object.keys(BAND_SETS), "none"], x_scale: ["log", "lin"], file_type: ["png", "svg", "pdf"],
};
// A setting from the page URL, or undefined if the name or value is not allowed. Numbers
// must lie within the range of their slider.
function urlSetting(k, v) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULTS, k)) return undefined;
  const d = DEFAULTS[k];
  if (typeof d === "boolean") return v === "true" ? true : v === "false" ? false : undefined;
  if (typeof d === "number") {
    const el = $("#" + k), n = Number(v);
    return Number.isFinite(n) && n >= Number(el.min) && n <= Number(el.max) ? n : undefined;
  }
  return CHOICES[k]?.includes(v) ? v : undefined;
}

function init() {
  bindControls();
  bindPlot();
  syncControls();
  $("#file-input").addEventListener("change", async (e) => {
    const files = e.target.files;
    if (files && files.length) await loadFiles(fileItems(files));
    e.target.value = "";
  });
  const dz = $("#dropzone");
  const over = (on) => (e) => { e.preventDefault(); dz.classList.toggle("over", on); };
  dz.addEventListener("dragenter", over(true));
  dz.addEventListener("dragover", over(true));
  dz.addEventListener("dragleave", over(false));
  dz.addEventListener("drop", async (e) => {
    over(false)(e);
    e.stopPropagation();          // the page-wide handler below would load them again
    if (e.dataTransfer.files.length) await loadFiles(fileItems(e.dataTransfer.files));
  });
  // dropping anywhere on the page opens the files too, instead of navigating away
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", async (e) => {
    e.preventDefault();
    if (e.dataTransfer?.files.length) await loadFiles(fileItems(e.dataTransfer.files));
  });
  $$("[data-example]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); loadExample(a.dataset.example); }));
  $("#tab-analyzer").addEventListener("click", () => showTab("analyzer"));
  $("#tab-readme").addEventListener("click", () => showTab("readme"));
  $("#welcome-readme").addEventListener("click", (e) => { e.preventDefault(); showTab("readme"); });
  if (location.hash === "#readme") showTab("readme");
  let rt = null, lastW = 0;
  window.addEventListener("resize", () => {
    clearTimeout(rt);
    rt = setTimeout(() => { const w = $("#plot").clientWidth; if (last && w !== lastW) { lastW = w; refresh(); } }, 200);
  });
  // ?example=glis or ?example=impact loads an example on start; further parameters set
  // controls, e.g. ?example=glis&plot_mode=diff&view=notes&zoom=200,700
  const q = new URLSearchParams(location.search), ex = q.get("example");
  if (ex && EXAMPLE_SETS[ex]) {
    loadExample(ex).then(() => {
      for (const [k, v] of q) {
        if (k === "zoom") {
          const z = v.split(",").map(Number);
          if (z.length === 2 && z.every(Number.isFinite) && z[0] > 0 && z[0] < z[1]) S.xZoom = z;
        } else {
          const s = urlSetting(k, v);
          if (s !== undefined) S[k] = s;
        }
      }
      const ro = Number(q.get("readout"));
      if (q.get("readout") && Number.isFinite(ro)) S.cursorF = ro;
      refresh();
    });
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
// for tests (tests/e2e.html)
window.__app = { S, refresh, loadExample, loadFiles, csvFile, chartFile, last: () => last, gen: () => gen };

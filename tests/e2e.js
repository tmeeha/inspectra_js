// End-to-end smoke test: drives the app (in an iframe) through every view, plot mode,
// axis and band set for both example sets, and checks messages, boxes and exports.

const out = document.getElementById("out");
let pass = 0, fail = 0;
const log = (s) => { out.textContent += s + "\n"; };
function check(label, ok, detail = "") {
  if (ok) pass++; else fail++;
  log(`${ok ? "ok  " : "FAIL"} ${label}${!ok && detail ? "  — " + detail : ""}`);
}

const frame = document.getElementById("app");
const loaded = new Promise((r) => frame.addEventListener("load", r));
frame.src = "../index.html";

async function run() {
  await loaded;
  const w = frame.contentWindow, doc = frame.contentDocument;
  for (let i = 0; i < 100 && !w.__app; i++) await new Promise((r) => setTimeout(r, 50));
  const app = w.__app, S = app.S;
  const msg = () => (doc.getElementById("plot-message").hidden ? "" : doc.getElementById("plot-message").textContent);
  const traces = () => (doc.getElementById("plot").data || []).length;
  const set = async (o) => { Object.assign(S, o); await app.refresh(); };

  // ---- glissando example
  await app.loadExample("glis");
  await app.refresh();
  check("glissando example: 4 files, type bowed", S.files.length === 4 && S.rec_type === "bowed", `${S.files.length} ${S.rec_type}`);
  check("pitch box shown, glissandi recognised", !doc.getElementById("tuning_note").hidden &&
    doc.getElementById("tuning_note").innerHTML.includes("Glissandi"));
  let n = 0, bad = [];
  for (const view of ["spec", "notes"]) for (const plot_mode of ["indiv", "mean", "diff"]) for (const x_scale of ["log", "lin"])
    for (const band_set of view === "spec" ? ["zones", "dw", "bark", "curtin4", "curtin5", "none"] : ["zones"])
      for (const err_type of ["se", "ci"]) {
        await set({ view, plot_mode, x_scale, band_set, err_type });
        n++;
        if (msg() || traces() === 0 || !app.last()) bad.push(`${view}/${plot_mode}/${x_scale}/${band_set}/${err_type}: ${msg()}`);
        const csv = app.csvFile().text.split("\n");
        const hdr = view === "notes" ? (plot_mode === "mean" ? '"Series","Note","Frequency_Hz","Level_dB","SE_dB","n"' : '"Series","Note","Frequency_Hz","Level_dB","SE_dB"')
          : '"Frequency_Hz","Level_dB","SE_dB","Series"';
        if (csv[0] !== hdr || csv.length < 10) bad.push(`csv ${view}/${plot_mode}: ${csv[0]} (${csv.length} lines)`);
      }
  check(`${n} plot combinations render with CSV export`, bad.length === 0, bad.slice(0, 5).join(" | "));

  await set({ view: "spec", plot_mode: "indiv", band_set: "zones", x_scale: "log" });
  const csv = app.csvFile().text.trim().split("\n");
  check(`individual spectrum CSV has 4 x grid rows (${csv.length - 1})`, csv.length - 1 === 4 * app.last().a.grid.length);
  // band summary table: one row per recording, one column per zone, values as in the band panel
  const bandTbl = () => doc.querySelector("#band_box table");
  let bt = bandTbl();
  const firstVal = bt && bt.querySelector("tbody td.num").textContent.replace("−", "-");
  const panelVal = app.last().a.sets.zones[0][0].toFixed(1);
  check(`band table: 4 rows x 7 zones, first value ${firstVal} = band panel ${panelVal}`, bt && bt.querySelectorAll("tbody tr").length === 4 &&
    bt.querySelectorAll("thead th").length === 8 && firstVal === panelVal);
  await set({ plot_mode: "mean", band_set: "bark" });
  bt = bandTbl();
  check("band table: group means with ± error, 18 Bark bands", bt && bt.querySelectorAll("tbody tr").length === 2 &&
    bt.querySelectorAll("thead th").length === 19 && /±/.test(bt.textContent));
  await set({ band_set: "none" });
  check("band table hidden when band levels are off", doc.getElementById("band_box").hidden);
  await set({ plot_mode: "indiv", band_set: "zones" });
  await set({ xZoom: [200, 700] });
  check("zoom to 200–700 Hz", Math.abs(app.last().xr[0] - 200) < 1e-9 && msg() === "");
  await set({ xZoom: null });

  // a drag-zoom (Plotly reports the new range in log10 units), then double-click to reset
  const gd = doc.getElementById("plot");
  await w.Plotly.relayout(gd, { "xaxis.range[0]": Math.log10(300), "xaxis.range[1]": Math.log10(900) });
  await app.refresh();
  check(`drag-zoom sets the range (${S.xZoom?.map((v) => v.toFixed(0))})`, S.xZoom && Math.abs(S.xZoom[0] - 300) < 0.01 && Math.abs(S.xZoom[1] - 900) < 0.01);
  gd.dispatchEvent(new w.MouseEvent("dblclick", { bubbles: true }));
  await app.refresh();
  check("double-click resets the zoom", S.xZoom === null);
  // hover readout in the middle of the plot area
  const r = gd.getBoundingClientRect(), sz = gd._fullLayout._size;
  gd.dispatchEvent(new w.MouseEvent("mousemove", { bubbles: true, clientX: r.left + sz.l + sz.w / 2, clientY: r.top + sz.t + 50 }));
  const ro = doc.getElementById("cursor_readout").textContent;
  check(`hover readout: ${ro.slice(0, 70)}…`, /Hz/.test(ro) && /dB/.test(ro) && /zone/.test(ro));

  // smoothing, normalization, FFT size, gate, common pitch range
  for (const o of [{ smooth: "0" }, { smooth: "3" }, { norm_mode: "none" }, { fft_size: "4096" }, { fft_size: "32768" },
    { gate_on: false }, { restrict_pitch: true }, { view: "notes" }]) {
    await set(o);
    check(`settings ${JSON.stringify(o)} render`, !msg() && traces() > 0, msg());
  }
  check("glissando note view uses pitch bins", app.last().glis === true && doc.getElementById("plot").layout.title.text.includes("Glissando"));
  check("common pitch range reported", doc.getElementById("tuning_note").innerHTML.includes("common pitch range"));

  // validation messages
  await set({ view: "spec", plot_mode: "diff", ref: S.ref, cmp: S.ref });
  check("same A and B groups gives a message", msg().includes("two different groups"), msg());
  await set({ plot_mode: "indiv", visible: [] });
  check("no visible layers gives a message", msg().includes("Select at least one audio layer"), msg());
  await set({ visible: S.files.map((f) => f.name) });

  // exports
  for (const fmt of ["png", "svg", "pdf"]) {
    const f = await app.chartFile(fmt);
    const size = f.blob ? f.blob.size : f.url.length;
    check(`chart export ${fmt}: ${f.name}, ${(size / 1024).toFixed(0)} kB`, size > 20000 && f.name.endsWith("." + fmt));
  }

  // ---- synthetic scales (held notes, two groups 20 cents apart): bowed, not glissandi
  const names = ["synth_before_semitones_1.wav", "synth_before_semitones_2.wav", "synth_after_semitones_1.wav", "synth_after_semitones_2.wav"];
  const items = await Promise.all(names.map(async (name) => {
    const buf = await (await fetch("fixtures/" + name)).arrayBuffer();
    return { name, size: buf.byteLength, buf };
  }));
  await app.loadFiles(items);
  await set({ view: "notes" });
  const tnote = doc.getElementById("tuning_note");
  check("scales: type bowed, held notes, tuning check with offset warning", S.rec_type === "bowed" && app.last().glis === false &&
    tnote.innerHTML.includes("Pitch offset") && tnote.innerHTML.includes("differ in average pitch"), tnote.textContent.slice(0, 120));
  check("scales: note-level view titled Note Levels", doc.getElementById("plot").layout.title.text.includes("Note Levels"));

  // ---- taps example
  await app.loadExample("impact");
  await app.refresh();
  check("taps example: type impact, defaults reset", S.rec_type === "impact" && S.smooth === "24" && S.plot_mode === "indiv");
  await app.refresh();
  const dmp = doc.getElementById("damping_box");
  check("damping table shows A0, B1−, B1+", !dmp.hidden && /A0/.test(dmp.innerHTML) && /B1−/.test(dmp.innerHTML) && /B1\+/.test(dmp.innerHTML));
  for (const o of [{ exp_db: 0 }, { trig_db: -12 }, { skip_clipped: false }, { x_scale: "lin" }, { plot_mode: "mean" }]) {
    await set(o);
    check(`taps ${JSON.stringify(o)} render`, !msg() && traces() > 0, msg());
  }
  check("pitch box hidden for taps", doc.getElementById("tuning_note").hidden);

  // ---- synthetic taps: two replicates (group mean row) and one with a ringing string
  const tapFiles = [["synth_taps_1.wav", "synth_taps_r1.wav"], ["synth_taps_double.wav", "synth_taps_r2.wav"],
    ["synth_taps_string_clipped.wav", "string_taps_r1.wav"]];
  const tapItems = await Promise.all(tapFiles.map(async ([src, name]) => {
    const buf = await (await fetch("fixtures/" + src)).arrayBuffer();
    return { name, size: buf.byteLength, buf };
  }));
  await app.loadFiles(tapItems);
  await app.refresh();
  const tbl = doc.querySelector("#damping_box table");
  check("damping table: 3 columns per mode, group mean row",
    tbl && tbl.querySelectorAll("thead tr:nth-child(2) th").length === 9 && !!tbl.querySelector(".mean-row"),
    tbl ? tbl.textContent.slice(0, 200) : "no table");
  frame.style.height = "1400px";
  w.scrollTo(0, doc.getElementById("damping_box").getBoundingClientRect().top + w.scrollY - 300);

  log(`\nDONE ${pass} passed, ${fail} failed`);
}
run().catch((e) => { log("ERROR " + e.stack); log("DONE with error"); });

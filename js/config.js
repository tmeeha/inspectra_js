// Constants and configuration: limits, analysis defaults, frequency bands, band sets,
// resonance regions, recording types and example sets. Port of R/config.R.

// Everything runs in the browser, so these limits only protect the browser's memory.
// Decoded samples take 8 bytes each, so a 16-bit mono file needs about 4x its size in
// memory (8-bit mono up to 8x); 300 MB of files is then about 1.2-2.4 GB.
export const MAX_FILES = 30;
export const MAX_FILE_MB = 50;
export const MAX_TOTAL_MB = 300;

// Reference sample rate for the FFT-size selector. The frame length is fixed as a
// duration (fft_size / REF_FS seconds), so every file gets the same bin spacing.
export const REF_FS = 48000;
export const DEFAULT_FFT = "16384";   // 0.34 s frames, ~2.9 Hz bins
export const FFT_CHOICES = ["4096", "8192", "16384", "32768"];
export const SMOOTH_CHOICES = ["0", "24", "12", "6", "3"];

// Base-10 1/12-octave bands (IEC 61260 even-fraction convention, as used by the
// Norsonic analyser in Buen 2005/2007): edges at 1000 * G^(k/12), G = 10^0.3.
const G10 = Math.pow(10, 0.3);
const oct12Edge = (k) => 1000 * Math.pow(G10, k / 12);
export const DW_LABELS = ["A", "B", "C", "D", "E", "F"];
const DW_COUNTS = [21, 12, 4, 8, 9, 9];
export const B12 = [];
{
  let k = -29;
  DW_LABELS.forEach((lab, j) => {
    for (let c = 0; c < DW_COUNTS[j]; c++, k++) B12.push({ lo: oct12Edge(k), hi: oct12Edge(k + 1), dw: lab });
  });
}
export const NORM_LO = B12[0].lo;                     // 188.4 Hz
export const NORM_HI = B12[B12.length - 1].hi;        // 7079.5 Hz
export const F_MIN = 180;                             // plotted / analysed range (Hz)
export const F_MAX = Math.ceil(NORM_HI);              // 7080 Hz

const cfg = (labels, xmin, xmax) => labels.map((Label, i) => ({ Label, xmin: xmin[i], xmax: xmax[i] }));
const edgesCfg = (e) => cfg(e.slice(0, -1).map((_, i) => String(i + 1)), e.slice(0, -1), e.slice(1));

export const bandsCfg = DW_LABELS.map((Label) => {
  const r = B12.filter((b) => b.dw === Label);
  return { Label, xmin: Math.min(...r.map((b) => b.lo)), xmax: Math.max(...r.map((b) => b.hi)) };
});

// Bark critical bands (Zwicker's edges, as listed by Curtin 2009), numbered from 1 = 0-100 Hz
const BARK_EDGES = [200, 300, 400, 510, 630, 770, 920, 1080, 1270, 1480, 1720, 2000,
  2320, 2700, 3150, 3700, 4400, 5300, 6400];
export const barkCfg = cfg(BARK_EDGES.slice(0, -1).map((_, i) => String(i + 3)), BARK_EDGES.slice(0, -1), BARK_EDGES.slice(1));
export const curtin4Cfg = edgesCfg([200, 780, 1740, 2930, 7000]);
export const curtin5Cfg = edgesCfg([200, 780, 1740, 3000, 5200, 7000]);
export const zonesCfg = edgesCfg([200, 400, 770, 1270, 1720, 3150, 5300, F_MAX]);
export const ZONE_NAMES = ["low-string fundamentals (G, D)", "high-string fundamentals (A, E)",
  "highest fundamentals", "upper midrange", "bridge hill highs", "upper hill highs", "highest highs"];

export const BAND_SETS = {
  dw:      { cfg: bandsCfg,   name: "Dünnwald regions" },
  bark:    { cfg: barkCfg,    name: "Bark critical bands 3–20 (200–6400 Hz)" },
  curtin4: { cfg: curtin4Cfg, name: "Curtin 4 bands (200–780–1740–2930–7000 Hz)" },
  curtin5: { cfg: curtin5Cfg, name: "Curtin 5 bands (200–780–1740–3000–5200–7000 Hz)" },
  zones:   { cfg: zonesCfg,   name: "Bark violin zones 1–7 (200–7080 Hz)" },
};

// Signature-mode and feature ranges, as used by the ObieApp (Oberlin workshop)
export const REGIONS = [
  { label: "A0",              xmin: 264,  xmax: 290,  alpha: 0.12, row: 1, italic: false },
  { label: "CBR",             xmin: 380,  xmax: 420,  alpha: 0.06, row: 2, italic: false },
  { label: "B1−",             xmin: 393,  xmax: 470,  alpha: 0.12, row: 1, italic: false },
  { label: "B1+",             xmin: 473,  xmax: 593,  alpha: 0.12, row: 2, italic: false },
  { label: "Transition hill", xmin: 800,  xmax: 1300, alpha: 0.05, row: 1, italic: true },
  { label: "Bridge hill",     xmin: 1750, xmax: 3000, alpha: 0.08, row: 1, italic: true },
  { label: "Upper hill",      xmin: 3000, xmax: 7000, alpha: 0.04, row: 1, italic: true },
];

// Two recording types: bowed strings (glissandi, scales, semitones, musical passages;
// analysed alike, with glissandi recognised automatically) and bridge taps
export const REC_LABELS = { bowed: "Bowed strings", impact: "Bridge taps" };
export const REC_DEFAULTS = {
  bowed:  { smooth: "12", gate: true },
  impact: { smooth: "24", gate: true },
};
// Fixed defaults of the analysis settings that do not depend on the recording type
export const ANALYSIS_FIXED = { fft_size: DEFAULT_FFT, norm_mode: "inband", gate_db: -40,
  exp_db: -40, trig_db: -20, skip_clipped: true };

// File-name keywords that suggest a recording type: each must be a whole word
const kw = (...w) => new RegExp("(^|[^a-z])(" + w.join("|") + ")([^a-z]|$)");
const GLIS_WORDS = ["glis", "gliss", "glissando", "glissandi", "slides?"];
export const REC_KEYWORDS = {
  impact: kw("imp", "impacts?", "taps?", "tapping", "hammer", "knocks?", "knocking"),
  bowed:  kw(...GLIS_WORDS, "semis?", "semitones?", "scales?", "chrom", "chromatic",
             "music", "musical", "excerpts?", "pieces?", "passages?", "concerto", "sonata", "bowed?"),
};
// A file name marking a glissando (used with the pitch track to recognise glissandi)
export const GLIS_KEYWORD = kw(...GLIS_WORDS);

export const EXAMPLE_DIR = "examples";
export const EXAMPLE_SETS = {
  glis: { label: "glissandi, before vs after",
    files: ["violin6_before_glissando_replicate1.wav", "violin6_before_glissando_replicate2.wav",
            "violin6_after_glissando_replicate1.wav", "violin6_after_glissando_replicate2.wav"] },
  impact: { label: "bridge taps", files: ["violin6_after_taps_replicate1.wav"] },
};

export const TUNE_WARN = 10;         // warn when groups differ in pitch offset by more (cents)
export const TUNE_SPREAD_WARN = 15;  // warn when note-to-note scatter exceeds (cents)
export const TUNE_SPREAD_MAX = 25;   // above this an average offset is "unclear"

export const DAMPING_MODES = ["A0", "B1−", "B1+"];
export const Q_STRING = 100;         // above this Q a peak is flagged as a likely string

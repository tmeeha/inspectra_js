# Builds the reference results that the JavaScript port is checked against.
#
# Run from the inspectra_js folder, with the R app next to it (../inspectra_r):
#   Rscript tests/make_reference.R
# Writes synthetic recordings to tests/fixtures/ and the R results to
# tests/fixtures/reference.json. Then open tests/test.html through a local web server
# (see tests/README.md) to compare.

suppressPackageStartupMessages({ library(tuneR); library(jsonlite) })
r_app <- normalizePath("../inspectra_r", mustWork = TRUE)
app <- new.env()
for (f in c("config.R", "utils.R", "dsp.R", "pitch.R", "plot_helpers.R"))
  sys.source(file.path(r_app, "R", f), envir = app)

fx <- "tests/fixtures"; dir.create(fx, showWarnings = FALSE, recursive = TRUE)
fs <- 44100
set.seed(42)

# ---- Synthetic recordings (the generators of the R test suite) -----------------------
bowed <- function(notes, cents = 0, dur = 0.45) unlist(lapply(notes, function(f0) {
  t <- seq(0, dur, by = 1 / fs); f0 <- f0 * 2^(cents / 1200)
  ph <- 2 * pi * cumsum(f0 * 2^((15 / 1200) * sin(2 * pi * 5.5 * t))) / fs
  s <- rowSums(sapply(1:15, function(h) sin(h * ph) / h^0.7 * (h * f0 < 20000)))
  s * pmin(1, t / 0.03, (dur - t) / 0.03)
}))
taps <- function(modes, n = 6) {
  t <- (0:(fs - 1)) / fs
  tap <- function() rowSums(sapply(seq_len(nrow(modes)), function(m)
    modes$A[m] * exp(-pi * modes$f[m] / modes$Q[m] * t) * sin(2 * pi * modes$f[m] * t + runif(1, 0, 2 * pi))))
  x <- numeric((n + 2) * fs); for (k in 0:(n - 1)) { s <- round((0.5 + k) * fs); x[s:(s + fs - 1)] <- tap() }
  x + rnorm(length(x), sd = 1e-4)
}
w16 <- function(x, path, amp = 0.5) writeWave(Wave(left = round(x / max(abs(x)) * amp * 32767), samp.rate = fs, bit = 16), path)

notes <- 196 * 2^((0:13) / 12)
w16(bowed(notes, -10) + 0.002 * rnorm(1), file.path(fx, "synth_before_semitones_1.wav"))
w16(bowed(notes, -12) + 0.002 * rnorm(1), file.path(fx, "synth_before_semitones_2.wav"))
w16(bowed(notes[3:14], +10), file.path(fx, "synth_after_semitones_1.wav"))
w16(bowed(notes[3:14], +9), file.path(fx, "synth_after_semitones_2.wav"))
body <- data.frame(f = c(275, 460, 540, 800, 1200), Q = c(25, 40, 50, 30, 30), A = c(1, .8, 1, .5, .4))
w16(taps(body), file.path(fx, "synth_taps_1.wav"))
x <- taps(rbind(body, data.frame(f = 432, Q = 1500, A = 0.15)))
x[round(2.5 * fs) + 0:3] <- 2 * max(abs(x))                  # one clipped tap
writeWave(Wave(left = round(pmax(-1, pmin(1, x / max(abs(x)))) * 32767), samp.rate = fs, bit = 16),
          file.path(fx, "synth_taps_string_clipped.wav"))
# a double hit
y <- taps(body, n = 3); s2 <- round(1.5 * fs) + round(0.05 * fs); y[s2:(s2 + fs - 1)] <- y[s2:(s2 + fs - 1)] + 0.9 * y[round(1.5 * fs):(round(1.5 * fs) + fs - 1)]
w16(y, file.path(fx, "synth_taps_double.wav"))

# WAV encodings: 24-bit stereo, 8-bit, 32-bit integer, 32-bit float, extensible 3-channel at 48 kHz
sc <- bowed(notes[1:4], 0, 0.4)
left <- sc / max(abs(sc)) * 0.6; right <- c(left[-(1:50)], numeric(50)) * 0.8
writeWave(Wave(left = round(left * (2^23 - 1)), right = round(right * (2^23 - 1)), samp.rate = fs, bit = 24),
          file.path(fx, "fmt_24bit_stereo.wav"))
writeWave(Wave(left = round(left * 127 + 128), samp.rate = fs, bit = 8), file.path(fx, "fmt_8bit.wav"))
writeWave(Wave(left = round(left * (2^31 - 1)), samp.rate = fs, bit = 32), file.path(fx, "fmt_32bit_int.wav"))
writeWave(Wave(left = left, samp.rate = fs, bit = 32, pcm = FALSE), file.path(fx, "fmt_float32.wav"))
fs48 <- 48000; t48 <- seq(0, 2, by = 1 / fs48)
mc <- sapply(1:3, function(k) round(sin(2 * pi * (330 * k) * t48) * 0.3 * 32767)); colnames(mc) <- c("FL", "FR", "FC")
writeWave(WaveMC(data = mc, samp.rate = fs48, bit = 16), file.path(fx, "fmt_extensible_3ch_48k.wav"))

# ---- Reference results -----------------------------------------------------------------
ex_dir <- file.path(r_app, "examples")
files <- c(file.path(ex_dir, list.files(ex_dir, "\\.wav$")), list.files(fx, "\\.wav$", full.names = TRUE))
type_of <- function(p) if (grepl("taps", p)) "impact" else if (grepl("glissando", p)) "glis" else "semi"

num <- function(v) ifelse(is.finite(v), v, NA)
ref <- list(files = list())
for (p in files) {
  nm <- basename(p); type <- type_of(nm)
  w <- app$read_mono(p)
  out <- list(path = if (startsWith(p, ex_dir)) paste0("examples/", nm) else paste0("tests/fixtures/", nm),
              type = type, n = length(w$x), fs = w$fs, n_clip = length(w$clip), clip_head = head(w$clip - 1, 10),
              sumsq = sum(w$x^2), head = w$x[1000 + 0:9])
  nfft <- app$nearest_smooth(w$fs * 16384 / app$REF_FS); out$nfft <- nfft
  spec <- list()
  if (type == "impact") {
    for (cfg in list(c(-40, -20, 1), c(0, -20, 1), c(-40, -12, 0))) {
      fp <- app$impact_power(w$x, nfft, w$fs, cfg[1], cfg[2], w$clip, cfg[3] == 1)
      key <- paste(cfg, collapse = "_")
      out[[paste0("imp_", key)]] <- list(total = fp$total, kept = fp$kept, edge = fp$edge, double = fp$double,
                                         clipped_good = fp$clipped_good, fallback = fp$fallback,
                                         pow_sum = if (is.null(fp$pow)) NA else sum(fp$pow))
    }
    fp <- app$impact_power(w$x, nfft, w$fs, -40, -20, w$clip, TRUE)
    if (!is.null(fp$pow)) {
      fr <- (0:(length(fp$pow) - 1)) * w$fs / nfft
      out$damping <- lapply(c("A0", "B1−", "B1+"), function(m) {
        r <- app$regions_cfg[app$regions_cfg$label == m, ]
        d <- app$mode_damping(fr, fp$pow, w$fs / nfft, r$xmin, r$xmax, -40)
        list(mode = m, f0 = num(d$f0), Q = num(d$Q), note = d$note)
      })
      spec$pow <- fp$pow
    }
    out$strings <- I(app$ringing_strings(w$x, nfft, w$fs, -20, w$clip, TRUE))
  } else {
    tr <- app$pitch_track(w$x, w$fs)
    po <- app$pitch_offset(tr); ex <- app$pitch_extent(tr); nl <- app$note_levels(tr, type == "glis")
    out$pitch <- list(n_frames = tr$n_frames, n_voiced = length(tr$fr), fr_head = head(tr$fr - 1, 30),
                      f0_head = head(tr$f0, 30), f0_sum = sum(tr$f0),
                      offset = num(po[["offset"]]), spread = num(po[["spread"]]),
                      lo = num(ex[["lo"]]), hi = num(ex[["hi"]]),
                      notes = list(key = nl$key, f = nl$f, pow = nl$pow, frames = nl$frames))
    fp <- app$frame_power(w$x, nfft, TRUE, -40)
    fp2 <- app$frame_power(w$x, nfft, TRUE, -20)
    out$gate20_pow_sum <- if (is.null(fp2)) NA else sum(fp2$pow)
    # common-range style exclusion: frames with pitch above 300 Hz are "bad"
    if (length(w$x) >= nfft && length(tr$fr)) {
      out_fr <- tr$fr[tr$f0 > 300]; bad <- logical(length(w$x))
      for (fr in out_fr) { a <- max(1, (fr - 2) * tr$H + 1); b <- min(length(w$x), (fr - 1) * tr$H + tr$N + tr$H); bad[a:b] <- TRUE }
      fb <- app$frame_power(w$x, nfft, TRUE, -40, bad)
      out$bad300 <- if (is.null(fb)) NULL else list(excluded = fb$excluded, pow_sum = sum(fb$pow))
    }
    if (!is.null(fp)) spec$pow <- fp$pow
  }
  if (!is.null(spec$pow) && w$fs / 2 >= app$F_MAX) {
    df <- w$fs / nfft; freq <- (0:(length(spec$pow) - 1)) * df
    bp <- app$band_power(freq, spec$pow, df, app$B12$lo, app$B12$hi); tot <- sum(bp)
    out$bands_dw <- app$band_shares(bp)
    out$bands_sets <- lapply(app$BAND_SETS[setdiff(names(app$BAND_SETS), "dw")], function(s)
      10 * log10(app$band_power(freq, spec$pow, df, s$cfg$xmin, s$cfg$xmax) / tot + 1e-30))
    grid <- seq(app$F_MIN, app$F_MAX, by = app$REF_FS / 16384)
    curves <- list()
    for (sm in c("0", "12", "3")) for (norm in c("inband", "none")) {
      d <- spec$pow / df; d <- if (norm == "inband") d / tot else 2 * d
      if (as.numeric(sm) > 0) d <- app$smooth_octave(freq, d, as.numeric(sm))
      curves[[paste0(sm, "_", norm)]] <- 10 * log10(approx(freq, d, xout = grid)$y + 1e-30)
    }
    out$curves <- curves
  }
  ref$files[[nm]] <- out
}

# group summaries, t quantiles, pretty, note names
m <- rbind(c(-10, -20, -30), c(-12, -18, -33), c(-11, -25, -29))
gs <- app$summarise_groups(m, c("a", "a", "b"))
ref$summ <- list(mat = m, grp = c("a", "a", "b"), a_mean = gs$a$mean, a_se = gs$a$se, b_mean = gs$b$mean)

ref$pretty <- lapply(list(c(180, 7080), c(-23.4, 8.1), c(200, 213), c(-1.7, 4.2), c(0.31, 0.37)), function(r)
  list(r = r, b = pretty(r)))
ref$notes <- list(f = c(196, 261.63, 440, 452, 7000), name = app$note_name(c(196, 261.63, 440, 452, 7000)))
ref$groups <- list(names = c("violin6_before_semitones_replicate2.wav", "v6_before_semi_r1.wav", "strad1715_take3.wav", "x_1.wav", "abc.wav"),
                   g = vapply(c("violin6_before_semitones_replicate2.wav", "v6_before_semi_r1.wav", "strad1715_take3.wav", "x_1.wav", "abc.wav"),
                              app$default_group, "", USE.NAMES = FALSE))
ref$hue <- scales::hue_pal()(11)
writeLines(toJSON(ref, digits = NA, auto_unbox = TRUE, na = "null"), file.path(fx, "reference.json"))
cat("Wrote", length(ref$files), "file references to", file.path(fx, "reference.json"), "\n")

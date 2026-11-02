# Tests

Both tests run in a browser through a local web server started in the `inspectra_js`
folder (for example `python -m http.server 8000`).

## Comparison with the R app: `tests/test.html`

`make_reference.R` runs the R app's analysis functions (from `../inspectra_r/R`) on the
example recordings and on synthetic test files, and saves the results to
`fixtures/reference.json`. `test.html` runs the JavaScript analysis on the same files and
compares the results.

```
Rscript tests/make_reference.R      # only needed when the R code or the fixtures change
```

then open <http://localhost:8000/tests/test.html>. It covers WAV reading (8/16/24/32-bit
integer, 32-bit float, stereo, 3-channel extensible, 48 kHz), Welch spectra with gating
and pitch-range exclusion, tap detection (double hits, clipped taps, file edges), mode
damping, the ringing-string check, all band sets, smoothing and normalization, pitch
tracking, tuning offset, pitch range, note levels, group statistics, t quantiles, axis
breaks, note names, group names and recording-type keywords.

Results agree to about 1e-9 or better. The one exception is smoothed curves of synthetic
pure tones, which may differ by up to about 1e-4 dB: R's smoothing (a difference of running
sums) is itself that far from the exact value there, while the JavaScript version uses a
compensated sum.

## End-to-end test: `tests/e2e.html`

Opens the app in a frame, loads both example sets and goes through every view, plot mode,
axis, band set and error type, the main analysis settings, the validation messages,
zooming, the hover readout, the pitch box, the damping table, and the PNG, SVG, PDF and
CSV exports.

## Running headless

Both pages print `DONE <passed> passed, <failed> failed` when finished, so they can be run
without a visible browser, for example:

```
msedge --headless=new --virtual-time-budget=600000 --dump-dom http://localhost:8000/tests/test.html
```

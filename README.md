# Violin Acoustic Spectrum Analyzer (browser version)

Compares the frequency content of violin recordings (WAV files of bowed glissandi, scales
or musical passages, or of bridge taps): long-time-average spectra, group means and differences,
band levels, note levels, pitch range and tuning checks, and tap-tone mode damping.

Everything runs in the visitor's browser. Recordings are never uploaded, and the app is a
set of static files, so it can be hosted for free on GitHub Pages.

This is a JavaScript port of the R/Shiny app in `../inspectra_r`. The guide shown in the
app's Read Me tab is [content/readme.md](content/readme.md).

## Publishing on GitHub Pages

1. Create a GitHub repository and push the contents of this folder to it.
2. In the repository, open **Settings → Pages**, choose **Deploy from a branch**, select
   the `main` branch and the `/ (root)` folder, and save.
3. After a minute or so the app is live at `https://<username>.github.io/<repository>/`.

No build step is needed. The libraries (Plotly.js 2.35.2, marked 12.0.2 and jsPDF 2.5.1)
are included in `vendor/`, so the site does not depend on outside servers.

## Running it locally

The app must be opened through a web server rather than by double-clicking `index.html`,
because browsers block JavaScript modules, the examples and the Read Me on `file://` pages.
Any static server works, for example with Python:

```
python -m http.server 8000
```

then open <http://localhost:8000>.

Links can preselect an example and settings, for example
`index.html?example=glis&plot_mode=diff` or `index.html?example=impact&show_damping=true`.

## Files

| Path | Contents |
|---|---|
| `index.html`, `css/style.css` | Page layout and styles |
| `js/app.js` | Controls, file loading and playback, pipeline, readout, exports |
| `js/analysis.js` | Analysis pipeline: groups, spectra, band levels, note levels, pitch box, damping table |
| `js/dsp.js` | Spectra (Welch and tap), double hits, mode damping, string check, bands, smoothing, group statistics |
| `js/pitch.js` | Pitch tracking, tuning offset, pitch range, note levels |
| `js/wav.js` | WAV reader (8/16/24/32-bit integer, 32/64-bit float, extensible, any number of channels) |
| `js/fft.js` | FFT of any length (radix-2 and Bluestein) |
| `js/stats.js`, `js/format.js` | R-compatible helpers (quantiles, t quantiles, `pretty()`, note names, colours) |
| `js/plot.js` | Plotly figures for the spectrum and note-level views |
| `js/config.js` | Bands, regions, recording types, defaults |
| `content/readme.md` | The Read Me tab |
| `examples/` | Example recordings (violin 6) |
| `tests/` | Comparison with the R app, and an end-to-end test (see `tests/README.md`) |

## Differences from the R app

- There are two recording types, bowed strings and bridge taps, instead of four. Glissandi,
  scales and musical passages were already analysed alike; glissandi are now recognised
  automatically (file name or sliding pitch) for the note-level view and tuning check.
- Files are opened from the computer (or dragged onto the page) instead of uploaded. The
  limits are 30 files, 50 MB per file and 300 MB in total, because the decoded audio needs
  about four times the file size in browser memory. Files that are not RIFF/WAVE are skipped with a
  warning rather than rejecting the whole set.
- The 95% confidence interval is mean ± 1.96 SE (z) rather than a t interval, which is
  very wide with only a few replicates (12.7 SE for two). It is labelled approximate
  because with so few replicates it understates the uncertainty.
- Resonance regions are always shown.
- The chart can also be exported as SVG. PDF export contains a 3000 × 1800 image of the
  chart rather than vector graphics; use SVG for an editable vector version.
- Warmer page colours (ivory and amber); the chart itself keeps traditional plotting
  colours and the R app's ColorBrewer Set1 curves, with the yellow darkened (#D4B300) so it
  stays visible on white.
- Bowed recordings get a band-levels table below the plot; tap recordings always show the
  mode-damping table.
- The analysis results are the same: see `tests/README.md`.

## License

Free for noncommercial use under the [PolyForm Noncommercial License 1.0.0](LICENSE.md):
personal, research, teaching and hobby use, and use by charities, schools, public research
organizations and government. Commercial use needs separate permission from the author.

The bundled libraries in `vendor/` (Plotly.js, marked, jsPDF) keep their own MIT licenses.

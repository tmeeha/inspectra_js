# Violin Acoustic Spectrum Analyzer (browser version)

Compares the frequency content of violin recordings (WAV files of bowed glissandi, scales
or musical passages, or of bridge taps): long-time-average spectra, group means and differences,
band levels, note levels, pitch range and tuning checks, and tap-tone mode damping.

Everything runs in the visitor's browser. Recordings are never uploaded, and the app is a
set of static files, so it can be hosted for free on GitHub Pages.

This is a JavaScript port of the R/Shiny app in `../inspectra_r`. The guide shown in the
app's Read Me tab is [content/readme.md](content/readme.md).

## License

Free for noncommercial use under the [PolyForm Noncommercial License 1.0.0](LICENSE.md):
personal, research, teaching and hobby use, and use by charities, schools, public research
organizations and government. Commercial use needs separate permission from the author.

The bundled libraries in `vendor/` (Plotly.js, marked, jsPDF) keep their own MIT licenses.

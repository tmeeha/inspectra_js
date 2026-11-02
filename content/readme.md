## Violin Acoustic Spectrum Analyzer

This app compares the frequency content of violin recordings supplied as WAV files: bowed glissandi, scales or musical passages, or bridge taps. It shows long-time-average spectra, compares single recordings or groups of repeated takes (for example before and after an adjustment), summarises the energy in frequency bands, checks the pitch range and tuning of played recordings, and exports charts and data. It runs entirely in your web browser: recordings are analysed on your own computer and are never uploaded.

The guide starts with a quick start and advice on making recordings, then walks through the controls in the order they appear in the sidebar. Technical background is in the expandable Details notes and in the Methods section at the end.

### Quick start

1.  Open WAV files of one recording type: click the file box or drag the files onto it (hold Ctrl or Shift to select several). Names like violin6_before_semitones_replicate1.wav, violin6_before_semitones_replicate2.wav and violin6_after_semitones_replicate1.wav work best: the recording type is recognised from the name, and the takes of one instrument and condition are grouped automatically. No recordings yet? Click one of the example links below the file box.
2.  Check the recording type (bowed or bridge taps) and read any messages that appear.
3.  Look at the individual spectra, then switch Compare to Group mean or Difference (B − A) to compare groups.
4.  Read the box below the plot: it warns when the recordings cover different pitch ranges or differ in tuning.
5.  Drag across the plot to zoom, hover for values, and export the chart or the data.

### 1. Making recordings

A recorded spectrum contains the player, the passage, the room, the microphone and its position as well as the violin. Comparisons are meaningful only when everything except what you are comparing is kept the same.

#### All recordings

- **Files:** WAV, with a sample rate of at least about 14.2 kHz (44.1, 48 and 96 kHz are all fine and can be mixed), each at least one analysis frame long (0.34 s at the default window). Files that cannot be used are skipped with a warning.
- **Level:** set the recording level so the loudest moments peak around −6 dBFS. Clipping adds spurious high-frequency content, and the app warns about clipped recordings.
- **Microphone:** use one channel or a coincident pair. Stereo and multichannel files are averaged to mono, and widely spaced microphones can partly cancel some frequencies.
- **Microphone position:** keep it the same for every recording. A close microphone picks up more of the violin and less of the room; Curtin (2009) used 20–37 cm from the instrument's central axis. Below about 850 Hz a violin radiates nearly equally in all directions, so one microphone in front of the bridge is representative up to about 800 Hz. Above that, radiation becomes increasingly directional, and a single position exaggerates the peaks and dips of that one direction.
- **Room:** room acoustics are probably the biggest obstacle to clean measurements (Curtin 2009): the same violin measured in an anechoic chamber and in a small, reverberant room differs mainly above 1–2 kHz. Buen (2005) recommends a room of more than about 100 m³ for a reverberation time of about 1 s, or at least 50 m³ for a drier room of about 0.5 s.

<details>
<summary>Details: averaging several microphone positions</summary>

For a better estimate of the total sound output, Curtin (following Schleske) records at 12 positions spaced 30° apart around the instrument, in the plane of the bridge, and averages their magnitudes. The same can be done here: record one file per position and give all the files of one instrument the same group name. The group mean is a power average, which corresponds to Curtin's magnitude average. Its error band then shows the spread between directions rather than random measurement error. Use the same positions for every instrument you compare.

</details>

#### Bowed recordings (glissandi, scales, musical passages)

- Play the same passage on every instrument, because a long-term spectrum depends on which notes are played. Buen compared recordings of the opening of the Sibelius concerto; a chromatic scale over a fixed range is a simple standard.
- Tune to the same reference with a tuner before each take (within about 5 cents). Tuning differences shift every note peak and make fine spectral comparisons unreliable (see the pitch box, section 2.7).
- A slow glissando excites all frequencies, not only those of the notes of a scale.

#### Tap recordings (impacts on the bridge)

- Tap at the same point and in the same direction each time (Curtin taps the bass corner of the bridge sideways), with the same hammer or finger, the same microphone position and the same mounting of the instrument.
- Damp the strings, for example with a strip of cloth woven under them: undamped open strings ring sympathetically and add very sharp peaks, such as the A string near 440 Hz or the E string near 659 Hz, which can be mistaken for body modes. Keep the damping in the same place, because Curtin found that its exact position along the strings changes the result to a surprising degree, particularly the B1 peaks.
- Record several taps per file, spaced further apart than one analysis frame (0.34 s at the default), and let each one ring out. Avoid bounces and second strikes; the app rejects them.
- Set the level so taps peak around −6 to −12 dBFS. Clipping flattens the impact peak and adds spurious high-frequency content.
- Without a force sensor, a tap spectrum also contains the spectrum of the tap itself, which falls off at high frequencies depending on the hammer or finger (Morset 2001 found fingernail taps repeatable from about 200 to 3,000 Hz). Compare only taps made the same way.

### 2. Using the app

#### 2.1 Opening files and recording type

Open one recording type at a time: all files open at once are analysed as the same type. The type, chosen in the Recordings section below the file box, selects the analysis window and sets suitable defaults:

- **Bowed strings** (glissandi, scales, semitones, musical passages): Hann window, quiet-frame gate on, 1/12-octave smoothing, pitch tracking and a tuning check. Glissandi are preferred, because a slow slide excites all frequencies rather than only the notes of a scale. For scales and musical passages the spectrum peaks are the played notes; compare recordings of the same passage.
- **Bridge taps:** exponential window on each detected tap, 1/24-octave smoothing and a mode-damping table (section 2.8).

Glissandi are recognised automatically, from a keyword in the file name (glissando, glis, slide) or because the tracked pitch keeps sliding instead of holding notes. When most of the files are glissandi, the note-level view uses pitch bins along the slide (section 2.4) and the tuning check is skipped; the pitch box says so.

If every file name contains a keyword for one type as a separate word (for example glissando, scale, semitones, passage, excerpt or music for bowed recordings, and taps or impact for taps, or short forms such as semi, glis, tap or imp, as in violin6_taps_replicate1.wav), the type is set automatically and a message says so; if the names suggest both types, a warning is shown. Opening a new set of files returns all settings to their defaults, so adjust them after opening the files.

**Example recordings.** The links below the file box load example recordings to try the app with: glissandi (two takes before and two after an adjustment) and bridge taps. With the glissando examples, switch Compare to Group mean to see each condition's two takes averaged with an error band, then to Difference (B − A) to see what the adjustment changed; the note-level view shows the same comparison along the pitch of the slide.

#### 2.2 Choosing and playing recordings

The Visible audio layers checklist in the View section controls which files are shown and used in group calculations; all usable files are selected at first. The ▶ button next to each name plays that recording in the browser; press it again to stop, and starting another recording stops the current one. Most browsers play 16- and 24-bit WAV files, but some (notably Safari) cannot play 32-bit floating-point WAV files, which the app can still analyse.

#### 2.3 Plot modes and groups

- **Individual spectra:** one curve per recording.
- **Group mean ± error:** recordings with the same group name are averaged frequency by frequency. The error band is ±1 standard error (SE) or an approximate 95% confidence interval (±1.96 SE); it needs at least two recordings in a group.
- **Difference (B − A):** the mean of group B minus the mean of group A. Positive values mean B is louder at that frequency.

Group names are made from the file names by removing the extension and a trailing take number after a space, underscore or hyphen (with an optional tag such as replicate, rep, r, take, t, run or trial), so violin6_before_semitones_replicate1 and violin6_before_semitones_replicate2 both become violin6_before_semitones. A number written directly after letters, as in violin6 or strad1715, stays part of the name. Group names can be edited in group mean and difference mode. Recordings in one group are treated as independent repeats.

The vertical range adjusts itself to what is shown. In the spectrum view the top is 5 dB above the highest curve and the bottom just below the lowest level, ignoring the deepest 1% of points so that a single sharp notch does not stretch the axis; in the note-level view the range fits the points and their error bars. In difference mode the range is symmetric about zero.

#### 2.4 Spectrum and note-level views

For played recordings, the View switch changes between the spectrum and the note levels. In the note-level view each held note (at least 0.24 s on one pitch) becomes one point: its level at its measured, played frequency, including all its harmonics; a note played several times is combined into one point. This shows directly which notes are strong or weak, for example notes near A0 or the B1 modes, or wolf-prone notes. Because the points sit at the played frequency rather than the note name, recordings with different tuning overlay correctly. For glissandi, which have no held notes, the levels are grouped into 1/24-octave pitch bins along the slide.

With in-band normalization, note levels are in dB relative to the mean level of the recording's notes shown (within the common pitch range when that filter is on); without it they are in dBFS. Zoom, the readout and both exports follow the current view. Group means average each note across the files of a group. Differences are frequency-matched: group B's curve is read at group A's note frequencies, within the range both cover, so a tuning difference does not pair notes of different pitch. A note close to a sharp body resonance gets louder or softer as its pitch moves along the resonance (a B1 mode is only about 3% wide, roughly half a semitone), so part of a note-level change can come from intonation rather than the instrument.

#### 2.5 Band levels

The Band Levels menu adds a panel below the spectra with the power in a set of frequency bands, in dB relative to the total power from 188 to 7,080 Hz (right-hand axis). Each band is a bar spanning its frequency range, in the colour of its curve, and the values are printed below the panel, one row per series. Group means show whiskers for the chosen error, and difference mode shows the change in each band (B − A). For bowed recordings the same values are also listed in a Band levels table below the plot, one row per recording or group, with the frequency range of each band in the column headings and the error (± SE or 95% CI) after each group mean or difference. Band levels are computed from the unsmoothed spectra, so they do not depend on the smoothing or normalization settings. The band sets are:

- **Dünnwald regions:** six regions, labelled A–F, used by Dünnwald and by Buen to characterise violin sound: A 188–631 Hz (sonority, darkness), B 631–1,259 Hz (nasality), C 1,259–1,585 Hz, D 1,585–2,512 Hz and E 2,512–4,217 Hz (brilliance), F 4,217–7,080 Hz (sharpness, harshness).
- **Bark critical bands:** 18 bands (numbered 3 to 20, 200–6,400 Hz) that follow the frequency resolution of human hearing, a refinement of 1/3-octave bands; Curtin (2009) suggests them as the band average that best reflects hearing.
- **Bark violin zones** (default): the Bark bands grouped into seven zones that follow the violin's range and response: 1 low-string fundamentals, G and D strings (Bark 3–4, 200–400 Hz); 2 high-string fundamentals, A and E strings (Bark 5–7, 400–770 Hz); 3 highest fundamentals, high on the E string (Bark 8–10, 770–1,270 Hz); 4 upper midrange (Bark 11–12, 1,270–1,720 Hz); 5 bridge hill highs (Bark 13–16, 1,720–3,150 Hz); 6 upper hill highs (Bark 17–19, 3,150–5,300 Hz); 7 highest highs (Bark 20 and up to the top of the analysed range, 5,300–7,080 Hz).
- **Curtin 4 or 5 bands:** Joseph Curtin's coarse violin bands, 200–780–1,740–2,930–7,000 Hz or 200–780–1,740–3,000–5,200–7,000 Hz, numbered from 1. They roughly separate the signature modes, the transition region, the bridge hill and the upper range.

Keep in mind that two instruments with identical band levels need not sound alike: one may have a much peakier response than the other with the same energy in each band. Levels from bowed playing depend strongly on the passage, so compare recordings of the same passage.

<details>
<summary>Details: band definitions and caveats</summary>

Dünnwald regions are built from 63 base-10 1/12-octave bands (IEC 61260 even-fraction bands, mid-band frequencies 193.9 to 6,879 Hz, the convention of the Norsonic analyser used by Buen), grouped following Buen (2007); the exact region edges are 188.4, 631.0, 1,258.9, 1,584.9, 2,511.9, 4,217.0 and 7,079.5 Hz. Bark bands use Zwicker's edges (200, 300, 400, 510, 630, 770, 920, 1,080, 1,270, 1,480, 1,720, 2,000, 2,320, 2,700, 3,150, 3,700, 4,400, 5,300 and 6,400 Hz), numbered from band 1 = 0–100 Hz; they are the bands lying wholly within the analysed range. Curtin's bands come from the band settings of the ObieApp. In every case each FFT bin's power is allocated to the bands in proportion to its overlap with them.

Dünnwald derived his regions from sine-sweep responses measured with a bridge exciter in an anechoic room; Buen applied them to long-time-average spectra of commercial recordings, and this app follows Buen. Dünnwald's perceptual labels were not tested by listening experiments, and later work with virtual violins (Fritz et al. 2007) did not support them; listeners' thresholds for a change in a single band were about 2–3 dB.

Where bands are too narrow for their values to fit (the low Bark bands on a linear axis), some values are left out; zooming in shows them.

</details>

#### 2.6 Resonance regions

The plot always shades typical frequency ranges of the violin's signature modes and response features, as used by the ObieApp of the Oberlin violin acoustics workshop: A0 (the Helmholtz air mode, 264–290 Hz), CBR (380–420 Hz, usually a weak radiator), B1− (393–470 Hz), B1+ (473–593 Hz), the transition hill (800–1,300 Hz), the bridge hill (1,750–3,000 Hz) and the upper hill (3,000–7,000 Hz). The ranges vary between instruments, which is why CBR and B1− overlap; for background on the modes, see Woodhouse (2014). They come from bridge-admittance and radiation measurements: in a recording of a played violin they appear only as the envelope that strengthens harmonics falling near them, not as peaks of their own.

#### 2.7 The pitch box: pitch range and tuning

For played recordings the app tracks the pitch of the notes and shows a box below the plot.

- **Pitch range:** the range of notes played in each group. A long-term spectrum depends on which notes are played, so if the visible recordings differ by two semitones or more at either end, the box turns into a warning. Ticking Restrict to common pitch range (in Analysis settings) then removes, from every recording, the frames whose pitch lies outside the range all of them share, in the spectra and in the note-level view. The box reports the common range and the share of frames removed, and says when a range cannot be measured or there is no common range.
- **Tuning:** for scales and musical passages, each file's offset from equal temperament (A4 = 440 Hz, used only as a common reference) and the note-to-note spread of intonation. The offset combines string tuning and the player's average intonation. The box turns into a warning if groups differ by more than 10 cents, or if the note-to-note spread exceeds 15 cents, because the note peaks of different recordings then do not line up. Above 25 cents of spread the offset is shown as unclear. Glissandi are not assessed.

<details>
<summary>Details: how pitch range and tuning are measured</summary>

The pitch range runs from the 1st to the 99th percentile of the tracked pitches, ignoring stray single frames, and the common range is widened by half a semitone so that the end notes count. Frames without a detectable pitch, such as note transitions, are kept by the filter. A recording whose range cannot be measured (too few stable pitches) does not help set the common range, and the box names it.

The tuning check uses only held notes: at least 0.24 s on one pitch, with a drift slower than 80 cents per second, which skips transitions but allows vibrato. The offset is a circular mean of their deviations in cents, and the note-to-note spread (±) is a circular standard deviation of the per-note medians. In a quickly played chromatic scale the spread can easily reach ±20–40 cents even when the open strings are well tuned.

</details>

#### 2.8 Mode damping (taps)

For tap recordings, a table below the plot gives, in separate columns for each mode, the frequency, Q and damping ratio of the A0, B1− and B1+ modes in each visible file, and group means when a group has several files. Q is the peak frequency divided by the peak's width 3 dB below its top (its half-power bandwidth); a higher Q means a sharper, less damped resonance. The damping ratio is 1/(2Q). Each mode is taken as the highest peak within its resonance-region range (section 2.6).

No force sensor is needed: damping depends on the width of a peak, not its height, and the spectrum of a tap is smooth across a mode's few hertz. So unlike the levels, the frequencies and Q values are not just relative to other recordings. They do depend on how the instrument is held or supported, which adds damping of its own, so compare only recordings made with the same mounting.

- **Damp the strings.** A ringing string makes a very sharp peak that can be taken for a body mode, for example the A string near 440 Hz within the B1− range. Body modes typically have Q of about 10–60; a peak with Q above 100 is marked as a likely string and left out of group means. Independently of this table, every tap recording is checked at the four open-string pitches (allowing for tuning about 80 cents either way), and a warning appears if a string seems to have rung.
- **Window.** The exponential tap window widens every peak by a known amount, which is subtracted. A rectangular window (0 dB) needs no correction and shows sharp string peaks most clearly; it is suitable when each tap dies away within the frame.
- **When a mode is not reported.** If the highest point in a mode's range lies at its edge (the mode is outside the typical range on this instrument), or if the peak cannot be separated from a neighbour, such as CBR close to B1−, the table says so instead of giving a value.
- **Accuracy.** Room reflections, overlapping modes and inconsistent taps all widen or distort peaks. Use a close microphone, a room that is not too live, and several clean, evenly spaced taps.

#### 2.9 Frequency axis, zoom and readout

The Frequency Axis switch gives a logarithmic axis (the default, on which every octave has the same width) or a linear one (on which every hertz has the same width, so harmonic series are evenly spaced and the upper range gets more room). On the linear axis, crowded labels at low frequencies are thinned out; zoom in to see them all.

Drag across the plot to zoom into a frequency range, for example 200–700 Hz for the low-frequency modes; double-click or press Reset zoom to return. Hovering over the plot (or tapping it) shows the frequency, the nearest note and its deviation in cents, the band from the Band Levels menu, and the level of each visible curve.

#### 2.10 Exporting results

- **Export Chart:** the current plot as PNG, SVG or PDF, as shown (including zoom and axis choice). PNG and PDF are 3,000 × 1,800 pixels (10 × 6 inches at 300 dpi); SVG is vector graphics that can be edited in a drawing program.
- **Export Curve Data (CSV):** in the spectrum view, the curves over the full frequency range (Frequency_Hz, Level_dB, SE_dB, Series); in the note-level view, one row per note with its series, note name, played frequency, level and SE (and n for group means). Individual recordings have a blank SE, and difference curves use sqrt(SE_A² + SE_B²). The SE column does not depend on the error-band choice.

### 3. Analysis settings

The analysis settings are in the collapsible Analysis settings panel below the recording type, closed by default. Its header shows a one-line summary and whether the settings are the defaults, and a link inside restores the defaults for the current recording type.

#### FFT window size

Given in samples at 48 kHz: 4,096, 8,192, 16,384 (default) or 32,768. The frame duration, not the sample count, is kept fixed, so files at 44.1 or 96 kHz get the same frequency resolution as a 48 kHz file. The default gives 0.34 s frames and about 2.9 Hz resolution, enough for the narrowest 1/12-octave bands near 190 Hz. Smaller windows blur the lowest bands; at 4,096 the lowest band levels become less reliable.

#### Level normalization

- **In-band power (default):** each recording is scaled by its total power from 188 to 7,080 Hz (the Dünnwald range), which removes differences caused only by overall level. The axis is dB relative to in-band power per Hz.
- **None:** absolute spectral density in dBFS/Hz (a full-scale sine has a total power of 0 dBFS). Absolute comparisons are meaningful only if the recording gain was kept fixed.

#### Spectral smoothing

None, 1/24, 1/12, 1/6 or 1/3 octave. The default is 1/12 octave (one semitone, the resolution used by Buen) for played recordings and 1/24 octave for taps, whose resonance peaks are narrower. Smoothing affects only the curves, not the band levels.

**Comparing played recordings:** a spectrum of played notes has a peak at every note. If two recordings differ in tuning, their peaks fall at slightly different frequencies, and subtracting them gives large note-to-note swings that have nothing to do with the instrument (40 cents moves every peak by about 2.3%, or 12 Hz at 500 Hz). For comparisons and difference plots of played material, use 1/6- or 1/3-octave smoothing, which is far less sensitive to tuning, or the note-level view; keep 1/12 octave for single recordings or carefully matched ones. Band levels are much less affected.

#### Quiet-frame gate (played recordings)

Ignore quiet frames leaves out frames more than the chosen threshold below the loudest frame of the recording (default −40 dB). It removes pauses, whose background noise (hum, ventilation, traffic) would otherwise be added to the average, mostly below about 200 Hz and in the upper bands. Higher thresholds can also remove quiet playing and bias the spectrum toward loud playing, and an accidental knock raises the threshold. Turn the gate off for a strict long-time-average spectrum like Buen's; with normalization on, the difference is usually small.

#### Tap detection (impacts)

The app finds each tap where the signal first exceeds the detection threshold (set relative to the strongest tap in the file), takes one frame starting 2 ms before it, applies an exponential window, and averages the spectra of all usable taps. A message reports how many taps were used in each file and why any were skipped.

- **Window level at frame end:** the exponential window equals 1 at the impact and decays to this level at the frame end (default −40 dB), reducing noise and leakage from a response that has not died away. It adds a little artificial damping, broadening resonance peaks by about 4 Hz at the defaults, so compare recordings made with the same setting. 0 dB gives a rectangular window, suitable only if each tap has fully decayed within the frame, as with well-damped strings.
- **Skip clipped taps:** taps with any sample within 0.1% of full scale are left out, unless every usable tap in a file is clipped, in which case they are used and a warning is shown.
- **Double hits** (a bounce or second strike) are always rejected, as are frames that would run past either end of the file.

<details>
<summary>Details: why an exponential window, and how double hits are found</summary>

A Hann window is not suitable for taps because it suppresses the start of the frame, where the impact and the strongest response are; the exponential window is the standard response window in impact testing. A double hit is recognised as a sudden re-rise of at least 12 dB in the short-time envelope, to within 10 dB of the tap's peak, more than 10 ms after the impact; the normal beating and build-up of the body response in the first tens of milliseconds are not affected. A tap that follows sooner than one frame falls inside the previous tap's frame: a strong one makes that frame a double hit, a weak one is not detected and adds to its spectrum.

Curtin's measurements divide the microphone signal by the force measured in the hammer tip, which removes the tap's own spectrum and also makes double hits harmless. This app has no force signal, so it rejects double hits instead.

</details>

### 4. Interpretation and limitations

- Relative comparisons are the strength of this tool: recordings made by one player, with the same passage, microphone setup and room, are generally consistent, so comparisons between instruments or before and after an adjustment are meaningful. Absolute levels and the absolute shape of a spectrum also contain the player's bowing, the room and the microphone, and (for taps) the tap itself, none of which the analysis removes.
- A spectrum describes how recorded energy is distributed across frequency. It does not by itself measure violin quality.
- Error bands are only as good as the replicates behind them: interpret them in light of how many recordings there are and how independent they are.
- The app is a comparative analysis tool, not a calibrated acoustic measurement system.
- Recordings are analysed in your browser and are never uploaded or stored: closing or reloading the page discards them.

### 5. Methods

**Signal preparation.** Each WAV file is read by the app's own WAV reader (8-, 16-, 24- and 32-bit integer and 32- and 64-bit floating-point PCM, including WAVE_FORMAT_EXTENSIBLE files). Stereo or multichannel recordings are averaged to mono, the mean is subtracted to remove DC offset, and integer PCM is scaled to ±1 full scale.

**Spectra.** The frame duration is the selected window size divided by 48,000 (in seconds), converted to a length in samples at the file's sample rate and adjusted to the nearest length with small prime factors. Frames overlap by 50%, are multiplied by a periodic Hann window, transformed with the FFT and averaged as power (Welch's method). The scaling makes the single-sided bins sum to the mean-square signal value, so dividing by the bin width gives a power spectral density; curve levels therefore do not depend on the window size for broadband content. At the default window, even the narrowest 1/12-octave band (about 11.2 Hz wide near 190 Hz) holds about 3.8 FFT bins; at 4,096 the Hann main lobe (about 23 Hz) is wider than those bands. Without smoothing, the height of a narrow tonal peak still rises about 3 dB per doubling of the window size; fractional-octave smoothing removes this dependence. Optional RMS gating removes quiet frames before averaging, and the common-pitch-range filter removes frames whose tracked pitch lies outside the common range. For taps, single frames aligned to each detected tap are exponentially windowed and their power spectra averaged, with the same scaling.

**Mode damping.** In the averaged, unsmoothed tap spectrum, the highest bin within a mode's range is refined by parabolic interpolation (in dB) to give the peak frequency, and the half-power points are found by linear interpolation where the spectrum first falls 3 dB below the peak on each side, within 20% of the peak frequency. An exponential window that falls to L dB at the frame end (length T) adds a decay rate 1/τ = −ln(10^(L/20)) / T, which widens every peak by 1/(πτ) Hz; this is subtracted from the measured width. Q = f / bandwidth and the damping ratio is 1/(2Q). Tested on synthetic taps with known Q of 25–50, the estimate was within about 2% for window end levels from 0 to −40 dB.

**Post-processing.** Band levels are computed from the unsmoothed spectrum. For the curves, the density is optionally normalized by in-band power, optionally smoothed in the power domain, interpolated linearly (in power) onto a common grid from 180 to 7,080 Hz with spacing 48,000 / window size, and converted to dB.

**Pitch tracking.** The fundamental frequency is estimated in 80 ms frames every 40 ms by normalized autocorrelation (Hann window, corrected for the window's own autocorrelation, with parabolic refinement), in frames within 30 dB of the loudest. The first autocorrelation peak within 90% of the highest is taken, which avoids octave errors, and pitches from 180 to 2,200 Hz (up to about C#7) are tracked. Held notes are runs of at least six frames (0.24 s) on one nearest note with a fitted drift below 80 cents per second.

**Group summaries.** At each frequency, and for each band level, the recordings of a group are averaged in the power domain: levels are converted from dB to power, averaged, and converted back. This is the physically consistent mean (spectra are averaged the same way across frames, taps and microphone positions); with level normalization on, it reflects differences in spectral shape rather than loudness. The standard error in dB comes from the standard deviation of the power values by the delta method, SE_dB = 4.343 × SD(power) / (√n × mean power), which is accurate when the repeats do not differ wildly. The 95% confidence interval is ±1.96 SE (normal approximation) for group means and for differences, where the SE of a difference is √(SE_A² + SE_B²), treating the groups as independent. With the few replicates usual here, a t interval would be very wide (12.7 SE for two recordings) and a z interval is a more useful guide. It is only approximate: with two or three recordings per group the true uncertainty is considerably larger, so treat a difference that only just clears the interval as unconfirmed.

### 6. About this version

This is a browser version of the Violin Acoustic Spectrum Analyzer, which was first written in R (Shiny). All of the analysis runs in JavaScript on your own computer. It was checked against the R version: on the example recordings and on synthetic test signals the spectra, band levels, pitch tracks, tuning offsets and mode-damping estimates agree to within rounding.

### References

- Buen, A. (2005). Comparing the sound of golden age and modern violins: Long-time-average spectra. VSA Papers 1(1), 51–74.
- Buen, A. (2007). On timbre parameters and sound levels of recorded old violins. J. Violin Soc. Am.: VSA Papers 21(1), 57–68.
- Curtin, J. (2009). Measuring violin sound radiation using an impact hammer. J. Violin Soc. Am.: VSA Papers 22(1), 186–209.
- Dünnwald, H. (1990). Ein erweitertes Verfahren zur objektiven Bestimmung der Klangqualität von Violinen. Acustica 71, 269–276.
- Dünnwald, H. (1991). Deduction of objective quality parameters on old and new violins. Catgut Acoust. Soc. J. 1(7), Series II, 1–5.
- Fritz, C., Cross, I., Moore, B.C.J. & Woodhouse, J. (2007). Perceptual thresholds for detecting modifications applied to the acoustical properties of a violin. J. Acoust. Soc. Am. 122, 3640–3650.
- Morset, L. H. (2001). A low-cost PC-based tool for violin acoustics measurements. Catgut Acoust. Soc. J. 4(4), Series II, 45–48.
- Woodhouse, J. (2014). The acoustics of the violin: a review. Rep. Prog. Phys. 77, 115901.

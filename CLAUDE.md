# MyoScope: project guide for Claude Code

## What this is
A real-time EMG (electromyography) dashboard built as a portfolio project for a
Software Engineering co-op at Delsys (wearable EMG sensors). It streams data from
simulated body-worn sensors, processes it live, and visualizes muscle activity.

The target role emphasizes: UI for body-worn sensor software, real-time
visualizations and dashboards, Figma, React, strong OOP, and **MVVM**.
Every change should strengthen those signals.

## Stack
React 18 + TypeScript + Vite. No UI or chart libraries; charts are hand-drawn on
canvas for performance. Plain CSS in `src/index.css` with tokens in `:root`.

## Commands
- `npm install`, then `npm run dev` (local dev server)
- `npm run build` (type-check + production build into `dist/`)

## Architecture rules (MVVM). Do not break these.
- **Model** (`src/model/`): pure TypeScript. No React, no DOM. Sensor simulation,
  signal processing, buffers. Must stay unit-testable in isolation.
- **ViewModel** (`src/viewmodel/`): classes extending `ObservableObject`. Own all
  app state. Expose an immutable snapshot plus **commands** (arrow-function methods
  like `start`, `stop`, `calibrate`). No JSX, no DOM APIs.
- **View** (`src/views/`): React components. Read state only via `useViewModel(vm)`
  and call ViewModel commands. Never import from `src/model/` except constants.
  Platform concerns (file downloads, canvas drawing) live here.
- High-frequency data (2,000 Hz × channels) must never go through React state.
  Canvas reads ViewModel buffers directly via `getTrace()` on requestAnimationFrame.
  Snapshot publishing stays throttled (currently 10×/s).

## Current state (Day 1 complete, Day 2 items 1–3 done)
- 4 simulated EMG channels at 2,000 Hz performing bicep curls
- Moving RMS envelope (100 ms window), live scrolling traces with min/max decimation
- Calibration flow (relax → max contraction → normalize to % of max)
- Rep counting with hysteresis, peak tracking, sensor battery/signal-quality panel
- Channel show/hide, adjustable time window, CSV export of envelopes at 100 Hz
- Fatigue indicator (biceps): `src/model/Spectrum.ts` has a hand-written radix-2 FFT and
  `MedianFrequencyAnalyzer` (Hann window, 20–450 Hz band). The ViewModel analyzes the
  latest 1 s of raw signal once per second (skipped during calibration). The first 5
  points set the baseline. Status uses a 5-point average: Fresh, then Tiring at 10% below
  baseline, then Fatigued at 20%. Keeps 5 min of history; Reset clears it.
  View: `FatiguePanel` in the sidebar (SVG trend, since the data only updates at 1 Hz).
- Simulator: muscle signal is Gaussian noise shaped by two cascaded band-pass biquads
  (normalized to unit variance); sensor noise stays white. The band center falls from
  90 Hz toward 50 Hz as exercise reps accumulate (biceps most, others less). Measured
  median frequency is about 104 Hz fresh. It reaches Tiring at ~40 s and Fatigued at
  ~70 s. `resetFatigue()` is called on Reset.
- Bandpass filter: `src/model/Filter.ts` has an RBJ `Biquad` (Direct Form II Transposed),
  `butterworthQs(order)` and `BandpassFilter` (4th-order Butterworth high-pass at 20 Hz
  then low-pass at 450 Hz; −3 dB exactly at both edges). Each channel keeps two signal
  paths (raw and filtered), each with its own trace, envelope, peak and calibration.
  The toolbar checkbox (`toggleFilter`, on by default) only switches which path is
  displayed. Rep counting and CSV export always use the filtered path; fatigue uses the
  raw trace (its analyzer band-limits to 20–450 Hz anyway). `getTrace` returns `{ signal, envelope }`.
- Simulator adds artifacts for the filter to remove: per-electrode DC offset plus motion
  artifact (follows the curl, with 3 Hz cable sway) during exercise only. Sensor 4's loose
  electrode moves most: with the filter off its peak reads ~0.97 mV vs ~0.31 mV filtered.
- Sensor events: sensor 4 drops its wireless link for 4 s, first at 15 s of streaming,
  then every 45 s (only starts in exercise mode, so calibration is never interrupted).
  `generate()` returns `null` for a disconnected channel, like missing packets. The
  ViewModel pushes NaN into its buffers so channels stay time-aligned and the canvas
  draws a gap (NaN columns skipped, envelope line lifted). Filter and RMS state reset on
  reconnect. `ChannelViewState.connection` is 'connected' | 'reconnecting' |
  'reconnected' (the last shows for 2 s). View: strip greys out with "Signal lost.
  Reconnecting…", sensor list shows a "Reconnecting…" label, and lost samples export as
  blank CSV cells.

## Roadmap
### Day 2
1. **Fatigue indicator**: compute median frequency of the raw biceps signal over
   sliding 1 s windows (FFT in `src/model/Spectrum.ts`). Show a small trend chart;
   a falling median frequency means fatigue. Make the simulator's signal shift to
   lower frequencies as reps accumulate so the trend is visible.
2. **Bandpass filter** (20–450 Hz, Butterworth biquads) in `src/model/Filter.ts`,
   applied before RMS. Add a toggle so the user can compare raw vs filtered.
3. **Sensor events**: simulated dropout/reconnect on one sensor with a clear UI
   state (greyed trace, "Reconnecting…" status). Shows UI strategy for real hardware.
4. Unit tests with Vitest for RingBuffer, RmsEnvelope, Filter, Spectrum.

### Day 3
1. Match styling to the Figma design (link it in README).
2. Keyboard shortcuts (Space = start/stop, C = calibrate) and an accessibility pass.
3. README: screenshots, demo GIF, architecture diagram, signal pipeline.
4. Deploy to GitHub Pages (`vite.config.ts` already uses `base: './'`).

## Conventions
- User-facing copy: plain language, sentence case, active verbs.
- Keep files small and single-purpose. Document *why* in comments, not *what*.
- When adding a feature, add it in this order: Model → ViewModel command/state → View.

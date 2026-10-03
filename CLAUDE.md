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

## Current state (Day 1 complete)
- 4 simulated EMG channels at 2,000 Hz performing bicep curls
- Moving RMS envelope (100 ms window), live scrolling traces with min/max decimation
- Calibration flow (relax → max contraction → normalize to % of max)
- Rep counting with hysteresis, peak tracking, sensor battery/signal-quality panel
- Channel show/hide, adjustable time window, CSV export of envelopes at 100 Hz

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

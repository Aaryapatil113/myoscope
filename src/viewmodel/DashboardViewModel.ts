import { ObservableObject } from './ObservableObject';
import { CHANNELS, SAMPLE_RATE, SensorSimulator } from '../model/SensorSimulator';
import { RingBuffer } from '../model/RingBuffer';
import { RmsEnvelope } from '../model/RmsEnvelope';
import { BandpassFilter } from '../model/Filter';
import { MedianFrequencyAnalyzer } from '../model/Spectrum';
import type { ChannelConfig, SensorStatus } from '../model/types';

const TICK_MS = 20; // process a new block of samples 50× per second
const SAMPLES_PER_TICK = (SAMPLE_RATE * TICK_MS) / 1000;
const PUBLISH_EVERY_TICKS = 5; // refresh numeric readouts 10× per second
const MAX_WINDOW_SECONDS = 10;
const RMS_WINDOW_SAMPLES = 0.1 * SAMPLE_RATE; // 100 ms window
const RELAX_SECONDS = 3;
const CONTRACT_SECONDS = 3;
const COMPLETE_SECONDS = 2;
const EXPORT_DECIMATION = 20; // 2000 Hz → 100 Hz in the CSV
const MAX_EXPORT_ROWS = 100 * 60 * 30; // 30 minutes
const FILTER_LOW_HZ = 20; // below this: electrode offset and motion artifact
const FILTER_HIGH_HZ = 450; // above this: amplifier noise, little muscle content
const RECONNECTED_NOTICE_SECONDS = 2; // how long "Reconnected" stays up before clearing
const FATIGUE_CHANNEL = 0; // biceps, the prime mover in a curl
const FATIGUE_WINDOW_SAMPLES = SAMPLE_RATE; // analyze the latest 1 s of raw signal…
const FATIGUE_INTERVAL_SAMPLES = SAMPLE_RATE; // …once per second, not every sample
const FATIGUE_HISTORY_POINTS = 300; // 5 minutes of trend
const FATIGUE_BASELINE_POINTS = 5; // the first 5 s set this session's "fresh" level
const FATIGUE_SMOOTHING_POINTS = 5; // a single 1 s estimate is noisy; status uses a 5 s average
const TIRING_DROP = 0.1; // 10% below baseline
const FATIGUED_DROP = 0.2; // 20% below baseline

export type CalibrationPhase = 'none' | 'relax' | 'contract' | 'complete';
export type ConnectionState = 'connected' | 'reconnecting' | 'reconnected';
export type FatigueStatus = 'waiting' | 'fresh' | 'tiring' | 'fatigued';

export interface FatigueState {
  muscle: string;
  color: string;
  medianHz: number | null; // latest 1 s estimate
  baselineHz: number | null; // null until enough data is in
  changePercent: number | null; // smoothed change from baseline, negative = lower
  status: FatigueStatus;
  history: readonly number[]; // one point per second, oldest first
}

export interface ChannelViewState extends ChannelConfig {
  visible: boolean;
  rmsMv: number;
  peakMv: number;
  mvcMv: number | null;
  percentMvc: number | null;
  status: SensorStatus;
  connection: ConnectionState;
}

export interface DashboardState {
  isStreaming: boolean;
  elapsedSeconds: number;
  windowSeconds: number;
  repCount: number;
  calibration: { phase: CalibrationPhase; secondsLeft: number };
  isCalibrated: boolean;
  hasData: boolean;
  channels: ChannelViewState[];
  fatigue: FatigueState;
  filter: { enabled: boolean; lowHz: number; highHz: number };
}

/** One version of a channel's signal (raw or filtered) and everything derived from it. */
interface SignalPath {
  trace: RingBuffer;
  envelope: RingBuffer;
  rms: RmsEnvelope;
  current: number;
  peak: number;
  calibrationPeak: number;
  mvc: number | null;
}

/**
 * Both paths are always computed, so the filter toggle switches the display
 * instantly (including the history on screen) and each keeps its own calibration.
 */
interface ChannelPipeline {
  filter: BandpassFilter;
  raw: SignalPath;
  filtered: SignalPath;
  connected: boolean;
  reconnectedUntil: number; // session sample index; shows "Reconnected" until then
}

function createPath(): SignalPath {
  return {
    trace: new RingBuffer(MAX_WINDOW_SECONDS * SAMPLE_RATE),
    envelope: new RingBuffer(MAX_WINDOW_SECONDS * SAMPLE_RATE),
    rms: new RmsEnvelope(RMS_WINDOW_SAMPLES),
    current: 0,
    peak: 0,
    calibrationPeak: 0,
    mvc: null,
  };
}

function clearPath(path: SignalPath): void {
  path.trace.clear();
  path.envelope.clear();
  path.rms.reset();
  path.current = 0;
  path.peak = 0;
  path.mvc = null;
}

export class DashboardViewModel extends ObservableObject<DashboardState> {
  private simulator = new SensorSimulator(CHANNELS);
  private pipelines: ChannelPipeline[] = CHANNELS.map(() => ({
    filter: new BandpassFilter(FILTER_LOW_HZ, FILTER_HIGH_HZ, SAMPLE_RATE),
    raw: createPath(),
    filtered: createPath(),
    connected: true,
    reconnectedUntil: 0,
  }));
  private filterEnabled = true;
  private hidden = new Set<number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private tickCount = 0;
  private sessionSamples = 0;
  private windowSeconds = 5;
  private repCount = 0;
  private repArmed = true;
  private calibration = { phase: 'none' as CalibrationPhase, samplesLeft: 0 };
  private recording: number[][] = [];
  private spectrum = new MedianFrequencyAnalyzer(FATIGUE_WINDOW_SAMPLES, SAMPLE_RATE);
  private spectrumInput = new Float32Array(FATIGUE_WINDOW_SAMPLES);
  private samplesSinceFatigue = 0;
  // Replaced (never mutated) on each new point so snapshots stay immutable
  private fatigueHistory: readonly number[] = [];
  private fatigueBaseline: number | null = null;

  constructor() {
    super();
    this.emit();
  }

  // ── Commands (bound to buttons in the View) ─────────────────────────

  start = (): void => {
    if (this.timer !== null) return;
    this.timer = setInterval(this.tick, TICK_MS);
    this.emit();
  };

  stop = (): void => {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (this.calibration.phase !== 'none') this.endCalibration();
    this.emit();
  };

  reset = (): void => {
    this.stop();
    this.pipelines.forEach((p) => {
      p.filter.reset();
      clearPath(p.raw);
      clearPath(p.filtered);
      p.connected = true;
      p.reconnectedUntil = 0;
    });
    this.sessionSamples = 0;
    this.repCount = 0;
    this.repArmed = true;
    this.recording = [];
    this.samplesSinceFatigue = 0;
    this.fatigueHistory = [];
    this.fatigueBaseline = null;
    this.simulator.resetFatigue();
    this.emit();
  };

  calibrate = (): void => {
    this.pipelines.forEach((p) => {
      p.raw.calibrationPeak = 0;
      p.filtered.calibrationPeak = 0;
    });
    this.calibration = { phase: 'relax', samplesLeft: RELAX_SECONDS * SAMPLE_RATE };
    this.simulator.mode = 'rest';
    if (this.timer === null) this.start();
    else this.emit();
  };

  toggleChannel = (id: number): void => {
    if (this.hidden.has(id)) this.hidden.delete(id);
    else this.hidden.add(id);
    this.emit();
  };

  /** Switches what the user sees. Rep counting and export always use the filtered signal. */
  toggleFilter = (): void => {
    this.filterEnabled = !this.filterEnabled;
    this.emit();
  };

  setWindowSeconds = (seconds: number): void => {
    this.windowSeconds = Math.min(Math.max(seconds, 1), MAX_WINDOW_SECONDS);
    this.emit();
  };

  /**
   * Returns CSV text. The View decides how to save it (platform concern).
   * Always the filtered envelope, so toggling mid-session never mixes signals in one file.
   */
  exportCsv = (): string | null => {
    if (this.recording.length === 0) return null;
    const header = ['time_s', ...CHANNELS.map((c) => `${c.muscle.replace(/\s+/g, '_')}_rms_mV`)];
    // Samples lost while a sensor was disconnected stay blank rather than looking like zero
    const rows = this.recording.map((r) => [
      r[0].toFixed(2),
      ...r.slice(1).map((v) => (Number.isNaN(v) ? '' : v.toFixed(4))),
    ]);
    return [header, ...rows].map((r) => r.join(',')).join('\n');
  };

  /**
   * Direct buffer access for high-frequency drawing. Canvas reads this every frame,
   * bypassing React. Returns the raw or filtered signal depending on the toggle.
   */
  getTrace = (channelId: number): { signal: RingBuffer; envelope: RingBuffer } => {
    const path = this.displayed(this.pipelines[CHANNELS.findIndex((c) => c.id === channelId)]);
    return { signal: path.trace, envelope: path.envelope };
  };

  dispose = (): void => this.stop();

  // ── Processing loop ─────────────────────────────────────────────────

  private tick = (): void => {
    const blocks = this.simulator.generate(SAMPLES_PER_TICK);
    // Only track peaks and reps during normal exercise, not while calibrating or settling after it
    const tracking = this.calibration.phase === 'none';
    const lastEnvelope = new Array<number>(CHANNELS.length).fill(0);
    blocks.forEach((block, c) => this.updateConnection(this.pipelines[c], block !== null));

    for (let k = 0; k < SAMPLES_PER_TICK; k++) {
      for (let c = 0; c < CHANNELS.length; c++) {
        const p = this.pipelines[c];
        const block = blocks[c];
        if (block === null) {
          this.pushGap(p);
          lastEnvelope[c] = NaN;
          continue;
        }
        const sample = block[k];
        this.process(p.raw, sample, tracking);
        lastEnvelope[c] = this.process(p.filtered, p.filter.next(sample), tracking);
      }
      if ((this.sessionSamples + k) % EXPORT_DECIMATION === 0 && this.recording.length < MAX_EXPORT_ROWS) {
        this.recording.push([(this.sessionSamples + k) / SAMPLE_RATE, ...lastEnvelope]);
      }
    }
    this.sessionSamples += SAMPLES_PER_TICK;

    this.advanceCalibration();
    if (tracking) this.detectReps();
    this.updateFatigue(tracking);

    this.tickCount++;
    if (this.tickCount % PUBLISH_EVERY_TICKS === 0) this.emit();
  };

  /** Pushes one sample through a signal path and returns its new envelope value. */
  private process(path: SignalPath, sample: number, tracking: boolean): number {
    const env = path.rms.next(sample);
    path.trace.push(sample);
    path.envelope.push(env);
    path.current = env;
    if (this.calibration.phase === 'contract') path.calibrationPeak = Math.max(path.calibrationPeak, env);
    else if (tracking) path.peak = Math.max(path.peak, env);
    return env;
  }

  /**
   * Missing samples go in as NaN so every channel stays time-aligned in its
   * buffer and the canvas can draw the loss as a visible gap.
   */
  private pushGap(p: ChannelPipeline): void {
    for (const path of [p.raw, p.filtered]) {
      path.trace.push(NaN);
      path.envelope.push(NaN);
      path.current = 0;
    }
  }

  private updateConnection(p: ChannelPipeline, linked: boolean): void {
    if (linked === p.connected) return;
    p.connected = linked;
    if (linked) {
      // The signal restarts after a gap, so old filter and RMS state no longer applies
      p.filter.reset();
      p.raw.rms.reset();
      p.filtered.rms.reset();
      p.reconnectedUntil = this.sessionSamples + RECONNECTED_NOTICE_SECONDS * SAMPLE_RATE;
    }
    this.emit(); // connection changes show immediately, not on the next 100 ms publish
  }

  private connectionState(p: ChannelPipeline): ConnectionState {
    if (!p.connected) return 'reconnecting';
    return this.sessionSamples < p.reconnectedUntil ? 'reconnected' : 'connected';
  }

  private displayed(p: ChannelPipeline): SignalPath {
    return this.filterEnabled ? p.filtered : p.raw;
  }

  private advanceCalibration(): void {
    const cal = this.calibration;
    if (cal.phase === 'none') return;
    cal.samplesLeft -= SAMPLES_PER_TICK;
    if (cal.samplesLeft > 0) return;

    if (cal.phase === 'relax') {
      this.calibration = { phase: 'contract', samplesLeft: CONTRACT_SECONDS * SAMPLE_RATE };
      this.simulator.mode = 'maxContraction';
    } else if (cal.phase === 'contract') {
      this.pipelines.forEach((p) => {
        for (const path of [p.raw, p.filtered]) {
          // A sensor that was offline for the whole contraction has nothing to calibrate against
          path.mvc = path.calibrationPeak > 0 ? path.calibrationPeak : null;
          path.peak = 0;
        }
      });
      this.calibration = { phase: 'complete', samplesLeft: COMPLETE_SECONDS * SAMPLE_RATE };
      this.simulator.mode = 'exercise';
      this.repArmed = true;
    } else {
      this.calibration = { phase: 'none', samplesLeft: 0 };
    }
    this.emit();
  }

  private endCalibration(): void {
    this.calibration = { phase: 'none', samplesLeft: 0 };
    this.simulator.mode = 'exercise';
  }

  /**
   * Counts reps from the biceps envelope using hysteresis (two thresholds).
   * Uses the filtered signal regardless of the toggle: motion artifact in the raw
   * signal keeps the resting level above the re-arm threshold.
   */
  private detectReps(): void {
    const biceps = this.pipelines[0].filtered;
    const level = biceps.mvc ? biceps.current / biceps.mvc : biceps.current / 0.7;
    if (this.repArmed && level > 0.35) {
      this.repCount++;
      this.repArmed = false;
    } else if (!this.repArmed && level < 0.15) {
      this.repArmed = true;
    }
  }

  /**
   * Once per second, takes the median frequency of the latest 1 s of raw biceps
   * signal. Skipped during calibration, where the forced rest/max phases would
   * distort the trend.
   */
  private updateFatigue(tracking: boolean): void {
    this.samplesSinceFatigue += SAMPLES_PER_TICK;
    if (this.samplesSinceFatigue < FATIGUE_INTERVAL_SAMPLES) return;
    this.samplesSinceFatigue = 0;

    const raw = this.pipelines[FATIGUE_CHANNEL].raw.trace;
    if (!tracking || raw.length < FATIGUE_WINDOW_SAMPLES) return;

    const offset = raw.length - FATIGUE_WINDOW_SAMPLES;
    for (let i = 0; i < FATIGUE_WINDOW_SAMPLES; i++) this.spectrumInput[i] = raw.at(offset + i);
    const medianHz = this.spectrum.analyze(this.spectrumInput);
    if (medianHz === null) return;

    this.fatigueHistory = [...this.fatigueHistory, medianHz].slice(-FATIGUE_HISTORY_POINTS);
    if (this.fatigueBaseline === null && this.fatigueHistory.length >= FATIGUE_BASELINE_POINTS) {
      this.fatigueBaseline = average(this.fatigueHistory.slice(0, FATIGUE_BASELINE_POINTS));
    }
  }

  private fatigueState(): FatigueState {
    const history = this.fatigueHistory;
    const baseline = this.fatigueBaseline;
    let changePercent: number | null = null;
    let status: FatigueStatus = 'waiting';
    if (baseline !== null) {
      const change = average(history.slice(-FATIGUE_SMOOTHING_POINTS)) / baseline - 1;
      changePercent = change * 100;
      status = change <= -FATIGUED_DROP ? 'fatigued' : change <= -TIRING_DROP ? 'tiring' : 'fresh';
    }
    return {
      muscle: CHANNELS[FATIGUE_CHANNEL].muscle,
      color: CHANNELS[FATIGUE_CHANNEL].color,
      medianHz: history.length > 0 ? history[history.length - 1] : null,
      baselineHz: baseline,
      changePercent,
      status,
      history,
    };
  }

  private emit(): void {
    const channels: ChannelViewState[] = CHANNELS.map((cfg, c) => {
      const p = this.displayed(this.pipelines[c]);
      const connection = this.connectionState(this.pipelines[c]);
      return {
        ...cfg,
        visible: !this.hidden.has(cfg.id),
        rmsMv: p.current,
        peakMv: p.peak,
        mvcMv: p.mvc,
        percentMvc: p.mvc ? Math.min((p.current / p.mvc) * 100, 150) : null,
        status: this.simulator.status(c),
        connection,
      };
    });

    this.publish({
      isStreaming: this.timer !== null,
      elapsedSeconds: this.sessionSamples / SAMPLE_RATE,
      windowSeconds: this.windowSeconds,
      repCount: this.repCount,
      calibration: {
        phase: this.calibration.phase,
        secondsLeft: Math.ceil(this.calibration.samplesLeft / SAMPLE_RATE),
      },
      isCalibrated: this.pipelines.every((p) => p.filtered.mvc !== null),
      hasData: this.sessionSamples > 0,
      channels,
      fatigue: this.fatigueState(),
      filter: { enabled: this.filterEnabled, lowHz: FILTER_LOW_HZ, highHz: FILTER_HIGH_HZ },
    });
  }
}

function average(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

import { ObservableObject } from './ObservableObject';
import { CHANNELS, SAMPLE_RATE, SensorSimulator } from '../model/SensorSimulator';
import { RingBuffer } from '../model/RingBuffer';
import { RmsEnvelope } from '../model/RmsEnvelope';
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
const FATIGUE_CHANNEL = 0; // biceps, the prime mover in a curl
const FATIGUE_WINDOW_SAMPLES = SAMPLE_RATE; // analyze the latest 1 s of raw signal…
const FATIGUE_INTERVAL_SAMPLES = SAMPLE_RATE; // …once per second, not every sample
const FATIGUE_HISTORY_POINTS = 300; // 5 minutes of trend
const FATIGUE_BASELINE_POINTS = 5; // the first 5 s set this session's "fresh" level
const FATIGUE_SMOOTHING_POINTS = 5; // a single 1 s estimate is noisy; status uses a 5 s average
const TIRING_DROP = 0.1; // 10% below baseline
const FATIGUED_DROP = 0.2; // 20% below baseline

export type CalibrationPhase = 'none' | 'relax' | 'contract' | 'complete';
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
}

interface ChannelPipeline {
  raw: RingBuffer;
  envelope: RingBuffer;
  rms: RmsEnvelope;
  current: number;
  peak: number;
  calibrationPeak: number;
  mvc: number | null;
}

export class DashboardViewModel extends ObservableObject<DashboardState> {
  private simulator = new SensorSimulator(CHANNELS);
  private pipelines: ChannelPipeline[] = CHANNELS.map(() => ({
    raw: new RingBuffer(MAX_WINDOW_SECONDS * SAMPLE_RATE),
    envelope: new RingBuffer(MAX_WINDOW_SECONDS * SAMPLE_RATE),
    rms: new RmsEnvelope(RMS_WINDOW_SAMPLES),
    current: 0,
    peak: 0,
    calibrationPeak: 0,
    mvc: null,
  }));
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
      p.raw.clear();
      p.envelope.clear();
      p.rms.reset();
      p.current = 0;
      p.peak = 0;
      p.mvc = null;
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
    this.pipelines.forEach((p) => (p.calibrationPeak = 0));
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

  setWindowSeconds = (seconds: number): void => {
    this.windowSeconds = Math.min(Math.max(seconds, 1), MAX_WINDOW_SECONDS);
    this.emit();
  };

  /** Returns CSV text. The View decides how to save it (platform concern). */
  exportCsv = (): string | null => {
    if (this.recording.length === 0) return null;
    const header = ['time_s', ...CHANNELS.map((c) => `${c.muscle.replace(/\s+/g, '_')}_rms_mV`)];
    const rows = this.recording.map((r) => [r[0].toFixed(2), ...r.slice(1).map((v) => v.toFixed(4))]);
    return [header, ...rows].map((r) => r.join(',')).join('\n');
  };

  /** Raw access for high-frequency drawing. Canvas reads this every frame, bypassing React. */
  getTrace = (channelId: number): { raw: RingBuffer; envelope: RingBuffer } => {
    const p = this.pipelines[CHANNELS.findIndex((c) => c.id === channelId)];
    return { raw: p.raw, envelope: p.envelope };
  };

  dispose = (): void => this.stop();

  // ── Processing loop ─────────────────────────────────────────────────

  private tick = (): void => {
    const blocks = this.simulator.generate(SAMPLES_PER_TICK);
    // Only track peaks and reps during normal exercise, not while calibrating or settling after it
    const tracking = this.calibration.phase === 'none';
    const lastEnvelope = new Array<number>(CHANNELS.length).fill(0);

    for (let k = 0; k < SAMPLES_PER_TICK; k++) {
      for (let c = 0; c < CHANNELS.length; c++) {
        const p = this.pipelines[c];
        const sample = blocks[c][k];
        const env = p.rms.next(sample);
        p.raw.push(sample);
        p.envelope.push(env);
        p.current = env;
        lastEnvelope[c] = env;
        if (this.calibration.phase === 'contract') p.calibrationPeak = Math.max(p.calibrationPeak, env);
        else if (tracking) p.peak = Math.max(p.peak, env);
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
        p.mvc = p.calibrationPeak;
        p.peak = 0;
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

  /** Counts reps from the biceps envelope using hysteresis (two thresholds). */
  private detectReps(): void {
    const biceps = this.pipelines[0];
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

    const raw = this.pipelines[FATIGUE_CHANNEL].raw;
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
      const p = this.pipelines[c];
      return {
        ...cfg,
        visible: !this.hidden.has(cfg.id),
        rmsMv: p.current,
        peakMv: p.peak,
        mvcMv: p.mvc,
        percentMvc: p.mvc ? Math.min((p.current / p.mvc) * 100, 150) : null,
        status: this.simulator.status(c),
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
      isCalibrated: this.pipelines.every((p) => p.mvc !== null),
      hasData: this.sessionSamples > 0,
      channels,
      fatigue: this.fatigueState(),
    });
  }
}

function average(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

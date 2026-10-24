import type { ChannelConfig, SensorStatus, SubjectMode, SignalQuality } from './types';

export const SAMPLE_RATE = 2000; // Hz, typical for surface EMG
const REP_SECONDS = 3; // one bicep curl: lift, hold, lower, rest
const MAX_AMPLITUDE_MV = 1.0; // RMS amplitude at full contraction
const BASELINE_NOISE_MV = 0.012;
const HUM_MV = 0.006; // 60 Hz powerline interference

// Muscle signal is band-limited noise. Its centre frequency falls as the muscle
// fatigues, which is what the median-frequency fatigue indicator picks up.
const EMG_CENTER_FRESH_HZ = 90;
const EMG_CENTER_FATIGUED_HZ = 50;
const EMG_Q = 0.7; // broad band, like real surface EMG
const FATIGUE_REPS = 30; // reps to reach ~63% of the full shift (about 90 s of curls)

// Wireless dropouts: sensor 4 (weakest battery, loose electrode) loses its link on a
// fixed schedule so the reconnect UI can be demoed predictably.
const DROPOUT_SENSOR_ID = 4;
const FIRST_DROPOUT_SECONDS = 15;
const DROPOUT_EVERY_SECONDS = 45;
const DROPOUT_SECONDS = 4;

export const CHANNELS: ChannelConfig[] = [
  { id: 1, muscle: 'Biceps brachii', side: 'Right', color: '#C2304B' },
  { id: 2, muscle: 'Triceps brachii', side: 'Right', color: '#1F6FB2' },
  { id: 3, muscle: 'Forearm flexors', side: 'Right', color: '#1C8C6E' },
  { id: 4, muscle: 'Anterior deltoid', side: 'Right', color: '#7A4FC0' },
];

/** Smooth hump from 0 → height → 0 between start and end (phase units 0–1). */
function hump(phase: number, start: number, end: number, height: number): number {
  if (phase < start || phase > end) return 0;
  const x = (phase - start) / (end - start);
  return height * Math.sin(Math.PI * x) ** 2;
}

/** Muscle activation (0–1) for each channel during a bicep curl. */
const CURL_PROFILES: Record<number, (phase: number) => number> = {
  1: (p) => 0.08 + hump(p, 0.0, 0.85, 0.65), // prime mover
  2: (p) => 0.05 + hump(p, 0.45, 0.9, 0.15), // stabilizes on the way down
  3: (p) => 0.06 + hump(p, 0.0, 0.85, 0.35), // grip
  4: (p) => 0.04 + hump(p, 0.05, 0.5, 0.2), // shoulder assist
};

/**
 * Artifacts a band-pass filter is there to remove. Electrodes sit at a small DC
 * offset, and when the arm moves, skin and cables shift and add a slow wave
 * (well under 20 Hz). Sensor 4's loose electrode moves the most.
 */
const ELECTRODE: Record<number, { offsetMv: number; motionMv: number }> = {
  1: { offsetMv: 0.1, motionMv: 0.25 },
  2: { offsetMv: -0.12, motionMv: 0.15 },
  3: { offsetMv: 0.08, motionMv: 0.2 },
  4: { offsetMv: 0.2, motionMv: 0.6 },
};
const CABLE_SWAY_HZ = 3.1;

/** How strongly each muscle fatigues. The biceps does most of the work in a curl. */
const FATIGUE_SENSITIVITY: Record<number, number> = { 1: 1, 2: 0.3, 3: 0.6, 4: 0.4 };

/** Deterministic per-rep variation so no two reps look identical. */
function repVariation(rep: number, channel: number): number {
  const s = Math.sin(rep * 12.9898 + channel * 78.233) * 43758.5453;
  return 0.85 + 0.3 * (s - Math.floor(s));
}

function gaussian(): number {
  let u = 0;
  while (u === 0) u = Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Gaussian noise shaped by two cascaded band-pass resonators (RBJ biquads) so its
 * spectrum rises, peaks and rolls off like real EMG instead of being flat white noise.
 * Output is scaled to unit variance so amplitude doesn't change when the centre moves.
 */
class ColoredNoise {
  private b0 = 0;
  private a1 = 0;
  private a2 = 0;
  private gain = 1;
  // Delay lines for both stages: [x1, x2, y1, y2]
  private stages = [new Float64Array(4), new Float64Array(4)];

  setCenter(hz: number): void {
    const w0 = (2 * Math.PI * hz) / SAMPLE_RATE;
    const alpha = Math.sin(w0) / (2 * EMG_Q);
    const a0 = 1 + alpha;
    this.b0 = alpha / a0;
    this.a1 = (-2 * Math.cos(w0)) / a0;
    this.a2 = (1 - alpha) / a0;
    // Two unity-peak band-pass stages pass about π·f/(2·Q·fs) of white noise's variance
    this.gain = 1 / Math.sqrt((Math.PI * hz) / (2 * EMG_Q * SAMPLE_RATE));
  }

  next(): number {
    let x = gaussian();
    for (const z of this.stages) {
      // b1 = 0 and b2 = -b0 for a band-pass
      const y = this.b0 * (x - z[1]) - this.a1 * z[2] - this.a2 * z[3];
      z[1] = z[0];
      z[0] = x;
      z[3] = z[2];
      z[2] = y;
      x = y;
    }
    return x * this.gain;
  }
}

/**
 * Stands in for a set of wireless body-worn EMG sensors.
 * Swap this class for a real device driver later and nothing
 * above the Model layer needs to change.
 */
export class SensorSimulator {
  mode: SubjectMode = 'exercise';
  private sampleIndex = 0;
  private nextDropoutAt = FIRST_DROPOUT_SECONDS * SAMPLE_RATE; // in samples
  private dropoutEndsAt = 0;
  private battery: number[];
  private extraNoise: number[];
  private muscleNoise: ColoredNoise[];
  private repsDone = 0; // fractional reps of exercise, drives fatigue

  constructor(private readonly channels: ChannelConfig[]) {
    this.battery = [92, 87, 78, 64].slice(0, channels.length);
    // Channel 4 has a slightly loose electrode, so it reads noisier
    this.extraNoise = channels.map((c) => (c.id === 4 ? 0.035 : 0));
    this.muscleNoise = channels.map(() => new ColoredNoise());
  }

  /** A fresh subject: undo all accumulated fatigue. */
  resetFatigue(): void {
    this.repsDone = 0;
  }

  /**
   * Produce the next n samples for every channel (one Float32Array per channel).
   * A disconnected sensor delivers nothing, so its entry is null, just like
   * missing packets from real wireless hardware.
   */
  generate(n: number): (Float32Array | null)[] {
    this.scheduleDropout();
    const linked = this.channels.map((ch) => !this.isDroppedOut(ch.id));
    const out = this.channels.map(() => new Float32Array(n));
    // Fatigue changes slowly, so updating the filters once per block is plenty
    const fatigue = 1 - Math.exp(-this.repsDone / FATIGUE_REPS);
    this.channels.forEach((ch, c) => {
      const shift = (EMG_CENTER_FRESH_HZ - EMG_CENTER_FATIGUED_HZ) * fatigue * FATIGUE_SENSITIVITY[ch.id];
      this.muscleNoise[c].setCenter(EMG_CENTER_FRESH_HZ - shift);
    });

    for (let k = 0; k < n; k++) {
      const t = this.sampleIndex / SAMPLE_RATE;
      const phase = (t % REP_SECONDS) / REP_SECONDS;
      const rep = Math.floor(t / REP_SECONDS);
      const hum = HUM_MV * Math.sin(2 * Math.PI * 60 * t);

      this.channels.forEach((ch, c) => {
        const activation = this.activation(ch.id, phase, rep);
        // Muscle activity is band-limited; electrode and amplifier noise is white
        const muscle = this.muscleNoise[c].next() * activation * MAX_AMPLITUDE_MV;
        const sensorNoise = gaussian() * (BASELINE_NOISE_MV + this.extraNoise[c]);
        out[c][k] = muscle + sensorNoise + hum + this.artifact(ch.id, phase, t);
      });
      this.sampleIndex++;
    }
    if (this.mode === 'exercise') this.repsDone += n / SAMPLE_RATE / REP_SECONDS;
    // Drain about 1% battery every 40 seconds of streaming
    this.battery = this.battery.map((b) => Math.max(0, b - n / SAMPLE_RATE / 40));
    // The body keeps moving while a sensor is offline; only delivery stops
    return out.map((block, c) => (linked[c] ? block : null));
  }

  /** Starts the next dropout when it's due. Waits for exercise so calibration is never interrupted. */
  private scheduleDropout(): void {
    if (this.sampleIndex < this.nextDropoutAt || this.mode !== 'exercise') return;
    if (!this.channels.some((ch) => ch.id === DROPOUT_SENSOR_ID)) return;
    this.dropoutEndsAt = this.sampleIndex + DROPOUT_SECONDS * SAMPLE_RATE;
    this.nextDropoutAt = this.sampleIndex + DROPOUT_EVERY_SECONDS * SAMPLE_RATE;
  }

  private isDroppedOut(channelId: number): boolean {
    return channelId === DROPOUT_SENSOR_ID && this.sampleIndex < this.dropoutEndsAt;
  }

  status(channelIndex: number): SensorStatus {
    const noise = this.extraNoise[channelIndex];
    const quality: SignalQuality = noise > 0.05 ? 'poor' : noise > 0 ? 'fair' : 'good';
    return { battery: Math.round(this.battery[channelIndex]), quality };
  }

  /** Electrode offset plus motion artifact, which only appears while the arm is moving. */
  private artifact(channelId: number, phase: number, t: number): number {
    const { offsetMv, motionMv } = ELECTRODE[channelId];
    if (this.mode !== 'exercise') return offsetMv;
    // Follows the elbow angle through the curl, with some cable sway on top
    const movement = hump(phase, 0, 0.85, 1);
    const sway = 0.3 * movement * Math.sin(2 * Math.PI * CABLE_SWAY_HZ * t + channelId);
    return offsetMv + motionMv * (movement + sway);
  }

  private activation(channelId: number, phase: number, rep: number): number {
    switch (this.mode) {
      case 'rest':
        return 0.02;
      case 'maxContraction':
        return 0.92 + 0.06 * Math.sin(this.sampleIndex / 300 + channelId);
      case 'exercise':
        return CURL_PROFILES[channelId](phase) * repVariation(rep, channelId);
    }
  }
}

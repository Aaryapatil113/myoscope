import type { ChannelConfig, SensorStatus, SubjectMode, SignalQuality } from './types';

export const SAMPLE_RATE = 2000; // Hz, typical for surface EMG
const REP_SECONDS = 3; // one bicep curl: lift, hold, lower, rest
const MAX_AMPLITUDE_MV = 1.0; // RMS amplitude at full contraction
const BASELINE_NOISE_MV = 0.012;
const HUM_MV = 0.006; // 60 Hz powerline interference

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
 * Stands in for a set of wireless body-worn EMG sensors.
 * Swap this class for a real device driver later and nothing
 * above the Model layer needs to change.
 */
export class SensorSimulator {
  mode: SubjectMode = 'exercise';
  private sampleIndex = 0;
  private battery: number[];
  private extraNoise: number[];

  constructor(private readonly channels: ChannelConfig[]) {
    this.battery = [92, 87, 78, 64].slice(0, channels.length);
    // Channel 4 has a slightly loose electrode, so it reads noisier
    this.extraNoise = channels.map((c) => (c.id === 4 ? 0.035 : 0));
  }

  /** Produce the next n samples for every channel (one Float32Array per channel). */
  generate(n: number): Float32Array[] {
    const out = this.channels.map(() => new Float32Array(n));
    for (let k = 0; k < n; k++) {
      const t = this.sampleIndex / SAMPLE_RATE;
      const phase = (t % REP_SECONDS) / REP_SECONDS;
      const rep = Math.floor(t / REP_SECONDS);
      const hum = HUM_MV * Math.sin(2 * Math.PI * 60 * t);

      this.channels.forEach((ch, c) => {
        const activation = this.activation(ch.id, phase, rep);
        const amplitude = BASELINE_NOISE_MV + this.extraNoise[c] + activation * MAX_AMPLITUDE_MV;
        out[c][k] = gaussian() * amplitude + hum;
      });
      this.sampleIndex++;
    }
    // Drain about 1% battery every 40 seconds of streaming
    this.battery = this.battery.map((b) => Math.max(0, b - n / SAMPLE_RATE / 40));
    return out;
  }

  status(channelIndex: number): SensorStatus {
    const noise = this.extraNoise[channelIndex];
    const quality: SignalQuality = noise > 0.05 ? 'poor' : noise > 0 ? 'fair' : 'good';
    return { battery: Math.round(this.battery[channelIndex]), quality };
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

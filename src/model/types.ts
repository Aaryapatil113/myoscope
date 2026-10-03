export interface ChannelConfig {
  id: number;
  muscle: string;
  side: 'Left' | 'Right';
  color: string;
}

export type SignalQuality = 'good' | 'fair' | 'poor';

export interface SensorStatus {
  battery: number; // 0–100
  quality: SignalQuality;
}

/** What the simulated subject is doing right now. */
export type SubjectMode = 'exercise' | 'rest' | 'maxContraction';

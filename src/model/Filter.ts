/**
 * IIR filtering for surface EMG.
 *
 * Useful EMG energy sits roughly between 20 and 450 Hz. Below that band are
 * electrode offset and motion artifacts (cables and skin moving as the arm
 * curls); above it is mostly amplifier noise. A Butterworth band-pass keeps the
 * passband flat, so it removes those without distorting the muscle signal.
 */

/**
 * One second-order IIR section in Direct Form II Transposed, which needs only
 * two state variables and behaves well numerically in floating point.
 * Coefficients follow the RBJ Audio EQ Cookbook, with a0 normalized to 1.
 */
export class Biquad {
  private z1 = 0;
  private z2 = 0;

  private constructor(
    private readonly b0: number,
    private readonly b1: number,
    private readonly b2: number,
    private readonly a1: number,
    private readonly a2: number,
  ) {}

  static lowpass(cutoffHz: number, sampleRate: number, q: number): Biquad {
    const { cos, alpha } = prewarp(cutoffHz, sampleRate, q);
    const a0 = 1 + alpha;
    const b = (1 - cos) / 2 / a0;
    return new Biquad(b, 2 * b, b, (-2 * cos) / a0, (1 - alpha) / a0);
  }

  static highpass(cutoffHz: number, sampleRate: number, q: number): Biquad {
    const { cos, alpha } = prewarp(cutoffHz, sampleRate, q);
    const a0 = 1 + alpha;
    const b = (1 + cos) / 2 / a0;
    return new Biquad(b, -2 * b, b, (-2 * cos) / a0, (1 - alpha) / a0);
  }

  next(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }

  reset(): void {
    this.z1 = 0;
    this.z2 = 0;
  }
}

function prewarp(cutoffHz: number, sampleRate: number, q: number): { cos: number; alpha: number } {
  if (cutoffHz <= 0 || cutoffHz >= sampleRate / 2) {
    throw new Error(`Cutoff ${cutoffHz} Hz must be between 0 and ${sampleRate / 2} Hz`);
  }
  const w0 = (2 * Math.PI * cutoffHz) / sampleRate;
  return { cos: Math.cos(w0), alpha: Math.sin(w0) / (2 * q) };
}

/**
 * Q of each biquad in an even-order Butterworth cascade. Splitting the poles
 * this way (rather than repeating one Q) is what makes the response maximally
 * flat. Order 4 gives 0.541 and 1.307.
 */
export function butterworthQs(order: number): number[] {
  if (order < 2 || order % 2 !== 0) throw new Error('Butterworth order must be even and at least 2');
  return Array.from({ length: order / 2 }, (_, k) => 1 / (2 * Math.cos(((2 * k + 1) * Math.PI) / (2 * order))));
}

/**
 * Butterworth band-pass built as a high-pass cascade followed by a low-pass
 * cascade. `order` applies to each edge: 4 means a 4th-order high-pass at
 * `lowHz` and a 4th-order low-pass at `highHz`, i.e. 24 dB/octave roll-off.
 */
export class BandpassFilter {
  private readonly sections: Biquad[];

  constructor(
    readonly lowHz: number,
    readonly highHz: number,
    sampleRate: number,
    order = 4,
  ) {
    if (lowHz >= highHz) throw new Error('Low cutoff must be below high cutoff');
    const qs = butterworthQs(order);
    this.sections = [
      ...qs.map((q) => Biquad.highpass(lowHz, sampleRate, q)),
      ...qs.map((q) => Biquad.lowpass(highHz, sampleRate, q)),
    ];
  }

  next(sample: number): number {
    let y = sample;
    for (const section of this.sections) y = section.next(y);
    return y;
  }

  reset(): void {
    this.sections.forEach((s) => s.reset());
  }
}

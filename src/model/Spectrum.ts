/**
 * Frequency analysis for EMG fatigue tracking.
 *
 * As a muscle fatigues, its fibres conduct more slowly and the EMG
 * spectrum shifts toward lower frequencies. The median frequency (the
 * point that splits the signal's power into two equal halves) is the
 * standard single-number summary of that shift.
 */

/**
 * In-place iterative radix-2 Cooley–Tukey FFT. O(n log n).
 * `re` and `im` must have the same power-of-two length.
 */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n !== im.length || (n & (n - 1)) !== 0) {
    throw new Error('FFT length must be a power of two');
  }

  // Bit-reversal permutation so the butterflies below can run in place
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const angle = (-2 * Math.PI) / size;
    const stepRe = Math.cos(angle);
    const stepIm = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let wRe = 1;
      let wIm = 0;
      for (let k = 0; k < half; k++) {
        const a = start + k;
        const b = a + half;
        const tRe = re[b] * wRe - im[b] * wIm;
        const tIm = re[b] * wIm + im[b] * wRe;
        re[b] = re[a] - tRe;
        im[b] = im[a] - tIm;
        re[a] += tRe;
        im[a] += tIm;
        // Rotate the twiddle factor incrementally instead of calling cos/sin per butterfly
        const nextRe = wRe * stepRe - wIm * stepIm;
        wIm = wRe * stepIm + wIm * stepRe;
        wRe = nextRe;
      }
    }
  }
}

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * Computes the median frequency of a fixed-length window of samples.
 * Buffers and the window function are allocated once, so calling
 * `analyze` repeatedly on a live stream creates no garbage.
 */
export class MedianFrequencyAnalyzer {
  private readonly fftSize: number;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly hann: Float64Array;

  /**
   * @param windowSize samples per analysis window (zero-padded up to a power of two)
   * @param minHz/maxHz only power inside this band counts. 20–450 Hz is the usual
   *   surface-EMG band: it ignores motion artifacts and DC below, and noise above.
   */
  constructor(
    readonly windowSize: number,
    private readonly sampleRate: number,
    private readonly minHz = 20,
    private readonly maxHz = 450,
  ) {
    this.fftSize = nextPowerOfTwo(windowSize);
    this.re = new Float64Array(this.fftSize);
    this.im = new Float64Array(this.fftSize);
    // A Hann window tapers the edges so the cut-off at each end doesn't smear power across the spectrum
    this.hann = new Float64Array(windowSize);
    for (let i = 0; i < windowSize; i++) {
      this.hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (windowSize - 1));
    }
  }

  /** Returns the median frequency in Hz, or null if the window holds no power in the band. */
  analyze(samples: ArrayLike<number>): number | null {
    if (samples.length !== this.windowSize) {
      throw new Error(`Expected ${this.windowSize} samples, got ${samples.length}`);
    }

    let mean = 0;
    for (let i = 0; i < this.windowSize; i++) mean += samples[i];
    mean /= this.windowSize;

    this.re.fill(0);
    this.im.fill(0);
    for (let i = 0; i < this.windowSize; i++) this.re[i] = (samples[i] - mean) * this.hann[i];
    fft(this.re, this.im);

    const binHz = this.sampleRate / this.fftSize;
    const first = Math.max(1, Math.ceil(this.minHz / binHz));
    const last = Math.min(this.fftSize / 2, Math.floor(this.maxHz / binHz));

    let total = 0;
    for (let k = first; k <= last; k++) total += this.re[k] ** 2 + this.im[k] ** 2;
    if (total <= 0) return null;

    // Walk up the spectrum until half the power is behind us
    const half = total / 2;
    let cumulative = 0;
    for (let k = first; k <= last; k++) {
      const power = this.re[k] ** 2 + this.im[k] ** 2;
      if (cumulative + power >= half) {
        // Interpolate within the bin so the result isn't quantized to ~1 Hz steps
        const fraction = power > 0 ? (half - cumulative) / power : 0;
        return (k - 0.5 + fraction) * binHz;
      }
      cumulative += power;
    }
    return last * binHz;
  }
}

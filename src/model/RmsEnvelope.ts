/**
 * Moving root-mean-square over a sliding window.
 * RMS is the standard way to turn a raw, oscillating EMG signal
 * into a smooth "how hard is this muscle working" envelope.
 * Runs in O(1) per sample using a running sum of squares.
 */
export class RmsEnvelope {
  private squares: Float32Array;
  private index = 0;
  private count = 0;
  private sum = 0;

  constructor(private readonly windowSize: number) {
    this.squares = new Float32Array(windowSize);
  }

  next(sample: number): number {
    const sq = sample * sample;
    if (this.count === this.windowSize) {
      this.sum -= this.squares[this.index];
    } else {
      this.count++;
    }
    this.squares[this.index] = sq;
    this.sum += sq;
    this.index = (this.index + 1) % this.windowSize;
    return Math.sqrt(Math.max(this.sum, 0) / this.count);
  }

  reset(): void {
    this.squares.fill(0);
    this.index = 0;
    this.count = 0;
    this.sum = 0;
  }
}

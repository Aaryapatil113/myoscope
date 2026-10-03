/**
 * Fixed-size circular buffer of samples. Old samples are overwritten,
 * so memory stays constant no matter how long a session streams.
 */
export class RingBuffer {
  private data: Float32Array;
  private head = 0;
  private filled = 0;

  constructor(readonly capacity: number) {
    this.data = new Float32Array(capacity);
  }

  push(value: number): void {
    this.data[this.head] = value;
    this.head = (this.head + 1) % this.capacity;
    if (this.filled < this.capacity) this.filled++;
  }

  get length(): number {
    return this.filled;
  }

  /** Index 0 is the oldest stored sample. */
  at(index: number): number {
    const start = (this.head - this.filled + this.capacity) % this.capacity;
    return this.data[(start + index) % this.capacity];
  }

  clear(): void {
    this.head = 0;
    this.filled = 0;
    this.data.fill(0);
  }
}

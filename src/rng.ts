/**
 * Deterministic seeded PRNG (mulberry32) plus a seed mixer so that every
 * fuzz case gets an independent, reproducible random stream derived from
 * (baseSeed, caseIndex). Same seed + same case index => same input, always.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = normalizeSeed(seed);
  }

  /** Next float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new RangeError(`maxExclusive must be a positive integer, got ${maxExclusive}`);
    }
    return Math.floor(this.next() * maxExclusive);
  }

  bool(probability = 0.5): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    const last = items[items.length - 1];
    if (items.length === 0 || last === undefined) {
      throw new RangeError("cannot pick from an empty list");
    }
    return items[this.int(items.length)] ?? last;
  }

  /** Fisher-Yates on a copy. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const a = out[i];
      const b = out[j];
      if (a === undefined || b === undefined) continue;
      out[i] = b;
      out[j] = a;
    }
    return out;
  }
}

export function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) return 0x9e3779b9;
  const n = Math.trunc(seed);
  return (n >>> 0) || 0x9e3779b9;
}

/** splitmix32: mix (baseSeed, caseIndex) into an independent per-case seed. */
export function caseSeed(baseSeed: number, caseIndex: number): number {
  let h = (normalizeSeed(baseSeed) ^ Math.imul(caseIndex + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h || 0x9e3779b9;
}

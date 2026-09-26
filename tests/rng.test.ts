import { describe, expect, test } from "bun:test";
import { Rng, caseSeed, normalizeSeed } from "../src/rng.js";

describe("Rng", () => {
  test("is deterministic for a fixed seed", () => {
    const a = new Rng(1337).next();
    const b = new Rng(1337).next();
    expect(a).toBe(b);
  });

  test("produces the same sequence from the same seed", () => {
    const xs = new Rng(42);
    const ys = new Rng(42);
    for (let i = 0; i < 100; i++) expect(xs.next()).toBe(ys.next());
  });

  test("different seeds diverge", () => {
    expect(new Rng(1).next()).not.toBe(new Rng(2).next());
  });

  test("next() stays in [0, 1)", () => {
    const rng = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test("int() respects the exclusive bound", () => {
    const rng = new Rng(9);
    for (let i = 0; i < 500; i++) {
      const v = rng.int(5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  test("int() rejects invalid bounds", () => {
    const rng = new Rng(1);
    expect(() => rng.int(0)).toThrow(RangeError);
    expect(() => rng.int(-1)).toThrow(RangeError);
    expect(() => rng.int(1.5)).toThrow(RangeError);
  });

  test("pick() returns members and rejects empty lists", () => {
    const rng = new Rng(3);
    const items = ["a", "b", "c"];
    for (let i = 0; i < 50; i++) expect(items).toContain(rng.pick(items));
    expect(() => rng.pick([])).toThrow(RangeError);
  });

  test("shuffle() is a permutation", () => {
    const rng = new Rng(11);
    const original = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = rng.shuffle(original);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(original);
    expect(shuffled).not.toBe(original);
  });
});

describe("caseSeed", () => {
  test("same (seed, index) yields the same case seed", () => {
    expect(caseSeed(1337, 5)).toBe(caseSeed(1337, 5));
  });

  test("different indices yield different case seeds", () => {
    const seeds = new Set(Array.from({ length: 100 }, (_, i) => caseSeed(1337, i)));
    expect(seeds.size).toBe(100);
  });

  test("different base seeds diverge", () => {
    expect(caseSeed(1, 0)).not.toBe(caseSeed(2, 0));
  });

  test("never returns 0", () => {
    for (let i = 0; i < 1000; i++) expect(caseSeed(i, i * 7)).not.toBe(0);
  });
});

describe("normalizeSeed", () => {
  test("coerces to uint32 and avoids 0", () => {
    expect(normalizeSeed(0)).toBe(0x9e3779b9);
    expect(normalizeSeed(-1)).toBe(0xffffffff);
    expect(normalizeSeed(Number.NaN)).toBe(0x9e3779b9);
    expect(normalizeSeed(4.2)).toBe(4);
  });
});

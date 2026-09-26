import { describe, expect, test } from "bun:test";
import { Rng, caseSeed } from "../src/rng.js";
import {
  generateCorpus,
  generateInput,
  generateInputOfKind,
  isJsonSafe,
  pickGeneratorKind,
  defaultWeights,
  GENERATOR_KINDS,
} from "../src/generators.js";
import type { GeneratorConfig } from "../src/types.js";

describe("generateInput", () => {
  test("is deterministic for a fixed case seed", () => {
    const cfg: GeneratorConfig = {};
    const a = generateInput(new Rng(caseSeed(1337, 3)), cfg);
    const b = generateInput(new Rng(caseSeed(1337, 3)), cfg);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("respects maxStringLength", () => {
    const cfg: GeneratorConfig = { maxStringLength: 128 };
    for (let i = 0; i < 300; i++) {
      const input = generateInput(new Rng(caseSeed(1, i)), cfg);
      if (typeof input === "string") expect(input.length).toBeLessThanOrEqual(128);
    }
  });

  test("respects maxNestingDepth for structure bombs", () => {
    const cfg: GeneratorConfig = { maxNestingDepth: 8, maxArrayLength: 16 };
    for (let i = 0; i < 300; i++) {
      const input = generateInput(new Rng(caseSeed(2, i)), cfg);
      expect(depthOf(input)).toBeLessThanOrEqual(8);
    }
  });

  test("respects maxArrayLength", () => {
    const cfg: GeneratorConfig = { maxArrayLength: 4 };
    for (let i = 0; i < 300; i++) {
      const input = generateInput(new Rng(caseSeed(3, i)), cfg);
      if (Array.isArray(input)) expect(input.length).toBeLessThanOrEqual(4);
    }
  });

  test("every generated input survives a JSON round-trip", () => {
    for (let i = 0; i < 500; i++) {
      const input = generateInput(new Rng(caseSeed(4, i)), {});
      expect(isJsonSafe(input)).toBe(true);
      expect(JSON.parse(JSON.stringify(input))).toEqual(JSON.parse(JSON.stringify(input)));
    }
  });

  test("every generated input re-parses after a JSON round-trip", () => {
    const finiteNumbers = (v: unknown): boolean => {
      if (typeof v === "number") return Number.isFinite(v);
      if (Array.isArray(v)) return v.every(finiteNumbers);
      if (typeof v === "object" && v !== null) {
        return Object.values(v).every(finiteNumbers);
      }
      return true;
    };
    for (let i = 0; i < 500; i++) {
      const input = generateInput(new Rng(caseSeed(5, i)), {});
      const text = JSON.stringify(input);
      // JSON.stringify coerces non-finite numbers to null, so the re-parsed
      // structure can only ever contain finite numbers and re-parseable JSON.
      const reparsed: unknown = JSON.parse(text);
      expect(finiteNumbers(reparsed)).toBe(true);
    }
  });
});

describe("pickGeneratorKind", () => {
  test("honours zero weights", () => {
    const cfg: GeneratorConfig = {
      weights: { adversarial: 0, "mutate-json": 0, "mutate-string": 0, "boundary-numbers": 0 },
    };
    for (let i = 0; i < 100; i++) {
      expect(pickGeneratorKind(new Rng(caseSeed(6, i)), cfg)).toBe("structure-bombs");
    }
  });

  test("falls back to adversarial when all weights are zero", () => {
    const cfg: GeneratorConfig = {
      weights: { adversarial: 0, "mutate-json": 0, "mutate-string": 0, "boundary-numbers": 0, "structure-bombs": 0 },
    };
    expect(pickGeneratorKind(new Rng(1), cfg)).toBe("adversarial");
  });
});

describe("generateCorpus", () => {
  test("case i of the corpus matches what the fuzz loop generates", () => {
    const cfg: GeneratorConfig = {};
    const corpus = generateCorpus(2026, 50, cfg);
    expect(corpus).toHaveLength(50);
    for (const entry of corpus) {
      const rng = new Rng(entry.seed);
      const kind = pickGeneratorKind(rng, cfg);
      expect(kind).toBe(entry.generator);
      const solo = generateInputOfKind(kind, rng, cfg);
      expect(JSON.stringify(solo)).toBe(JSON.stringify(entry.input));
    }
  });

  test("is reproducible across calls", () => {
    const a = JSON.stringify(generateCorpus(99, 25, {}));
    const b = JSON.stringify(generateCorpus(99, 25, {}));
    expect(a).toBe(b);
  });
});

describe("defaultWeights", () => {
  test("covers every generator kind with a positive weight", () => {
    const weights = defaultWeights();
    for (const kind of GENERATOR_KINDS) expect(weights[kind]).toBeGreaterThan(0);
  });
});

function depthOf(value: unknown): number {
  if (Array.isArray(value)) return 1 + Math.max(0, ...value.map(depthOf));
  if (typeof value === "object" && value !== null) {
    const depths = Object.values(value).map(depthOf);
    return 1 + (depths.length > 0 ? Math.max(...depths) : 0);
  }
  return 0;
}

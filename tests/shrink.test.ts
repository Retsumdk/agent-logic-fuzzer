import { describe, expect, test } from "bun:test";
import { shrinkInput } from "../src/shrink.js";
import { asTarget } from "../src/targets.js";
import { executeCase } from "../src/fuzzer.js";
import { buildConfig, defaultOracles } from "../src/config.js";
import { evaluateOracles } from "../src/oracles.js";
import type { FuzzConfig, TargetSpec } from "../src/types.js";

function crashyTarget(spec: { crashesOn: (input: unknown) => boolean }): TargetSpec {
  return asTarget("test-crashy", async (input: unknown) => {
    if (spec.crashesOn(input)) {
      throw new Error("synthetic crash");
    }
    return "ok";
  });
}

function configOver(overrides: Partial<FuzzConfig> = {}): FuzzConfig {
  return {
    target: { type: "module", path: "./unused.js" },
    runs: 10,
    seed: 1,
    timeoutMs: 250,
    generators: {},
    oracles: defaultOracles(),
    minimize: true,
    ...overrides,
  };
}

describe("shrinkInput", () => {
  test("shrinks a long crashing string to a short one that still crashes", async () => {
    const long = "x".repeat(400) + "!" + "y".repeat(400);
    const target = crashyTarget({ crashesOn: (i) => typeof i === "string" && i.includes("!") });
    const shrunk = await shrinkInput(target, long, configOver(), 250);
    expect(typeof shrunk).toBe("string");
    expect((shrunk as string).length).toBeLessThan(long.length);
    expect((shrunk as string)).toContain("!");
  });

  test("shrinks an array by dropping innocent elements", async () => {
    const target = crashyTarget({ crashesOn: (i) => Array.isArray(i) && i.includes(13) });
    const input = [1, 2, 3, 4, 5, 13, 6, 7, 8];
    const shrunk = await shrinkInput(target, input, configOver(), 250);
    expect(shrunk).toEqual([13]);
  });

  test("shrinks an object by removing innocent keys", async () => {
    const target = crashyTarget({ crashesOn: (i) => typeof i === "object" && i !== null && "boom" in i });
    const input = { alpha: 1, beta: "two", boom: "x", gamma: [1, 2, 3] };
    const shrunk = await shrinkInput(target, input, configOver(), 250) as Record<string, unknown>;
    expect(Object.keys(shrunk)).toEqual(["boom"]);
  });

  test("returns the input unchanged when no simplification keeps the failure", async () => {
    const target = crashyTarget({ crashesOn: (i) => JSON.stringify(i) === '{"a":1}' });
    const shrunk = await shrinkInput(target, { a: 1 }, configOver(), 250);
    expect(shrunk).toEqual({ a: 1 });
  });

  test("shrinks numbers toward simple values", async () => {
    const target = crashyTarget({ crashesOn: (i) => typeof i === "number" && i > 0 });
    const shrunk = await shrinkInput(target, 98765, configOver(), 250);
    // 0 does not satisfy i > 0; 1 does — so 1 is the minimal failing number.
    expect(shrunk).toBe(1);
  });
});

describe("executeCase", () => {
  test("classifies a thrown error as kind=thrown", async () => {
    const target = crashyTarget({ crashesOn: () => true });
    const outcome = await executeCase(target, "anything", 250);
    expect(outcome.ok).toBe(false);
    expect(outcome.error?.kind).toBe("thrown");
    expect(outcome.error?.message).toContain("synthetic crash");
  });

  test("classifies an over-budget run as kind=timeout", async () => {
    const target = asTarget("slow", () => new Promise((resolve) => setTimeout(resolve, 500)));
    const outcome = await executeCase(target, "x", 50);
    expect(outcome.ok).toBe(false);
    expect(outcome.error?.kind).toBe("timeout");
  });

  test("measures duration", async () => {
    const target = asTarget("fast", async () => "ok");
    const outcome = await executeCase(target, "x", 250);
    expect(outcome.ok).toBe(true);
    expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("fuzzer + shrink integration", () => {
  test("an end-to-end run reports minimised failing inputs", async () => {
    // String inputs dominate the generator weights, so a string crash is
    // guaranteed within a fixed-seed corpus; the shrinker reduces any
    // failing string to a 1-char prefix.
    const target = crashyTarget({ crashesOn: (i) => typeof i === "string" });
    const config = configOver({
      target: { type: "module", path: "./test.js" },
      runs: 60,
      seed: 2026,
      oracles: defaultOracles(),
      minimize: true,
    });
    const { runFuzz } = await import("../src/fuzzer.js");
    const report = await runFuzz(config, target);
    expect(report.failureCount).toBeGreaterThan(0);
    const withMin = report.failures.find((f) => f.minimizedInput !== undefined);
    expect(withMin).toBeDefined();
    // The minimised input must still fail when replayed.
    const replay = await executeCase(target, withMin?.minimizedInput, config.timeoutMs);
    const oracles = evaluateOracles(withMin?.minimizedInput, replay, config.oracles);
    expect(oracles.some((r) => !r.ok)).toBe(true);
  });

  test("a robust agent produces a clean report", async () => {
    const target = asTarget("robust", async (input) => ({ handled: typeof input }));
    const config = configOver({ runs: 40 });
    const { runFuzz } = await import("../src/fuzzer.js");
    const report = await runFuzz(config, target);
    expect(report.failureCount).toBe(0);
  });

  test("the demo agent is caught by the extended oracle set", async () => {
    const { demoAgent } = await import("../src/demo-agent.js");
    const oracles = [
      { kind: "no-crash" as const },
      { kind: "no-timeout" as const },
      { kind: "no-echo" as const },
      { kind: "no-stack-leak" as const },
    ];

    const classify = async (input: unknown): Promise<string[]> => {
      const outcome = await executeCase(asTarget("demo", demoAgent), input, 250);
      const results = evaluateOracles(input, outcome, oracles);
      return results.filter((r) => !r.ok).map((r) => r.oracle);
    };

    expect(await classify("")).toContain("no-crash");
    expect(await classify("   ")).toContain("no-crash");
    expect(await classify("x".repeat(4096))).toContain("no-timeout");
    expect(await classify("echo-me!")).toContain("no-echo");
    expect(await classify("v2!")).toContain("no-stack-leak");
    expect(await classify("odd-string-without-digits-but-odd")).toEqual([]);
  });

  test("identical seeds reproduce identical failure counts", async () => {
    const { demoAgent } = await import("../src/demo-agent.js");
    const target = asTarget("builtin:demo", demoAgent);
    const config = configOver({ runs: 40, timeoutMs: 250, minimize: false });
    const { runFuzz } = await import("../src/fuzzer.js");
    const a = await runFuzz(config, target, { seed: 424242 });
    const b = await runFuzz(config, target, { seed: 424242 });
    expect(a.failureCount).toBe(b.failureCount);
    expect(JSON.stringify(a.perGenerator)).toBe(JSON.stringify(b.perGenerator));
  });
});

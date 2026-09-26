import { describe, expect, test } from "bun:test";
import { main } from "../src/cli.js";
import { renderReport, writeReport } from "../src/report.js";
import type { FuzzReport } from "../src/types.js";

describe("cli main()", () => {
  test("help exits 0 and prints usage", async () => {
    const captured: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown) => {
      captured.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      expect(await main(["help"])).toBe(0);
      expect(await main([])).toBe(0);
    } finally {
      process.stdout.write = original;
    }
    expect(captured.join("")).toContain("Usage:");
    expect(captured.join("")).toContain("corpus");
  });

  test("corpus prints count JSONL lines deterministically", async () => {
    const captured: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown) => {
      captured.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      const code = await main(["corpus", "--seed", "555", "--count", "5"]);
      expect(code).toBe(0);
      const lines = captured.join("").trim().split("\n");
      expect(lines).toHaveLength(5);
      for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
      const first = JSON.parse(lines[0] ?? "{}") as { id: number; input: unknown };
      expect(first.id).toBe(0);
    } finally {
      process.stdout.write = original;
    }
  });

  test("unknown commands throw ConfigError", async () => {
    await expect(main(["frobnicate"])).rejects.toThrow(/unknown command/);
  });
});

describe("renderReport / writeReport", () => {
  const report: FuzzReport = {
    target: "builtin:demo",
    seed: 1337,
    runs: 40,
    failureCount: 2,
    durationMs: 120,
    perGenerator: { adversarial: { cases: 30, failures: 2 } },
    oracleBreakdown: { "no-crash": 1, "no-timeout": 1 },
    failures: [
      {
        caseId: 7,
        caseSeed: 99,
        generator: "adversarial",
        input: "",
        failedOracle: "no-crash",
        detail: "target threw: Error: boom",
        durationMs: 1,
        repro: "--seed 1337 --case 7",
      },
      {
        caseId: 8,
        caseSeed: 100,
        generator: "adversarial",
        input: "x".repeat(500),
        minimizedInput: "hang",
        failedOracle: "no-timeout",
        detail: "target exceeded its time budget",
        durationMs: 250,
        repro: "--seed 1337 --case 8",
      },
    ],
  };

  test("renders PASS/FAIL, stats, and a repro hint per failure", () => {
    const text = renderReport(report);
    expect(text).toContain("FAIL: 2 failure(s) across 40 run(s)");
    expect(text).toContain("seed: 1337");
    expect(text).toContain("adversarial");
    expect(text).toContain("--seed 1337 (case 8");
    expect(text).not.toContain("no-stack-leak");
  });

  test("PASS when there are no failures", () => {
    const clean = { ...report, failureCount: 0, failures: [] };
    expect(renderReport(clean).startsWith("PASS")).toBe(true);
  });

  test("writeReport serialises the full report", async () => {
    const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "alf-report-"));
    const path = join(dir, "report.json");
    writeReport(report, path);
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as FuzzReport;
    expect(parsed.failureCount).toBe(2);
    expect(parsed.failures).toHaveLength(2);
    rmSync(dir, { recursive: true, force: true });
  });
});

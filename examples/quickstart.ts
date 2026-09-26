#!/usr/bin/env bun
/**
 * Quickstart: fuzz an inline agent from your own script (no config file).
 *
 *   bun examples/quickstart.ts
 *
 * The agent below is deliberately fragile so the run FINDS something; swap in
 * `await import("./my-agent.js").then((m) => m.default)` to fuzz your own.
 */
import { runFuzz, asTarget } from "../src/index.js";

const fragileAgent = async (input: unknown): Promise<unknown> => {
  if (typeof input === "string" && input.length === 0) {
    throw new Error("empty input is not supported");
  }
  if (typeof input === "string" && input.includes("hang")) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  if (input !== null && typeof input === "object" && "deep" in input) {
    return { ok: true, note: "at Object.<anonymous> (dist/agent.js:12:3)" };
  }
  return { decision: "proceed" };
};

const report = await runFuzz(
  {
    target: { type: "module", path: "./examples/quickstart.ts" },
    runs: 200,
    seed: 2026,
    timeoutMs: 250,
    generators: {},
    oracles: [
      { kind: "no-crash" },
      { kind: "no-timeout" },
      { kind: "no-echo" },
      { kind: "no-stack-leak" },
      { kind: "require-fields", fields: ["decision"] },
    ],
    minimize: true,
  },
  asTarget("quickstart-agent", fragileAgent),
);

console.log(`
=== quickstart fuzz report ===
target:   ${report.target}
seed:     ${report.seed}
runs:     ${report.runs}
failures: ${report.failureCount}
duration: ${report.durationMs}ms
`);

for (const failure of report.failures.slice(0, 5)) {
  const shown = failure.minimizedInput !== undefined ? failure.minimizedInput : failure.input;
  console.log(`#${failure.caseId} [${failure.failedOracle}] ${failure.detail}`);
  console.log(`  input: ${JSON.stringify(shown)?.slice(0, 120)}`);
}

process.exit(report.failureCount > 0 ? 1 : 0);

import { parseArgs } from "node:util";
import { resolveTarget, asTarget } from "./targets.js";
import { buildConfig, loadConfigFile } from "./config.js";
import { runFuzz } from "./fuzzer.js";
import { renderReport, writeReport } from "./report.js";
import { generateCorpus } from "./generators.js";
import { demoAgent } from "./demo-agent.js";
import { ConfigError } from "./errors.js";
import type { FuzzConfig, TargetConfig, TargetSpec, OracleConfig } from "./types.js";
import type { ConfigOverrides } from "./types.js";

const USAGE = `agent-logic-fuzzer — deterministic adversarial fuzzing for agent decision endpoints

Usage:
  agent-logic-fuzzer run    [--config file] [--target path] [--runs n] [--seed n]
                              [--timeout ms] [--no-minimize] [--out file] [--json]
  agent-logic-fuzzer corpus --seed n [--count n]     # print the generated corpus as JSONL
  agent-logic-fuzzer demo                            # fuzz a deliberately fragile demo agent
  agent-logic-fuzzer help

Commands:
  run      Fuzz the configured target. Exits 1 when failures are found.
  corpus   Print 'count' deterministic fuzz inputs (one JSON per line) for
           review or replay, without executing anything.
  demo     Fuzz the built-in fragile demo agent (crash, hang, echo, stack-leak
           bugs) and show the oracles catching each class of failure.

Options:
  --config <file>     JSON config file (see README for the schema)
  --target <path>     Shortcut for {"target":{"type":"module","path":"..."}}
  --runs <n>          Number of fuzz cases (default 100, max 100000)
  --seed <n>          Base seed; same seed always reproduces the same corpus
  --timeout <ms>      Per-case time budget (default 2000)
  --no-minimize       Skip delta-debugging minimisation of failing inputs
  --out <file>        Write the full machine-readable JSON report to a file
  --json              Print the JSON report to stdout instead of the summary
`;

interface CliOptions {
  config?: string;
  target?: string;
  runs?: number;
  seed?: number;
  timeout?: number;
  minimize: boolean;
  out?: string;
  json: boolean;
  count?: number;
}

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(USAGE);
      return 0;
    case "run":
      return runCommand(await options(rest));
    case "corpus":
      return corpusCommand(await options(rest));
    case "demo":
      return demoCommand(await options(rest));
    default:
      throw new ConfigError(`unknown command '${String(command)}' — try 'help'`);
  }
}

async function options(argv: string[]): Promise<CliOptions> {
  const { values } = parseArgs({
    args: argv,
    options: {
      config: { type: "string" },
      target: { type: "string" },
      runs: { type: "string", short: "r" },
      seed: { type: "string", short: "s" },
      count: { type: "string", short: "c" },
      timeout: { type: "string", short: "t" },
      minimize: { type: "boolean", default: true },
      out: { type: "string", short: "o" },
      json: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });
  return {
    ...(values.config !== undefined ? { config: values.config } : {}),
    ...(values.target !== undefined ? { target: values.target } : {}),
    ...(values.runs !== undefined ? { runs: numberFlag(values.runs, "--runs") } : {}),
    ...(values.seed !== undefined ? { seed: numberFlag(values.seed, "--seed") } : {}),
    ...(values.count !== undefined ? { count: numberFlag(values.count, "--count") } : {}),
    ...(values.timeout !== undefined ? { timeout: numberFlag(values.timeout, "--timeout") } : {}),
    minimize: values.minimize,
    ...(values.out !== undefined ? { out: values.out } : {}),
    json: values.json,
  };
}

function numberFlag(raw: string, flag: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new ConfigError(`${flag} must be a number, got '${raw}'`);
  }
  return n;
}

function loadBuildConfig(opts: CliOptions, overrides: ConfigOverrides): Omit<FuzzConfig, "target"> & { target?: TargetConfig } {
  const file = opts.config !== undefined ? loadConfigFile(opts.config) : {};
  return buildConfig(file, overrides);
}

async function requireTarget(partial: Omit<FuzzConfig, "target"> & { target?: TargetConfig }): Promise<{ target: TargetSpec; config: FuzzConfig }> {
  if (partial.target === undefined) {
    throw new ConfigError("no target configured — pass --target ./agent.js or set target in the config file");
  }
  const target = await resolveTarget(partial.target, partial.timeoutMs);
  return { target, config: { ...partial, target: partial.target } };
}

async function runCommand(opts: CliOptions): Promise<number> {
  const partial = loadBuildConfig(opts, {
    ...(opts.runs !== undefined ? { runs: opts.runs } : {}),
    ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
    ...(opts.timeout !== undefined ? { timeoutMs: opts.timeout } : {}),
    ...(opts.target !== undefined ? { target: opts.target } : {}),
    minimize: opts.minimize,
  });
  const { target, config } = await requireTarget(partial);
  const report = await runFuzz(config, target);
  if (opts.out !== undefined) writeReport(report, opts.out);
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderReport(report)}\n`);
    if (opts.out !== undefined) process.stdout.write(`report written to ${opts.out}\n`);
  }
  return report.failureCount === 0 ? 0 : 1;
}

async function corpusCommand(opts: CliOptions): Promise<number> {
  const partial = loadBuildConfig(opts, {
    ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
  });
  const seed = partial.seed;
  const count = opts.count ?? partial.runs;
  for (const entry of generateCorpus(seed, count, partial.generators)) {
    process.stdout.write(`${JSON.stringify(entry)}\n`);
  }
  return 0;
}

async function demoCommand(opts: CliOptions): Promise<number> {
  if (!opts.json) process.stdout.write("fuzzing the built-in fragile demo agent (4 planted bugs)\n\n");
  const partial = buildConfig(
    {},
    { runs: opts.runs ?? 40, ...(opts.seed !== undefined ? { seed: opts.seed } : {}), timeoutMs: opts.timeout ?? 250 },
  );
  const oracles: OracleConfig[] = [
    { kind: "no-crash" },
    { kind: "no-timeout" },
    { kind: "no-echo" },
    { kind: "no-stack-leak" },
  ];
  const config: FuzzConfig = { ...partial, target: { type: "module", path: "builtin:demo" }, oracles };
  const report = await runFuzz(config, asTarget("builtin:demo", demoAgent));
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderReport(report)}\n`);
  }
  return report.failureCount === 0 ? 0 : 1;
}

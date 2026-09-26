import type { FuzzConfig, FuzzCase, FuzzFailure, FuzzReport, GeneratorStat, TargetSpec } from "./types.js";
import { generateCase } from "./generators.js";
import { evaluateOracles, type TargetOutcome } from "./oracles.js";
import { shrinkInput } from "./shrink.js";
import { withTimeout } from "./targets.js";

const MAX_RECORDED_FAILURES = 50;

export interface RunOptions {
  readonly runs?: number;
  readonly seed?: number;
  readonly timeoutMs?: number;
  readonly minimize?: boolean;
  readonly onCaseComplete?: (info: { caseIndex: number; total: number; failed: boolean }) => void;
}

/**
 * Run the fuzz loop: generate `runs` deterministic inputs from the base seed,
 * execute the target against each one, evaluate the oracles, and minimise any
 * failing input. Returns a full report.
 */
export async function runFuzz(config: FuzzConfig, target: TargetSpec, options: RunOptions = {}): Promise<FuzzReport> {
  const runs = options.runs ?? config.runs;
  const seed = options.seed ?? config.seed;
  const timeoutMs = options.timeoutMs ?? config.timeoutMs;
  const minimize = options.minimize ?? config.minimize;

  const started = Date.now();
  const failures: FuzzFailure[] = [];
  const perGenerator: Record<string, GeneratorStat> = {};
  const oracleBreakdown: Record<string, number> = {};

  for (let i = 0; i < runs; i++) {
    const generated = generateCase(seed, i, config.generators);
    const caseInfo: FuzzCase = {
      id: generated.id,
      seed: generated.seed,
      generator: generated.generator,
      input: generated.input,
    };

    bump(perGenerator, generated.generator).cases += 1;

    const outcome = await executeCase(target, generated.input, timeoutMs);
    const results = evaluateOracles(generated.input, outcome, config.oracles);
    for (const r of results) {
      if (!r.ok) bumpCount(oracleBreakdown, r.oracle);
    }

    const firstFailed = results.find((r) => !r.ok);
    if (firstFailed) {
      bump(perGenerator, generated.generator).failures += 1;
      if (failures.length < MAX_RECORDED_FAILURES) {
        failures.push(await toFailure(target, config, caseInfo, firstFailed.oracle, firstFailed.detail ?? "no detail", outcome.durationMs, minimize, timeoutMs));
      }
    }

    options.onCaseComplete?.({ caseIndex: i, total: runs, failed: Boolean(firstFailed) });
  }

  return {
    target: target.name,
    seed,
    runs,
    failureCount: failures.length,
    durationMs: Date.now() - started,
    perGenerator,
    oracleBreakdown,
    failures,
  };
}

export async function executeCase(target: TargetSpec, input: unknown, timeoutMs: number): Promise<TargetOutcome> {
  const startedAt = Date.now();
  try {
    const promise = target.run(input);
    const output = await withTimeout(promise, timeoutMs);
    return { ok: true, output, durationMs: Date.now() - startedAt };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    if (err instanceof Error && err.name === "TimeoutError") {
      return { ok: false, error: { message: "timeout", kind: "timeout" }, durationMs };
    }
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return { ok: false, error: { message, kind: "thrown" }, durationMs };
  }
}

async function toFailure(
  target: TargetSpec,
  config: FuzzConfig,
  fuzzCase: FuzzCase,
  failedOracle: string,
  detail: string,
  durationMs: number,
  minimize: boolean,
  timeoutMs: number,
): Promise<FuzzFailure> {
  let minimizedInput: unknown;
  if (minimize) {
    minimizedInput = await shrinkInput(target, fuzzCase.input, config, timeoutMs);
  }
  return {
    caseId: fuzzCase.id,
    caseSeed: fuzzCase.seed,
    generator: fuzzCase.generator,
    input: fuzzCase.input,
    ...(minimizedInput !== undefined ? { minimizedInput } : {}),
    failedOracle,
    detail,
    durationMs,
    repro: `--seed ${config.seed} --case ${fuzzCase.id}`,
  };
}

function bump(record: Record<string, GeneratorStat>, key: string): GeneratorStat {
  const existing = record[key];
  const stat = existing ?? { cases: 0, failures: 0 };
  record[key] = stat;
  return stat;
}


function bumpCount(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

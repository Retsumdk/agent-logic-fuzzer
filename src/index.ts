/**
 * agent-logic-fuzzer — deterministic adversarial fuzzing for agent
 * decision endpoints. Library API.
 *
 * @example
 * ```ts
 * import { runFuzz } from "agent-logic-fuzzer";
 * import { asTarget } from "agent-logic-fuzzer";
 *
 * const report = await runFuzz(
 *   {
 *     target: { type: "module", path: "./my-agent.js" },
 *     runs: 500,
 *     seed: 1337,
 *     timeoutMs: 2000,
 *     generators: {},
 *     oracles: [{ kind: "no-crash" }, { kind: "no-timeout" }],
 *     minimize: true,
 *   },
 *   asTarget("inline", async (input) => myAgent(input)),
 * );
 * if (report.failureCount > 0) process.exit(1);
 * ```
 */
export { runFuzz, executeCase, type RunOptions } from "./fuzzer.js";
export { generateInput, generateCorpus, pickGeneratorKind, defaultWeights, GENERATOR_KINDS, isJsonSafe } from "./generators.js";
export { evaluateOracles, type TargetOutcome } from "./oracles.js";
export { shrinkInput } from "./shrink.js";
export { resolveTarget, moduleTarget, httpTarget, asTarget, withTimeout } from "./targets.js";
export { buildConfig, loadConfigFile, defaultOracles } from "./config.js";
export { renderReport, writeReport } from "./report.js";
export { demoAgent } from "./demo-agent.js";
export { Rng, caseSeed, normalizeSeed } from "./rng.js";
export { FuzzerError, ConfigError, TargetError, TimeoutError } from "./errors.js";
export type {
  Json,
  TargetSpec,
  TargetConfig,
  ModuleTargetConfig,
  HttpTargetConfig,
  GeneratorKind,
  GeneratorConfig,
  OracleKind,
  OracleConfig,
  OracleResult,
  FuzzConfig,
  FuzzCase,
  FuzzFailure,
  FuzzReport,
  GeneratorStat,
  ConfigOverrides,
  AgentHandler,
} from "./types.js";

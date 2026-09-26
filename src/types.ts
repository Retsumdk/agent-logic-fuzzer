export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

export interface TargetSpec {
  readonly name: string;
  run(input: unknown): Promise<unknown>;
}

export interface ModuleTargetConfig {
  readonly type: "module";
  readonly path: string;
}

export interface HttpTargetConfig {
  readonly type: "http";
  readonly url: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
}

export type TargetConfig = ModuleTargetConfig | HttpTargetConfig;

export type GeneratorKind =
  | "adversarial"
  | "mutate-json"
  | "mutate-string"
  | "boundary-numbers"
  | "structure-bombs";

export interface GeneratorConfig {
  readonly weights?: Partial<Record<GeneratorKind, number>>;
  readonly maxNestingDepth?: number;
  readonly maxStringLength?: number;
  readonly maxArrayLength?: number;
}

export type OracleKind =
  | "no-crash"
  | "no-timeout"
  | "no-echo"
  | "no-stack-leak"
  | "nonempty"
  | "valid-json"
  | "require-fields";

export interface OracleConfig {
  readonly kind: OracleKind;
  readonly fields?: readonly string[];
}

export interface FuzzConfig {
  readonly target: TargetConfig;
  readonly runs: number;
  readonly seed: number;
  readonly timeoutMs: number;
  readonly generators: GeneratorConfig;
  readonly oracles: readonly OracleConfig[];
  readonly minimize: boolean;
}

export interface FuzzCase {
  readonly id: number;
  readonly seed: number;
  readonly generator: GeneratorKind;
  readonly input: unknown;
}

export interface OracleResult {
  readonly oracle: string;
  readonly ok: boolean;
  readonly detail?: string;
}

export interface FuzzFailure {
  readonly caseId: number;
  readonly caseSeed: number;
  readonly generator: GeneratorKind;
  readonly input: unknown;
  readonly minimizedInput?: unknown;
  readonly failedOracle: string;
  readonly detail: string;
  readonly durationMs: number;
  readonly repro: string;
}

export interface GeneratorStat {
  cases: number;
  failures: number;
}

export interface FuzzReport {
  readonly target: string;
  readonly seed: number;
  readonly runs: number;
  readonly failureCount: number;
  readonly durationMs: number;
  readonly perGenerator: Record<string, GeneratorStat>;
  readonly oracleBreakdown: Record<string, number>;
  readonly failures: readonly FuzzFailure[];
}

export interface ConfigOverrides {
  readonly runs?: number;
  readonly seed?: number;
  readonly timeoutMs?: number;
  readonly minimize?: boolean;
}

/** Shape a custom target module must export as its default. */
export type AgentHandler = (input: unknown) => Promise<unknown>;

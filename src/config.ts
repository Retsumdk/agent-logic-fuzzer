import { existsSync, readFileSync } from "node:fs";
import { ConfigError } from "./errors.js";
import { GENERATOR_KINDS, defaultWeights } from "./generators.js";
import type { FuzzConfig, GeneratorKind, GeneratorConfig, OracleConfig, OracleKind, TargetConfig } from "./types.js";

const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_RUNS = 100;
const MAX_RUNS = 100_000;
const KNOWN_ORACLES: readonly OracleKind[] = [
  "no-crash",
  "no-timeout",
  "no-echo",
  "no-stack-leak",
  "nonempty",
  "valid-json",
  "require-fields",
];

export function defaultOracles(): OracleConfig[] {
  return [{ kind: "no-crash" }, { kind: "no-timeout" }];
}

/**
 * Merge a parsed config-file object over the defaults. `overrides` come from
 * CLI flags and win over both. Throws ConfigError with a specific message for
 * every malformed field so a bad config never fails silently.
 */
export interface ConfigOverrides {
  readonly target?: string;
  readonly runs?: number;
  readonly seed?: number;
  readonly timeoutMs?: number;
  readonly minimize?: boolean;
}

export function buildConfig(
  file: unknown,
  overrides: ConfigOverrides = {},
): Omit<FuzzConfig, "target"> & { target?: TargetConfig } {
  const source = (file ?? {}) as Record<string, unknown>;
  const target = overrides.target !== undefined
    ? { type: "module", path: overrides.target } as const
    : parseTarget(source.target, overrides);
  const runs = overrides.runs !== undefined
    ? clampInt(overrides.runs, "runs", 1, MAX_RUNS)
    : intInRange(source.runs, "runs", 1, MAX_RUNS, DEFAULT_RUNS);
  const seed = overrides.seed !== undefined
    ? clampInt(overrides.seed, "seed", -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
    : intInRange(source.seed, "seed", -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, Date.now() % 2147483647);
  const timeoutMs = overrides.timeoutMs !== undefined
    ? clampInt(overrides.timeoutMs, "timeoutMs", 1, 120_000)
    : intInRange(source.timeoutMs, "timeoutMs", 1, 120_000, DEFAULT_TIMEOUT_MS);
  const minimizeRaw = source.minimize;
  const minimize = typeof overrides.minimize === "boolean"
    ? overrides.minimize
    : typeof minimizeRaw === "boolean"
      ? minimizeRaw
      : true;
  const generators = parseGenerators(source.generators);
  const oracles = parseOracles(source.oracles);
  return {
    ...(target !== undefined ? { target } : {}),
    runs,
    seed,
    timeoutMs,
    minimize,
    generators,
    oracles,
  };
}

/** Read and parse a config file from disk (JSON only). */
export function loadConfigFile(path: string): unknown {
  if (!existsSync(path)) {
    throw new ConfigError(`config file not found: ${path}`);
  }
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`could not read config file '${path}': ${detail}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`config file '${path}' is not valid JSON: ${detail}`);
  }
}

function parseTarget(raw: unknown, overrides: ConfigOverrides): TargetConfig | undefined {
  if (overrides.target !== undefined) return { type: "module", path: overrides.target };
  if (raw === undefined) return undefined;
  if (typeof raw !== "object" || raw === null) {
    throw new ConfigError("target must be an object: { type: 'module' | 'http', ... }");
  }
  const t = raw as Record<string, unknown>;
  if (t.type === "module") {
    if (typeof t.path !== "string" || t.path.length === 0) {
      throw new ConfigError("module target requires a non-empty 'path'");
    }
    return { type: "module", path: t.path };
  }
  if (t.type === "http") {
    if (typeof t.url !== "string" || !/^https?:\/\//.test(t.url)) {
      throw new ConfigError("http target requires 'url' starting with http:// or https://");
    }
    const method = t.method === undefined ? undefined : requireString(t.method, "target.method").toUpperCase();
    const headers = parseHeaders(t.headers);
    return { type: "http", url: t.url, ...(method ? { method } : {}), ...(headers ? { headers } : {}) };
  }
  throw new ConfigError("target.type must be 'module' or 'http'");
}

function parseHeaders(raw: unknown): Record<string, string> | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ConfigError("target.headers must be an object of string to string");
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "string") throw new ConfigError(`header '${key}' must be a string`);
    out[key] = value;
  }
  return out;
}

function parseGenerators(raw: unknown): GeneratorConfig {
  if (raw === undefined) return {};
  if (typeof raw !== "object" || raw === null) throw new ConfigError("generators must be an object");
  const g = raw as Record<string, unknown>;
  const parsed: GeneratorConfig = {};
  if (g.weights !== undefined) {
    if (typeof g.weights !== "object" || g.weights === null) throw new ConfigError("generators.weights must be an object");
    const weightRecord: { [K in GeneratorKind]?: number } = {};
    for (const [key, value] of Object.entries(g.weights)) {
      if (!(GENERATOR_KINDS as readonly string[]).includes(key)) {
        throw new ConfigError(`unknown generator '${key}' (known: ${GENERATOR_KINDS.join(", ")})`);
      }
      if (typeof value !== "number" || value < 0 || !Number.isFinite(value)) {
        throw new ConfigError(`generator weight '${key}' must be a non-negative finite number`);
      }
      weightRecord[key as GeneratorKind] = value;
    }
    const hasAny = GENERATOR_KINDS.some((k) => (weightRecord[k] ?? defaultWeights()[k]) > 0);
    if (!hasAny) throw new ConfigError("at least one generator weight must be > 0");
    const weights: Partial<Record<GeneratorKind, number>> = {};
    for (const k of GENERATOR_KINDS) {
      const w = weightRecord[k];
      if (w !== undefined) weights[k] = w;
    }
    return {
      ...parsed,
      ...(Object.keys(weights).length > 0 ? { weights } : {}),
    };
  }
  const maxNestingDepth = optionalInt(g.maxNestingDepth, "generators.maxNestingDepth", 1, 100_000);
  const maxStringLength = optionalInt(g.maxStringLength, "generators.maxStringLength", 1, 1_048_576);
  const maxArrayLength = optionalInt(g.maxArrayLength, "generators.maxArrayLength", 0, 100_000);
  return {
    ...(maxNestingDepth !== undefined ? { maxNestingDepth } : {}),
    ...(maxStringLength !== undefined ? { maxStringLength } : {}),
    ...(maxArrayLength !== undefined ? { maxArrayLength } : {}),
  };
}

function parseOracles(raw: unknown): OracleConfig[] {
  if (raw === undefined) return defaultOracles();
  if (!Array.isArray(raw)) throw new ConfigError("oracles must be an array");
  const out: OracleConfig[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const kind = requireKnownOracle(item);
      out.push({ kind });
      continue;
    }
    if (typeof item === "object" && item !== null) {
      const o = item as Record<string, unknown>;
      const kind = requireKnownOracle(o.kind);
      if (kind === "require-fields") {
        if (!Array.isArray(o.fields) || o.fields.length === 0 || o.fields.some((f) => typeof f !== "string")) {
          throw new ConfigError("require-fields oracle requires a non-empty 'fields' array of strings");
        }
        out.push({ kind, fields: o.fields as string[] });
        continue;
      }
      out.push({ kind });
      continue;
    }
    throw new ConfigError("each oracle must be a string or an object with a 'kind' field");
  }
  return out;
}

function requireKnownOracle(raw: unknown): OracleKind {
  if (typeof raw !== "string" || !(KNOWN_ORACLES as readonly string[]).includes(raw)) {
    throw new ConfigError(`unknown oracle '${String(raw)}' (known: ${KNOWN_ORACLES.join(", ")})`);
  }
  return raw as OracleKind;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new ConfigError(`${field} must be a non-empty string`);
  return value;
}

function intInRange(
  raw: unknown,
  field: string,
  min: number,
  max: number,
  fallback: number,
): number {
  if (raw === undefined) return clampInt(fallback, field, min, max);
  return clampInt(raw, field, min, max);
}

function optionalInt(raw: unknown, field: string, min: number, max: number): number | undefined {
  if (raw === undefined) return undefined;
  return clampInt(raw, field, min, max);
}

function clampInt(raw: unknown, field: string, min: number, max: number): number {
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) {
    throw new ConfigError(`${field} must be an integer in [${min}, ${max}], got ${String(raw)}`);
  }
  return n;
}

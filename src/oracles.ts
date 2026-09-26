import type { OracleConfig, OracleResult } from "./types.js";

const STACK_TRACE_PATTERN = /\bat [^\s(]+ \([^)]*:\d+:\d+\)|node:internal|node_modules\//;
const ECHO_SAMPLE_MAX = 256;

export interface TargetOutcome {
  readonly ok: boolean;
  readonly output?: unknown;
  readonly error?: { message: string; kind: "thrown" | "timeout" };
  readonly durationMs: number;
}

/**
 * Evaluate the configured oracles against one target outcome.
 * `no-crash` and `no-timeout` are implicit and always evaluated first;
 * the configured list adds the opt-in behavioural checks.
 */
export function evaluateOracles(
  input: unknown,
  outcome: TargetOutcome,
  oracles: readonly OracleConfig[],
): OracleResult[] {
  const results: OracleResult[] = [];

  if (outcome.error?.kind === "timeout") {
    results.push({ oracle: "no-timeout", ok: false, detail: `target exceeded its time budget (${outcome.durationMs}ms elapsed)` });
    return results;
  }
  results.push({ oracle: "no-timeout", ok: true });

  if (outcome.error?.kind === "thrown") {
    results.push({ oracle: "no-crash", ok: false, detail: `target threw: ${outcome.error.message}` });
    return results;
  }
  results.push({ oracle: "no-crash", ok: true });

  for (const oracle of oracles) {
    results.push(evaluateOne(input, outcome.output, oracle));
  }
  return results;
}

function evaluateOne(input: unknown, output: unknown, oracle: OracleConfig): OracleResult {
  switch (oracle.kind) {
    case "no-crash":
    case "no-timeout":
      return { oracle: oracle.kind, ok: true };
    case "nonempty": {
      const text = stringifyOutput(output);
      if (text.trim().length === 0) {
        return { oracle: "nonempty", ok: false, detail: "target returned an empty response" };
      }
      return { oracle: "nonempty", ok: true };
    }
    case "valid-json": {
      if (typeof output !== "string") return { oracle: "valid-json", ok: true };
      try {
        JSON.parse(output);
        return { oracle: "valid-json", ok: true };
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return { oracle: "valid-json", ok: false, detail: `output is not valid JSON: ${detail}` };
      }
    }
    case "no-echo": {
      const outputText = stringifyOutput(output);
      for (const probe of echoProbes(input)) {
        if (probe.length >= 8 && outputText.includes(probe)) {
          return {
            oracle: "no-echo",
            ok: false,
            detail: `output echoes the raw input payload verbatim (probe: ${JSON.stringify(probe.slice(0, 32))}...)`,
          };
        }
      }
      return { oracle: "no-echo", ok: true };
    }
    case "no-stack-leak": {
      const text = stringifyOutput(output);
      if (STACK_TRACE_PATTERN.test(text)) {
        const match = STACK_TRACE_PATTERN.exec(text);
        return {
          oracle: "no-stack-leak",
          ok: false,
          detail: `output leaks internal stack information near ${JSON.stringify(match?.[0] ?? "")}`,
        };
      }
      return { oracle: "no-stack-leak", ok: true };
    }
    case "require-fields": {
      const fields = oracle.fields ?? [];
      if (fields.length === 0) return { oracle: "require-fields", ok: true };
      if (!isRecord(output)) {
        return { oracle: "require-fields", ok: false, detail: "output is not an object, so required fields are missing" };
      }
      const missing = fields.filter((f) => !(f in output));
      if (missing.length > 0) {
        return { oracle: "require-fields", ok: false, detail: `output is missing required fields: ${missing.join(", ")}` };
      }
      return { oracle: "require-fields", ok: true };
    }
  }
}

function echoProbes(input: unknown): string[] {
  const probes: string[] = [];
  const raw = typeof input === "string" ? input : safeStringify(input);
  probes.push(raw.length > ECHO_SAMPLE_MAX ? raw.slice(0, ECHO_SAMPLE_MAX) : raw);
  // Object payloads: also probe each string leaf, because an agent that folds
  // the payload into a JSON envelope ("reply": {...}) hides the full-body
  // echo while still reflecting the adversarial text verbatim.
  if (typeof input === "object" && input !== null) {
    for (const leaf of stringLeaves(input, 0)) {
      if (leaf.length >= 8) probes.push(leaf.length > ECHO_SAMPLE_MAX ? leaf.slice(0, ECHO_SAMPLE_MAX) : leaf);
      if (probes.length >= 4) break;
    }
  }
  return probes;
}

function stringLeaves(value: unknown, depth: number): string[] {
  if (depth > 8) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.slice(0, 16).flatMap((v) => stringLeaves(v, depth + 1));
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap((v) => stringLeaves(v, depth + 1));
  }
  return [];
}

function stringifyOutput(output: unknown): string {
  if (typeof output === "string") return output;
  if (output === null || output === undefined) return "";
  return safeStringify(output);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

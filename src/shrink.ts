import type { FuzzConfig } from "./types.js";
import { evaluateOracles } from "./oracles.js";
import { executeCase } from "./fuzzer.js";
import type { TargetSpec } from "./types.js";

const MAX_STEPS = 200;

/**
 * Delta-debug a failing input down to a smaller input that still fails.
 * Simplifications that keep the failure are kept; ones that lose it are
 * reverted. Bounded by MAX_STEPS so shrinking cannot run away on huge inputs.
 */
export async function shrinkInput(
  target: TargetSpec,
  input: unknown,
  config: FuzzConfig,
  timeoutMs: number,
): Promise<unknown> {
  let current = input;
  let steps = 0;

  const stillFails = async (candidate: unknown): Promise<boolean> => {
    const outcome = await executeCase(target, candidate, timeoutMs);
    const results = evaluateOracles(candidate, outcome, config.oracles);
    return results.some((r) => !r.ok);
  };

  // Number simplifications first (cheapest, most dramatic).
  if (typeof current === "number") {
    for (const candidate of [0, 1, -1]) {
      if (++steps > MAX_STEPS) break;
      if (candidate !== current && (await stillFails(candidate))) {
        current = candidate;
        return current;
      }
    }
  }

  // String truncation: binary-search down to a minimal failing prefix.
  if (typeof current === "string" && current.length > 1) {
    let s: string = current;
    let lo = 1;
    let hi = s.length;
    while (lo < hi && steps < MAX_STEPS) {
      steps++;
      const mid = Math.floor((lo + hi) / 2);
      if (await stillFails(s.slice(0, mid))) {
        hi = mid;
        s = s.slice(0, mid);
      } else {
        lo = mid + 1;
      }
    }
    return s;
  }

  // Arrays: drop elements while the failure survives.
  if (Array.isArray(current)) {
    const items: unknown[] = current as unknown[];
    let arr: unknown[] = [...items];
    let i = 0;
    while (i < arr.length && steps < MAX_STEPS) {
      steps++;
      const candidate = [...arr.slice(0, i), ...arr.slice(i + 1)];
      if (await stillFails(candidate)) {
        arr = candidate;
      } else {
        i++;
      }
    }
    current = arr;
  }

  // Objects: remove one key at a time while the failure survives.
  if (typeof current === "object" && current !== null && !Array.isArray(current)) {
    let obj: Record<string, unknown> = { ...(current as Record<string, unknown>) };
    let changed = true;
    while (changed && steps < MAX_STEPS) {
      changed = false;
      for (const key of Object.keys(obj)) {
        if (steps >= MAX_STEPS) break;
        steps++;
        const { [key]: _removed, ...rest } = obj;
        if (await stillFails(rest)) {
          obj = { ...rest };
          changed = true;
        }
      }
    }
    return obj;
  }

  return current;
}

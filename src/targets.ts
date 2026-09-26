import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { TargetError, TimeoutError } from "./errors.js";
import type { TargetSpec, TargetConfig, AgentHandler } from "./types.js";

export async function resolveTarget(config: TargetConfig, timeoutMs?: number): Promise<TargetSpec> {
  switch (config.type) {
    case "module":
      return moduleTarget(config.path);
    case "http":
      return httpTarget(config, timeoutMs);
  }
}

/**
 * Load a module target: a JS/TS file whose default export is
 * `(input: unknown) => Promise<unknown>`. TS targets are only loadable
 * under Bun; under Node, point the target at built JavaScript.
 */
export async function moduleTarget(path: string): Promise<TargetSpec> {
  if (path.trim().length === 0) {
    throw new TargetError("module target path must not be empty");
  }
  let mod: unknown;
  const resolved = resolveAgainstCwd(path);
  try {
    mod = await import(resolved);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new TargetError(`could not load target module '${path}': ${detail}`);
  }
  const handler = (mod as { default?: unknown } | null)?.default;
  if (typeof handler !== "function") {
    throw new TargetError(`target module '${path}' must default-export an async function (input) => Promise<output>`);
  }
  return asTarget(path, handler as AgentHandler);
}

export function asTarget(name: string, run: AgentHandler): TargetSpec {
  return { name, run };
}

function resolveAgainstCwd(path: string): string {
  if (path.startsWith("/")) return path;
  if (path.startsWith("./") || path.startsWith("../")) {
    return pathToFileURL(resolve(process.cwd(), path)).href;
  }
  // Bare specifier: let Node/Bun resolution decide (e.g. a package export).
  return path;
}

/**
 * HTTP target: POSTs the fuzz input as a JSON body and treats any 2xx
 * response as success. Non-2xx statuses count as crashes (the oracle
 * sees them as thrown errors).
 */
export function httpTarget(config: TargetConfig & { type: "http" }, timeoutMs?: number): TargetSpec {
  const method = (config.method ?? "POST").toUpperCase();
  const headers = { "content-type": "application/json", ...(config.headers ?? {}) };
  return {
    name: `${method} ${config.url}`,
    async run(input: unknown): Promise<unknown> {
      const body = JSON.stringify(input);
      let response: Response;
      try {
        response = await fetch(config.url, {
          method,
          headers,
          body,
          ...(timeoutMs !== undefined ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
        });
      } catch (err) {
        // A fetch aborted by our own timeout signal is a timeout, not a crash.
        if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
          throw new TimeoutError(timeoutMs ?? 0);
        }
        throw err;
      }
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 200)}`);
      }
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    },
  };
}

/** Run `promise` under a hard timeout. Rejects with TimeoutError on expiry. */
export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

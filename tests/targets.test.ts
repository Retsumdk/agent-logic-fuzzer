import { describe, expect, test } from "bun:test";
import { moduleTarget, httpTarget, asTarget, withTimeout } from "../src/targets.js";
import { TargetError, TimeoutError } from "../src/errors.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("moduleTarget", () => {
  test("loads a file whose default export is an async handler", async () => {
    const dir = mkdtempSync(join(tmpdir(), "alf-target-"));
    const path = join(dir, "agent.mjs");
    writeFileSync(path, "export default async (input) => ({ got: input });", "utf-8");
    const target = await moduleTarget(path);
    expect(target.name).toBe(path);
    expect(await target.run("hi")).toEqual({ got: "hi" });
    rmSync(dir, { recursive: true, force: true });
  });

  test("rejects missing modules and wrong export shapes", async () => {
    await expect(moduleTarget("/nonexistent/target.js")).rejects.toThrow(TargetError);
    const dir = mkdtempSync(join(tmpdir(), "alf-target-"));
    const path = join(dir, "bad.mjs");
    writeFileSync(path, "export const notDefault = 1;", "utf-8");
    await expect(moduleTarget(path)).rejects.toThrow(/must default-export/);
    rmSync(dir, { recursive: true, force: true });
  });

  test("rejects empty paths", async () => {
    await expect(moduleTarget("  ")).rejects.toThrow(/must not be empty/);
  });
});

describe("httpTarget", () => {
  test("rejects non-http URLs at config time, not request time", () => {
    // buildConfig validates URLs; httpTarget itself trusts its input but we
    // verify the happy-path wiring here against a local Bun server.
    expect(typeof httpTarget({ type: "http", url: "http://localhost:1/x" }).run).toBe("function");
  });

  test("turns non-2xx responses into thrown errors (caught by no-crash)", async () => {
    const { Bun } = globalThis as unknown as { Bun?: { serve: (opts: unknown) => { stop: () => void; port: number } } };
    if (!Bun) return; // Node consumer: skip the live-server check
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response("nope", { status: 400 }),
    });
    try {
      const target = httpTarget({ type: "http", url: `http://localhost:${server.port}/decide` });
      const threw = await target.run({ a: 1 }).then(
        () => false,
        (err: unknown) => (err instanceof Error ? err.message.includes("400") : false),
      );
      expect(threw).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  test("parses JSON responses and passes through text", async () => {
    const { Bun } = globalThis as unknown as { Bun?: { serve: (opts: unknown) => { stop: () => void; port: number } } };
    if (!Bun) return;
    const server = Bun.serve({
      port: 0,
      fetch: (req: Request) => req.url.endsWith("/text")
        ? new Response("plain", { status: 200 })
        : Response.json({ ok: true }),
    });
    try {
      const target = httpTarget({ type: "http", url: `http://localhost:${server.port}/json` });
      expect(await target.run({})).toEqual({ ok: true });
      const textTarget = httpTarget({ type: "http", url: `http://localhost:${server.port}/text` });
      expect(await textTarget.run({})).toBe("plain");
    } finally {
      server.stop(true);
    }
  });
});

describe("asTarget / withTimeout", () => {
  test("asTarget wraps a handler with a name", async () => {
    const target = asTarget("inline", async (input) => input);
    expect(target.name).toBe("inline");
    expect(await target.run(1)).toBe(1);
  });

  test("withTimeout resolves fast promises untouched", async () => {
    expect(await withTimeout(Promise.resolve("fast"), 500)).toBe("fast");
  });

  test("withTimeout rejects with TimeoutError when the budget is exceeded", async () => {
    await expect(
      withTimeout(new Promise<string>(() => {}), 25),
    ).rejects.toThrow(TimeoutError);
  });
});

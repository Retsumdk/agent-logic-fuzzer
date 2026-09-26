import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildConfig, loadConfigFile, defaultOracles } from "../src/config.js";
import { ConfigError } from "../src/errors.js";

describe("buildConfig defaults", () => {
  test("applies documented defaults", () => {
    const config = buildConfig({});
    expect(config.runs).toBe(100);
    expect(config.timeoutMs).toBe(2000);
    expect(config.minimize).toBe(true);
    expect(config.oracles).toEqual(defaultOracles());
    expect(Number.isInteger(config.seed)).toBe(true);
  });

  test("requires a target eventually", () => {
    const config = buildConfig({});
    expect(config.target).toBeUndefined();
  });
});

describe("buildConfig parsing", () => {
  test("parses a full module config", () => {
    const config = buildConfig({
      target: { type: "module", path: "./agent.js" },
      runs: 250,
      seed: 7,
      timeoutMs: 500,
      minimize: false,
      generators: { maxStringLength: 256, maxNestingDepth: 16, weights: { adversarial: 10 } },
      oracles: ["nonempty", { kind: "require-fields", fields: ["decision"] }],
    });
    expect(config.target).toEqual({ type: "module", path: "./agent.js" });
    expect(config.runs).toBe(250);
    expect(config.seed).toBe(7);
    expect(config.timeoutMs).toBe(500);
    expect(config.minimize).toBe(false);
    expect(config.oracles).toEqual([{ kind: "nonempty" }, { kind: "require-fields", fields: ["decision"] }]);
  });

  test("parses http targets with method and headers", () => {
    const config = buildConfig({
      target: { type: "http", url: "https://example.test/decide", method: "put", headers: { authorization: "Bearer x" } },
    });
    expect(config.target).toEqual({
      type: "http",
      url: "https://example.test/decide",
      method: "PUT",
      headers: { authorization: "Bearer x" },
    });
  });

  test("CLI overrides win over file values", () => {
    const config = buildConfig({ runs: 5, seed: 1 }, { runs: 50, seed: 2 });
    expect(config.runs).toBe(50);
    expect(config.seed).toBe(2);
  });
});

describe("buildConfig validation", () => {
  test("rejects unknown generators, oracles, and malformed values", () => {
    expect(() => buildConfig({ generators: { weights: { "nope": 1 } } })).toThrow(/unknown generator/);
    expect(() => buildConfig({ oracles: ["nope"] })).toThrow(/unknown oracle/);
    expect(() => buildConfig({ runs: 0 })).toThrow(/runs/);
    expect(() => buildConfig({ runs: 1.5 })).toThrow(/runs/);
    expect(() => buildConfig({ timeoutMs: -1 })).toThrow(/timeoutMs/);
    expect(() => buildConfig({ target: { type: "http", url: "ftp://x" } })).toThrow(/http/);
    expect(() => buildConfig({ target: { type: "module", path: "" } })).toThrow(/path/);
    expect(() => buildConfig({ target: "module" })).toThrow(/must be an object/);
    expect(() => buildConfig({ oracles: [{ kind: "require-fields" }] })).toThrow(/fields/);
    expect(() => buildConfig({ generators: { weights: { adversarial: -1 } } })).toThrow(/non-negative/);
    expect(() => buildConfig({ generators: { weights: { adversarial: 0, "mutate-json": 0, "mutate-string": 0, "boundary-numbers": 0, "structure-bombs": 0 } } })).toThrow(/> 0/);
  });
});

describe("loadConfigFile", () => {
  test("reads a valid JSON file", () => {
    const dir = mkdtempSync(join(tmpdir(), "alf-config-"));
    const path = join(dir, "fuzz.config.json");
    writeFileSync(path, JSON.stringify({ runs: 12, seed: 34 }), "utf-8");
    const parsed = loadConfigFile(path);
    expect(buildConfig(parsed).runs).toBe(12);
    rmSync(dir, { recursive: true, force: true });
  });

  test("rejects missing files and invalid JSON with ConfigError", () => {
    expect(() => loadConfigFile("/nonexistent/fuzz.config.json")).toThrow(ConfigError);
    const dir = mkdtempSync(join(tmpdir(), "alf-config-"));
    const path = join(dir, "broken.json");
    writeFileSync(path, "{not json", "utf-8");
    expect(() => loadConfigFile(path)).toThrow(/not valid JSON/);
    rmSync(dir, { recursive: true, force: true });
  });
});

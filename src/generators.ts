import type { GeneratorConfig, GeneratorKind, Json } from "./types.js";
import { caseSeed, Rng } from "./rng.js";

const ADVERSARIAL_STRINGS: readonly string[] = [
  "",
  " ",
  "\n",
  "\r\n",
  "\t\t",
  "\u0000",
  "\u0000\u0000",
  "\\x00\\x00",
  "' OR 1=1 --",
  '"; DROP TABLE users; --',
  "{{7*7}}",
  "${7*7}",
  "<script>alert(1)</script>",
  "</textarea><script>alert(1)</script>",
  "../../etc/passwd",
  "%2e%2e%2f%2e%2e%2f",
  "\u202Eevil.txt", // RTL override
  "zero\u200Bwidth", // zero-width space
  "\u{1F916}\u{1F916}\u{1F916}", // astral-plane emoji
  "e\u0301combining", // combining marks
  "ﬁ ligature", // normalization trap (single code point)
  "{}",
  "[]",
  "null",
  "undefined",
  "NaN",
  "Infinity",
  "-Infinity",
  '{"json": "trailing",}',
  '{"a":',
  "[1,2,",
  "\\u0000\\uFFFF\\uD800", // lone surrogate
  "A".repeat(0), // replaced below with a sized payload at generation time
  "\u{10FFFE}", // noncharacter
  "​", // zero-width space alone
];

const HUGE_STRING_SENTINEL = 32; // index of the "A".repeat(0) entry above
const INJECTION_KEY_NAMES: readonly string[] = [
  "__proto__",
  "constructor",
  "prototype",
  "hasOwnProperty",
  "toString",
  "",
  " ",
  "a.b",
  'a"b',
  "a\\b",
];

const BOUNDARY_NUMBERS: readonly number[] = [
  0, -0, 1, -1, 42, 0.5, -0.5, Number.EPSILON, -Number.EPSILON,
  Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1,
  Number.MIN_SAFE_INTEGER, Number.MIN_SAFE_INTEGER - 1,
  Number.MAX_VALUE, 5e-324, 1e308, -1e308, 2 ** 53, -(2 ** 53),
  1 / 3, Math.PI, -Math.PI, 0.1 + 0.2,
];

const BOUNDARY_NUMERAL_STRINGS: readonly string[] = [
  "0", "-0", "00", "0x10", "0b1010", "0o17", "1e3", "1E-3", "1_000",
  "NaN", "Infinity", "-Infinity", "+5", " 5", "5 ", "5.0.0", "٢٥", "Ⅴ",
];

export const GENERATOR_KINDS: readonly GeneratorKind[] = [
  "adversarial",
  "mutate-json",
  "mutate-string",
  "boundary-numbers",
  "structure-bombs",
];

export function defaultWeights(): Record<GeneratorKind, number> {
  return {
    adversarial: 30,
    "mutate-json": 25,
    "mutate-string": 20,
    "boundary-numbers": 10,
    "structure-bombs": 15,
  };
}

function resolveWeights(config: GeneratorConfig): Record<GeneratorKind, number> {
  const weights = defaultWeights();
  const overrides = config.weights ?? {};
  for (const kind of GENERATOR_KINDS) {
    const w = overrides[kind];
    if (typeof w === "number" && w >= 0) weights[kind] = w;
  }
  return weights;
}

export function pickGeneratorKind(rng: Rng, config: GeneratorConfig): GeneratorKind {
  const weights = resolveWeights(config);
  let total = 0;
  for (const kind of GENERATOR_KINDS) total += weights[kind];
  if (total <= 0) return "adversarial";
  let roll = rng.next() * total;
  for (const kind of GENERATOR_KINDS) {
    roll -= weights[kind];
    if (roll < 0) return kind;
  }
  return "adversarial";
}

function limits(config: GeneratorConfig): {
  maxStringLength: number;
  maxArrayLength: number;
  maxNestingDepth: number;
} {
  return {
    maxStringLength: config.maxStringLength ?? 8192,
    maxArrayLength: config.maxArrayLength ?? 512,
    maxNestingDepth: config.maxNestingDepth ?? 64,
  };
}

function adversarialString(rng: Rng, config: GeneratorConfig): string {
  const { maxStringLength } = limits(config);
  const i = rng.int(ADVERSARIAL_STRINGS.length);
  if (i === HUGE_STRING_SENTINEL) {
    const n = Math.min(maxStringLength, 4096 + rng.int(maxStringLength));
    return "A".repeat(n);
  }
  const base = ADVERSARIAL_STRINGS[i] ?? "";
  if (base.length === 0) return base;
  // Occasionally stack two payloads to create interactions.
  if (rng.bool(0.25)) {
    const j = rng.int(ADVERSARIAL_STRINGS.length);
    const other = ADVERSARIAL_STRINGS[j] ?? "";
    return base + other;
  }
  return base;
}

function seedJson(rng: Rng, config: GeneratorConfig): Json {
  const { maxArrayLength } = limits(config);
  const roll = rng.int(8);
  switch (roll) {
    case 0:
      return null;
    case 1:
      return rng.bool();
    case 2:
      return rng.pick(BOUNDARY_NUMBERS);
    case 3:
      return rng.pick(BOUNDARY_NUMERAL_STRINGS);
    case 4:
      return adversarialString(rng, config).slice(0, 256);
    case 5: {
      const n = 1 + rng.int(4);
      return Array.from({ length: n }, () => rng.pick(BOUNDARY_NUMBERS));
    }
    case 6: {
      const n = 1 + rng.int(4);
      const obj: { [key: string]: Json } = {};
      for (let k = 0; k < n; k++) {
        obj[rng.pick(INJECTION_KEY_NAMES) || `k${k}`] = rng.pick(BOUNDARY_NUMERAL_STRINGS);
      }
      return obj;
    }
    default: {
      const n = rng.int(maxArrayLength === 0 ? 1 : Math.min(8, maxArrayLength));
      return Array.from({ length: n }, () => null);
    }
  }
}

function mutateJson(value: Json, rng: Rng, config: GeneratorConfig): Json {
  const { maxNestingDepth } = limits(config);
  let current: Json = structuredCloneSafe(value);
  const mutations = 1 + rng.int(3);
  for (let m = 0; m < mutations; m++) {
    current = applyJsonMutation(current, rng, config, maxNestingDepth);
  }
  return current;
}

/** JSON-safe structured clone (structuredClone exists in Node 17+, but stay explicit). */
function structuredCloneSafe(value: Json): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function applyJsonMutation(value: Json, rng: Rng, config: GeneratorConfig, maxDepth: number): Json {
  const roll = rng.int(8);
  switch (roll) {
    case 0: // delete a key
      if (isPlainObject(value)) {
        const keys = Object.keys(value);
        if (keys.length > 0) {
          const victim = keys[rng.int(keys.length)];
          if (victim !== undefined) {
            const copy: { [key: string]: Json } = { ...value };
            delete copy[victim];
            return copy;
          }
        }
      }
      return value;
    case 1: // duplicate a key with a type-flipped value
      if (isPlainObject(value)) {
        const copy: { [key: string]: Json } = { ...value };
        const keys = Object.keys(copy);
        const key = keys.length > 0 ? (keys[rng.int(keys.length)] ?? "k") : "k";
        copy[key] = flipType(copy[key], rng, config);
        return copy;
      }
      return value;
    case 2: // inject a hostile key
      if (isPlainObject(value)) {
        const copy: { [key: string]: Json } = { ...value };
        copy[rng.pick(INJECTION_KEY_NAMES)] = adversarialString(rng, config).slice(0, 128) || null;
        return copy;
      }
      return value;
    case 3: // wrap in an array
      return [value];
    case 4: // wrap under an object key
      return { data: value, [rng.pick(INJECTION_KEY_NAMES) || "meta"]: null };
    case 5: // nest deeper
      return nest(value, 1 + rng.int(3), maxDepth);
    case 6: // replace a nested leaf with a hostile string
      return replaceLeaf(value, rng, config, 0);
    default: // swap to a boundary number
      return typeof value === "number" ? rng.pick(BOUNDARY_NUMBERS) : seedJson(rng, config);
  }
}

function flipType(v: Json | undefined, rng: Rng, config: GeneratorConfig): Json {
  if (v === undefined || v === null) return adversarialString(rng, config).slice(0, 128);
  if (typeof v === "string") return rng.bool() ? 0 : null;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : 0;
  return "flattened";
}

function nest(value: Json, depth: number, maxDepth: number): Json {
  let current = value;
  for (let i = 0; i < depth && i < maxDepth; i++) {
    current = current === null || current === undefined ? null : { child: current };
  }
  return current;
}

function replaceLeaf(value: Json, rng: Rng, config: GeneratorConfig, depth: number): Json {
  if (depth > 16) return value;
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return value;
    const key = keys[rng.int(keys.length)];
    if (key === undefined) return value;
    return { ...value, [key]: replaceLeaf(value[key] ?? null, rng, config, depth + 1) };
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return value;
    const i = rng.int(value.length);
    const copy = [...value];
    copy[i] = replaceLeaf(copy[i] ?? null, rng, config, depth + 1);
    return copy;
  }
  return adversarialString(rng, config).slice(0, 128);
}

function isPlainObject(v: Json): v is { [key: string]: Json } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function mutateString(rng: Rng, config: GeneratorConfig): string {
  const { maxStringLength } = limits(config);
  let s = adversarialString(rng, config);
  if (s.length === 0) s = "seed";
  const mutations = 1 + rng.int(3);
  for (let m = 0; m < mutations; m++) {
    const roll = rng.int(6);
    switch (roll) {
      case 0: // truncate at a random point
        s = s.slice(0, rng.int(s.length + 1));
        break;
      case 1: // append junk
        s = s + adversarialString(rng, config).slice(0, 64);
        break;
      case 2: // duplicate a substring
        if (s.length > 1) {
          const start = rng.int(s.length);
          s = s.slice(0, start) + s.slice(start) + s.slice(start);
        }
        break;
      case 3: // swap two chars
        if (s.length > 1) {
          const i = rng.int(s.length);
          const j = rng.int(s.length);
          const chars = [...s];
          const ci = chars[i] ?? "";
          const cj = chars[j] ?? "";
          chars[i] = cj;
          chars[j] = ci;
          s = chars.join("");
        }
        break;
      case 4: // insert a control character
        s = s.slice(0, rng.int(s.length + 1)) + "\u0000" + s.slice(rng.int(s.length + 1));
        break;
      default: // repeat to grow toward the size limit
        if (s.length > 0 && s.length < maxStringLength) {
          const factor = Math.min(64, Math.max(2, Math.floor(maxStringLength / Math.max(1, s.length))));
          s = s.repeat(rng.int(factor) + 1).slice(0, maxStringLength);
        }
        break;
    }
    if (s.length > maxStringLength) s = s.slice(0, maxStringLength);
  }
  return s;
}

function boundaryNumber(rng: Rng): number | string {
  if (rng.bool(0.3)) return rng.pick(BOUNDARY_NUMERAL_STRINGS);
  return rng.pick(BOUNDARY_NUMBERS);
}

function structureBomb(rng: Rng, config: GeneratorConfig): Json {
  const { maxNestingDepth, maxArrayLength } = limits(config);
  const roll = rng.int(5);
  switch (roll) {
    case 0: {
      // deep nesting
      let v: Json = "bottom";
      for (let i = 0; i < maxNestingDepth; i++) v = { child: v };
      return v;
    }
    case 1: {
      // wide array
      return Array.from({ length: maxArrayLength }, () => null);
    }
    case 2: {
      // many keys with hostile names
      const obj: { [key: string]: Json } = {};
      const n = Math.min(256, maxArrayLength);
      for (let i = 0; i < n; i++) obj[`key_${i}_${rng.int(16)}`] = i;
      return obj;
    }
    case 3: {
      // deep array nesting
      let v: Json = 1;
      for (let i = 0; i < Math.min(maxNestingDepth, 128); i++) v = [v];
      return v;
    }
    default: {
      // wide object of long keys
      const obj: { [key: string]: Json } = {};
      for (let i = 0; i < Math.min(64, maxArrayLength); i++) {
        obj["k".repeat(256) + String(i)] = "v".repeat(256);
      }
      return obj;
    }
  }
}

/** Generate one fuzz input for a kind already chosen by `pickGeneratorKind`. */
export function generateInputOfKind(kind: GeneratorKind, rng: Rng, config: GeneratorConfig): unknown {
  switch (kind) {
    case "adversarial":
      return adversarialString(rng, config);
    case "mutate-json":
      return mutateJson(seedJson(rng, config), rng, config);
    case "mutate-string":
      return mutateString(rng, config);
    case "boundary-numbers":
      return boundaryNumber(rng);
    case "structure-bombs":
      return structureBomb(rng, config);
  }
}

/** Generate one fuzz input deterministically from `rng` under `config`. */
export function generateInput(rng: Rng, config: GeneratorConfig): unknown {
  const kind = pickGeneratorKind(rng, config);
  return generateInputOfKind(kind, rng, config);
}

/** Every generated input must survive a JSON round-trip so HTTP targets can send it. */
export function isJsonSafe(value: unknown): boolean {
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
}

export interface CorpusEntry {
  readonly id: number;
  readonly seed: number;
  readonly generator: GeneratorKind;
  readonly input: unknown;
}

/**
 * Generate case `index` exactly as the fuzz loop does: the case seed is mixed
 * from (baseSeed, index), the generator kind is drawn first, then the input.
 * The corpus command and the fuzz loop share this function, so case i of a
 * printed corpus is always byte-identical to what the loop would execute.
 */
export function generateCase(baseSeed: number, index: number, config: GeneratorConfig = {}): CorpusEntry {
  const seed = caseSeed(baseSeed, index);
  const rng = new Rng(seed);
  const generator = pickGeneratorKind(rng, config);
  return { id: index, seed, generator, input: generateInputOfKind(generator, rng, config) };
}

/** Deterministically generate a standalone corpus (used by the `corpus` command). */
export function generateCorpus(baseSeed: number, count: number, config: GeneratorConfig = {}): CorpusEntry[] {
  return Array.from({ length: count }, (_unused, i) => generateCase(baseSeed, i, config));
}

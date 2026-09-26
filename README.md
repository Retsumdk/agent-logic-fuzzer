# agent-logic-fuzzer

Deterministic adversarial fuzzing for AI-agent decision endpoints: seeded scenario generation, timeout/crash/echo/stack-leak oracles, and delta-debugging counterexample minimisation. Zero runtime dependencies.

## The problem

Autonomous agents fail at the edges: malformed inputs, unexpected payload shapes, slow tool calls, prompt-injection echoes, and error messages that leak internals. Each of these failure classes is *predictable*, yet agent pipelines are usually tested with a handful of happy-path fixtures. When an agent misbehaves in production you get a vague bug report instead of a minimal, replayable counterexample.

## The solution

`agent-logic-fuzzer` treats your agent's decision function the way a property-based testing tool treats a parser: point a fuzz harness at it, generate thousands of hostile inputs from a fixed seed, evaluate every response against a set of *oracles* (behavioural contracts), and — when something breaks — shrink the input down to the smallest thing that still fails, with a reproduce command.

Compared to ad-hoc "weird inputs" tests:

- **Deterministic** — same seed ⇒ same corpus ⇒ same failures, on your laptop and in CI.
- **Agent-shaped** — generators speak JSON, hostile strings, boundary numbers, and deep/wide structures, not raw bytes.
- **Oracle-based** — checks behavioural contracts (`no-echo`, `no-stack-leak`) that generic fuzzers don't have.
- **Minimising** — delta-debugging turns a 8 KB bomb into `""` or `{"child": 1}` automatically.

## How it works

```
                 ┌──────────────────────────────────────────────┐
 config / CLI ──►│  generators (seeded)                         │
                 │   adversarial · mutate-json · mutate-string  │
                 │   boundary-numbers · structure-bombs         │
                 └──────────────┬───────────────────────────────┘
                                │  one input per case (seed, i)
                 ┌──────────────▼───────────────┐
                 │  target runner               │  module: default-exported
                 │  (hard per-case timeout)     │  async fn, or HTTP POST JSON
                 └──────────────┬───────────────┘
                 ┌──────────────▼───────────────┐
                 │  oracles                     │  no-crash · no-timeout
                 │                              │  no-echo · no-stack-leak
                 │                              │  nonempty · valid-json
                 │                              │  require-fields
                 └──────────────┬───────────────┘
                 ┌──────────────▼───────────────┐
                 │  shrinker + report           │  delta-debug failing inputs,
                 │                              │  JSON report, exit code
                 └──────────────────────────────┘
```

Every case index `i` derives its own RNG stream from `(seed, i)` via splitmix32, so case 417 is byte-identical whether you ran 500 cases or are re-running case 417 alone.

## Getting started

Requires Node ≥ 20 (or Bun ≥ 1.1).

**Install (library or CLI):**

```bash
npm install github:Retsumdk/agent-logic-fuzzer
```

**Run the built-in demo** (a deliberately fragile agent with 4 planted bugs):

```bash
npx agent-logic-fuzzer demo --seed 2026 --runs 120
```

Real output:

```
fuzzing the built-in fragile demo agent (4 planted bugs)

FAIL: 50 failure(s) across 120 run(s) in 354ms
target: builtin:demo | seed: 2026
per-generator:
  adversarial           34 cases, 22 failures
  boundary-numbers       9 cases, 5 failures
  mutate-json           34 cases, 21 failures
  mutate-string         29 cases, 15 failures
  structure-bombs        14 cases, 14 failures
oracle failures:
  no-crash           8
  no-echo            66
  no-stack-leak      11
  no-timeout         1
```

**Fuzz your own agent.** Your target is any module whose default export is an async function:

```js
// agent.js  (plain JS — runs under Node; TS sources need Bun)
export default async function decide(input) {
  const r = await reason(input);        // your agent logic
  return { decision: r.text };          // return a value, or throw
}
```

```bash
npx agent-logic-fuzzer run --target ./agent.js --runs 500 --seed 1337
```

Exit code is `0` when clean, `1` when any oracle failed — wire it straight into CI.

## CLI reference

```
agent-logic-fuzzer run    [--config file] [--target path] [--runs n] [--seed n]
                            [--timeout ms] [--no-minimize] [--out file] [--json]
agent-logic-fuzzer corpus --seed n [--count n]   # print the corpus as JSONL
agent-logic-fuzzer demo [--seed n] [--runs n]    # fuzz the fragile demo agent
agent-logic-fuzzer help
```

| Flag | Meaning |
| --- | --- |
| `--config <file>` | JSON config file (schema below) |
| `--target <path>` | Shortcut for `{"target":{"type":"module","path":"..."}}` |
| `--runs <n>` | Number of fuzz cases (default 100, max 100 000) |
| `--seed <n>` | Base seed; identical seeds reproduce identical corpora |
| `--timeout <ms>` | Per-case time budget (default 2 000) |
| `--no-minimize` | Skip delta-debugging minimisation of failing inputs |
| `--out <file>` | Write the full JSON report to a file |
| `--json` | Print the JSON report to stdout (no banner) |

**Corpus inspection** — print exactly what will be sent, without executing anything:

```bash
$ npx agent-logic-fuzzer corpus --seed 2026 --count 3
{"id":0,"seed":3346012383,"generator":"adversarial","input":"%2e%2e%2f%2e%2e%2f"}
{"id":1,"seed":2261737103,"generator":"mutate-string","input":"\u0000\u0000<script>alert(1\u0000\u0000<script>alert(1\u0000\u0000<script>alert(1\u0000\u0000<script>alert(1"}
{"id":2,"seed":950685697,"generator":"adversarial","input":"\r\n"}
```

A printed corpus doubles as a regression fixture: case `i` is byte-identical to what the fuzz loop sends for the same seed.

## Oracles

| Oracle | Always on? | Fails when |
| --- | --- | --- |
| `no-crash` | yes | the target throws |
| `no-timeout` | yes | the target exceeds `timeoutMs` |
| `no-echo` | opt-in | the output contains the raw input payload (or any ≥ 8-char string leaf of it) verbatim — the prompt-injection echo smell |
| `no-stack-leak` | opt-in | the output contains stack-frame text (`at x (f.js:1:2)`, `node:internal`, `node_modules/`) |
| `nonempty` | opt-in | the output is empty/whitespace |
| `valid-json` | opt-in | a string output does not parse as JSON |
| `require-fields` | opt-in | an object output is missing named fields (e.g. `["decision"]`) |

Example config (`fuzz.config.json`):

```json
{
  "target": { "type": "http", "url": "http://127.0.0.1:8931/decide" },
  "runs": 60,
  "seed": 42,
  "timeoutMs": 1000,
  "oracles": ["no-crash", "no-echo"]
}
```

```bash
npx agent-logic-fuzzer run --config fuzz.config.json
```

Verified end-to-end against a local HTTP agent that echoes its payload back inside a JSON envelope:

```
FAIL: 30 failure(s) across 60 run(s) in 1158ms
target: POST http://127.0.0.1:8931/decide | seed: 42
per-generator:
  adversarial           24 cases, 9 failures
  boundary-numbers       5 cases, 2 failures
  mutate-json           18 cases, 11 failures
  mutate-string          5 cases, 0 failures
  structure-bombs        8 cases, 8 failures
oracle failures:
  no-echo            30
```

HTTP targets POST each input as a JSON body (every generated input is guaranteed JSON-serialisable) and treat non-2xx responses as crashes.

## Minimisation

When a case fails, the shrinker delta-debugs it: strings are binary-searched to a minimal failing prefix, arrays drop innocent elements, objects drop innocent keys, and numbers snap to `0`/`1`/`-1` when the failure survives. Every simplification is re-executed against the target — a kept simplification always still fails.

From the demo run above, case 5's original boundary-number payload shrank to a 7-character string that still trips the oracle:

```
--- failure #5 (generator: boundary-numbers) ---
oracle: no-echo | output echoes the raw input payload verbatim (probe: "' OR 1=1 --\t\t"...)
input: "' OR 1="
reproduce: rerun with --seed 2026 (case 5, case-seed 3445366617)
```

## Library API

```ts
import { runFuzz, asTarget } from "agent-logic-fuzzer";

const report = await runFuzz(
  {
    target: { type: "module", path: "./agent.js" }, // required by the type;
    runs: 500,                                      // the explicit TargetSpec
    seed: 1337,                                     // below wins
    timeoutMs: 2_000,
    generators: {},                                 // defaults, weighted
    oracles: [{ kind: "no-crash" }, { kind: "no-echo" }],
    minimize: true,
  },
  asTarget("inline", myDecideFn),
);

if (report.failureCount > 0) {
  for (const f of report.failures) {
    console.log(f.failedOracle, f.detail, f.minimizedInput ?? f.input);
  }
}
```

The report (`FuzzReport`) includes `failureCount`, per-generator case/failure counts, an oracle-failure breakdown, and the full failure list with original + minimised inputs. `run --json` emits the same object.

Quickstart script: `bun examples/quickstart.ts` (runs the harness against a fragile inline agent and prints the top failures).

## Generators

| Generator | Default weight | Produces |
| --- | --- | --- |
| `adversarial` | 30 | SQL/XSS/path-traversal/injection strings, control chars, Unicode direction/zero-width traps, lone surrogates, oversized payloads |
| `mutate-json` | 25 | Type-flipped values, hostile key names (`__proto__`, `constructor`), key deletion, wrapping and re-nesting |
| `mutate-string` | 20 | Truncation, duplication, control-char insertion, growth to the size cap |
| `boundary-numbers` | 10 | `MAX_SAFE_INTEGER ± 1`, `-0`, `5e-324`, `0.1 + 0.2`, numeral strings (`0x10`, `1e3`, `+5`, ` 5`) |
| `structure-bombs` | 15 | Deep nesting (depth 64), wide arrays/objects, 256-byte keys |

Weights are configurable per generator (including zero) via `generators.weights` in the config file.

## Development

```bash
git clone https://github.com/Retsumdk/agent-logic-fuzzer.git
cd agent-logic-fuzzer
bun install        # zero runtime dependencies; dev deps are typescript + @types/node
bun run typecheck  # tsc --noEmit (strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes)
bun test           # 78 tests across 7 files
bun run build      # emits dist/ (ESM, declarations, source maps)
```

CI (`.github/workflows/ci.yml`) runs typecheck → test → build → a Node smoke test of the built CLI on every push and PR.

## Scope

This harness checks generic behavioural contracts on structured input/output. It does not evaluate the *semantic quality* of an agent's reasoning, and it cannot inspect proprietary model internals — it observes what your decision function does with hostile inputs and reports minimal counterexamples when a contract breaks.

## License

[MIT](./LICENSE) — © 2026 Retsumdk

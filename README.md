# agent-logic-fuzzer

A configurable CLI harness for stress-testing agent decision pipelines with adversarial and edge-case scenarios.

## Why it exists

Autonomous agents fail in predictable ways at the edges: malformed inputs, timeouts, retry storms, and unexpected payload shapes. `agent-logic-fuzzer` gives agent operators a repeatable harness to point at any decision endpoint and validate how it responds under hostile or unusual inputs, so reasoning failures surface in CI instead of production.

## Architecture

```
agent-logic-fuzzer (bun + commander CLI)
│
├── src/index.ts        # CLI entrypoint: loads config, parses flags, runs the fuzz pass
└── config.json         # runtime settings (base URL, timeout, retries) — optional, JSON only
```

- Written in strict TypeScript (ES2022), run with Bun.
- CLI parsing via `commander` (`-c/--config`, `-v/--verbose`, `-V/--version`, `-h/--help`).
- Configuration is loaded at startup from `config.json` in the working directory and merged over built-in defaults; a missing or invalid file falls back to defaults without crashing.

## Installation

```bash
git clone https://github.com/Retsumdk/agent-logic-fuzzer.git
cd agent-logic-fuzzer
bun install
```

Requires [Bun](https://bun.sh) `>=1.0`.

## Usage

Run against the default configuration:

```bash
bun run src/index.ts
```

Enable verbose logging:

```bash
bun run src/index.ts --verbose
```

Point at a custom config file:

```bash
bun run src/index.ts --config ./ci/config.json
```

View the full CLI surface:

```bash
bun run src/index.ts --help
```

## Configuration

Create `config.json` in the repo root (or point to it with `--config`). All keys are optional and fall back to these defaults:

```json
{
  "baseUrl": "https://api.example.com",
  "timeout": 30000,
  "retries": 3
}
```

| Key       | Type   | Default                | Purpose                              |
|-----------|--------|------------------------|--------------------------------------|
| `baseUrl` | string | `https://api.example.com` | Endpoint the fuzz harness targets |
| `timeout` | number | `30000`                | Request timeout in milliseconds       |
| `retries` | number | `3`                    | Retry count on transient failures     |

## Real use case

Wire it into a CI step to smoke-test an agent's decision endpoint before deploy:

```yaml
- name: Fuzz agent decision endpoint
  run: |
    echo '{"baseUrl":"https://staging.agents.internal/predict","timeout":15000,"retries":2}' > config.json
    bun run src/index.ts --verbose
```

If the pipeline runs the harness against staging and any request exceeds the timeout or exhausts retries, the run fails loudly — catching degraded reasoning backends before they reach users.

## Roadmap

Adversarial scenario generation (mutation of valid payloads, boundary-value injection) is the core mutation engine this harness is designed to host, and is layered in without changing the CLI contract described above.

## License

MIT License — see [LICENSE](./LICENSE).

---

Built by [Retsumdk](https://github.com/Retsumdk)

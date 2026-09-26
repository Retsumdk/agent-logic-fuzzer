import type { AgentHandler } from "./types.js";

/**
 * A deliberately fragile "agent decision endpoint" used by the `demo`
 * command and the test suite. It plants one instance of each failure
 * class the extended oracle set is designed to catch, keyed to inputs the
 * generator corpus actually produces so a demo run exhibits every class:
 *
 *   1. crash       — throws on empty / whitespace-only input
 *   2. hang        — stalls asynchronously (the I/O-hang shape) on long inputs
 *   3. echo        — returns even-length string inputs verbatim
 *   4. stack-leak  — includes an internal stack frame for digit-bearing input
 */
export const demoAgent: AgentHandler = async (input: unknown) => {
  await tick();

  if (typeof input === "string") {
    if (input.trim().length === 0) {
      throw new Error("demo agent crashed: input must not be empty");
    }
    if (input.length > 2048) {
      // Asynchronous stall: the async I/O-hang shape. A synchronous
      // busy-wait would block the event loop and prevent the fuzzer's
      // own timeout timer from ever firing.
      await sleep(1200);
      return "eventually";
    }
    if (input.length % 2 === 0) {
      return input;
    }
    if (/\d/.test(input)) {
      return `unhandled at Object.<anonymous> (src/agent.ts:42:13) while thinking about ${input}`;
    }
    return `ok (${input.length} chars)`;
  }

  if (input === null || input === undefined) {
    throw new TypeError("demo agent crashed: cannot reason about nothing");
  }
  return { reasoned: true, input };
};

async function tick(): Promise<void> {
  await Promise.resolve();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

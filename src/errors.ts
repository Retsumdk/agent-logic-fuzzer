export class FuzzerError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FuzzerError";
    this.code = code;
  }
}

export class ConfigError extends FuzzerError {
  constructor(message: string) {
    super("E_CONFIG", message);
    this.name = "ConfigError";
  }
}

export class TargetError extends FuzzerError {
  constructor(message: string) {
    super("E_TARGET", message);
    this.name = "TargetError";
  }
}

export class TimeoutError extends FuzzerError {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super("E_TIMEOUT", `target did not respond within ${timeoutMs}ms`);
    this.name = "TimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

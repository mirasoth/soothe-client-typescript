/**
 * Custom error types for the Soothe client (RFC-450 protocol-1).
 */

/** Represents a WebSocket connection failure. */
export class ConnectionError extends Error {
  readonly url: string;
  readonly attempt: number;
  readonly cause: Error;

  constructor(url: string, attempt: number, cause: Error) {
    super(`connection error to ${url} (attempt ${attempt}): ${cause.message}`);
    this.name = 'ConnectionError';
    this.url = url;
    this.attempt = attempt;
    this.cause = cause;
  }
}

/**
 * Represents an error reported by the Soothe daemon (RFC-450 §7).
 *
 * The daemon's structured error object carries a numeric `code` from the
 * reserved ranges, a human-readable `message`, and optional `data`.
 */
export class DaemonError extends Error {
  /** Numeric error code from the RFC-450 §7.3 registry. */
  readonly code: number;
  /** The daemon's error message text. */
  readonly daemonMessage: string;
  /** Optional machine-parseable error details. */
  readonly data: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(`daemon error [${code}]: ${message}`);
    this.name = 'DaemonError';
    this.code = code;
    this.daemonMessage = message;
    this.data = data;
  }
}

/** Represents a timeout waiting for a daemon response. */
export class TimeoutError extends Error {
  readonly operation: string;
  readonly duration: string;

  constructor(operation: string, duration: string) {
    super(`timeout after ${duration} waiting for ${operation}`);
    this.name = 'TimeoutError';
    this.operation = operation;
    this.duration = duration;
  }
}

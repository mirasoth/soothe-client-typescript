/**
 * Custom error types for the Soothe client.
 */

/** Represents a WebSocket connection failure. */
export class ConnectionError extends Error {
  readonly url: string;
  readonly attempt: number;
  readonly cause: Error;

  constructor(url: string, attempt: number, cause: Error) {
    super(`connection error to ${url} (attempt ${attempt}): ${cause.message}`);
    this.name = "ConnectionError";
    this.url = url;
    this.attempt = attempt;
    this.cause = cause;
  }
}

/**
 * Represents an error reported by the Soothe daemon.
 *
 * The daemon's structured error object carries a numeric `code` from the
 * reserved ranges, a human-readable `message`, and optional `data`.
 */
export class DaemonError extends Error {
  /** Numeric error code from the daemon error registry. */
  readonly code: number;
  /** The daemon's error message text. */
  readonly daemonMessage: string;
  /** Optional machine-parseable error details. */
  readonly data: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(`daemon error [${code}]: ${message}`);
    this.name = "DaemonError";
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
    this.name = "TimeoutError";
    this.operation = operation;
    this.duration = duration;
  }
}

/**
 * Distinguishes clean vs unclean connection loss.
 *
 * A clean drop follows a `disconnect` notification (loops keep running
 * server-side); an unclean drop is a read/write error or a missed pong
 * (in-flight queries are cancelled). Pair with the Client's `'disconnected'`
 * event: the cause is emitted exactly once when the connection drops.
 */
export enum DisconnectCause {
  /** Abrupt loss: read/write error or missed pong. */
  Unclean = 0,
  /** Graceful peer-initiated `disconnect` notification. */
  Clean = 1,
}

/** Human-readable cause name for logging. */
export function disconnectCauseName(cause: DisconnectCause): string {
  return cause === DisconnectCause.Clean ? "clean" : "unclean";
}

/** Indicates a failed reconnection attempt sequence. */
export class ReconnectError extends Error {
  readonly url: string;
  readonly attempts: number;
  readonly cause: Error;

  constructor(url: string, attempts: number, cause: Error) {
    super(`reconnect to ${url} failed after ${attempts} attempts: ${cause.message}`);
    this.name = "ReconnectError";
    this.url = url;
    this.attempts = attempts;
    this.cause = cause;
  }
}

/**
 * Returned by `reattachAndProbe` when a loop accepts the reattach handshake
 * but fails the `loop_get` liveness probe. Callers should fall back to a
 * fresh `loop_new` bootstrap.
 */
export class StaleLoopError extends Error {
  readonly loopID: string;
  readonly cause?: Error;

  constructor(loopID: string, cause?: Error) {
    const detail = cause ? `: ${cause.message}` : "";
    super(`stale loop ${loopID}: reattach accepted but liveness probe failed${detail}`);
    this.name = "StaleLoopError";
    this.loopID = loopID;
    this.cause = cause;
  }
}

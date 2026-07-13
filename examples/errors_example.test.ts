/**
 * Error type examples: ConnectionError, DaemonError, TimeoutError,
 * ReconnectError, StaleLoopError, and DisconnectCause.
 *
 * Mirrors the Go client's `errors_example_test.go`.
 */

import { describe, it, expect } from "vitest";
import {
  ConnectionError,
  DaemonError,
  TimeoutError,
  ReconnectError,
  StaleLoopError,
  DisconnectCause,
  disconnectCauseName,
} from "../src/index.js";

describe("Example: ConnectionError", () => {
  it("connectionError: wraps a dial failure with URL and attempt", () => {
    const cause = new Error("dial tcp: connection refused");
    const ce = new ConnectionError("ws://localhost:8765", 3, cause);

    console.log(ce);
    console.log("URL:", ce.url);
    console.log("Attempt:", ce.attempt);
    console.log("Cause:", ce.cause.message);

    expect(ce.url).toBe("ws://localhost:8765");
    expect(ce.attempt).toBe(3);
    expect(ce.cause).toBe(cause);
    expect(ce.message).toContain("connection error to ws://localhost:8765");
    expect(ce.message).toContain("attempt 3");
    expect(ce.name).toBe("ConnectionError");
  });
});

describe("Example: DaemonError", () => {
  it("daemonError: carries numeric code, message, and optional data", () => {
    // Simple daemon error.
    const de = new DaemonError(-32200, "loop not found");
    console.log(de);
    console.log("Code:", de.code);
    console.log("Message:", de.daemonMessage);

    expect(de.code).toBe(-32200);
    expect(de.daemonMessage).toBe("loop not found");
    expect(de.message).toContain("[-32200]");
    expect(de.name).toBe("DaemonError");
  });

  it("daemonError: with structured data", () => {
    const de = new DaemonError(-32603, "internal error", { detail: "checkpoint corruption" });
    console.log(de);
    console.log("Data:", de.data);

    expect(de.code).toBe(-32603);
    expect(de.data).toMatchObject({ detail: "checkpoint corruption" });
  });
});

describe("Example: TimeoutError", () => {
  it("timeoutError: constructs for a stalled RPC call", () => {
    const te = new TimeoutError("daemon_status", "5s");
    console.log(te);
    console.log("Operation:", te.operation);
    console.log("Duration:", te.duration);

    expect(te.operation).toBe("daemon_status");
    expect(te.duration).toBe("5s");
    expect(te.message).toContain("timeout after 5s");
    expect(te.message).toContain("daemon_status");
    expect(te.name).toBe("TimeoutError");
  });
});

describe("Example: ReconnectError", () => {
  it("reconnectError: wraps a failed reconnection sequence", () => {
    const cause = new Error("websocket: bad handshake");
    const re = new ReconnectError("ws://localhost:8765", 10, cause);

    console.log(re);
    console.log("URL:", re.url);
    console.log("Attempts:", re.attempts);
    console.log("Cause:", re.cause.message);

    expect(re.url).toBe("ws://localhost:8765");
    expect(re.attempts).toBe(10);
    expect(re.cause).toBe(cause);
    expect(re.message).toContain("reconnect to ws://localhost:8765");
    expect(re.message).toContain("10 attempts");
    expect(re.name).toBe("ReconnectError");
  });
});

describe("Example: StaleLoopError", () => {
  it("staleLoopError: returned by reattachAndProbe when liveness probe fails", () => {
    const cause = new Error("loop_get timeout");
    const se = new StaleLoopError("loop-abc-123", cause);

    console.log(se);
    console.log("LoopID:", se.loopID);
    console.log("Cause:", se.cause?.message);

    expect(se.loopID).toBe("loop-abc-123");
    expect(se.cause).toBe(cause);
    expect(se.message).toContain("loop-abc-123");
    expect(se.message).toContain("liveness probe failed");
    expect(se.name).toBe("StaleLoopError");
  });

  it("staleLoopError: without a cause", () => {
    const se = new StaleLoopError("loop-xyz");
    console.log(se);
    console.log("LoopID:", se.loopID);

    expect(se.loopID).toBe("loop-xyz");
    expect(se.cause).toBeUndefined();
  });
});

describe("Example: DisconnectCause", () => {
  it("disconnectCause: clean vs unclean", () => {
    console.log("Unclean:", DisconnectCause.Unclean);
    console.log("Clean:", DisconnectCause.Clean);

    expect(DisconnectCause.Unclean).toBe(0);
    expect(DisconnectCause.Clean).toBe(1);
  });

  it("disconnectCauseName: human-readable cause names", () => {
    console.log("Unclean name:", disconnectCauseName(DisconnectCause.Unclean));
    console.log("Clean name:", disconnectCauseName(DisconnectCause.Clean));

    expect(disconnectCauseName(DisconnectCause.Unclean)).toBe("unclean");
    expect(disconnectCauseName(DisconnectCause.Clean)).toBe("clean");
  });
});

describe("Example: error instanceof chains", () => {
  it("all errors extend Error", () => {
    expect(new ConnectionError("url", 1, new Error("x"))).toBeInstanceOf(Error);
    expect(new DaemonError(-1, "msg")).toBeInstanceOf(Error);
    expect(new TimeoutError("op", "1s")).toBeInstanceOf(Error);
    expect(new ReconnectError("url", 1, new Error("x"))).toBeInstanceOf(Error);
    expect(new StaleLoopError("loop-1")).toBeInstanceOf(Error);
  });
});

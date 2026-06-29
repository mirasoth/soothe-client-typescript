import { describe, it, expect } from "vitest";
import { ConnectionError, DaemonError, TimeoutError } from "../src/errors.js";

describe("ConnectionError", () => {
  it("has correct properties", () => {
    const cause = new Error("refused");
    const err = new ConnectionError("ws://localhost:8765", 3, cause);
    expect(err.url).toBe("ws://localhost:8765");
    expect(err.attempt).toBe(3);
    expect(err.cause).toBe(cause);
    expect(err.name).toBe("ConnectionError");
    expect(err.message).toContain("ws://localhost:8765");
    expect(err.message).toContain("attempt 3");
  });
});

describe("DaemonError", () => {
  it("has correct properties", () => {
    const err = new DaemonError(-32200, "loop not found", { loop_id: "abc" });
    expect(err.code).toBe(-32200);
    expect(err.daemonMessage).toBe("loop not found");
    expect(err.data).toEqual({ loop_id: "abc" });
    expect(err.name).toBe("DaemonError");
    expect(err.message).toContain("-32200");
    expect(err.message).toContain("loop not found");
  });
});

describe("TimeoutError", () => {
  it("has correct properties", () => {
    const err = new TimeoutError("daemon_ready", "10s");
    expect(err.operation).toBe("daemon_ready");
    expect(err.duration).toBe("10s");
    expect(err.name).toBe("TimeoutError");
    expect(err.message).toContain("10s");
    expect(err.message).toContain("daemon_ready");
  });
});

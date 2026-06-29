import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { defaultConfig, loadConfigFromEnv } from "../src/config.js";

describe("defaultConfig", () => {
  it("has expected defaults", () => {
    const cfg = defaultConfig();
    expect(cfg.daemonURL).toBe("ws://localhost:8765");
    expect(cfg.verbosityLevel).toBe("normal");
    expect(cfg.maxRetries).toBe(5);
    expect(cfg.daemonReadyTimeout).toBe(20000);
    expect(cfg.loopStatusTimeout).toBe(60000);
    expect(cfg.subscriptionTimeout).toBe(10000);
    expect(cfg.reconnectDelay).toBe(2000);
    expect(cfg.heartbeatInterval).toBe(30000);
  });
});

describe("loadConfigFromEnv", () => {
  const envVars = [
    "SOOTHE_DAEMON_URL",
    "SOOTHE_VERBOSITY",
    "SOOTHE_MAX_RETRIES",
    "SOOTHE_DAEMON_READY_TIMEOUT_SEC",
    "SOOTHE_LOOP_STATUS_TIMEOUT_SEC",
    "SOOTHE_SUBSCRIPTION_TIMEOUT_SEC",
  ];

  const originalValues: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of envVars) {
      originalValues[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envVars) {
      if (originalValues[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalValues[key];
      }
    }
  });

  it("overrides defaults from env", () => {
    process.env.SOOTHE_DAEMON_URL = "ws://custom:9999";
    process.env.SOOTHE_VERBOSITY = "debug";
    process.env.SOOTHE_MAX_RETRIES = "10";
    process.env.SOOTHE_DAEMON_READY_TIMEOUT_SEC = "30";
    process.env.SOOTHE_LOOP_STATUS_TIMEOUT_SEC = "45";
    process.env.SOOTHE_SUBSCRIPTION_TIMEOUT_SEC = "15";

    const cfg = loadConfigFromEnv();
    expect(cfg.daemonURL).toBe("ws://custom:9999");
    expect(cfg.verbosityLevel).toBe("debug");
    expect(cfg.maxRetries).toBe(10);
    expect(cfg.daemonReadyTimeout).toBe(30000);
    expect(cfg.loopStatusTimeout).toBe(45000);
    expect(cfg.subscriptionTimeout).toBe(15000);
  });

  it("falls back to defaults for invalid values", () => {
    process.env.SOOTHE_MAX_RETRIES = "not-a-number";
    process.env.SOOTHE_DAEMON_READY_TIMEOUT_SEC = "-5";

    const cfg = loadConfigFromEnv();
    expect(cfg.maxRetries).toBe(5);
    expect(cfg.daemonReadyTimeout).toBe(20000);
  });
});

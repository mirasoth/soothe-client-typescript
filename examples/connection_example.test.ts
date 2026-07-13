/**
 * Connection lifecycle examples: connect → bootstrap → send → close,
 * connect-with-retries, config-from-env, and disconnect monitoring.
 *
 * Mirrors the Go client's `connection_example_test.go`.
 */

import { describe, it, expect } from "vitest";
import {
  Client,
  defaultConfig,
  loadConfigFromEnv,
  bootstrapLoopSession,
  connectWithRetries,
} from "../src/index.js";
import { DisconnectCause, disconnectCauseName } from "../src/errors.js";
import { createMockDaemon } from "./helpers/mock-server.js";

// --- Connection lifecycle ---

describe("Example: connection lifecycle", () => {
  it("basicConnection: connect → bootstrap → send → close", async () => {
    const md = createMockDaemon();
    try {
      // Use defaultConfig for sensible timeouts and retry defaults.
      const cfg = defaultConfig();
      cfg.daemonReadyTimeout = 30_000;

      const client = new Client(md.url, cfg);

      // Connect performs the protocol-1 handshake (connection_init / connection_ack).
      await client.connect();

      // Check readiness after the handshake.
      console.log("Handshake complete:", client.isConnected());

      // Bootstrap a fresh loop session (loop_new + loop_subscribe).
      const loopId = await bootstrapLoopSession(client, null, cfg);
      console.log("Loop ID:", loopId);

      // Send a fire-and-forget input notification.
      await client.sendInput("Hello, Soothe!", { loopID: loopId });
      console.log("Input sent");

      client.close();

      expect(loopId).toMatch(/^loop-\d+$/);
      expect(client.isConnected()).toBe(false);
    } finally {
      await md.close();
    }
  });

  it("connectWithRetries: handles daemon cold start", async () => {
    const md = createMockDaemon();
    try {
      const cfg = defaultConfig();
      const client = new Client(md.url, cfg);

      // Retry up to 10 times with 500ms delay (handles daemon cold start).
      await connectWithRetries(client, 10, 500);

      console.log("Connected:", client.isConnected());

      expect(client.isConnected()).toBe(true);
      client.close();
    } finally {
      await md.close();
    }
  });

  it("loadConfigFromEnv: reads environment variables", () => {
    process.env.SOOTHE_DAEMON_URL = "ws://localhost:8765";
    process.env.SOOTHE_VERBOSITY = "normal";
    process.env.SOOTHE_MAX_RETRIES = "5";

    const cfg = loadConfigFromEnv();
    console.log("Daemon URL:", cfg.daemonURL);
    console.log("Verbosity:", cfg.verbosityLevel);
    console.log("Max retries:", cfg.maxRetries);

    expect(cfg.daemonURL).toBe("ws://localhost:8765");
    expect(cfg.verbosityLevel).toBe("normal");
    expect(cfg.maxRetries).toBe(5);

    delete process.env.SOOTHE_DAEMON_URL;
    delete process.env.SOOTHE_VERBOSITY;
    delete process.env.SOOTHE_MAX_RETRIES;
  });

  it("disconnectMonitoring: watches the 'disconnected' event", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);

      let disconnectCause: DisconnectCause | null = null;
      client.on("disconnected", cause => {
        disconnectCause = cause;
      });

      await client.connect();
      console.log("Connected:", client.isConnected());

      // Simulate a clean disconnect (sends disconnect notification + closes).
      client.close();

      // Allow the event loop to process the close/disconnect callbacks.
      await new Promise(resolve => setTimeout(resolve, 100));

      console.log("Disconnected:", client.isDisconnected());
      if (disconnectCause !== null) {
        console.log("Cause:", disconnectCauseName(disconnectCause));
      }

      expect(client.isDisconnected()).toBe(true);
    } finally {
      await md.close();
    }
  });

  it("reconnect: re-dials after a connection drop", async () => {
    // Start a server, connect, then kill the server to simulate a drop.
    const md = createMockDaemon();
    const client = new Client(md.url);

    await client.connect();
    expect(client.isConnected()).toBe(true);

    // Kill the server to simulate an unclean drop.
    await md.close();

    // Wait for the disconnect to propagate.
    await new Promise(resolve => setTimeout(resolve, 200));
    console.log("Dropped:", client.isDisconnected());
    expect(client.isDisconnected()).toBe(true);

    // In production, reconnect() retries the same URL with bounded backoff.
    // Here we just verify the disconnect was detected (no new server to
    // reconnect to on the same port).
    client.close();
  });
});

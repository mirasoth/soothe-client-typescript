import { describe, it, expect } from "vitest";
import { Client } from "../src/client.js";
import {
  bootstrapLoopSession,
  waitDaemonReady,
  waitLoopStatusWithID,
  waitSubscriptionConfirmed,
  connectWithRetries,
} from "../src/session.js";
import { defaultConfig } from "../src/config.js";
import {
  createTestServer,
  fullBootstrapHandler,
  echoHandler,
} from "./helpers/ws-server.js";

describe("bootstrapLoopSession", () => {
  it("runs loop_new + subscribe (handshake in connect)", async () => {
    const server = createTestServer(fullBootstrapHandler);
    try {
      const client = new Client(server.url, defaultConfig());
      await client.connect();

      const loopID = await bootstrapLoopSession(client, null, defaultConfig());
      expect(loopID).toBe("test-loop-123");
      client.close();
    } finally {
      await server.close();
    }
  });

  it("resumes with existing loop id (skips loop_new)", async () => {
    const server = createTestServer(fullBootstrapHandler);
    try {
      const client = new Client(server.url, defaultConfig());
      await client.connect();

      const loopID = await bootstrapLoopSession(
        client,
        "existing-loop",
        defaultConfig(),
      );
      expect(loopID).toBe("existing-loop");
      client.close();
    } finally {
      await server.close();
    }
  });
});

describe("waitDaemonReady", () => {
  it("resolves immediately after handshake", async () => {
    const server = createTestServer(fullBootstrapHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      await expect(waitDaemonReady(client, 3000)).resolves.toBeUndefined();
      client.close();
    } finally {
      await server.close();
    }
  });

  it("times out when no connection_ack arrives", async () => {
    const server = createTestServer((ws) => {
      ws.on("message", () => {
        // Never handshake
      });
    });
    try {
      // Short handshake timeout so connect() rejects quickly.
      const cfg = defaultConfig();
      cfg.daemonReadyTimeout = 300;
      const client = new Client(server.url, cfg);
      await client.connect().catch(() => {});
      // Client is not connected (handshake failed); waitDaemonReady should
      // time out fast since readEventWithTimeout returns null immediately.
      await expect(waitDaemonReady(client, 300)).rejects.toThrow("timeout");
      client.close();
    } finally {
      await server.close();
    }
  });
});

describe("waitLoopStatusWithID", () => {
  it("returns status with loop_id after loop_input", async () => {
    const server = createTestServer(fullBootstrapHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      // Send loop_input notification; the handler emits a status frame.
      await client.sendInput("test", { loopID: "test-loop-123" });
      const status = await waitLoopStatusWithID(client, 3000);
      expect(status.loop_id).toBe("test-loop-123");
      client.close();
    } finally {
      await server.close();
    }
  });

  it("fails on error response", async () => {
    const server = createTestServer((ws) => {
      ws.on("message", (raw) => {
        let m: Record<string, unknown>;
        try {
          m = JSON.parse(raw.toString()) as Record<string, unknown>;
        } catch {
          return;
        }
        if (m.type === "connection_init") {
          ws.send(
            JSON.stringify({
              proto: "1",
              type: "status",
              state: "idle",
              input_history: [],
            }),
          );
          ws.send(
            JSON.stringify({
              proto: "1",
              type: "connection_ack",
              result: {
                protocol_version: "1",
                readiness_state: "ready",
                capabilities: [],
                heartbeat_interval_ms: 0,
              },
            }),
          );
          return;
        }
        // Respond to any subsequent message with an error.
        ws.send(
          JSON.stringify({
            proto: "1",
            type: "error",
            id: m.id,
            error: { code: -32200, message: "loop not found" },
          }),
        );
      });
    });
    try {
      const client = new Client(server.url);
      await client.connect();
      await client.sendInput("test", { loopID: "test-loop" });
      await expect(waitLoopStatusWithID(client, 3000)).rejects.toThrow(
        "daemon error",
      );
      client.close();
    } finally {
      await server.close();
    }
  });
});

describe("waitSubscriptionConfirmed", () => {
  it("succeeds when loop_id matches (next confirmation)", async () => {
    const server = createTestServer(fullBootstrapHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      await client.subscribe(
        "loop_events",
        { loop_id: "loop-abc", verbosity: "normal" },
        3000,
      );
      await expect(
        waitSubscriptionConfirmed(client, "loop-abc", "normal", 3000),
      ).resolves.toBeUndefined();
      client.close();
    } finally {
      await server.close();
    }
  });

  it("times out when loop_id mismatches", async () => {
    const server = createTestServer(fullBootstrapHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      await client.subscribe(
        "loop_events",
        { loop_id: "different", verbosity: "normal" },
        3000,
      );
      await expect(
        waitSubscriptionConfirmed(client, "loop-abc", "normal", 500),
      ).rejects.toThrow("timeout");
      client.close();
    } finally {
      await server.close();
    }
  });
});

describe("connectWithRetries", () => {
  it("succeeds with available server", async () => {
    const server = createTestServer(echoHandler);
    try {
      const client = new Client(server.url);
      await connectWithRetries(client, 3, 50);
      expect(client.isConnected()).toBe(true);
      client.close();
    } finally {
      await server.close();
    }
  });

  it("fails after max retries", async () => {
    const client = new Client("ws://localhost:59999");
    await expect(connectWithRetries(client, 3, 50)).rejects.toThrow(
      "failed to connect",
    );
  });

  it("uses defaults when zero values passed", async () => {
    const server = createTestServer(echoHandler);
    try {
      const client = new Client(server.url);
      await connectWithRetries(client, 0, 0);
      expect(client.isConnected()).toBe(true);
      client.close();
    } finally {
      await server.close();
    }
  });
});

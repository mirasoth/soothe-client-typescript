import { describe, it, expect } from "vitest";
import { Client } from "../src/client.js";
import {
  createTestServer,
  echoHandler,
  fullBootstrapHandler,
  ndjsonHandler,
  requestResponseHandler,
} from "./helpers/ws-server.js";
import type { WebSocket } from "ws";

// ---------------------------------------------------------------------------
// Client unit tests (RFC-450 protocol-1)
// ---------------------------------------------------------------------------

describe("Client", () => {
  it("connect completes handshake and close", async () => {
    const server = createTestServer(echoHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      expect(client.isConnected()).toBe(true);
      client.close();
      expect(client.isConnected()).toBe(false);
    } finally {
      await server.close();
    }
  });

  it("send when not connected throws", async () => {
    const client = new Client("ws://localhost:9999");
    await expect(client.sendMessage({ type: "test" })).rejects.toThrow(
      "not connected",
    );
  });

  it("send and receive echo (notification envelope)", async () => {
    const server = createTestServer(echoHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      await client.notify("loop_input", { loop_id: "l1", content: "hello" });
      const ev = await client.readEvent();
      expect(ev).not.toBeNull();
      expect(ev!.type).toBe("notification");
      expect(ev!.method).toBe("loop_input");
      expect((ev!.params as Record<string, unknown>).content).toBe("hello");
      client.close();
    } finally {
      await server.close();
    }
  });

  it("receiveMessages yields decoded messages", async () => {
    const server = createTestServer(echoHandler);
    try {
      const client = new Client(server.url);
      await client.connect();

      const msgs: unknown[] = [];
      const iter = client.receiveMessages();
      const p = (async () => {
        for await (const msg of iter) {
          msgs.push(msg);
          if (msgs.length >= 1) break;
        }
      })();

      await client.notify("loop_input", { loop_id: "l1", content: "world" });
      await p;

      expect(msgs.length).toBeGreaterThanOrEqual(1);
      client.close();
    } finally {
      await server.close();
    }
  });

  it("NDJSON receive splits multiple messages", async () => {
    const server = createTestServer(ndjsonHandler);
    try {
      const client = new Client(server.url);
      await client.connect();

      const msgs: unknown[] = [];
      const iter = client.receiveMessages();
      const p = (async () => {
        for await (const msg of iter) {
          msgs.push(msg);
          if (msgs.length >= 2) break;
        }
      })();

      // ndjsonHandler triggers the NDJSON payload on the second message.
      await client.notify("loop_input", { loop_id: "l1", content: "trigger" });
      await p;

      expect(msgs.length).toBeGreaterThanOrEqual(2);
      client.close();
    } finally {
      await server.close();
    }
  });

  it("requestResponse matches by id and returns result", async () => {
    const server = createTestServer(requestResponseHandler);
    try {
      const client = new Client(server.url);
      await client.connect();

      const resp = await client.requestResponse(
        "daemon_status",
        {},
        "daemon_status",
        3000,
      );
      expect(resp.running).toBe(true);
      expect(resp.port_live).toBe(true);
      client.close();
    } finally {
      await server.close();
    }
  });

  it("requestResponse timeout", async () => {
    const server = createTestServer((ws: WebSocket) => {
      ws.on("message", () => {
        // Never respond (but still handshake so connect succeeds)
      });
      // Perform the handshake only.
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
        }
      });
    });
    try {
      const client = new Client(server.url);
      await client.connect();
      await expect(
        client.requestResponse("daemon_status", {}, "daemon_status", 500),
      ).rejects.toThrow("timeout");
      client.close();
    } finally {
      await server.close();
    }
  });

  it("requestResponse daemon error", async () => {
    const server = createTestServer(requestResponseHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      await expect(
        client.requestResponse("error_test", {}, "error_test", 3000),
      ).rejects.toThrow("daemon error");
      client.close();
    } finally {
      await server.close();
    }
  });

  // ---------------------------------------------------------------------------
  // High-level API method tests (Loop-first, RFC-503)
  // ---------------------------------------------------------------------------

  it("sendInput emits loop_input notification with params", async () => {
    const server = createTestServer(echoHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      await client.sendInput("hello", { loopID: "l1", model: "openai:gpt-4" });
      const ev = await client.readEvent();
      expect(ev!.type).toBe("notification");
      expect(ev!.method).toBe("loop_input");
      const params = ev!.params as Record<string, unknown>;
      expect(params.content).toBe("hello");
      expect(params.loop_id).toBe("l1");
      expect(params.model).toBe("openai:gpt-4");
      client.close();
    } finally {
      await server.close();
    }
  });

  it("sendInput rejects without loop id", async () => {
    const server = createTestServer(echoHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      await expect(client.sendInput("hello")).rejects.toThrow("loopID");
      client.close();
    } finally {
      await server.close();
    }
  });

  it("sendInput autonomous", async () => {
    const server = createTestServer(echoHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      await client.sendInput("do stuff", {
        loopID: "L1",
        autonomous: true,
        maxIterations: 5,
      });
      const ev = await client.readEvent();
      const params = ev!.params as Record<string, unknown>;
      expect(params.autonomous).toBe(true);
      expect(params.max_iterations).toBe(5);
      client.close();
    } finally {
      await server.close();
    }
  });

  it("sendCommand emits slash_command notification", async () => {
    const server = createTestServer(echoHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      await client.sendCommand("/help");
      const ev = await client.readEvent();
      expect(ev!.type).toBe("notification");
      expect(ev!.method).toBe("slash_command");
      expect((ev!.params as Record<string, unknown>).cmd).toBe("/help");
      client.close();
    } finally {
      await server.close();
    }
  });

  it("sendLoopNew returns loop_id via response", async () => {
    const server = createTestServer(fullBootstrapHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      const resp = await client.requestResponse(
        "loop_new",
        { client_workspace: "/tmp/workspace" },
        "loop_new",
        3000,
      );
      expect(resp.loop_id).toBe("test-loop-123");
      client.close();
    } finally {
      await server.close();
    }
  });

  it("sendLoopSubscribe receives next confirmation", async () => {
    const server = createTestServer(fullBootstrapHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      const subId = await client.subscribe(
        "loop_events",
        { loop_id: "loop-abc", verbosity: "normal" },
        3000,
      );
      const ev = await client.readEvent();
      expect(ev!.type).toBe("next");
      expect(ev!.id).toBe(subId);
      client.close();
    } finally {
      await server.close();
    }
  });

  it("sendDetach emits disconnect notification", async () => {
    const server = createTestServer(echoHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      await client.sendDetach();
      const ev = await client.readEvent();
      expect(ev!.type).toBe("disconnect");
      client.close();
    } finally {
      await server.close();
    }
  });

  // ---------------------------------------------------------------------------
  // Convenience RPC method tests
  // ---------------------------------------------------------------------------

  it("listSkills", async () => {
    const server = createTestServer(requestResponseHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      const resp = await client.listSkills(3000);
      expect(resp.skills).toHaveLength(2);
      client.close();
    } finally {
      await server.close();
    }
  });

  it("listModels", async () => {
    const server = createTestServer(requestResponseHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      const resp = await client.listModels(3000);
      expect(resp.models).toHaveLength(2);
      client.close();
    } finally {
      await server.close();
    }
  });

  it("invokeSkill", async () => {
    const server = createTestServer(requestResponseHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      const resp = await client.invokeSkill("research", "search for X", 3000);
      expect(resp.echo).toMatchObject({ status: "ok" });
      client.close();
    } finally {
      await server.close();
    }
  });

  it("listLoops", async () => {
    const server = createTestServer(requestResponseHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      const resp = await client.listLoops(3000);
      expect(resp.loops).toHaveLength(2);
      client.close();
    } finally {
      await server.close();
    }
  });

  it("getLoop", async () => {
    const server = createTestServer(requestResponseHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      const resp = await client.getLoop("l1", 3000);
      expect(resp.loop).toMatchObject({ loop_id: "l1" });
      client.close();
    } finally {
      await server.close();
    }
  });

  it("deleteLoop", async () => {
    const server = createTestServer(requestResponseHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      const resp = await client.deleteLoop("l1", 3000);
      expect(resp.success).toBe(true);
      client.close();
    } finally {
      await server.close();
    }
  });

  // ---------------------------------------------------------------------------
  // WaitForDaemonReady
  // ---------------------------------------------------------------------------

  it("waitForDaemonReady resolves after handshake", async () => {
    const server = createTestServer(echoHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      // Handshake already completed in connect(); waitForDaemonReady resolves immediately.
      const ev = await client.waitForDaemonReady(3000);
      expect(ev.readiness_state).toBe("ready");
      client.close();
    } finally {
      await server.close();
    }
  });

  // ---------------------------------------------------------------------------
  // Connection recovery
  // ---------------------------------------------------------------------------

  it("connection recovery", async () => {
    const server = createTestServer(echoHandler);
    try {
      const client1 = new Client(server.url);
      await client1.connect();
      client1.close();
      expect(client1.isConnected()).toBe(false);

      const client2 = new Client(server.url);
      await client2.connect();
      expect(client2.isConnected()).toBe(true);
      client2.close();
    } finally {
      await server.close();
    }
  });
});

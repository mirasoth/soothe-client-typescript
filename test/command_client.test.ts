import { describe, it, expect } from "vitest";
import { CommandClient } from "../src/command_client.js";
import { createTestServer } from "./helpers/ws-server.js";
import type { WebSocket } from "ws";

describe("CommandClient", () => {
  it("jobCreate uses a single ephemeral request", async () => {
    const methods: string[] = [];
    const { url, close } = createTestServer((ws: WebSocket) => {
      ws.on("message", raw => {
        let m: Record<string, unknown>;
        try {
          m = JSON.parse(raw.toString()) as Record<string, unknown>;
        } catch {
          return;
        }
        if (m.type === "connection_init") {
          ws.send(JSON.stringify({ proto: "1", type: "status", state: "idle" }));
          ws.send(
            JSON.stringify({
              proto: "1",
              type: "connection_ack",
              result: {
                protocol_version: "1",
                readiness_state: "ready",
                capabilities: ["streaming", "batch", "heartbeat"],
                heartbeat_interval_ms: 0,
              },
            }),
          );
          return;
        }
        if (m.type === "request") {
          const method = String(m.method ?? "");
          methods.push(method);
          ws.send(
            JSON.stringify({
              proto: "1",
              type: "response",
              id: m.id,
              result: { job_id: "job-1", ok: true },
            }),
          );
        }
      });
    });

    try {
      const cc = new CommandClient(url, { timeoutMs: 5_000 });
      const result = await cc.jobCreate("summarize readme");
      expect(result.job_id).toBe("job-1");
      expect(methods.filter(m => m === "job_create")).toHaveLength(1);
    } finally {
      await close();
    }
  });
});

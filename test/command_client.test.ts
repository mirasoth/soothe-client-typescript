import { describe, it, expect } from "vitest";
import { CommandClient } from "../src/command_client.js";
import { createTestServer } from "./helpers/ws-server.js";
import type { WebSocket } from "ws";

function echoRequestServer(methods: string[]) {
  return createTestServer((ws: WebSocket) => {
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
        const params = (m.params as Record<string, unknown> | undefined) ?? {};
        let result: Record<string, unknown> = { ok: true };
        if (method === "job_create") {
          result = { job_id: "job-1", ok: true };
        } else if (method === "autopilot_status") {
          result = { state: "active", running: true, dreaming: false };
        } else if (method === "autopilot_submit") {
          result = { status: "submitted", goal_id: "goal-1", ...params };
        } else if (method === "autopilot_list_goals") {
          result = { goals: [] };
        } else if (method === "autopilot_cancel_all") {
          result = { status: "cancelled", cancelled_count: 0 };
        }
        ws.send(
          JSON.stringify({
            proto: "1",
            type: "response",
            id: m.id,
            result,
          }),
        );
      }
    });
  });
}

describe("CommandClient", () => {
  it("jobCreate uses a single ephemeral request", async () => {
    const methods: string[] = [];
    const { url, close } = echoRequestServer(methods);

    try {
      const cc = new CommandClient(url, { timeoutMs: 5_000 });
      const result = await cc.jobCreate("summarize readme");
      expect(result.job_id).toBe("job-1");
      expect(methods.filter(m => m === "job_create")).toHaveLength(1);
    } finally {
      await close();
    }
  });

  it("autopilotStatus / autopilotSubmit use protocol-1 request methods", async () => {
    const methods: string[] = [];
    const { url, close } = echoRequestServer(methods);

    try {
      const cc = new CommandClient(url, { timeoutMs: 5_000 });
      const status = await cc.autopilotStatus();
      expect(status.running).toBe(true);

      const submitted = await cc.autopilotSubmit("deploy the app", {
        priority: 80,
        workspace: "/tmp",
      });
      expect(submitted.goal_id).toBe("goal-1");
      expect(submitted.description).toBe("deploy the app");
      expect(submitted.priority).toBe(80);

      expect(methods).toContain("autopilot_status");
      expect(methods).toContain("autopilot_submit");
    } finally {
      await close();
    }
  });

  it("autopilotListGoals and autopilotCancelAll round-trip", async () => {
    const methods: string[] = [];
    const { url, close } = echoRequestServer(methods);

    try {
      const cc = new CommandClient(url, { timeoutMs: 5_000 });
      const goals = await cc.autopilotListGoals();
      expect(Array.isArray(goals.goals)).toBe(true);
      const cancelled = await cc.autopilotCancelAll();
      expect(cancelled.status).toBe("cancelled");
      expect(methods).toEqual(
        expect.arrayContaining(["autopilot_list_goals", "autopilot_cancel_all"]),
      );
    } finally {
      await close();
    }
  });
});

/**
 * Mock daemon for examples — an in-process WebSocket server that speaks the
 * protocol-1 wire contract so examples run without a live Soothe
 * daemon.
 *
 * Mirrors the Go client's `mockdaemon_test.go` and the test helper in
 * `test/helpers/ws-server.ts`, but expanded with handlers for every RPC method
 * the examples exercise (loop_new, loop_get, loop_list, job_*, cron_*, skills_list,
 * models_list, auth, config_get, daemon_status, daemon_shutdown, etc.).
 */

import { WebSocketServer, WebSocket } from "ws";
import type { AddressInfo } from "node:net";

/**
 * Creates a mock daemon on a random port. Returns the URL and a close function.
 * The handler performs the connection_init/connection_ack handshake, then
 * answers request/subscribe/notification envelopes with deterministic responses.
 */
export function createMockDaemon(): { url: string; close: () => Promise<void> } {
  const wss = new WebSocketServer({ port: 0 });
  const connections = new Set<WebSocket>();
  wss.on("connection", (ws: WebSocket) => {
    connections.add(ws);
    ws.on("close", () => connections.delete(ws));
    handler(ws);
  });
  const port = (wss.address() as AddressInfo).port;
  return {
    url: `ws://localhost:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        // Terminate all active connections first so connected clients see a drop.
        for (const ws of connections) {
          try {
            ws.terminate();
          } catch {
            // ignore
          }
        }
        connections.clear();
        wss.close(err => (err ? reject(err) : resolve()));
      }),
  };
}

function isConnectionInit(m: Record<string, unknown>): boolean {
  return m.type === "connection_init";
}

function sendHandshake(ws: WebSocket, m: Record<string, unknown>): void {
  // Leading status frame (the daemon sends this on connect).
  ws.send(
    JSON.stringify({
      proto: "1",
      type: "status",
      state: "idle",
      input_history: [],
    }),
  );
  const params = (m.params as Record<string, unknown> | undefined) ?? {};
  const clientCaps = (params.capabilities as string[] | undefined) ?? [];
  const daemonCaps = ["streaming", "batch", "heartbeat", "receipts"];
  const negotiated = daemonCaps.filter(c => clientCaps.includes(c));
  ws.send(
    JSON.stringify({
      proto: "1",
      type: "connection_ack",
      result: {
        server_version: "0.1.0",
        protocol_version: "1",
        capabilities: negotiated,
        readiness_state: "ready",
        heartbeat_interval_ms: 0,
      },
    }),
  );
}

function sendResponse(ws: WebSocket, id: unknown, result: Record<string, unknown>): void {
  ws.send(JSON.stringify({ proto: "1", type: "response", result, id }));
}

let loopCounter = 0;

function nextLoopId(): string {
  loopCounter += 1;
  return `loop-${loopCounter}`;
}

let jobCounter = 1;

function nextJobId(): string {
  jobCounter += 1;
  return `job-${jobCounter}`;
}

function handler(ws: WebSocket): void {
  ws.on("message", raw => {
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(raw.toString()) as Record<string, unknown>;
    } catch {
      return;
    }

    if (isConnectionInit(m)) {
      sendHandshake(ws, m);
      return;
    }

    const typ = m.type as string;
    const id = m.id;
    const params = (m.params as Record<string, unknown> | undefined) ?? {};
    const method = m.method as string | undefined;

    // --- Subscriptions ---
    if (typ === "subscribe" && method === "loop_events") {
      const loopId = String(params.loop_id ?? "");
      ws.send(
        JSON.stringify({
          proto: "1",
          type: "next",
          id,
          payload: { loop_id: loopId, event: "subscribed", success: true, client_id: "c1" },
        }),
      );
      return;
    }
    if (typ === "subscribe" && method === "autopilot_events") {
      ws.send(
        JSON.stringify({
          proto: "1",
          type: "next",
          id,
          payload: { event: "subscribed", success: true },
        }),
      );
      return;
    }
    if (typ === "unsubscribe") {
      sendResponse(ws, id, { success: true, loop_id: params.loop_id });
      return;
    }

    // --- Notifications (fire-and-forget) ---
    if (typ === "notification" && method === "loop_input") {
      ws.send(
        JSON.stringify({
          proto: "1",
          type: "status",
          state: "running",
          loop_id: params.loop_id,
          workspace: "/tmp",
        }),
      );
      return;
    }
    if (typ === "notification" && method === "slash_command") {
      ws.send(
        JSON.stringify({
          proto: "1",
          type: "status",
          state: "running",
          loop_id: params.loop_id ?? "loop-1",
        }),
      );
      return;
    }
    if (typ === "notification" && method === "disconnect") {
      return; // clean disconnect
    }

    // --- Request/Response RPC ---
    if (typ !== "request") {
      ws.send(raw.toString()); // echo unknown
      return;
    }

    switch (method) {
      // Loop lifecycle
      case "loop_new":
        sendResponse(ws, id, { loop_id: nextLoopId(), success: true });
        return;
      case "loop_get": {
        sendResponse(ws, id, {
          loop_id: params.loop_id,
          active: true,
          state: "idle",
        });
        return;
      }
      case "loop_list":
        sendResponse(ws, id, {
          loops: [
            { loop_id: "loop-1", state: "idle" },
            { loop_id: "loop-2", state: "running" },
          ],
          total: 2,
        });
        return;
      case "loop_tree":
        sendResponse(ws, id, {
          loop_id: params.loop_id,
          tree: { root: "loop-1", children: ["loop-2", "loop-3"] },
        });
        return;
      case "loop_delete":
        sendResponse(ws, id, { success: true, loop_id: params.loop_id });
        return;
      case "loop_messages":
        sendResponse(ws, id, {
          messages: [
            { role: "user", content: "Hello" },
            { role: "assistant", content: "Hi there" },
          ],
          total: 2,
        });
        return;
      case "loop_state_get":
        sendResponse(ws, id, {
          loop_id: params.loop_id,
          state: { context_window: 128000, token_usage: 1500 },
        });
        return;
      case "loop_state_update":
        sendResponse(ws, id, { success: true, loop_id: params.loop_id });
        return;
      case "loop_history_fetch":
        sendResponse(ws, id, {
          loop_id: params.loop_id,
          history: [{ turn: 1, input: "Hello", output: "Hi there" }],
        });
        return;
      case "loop_reattach":
        sendResponse(ws, id, { success: true, loop_id: params.loop_id });
        return;

      // Daemon control
      case "daemon_status":
        sendResponse(ws, id, { running: true, port_live: true, active_loops: 2 });
        return;
      case "daemon_shutdown":
        sendResponse(ws, id, { status: "acknowledged" });
        return;
      case "config_get":
        sendResponse(ws, id, {
          [params.section as string]: { model: "gpt-4o", max_tokens: 4096 },
        });
        return;
      case "config_reload":
        sendResponse(ws, id, { success: true, reloaded: true });
        return;
      case "mcp_status":
        sendResponse(ws, id, { servers: [{ name: "filesystem", status: "connected" }] });
        return;

      // Skills & Models
      case "skills_list":
        sendResponse(ws, id, {
          skills: [
            { name: "research", description: "Research skill" },
            { name: "browser", description: "Browser skill" },
            { name: "code_reviewer", description: "Code review skill" },
          ],
        });
        return;
      case "models_list":
        sendResponse(ws, id, {
          models: [
            { id: "openai:gpt-4o", name: "GPT-4o" },
            { id: "anthropic:claude-3.5-sonnet", name: "Claude 3.5 Sonnet" },
          ],
        });
        return;
      case "invoke_skill":
        sendResponse(ws, id, { skill: params.skill, result: "skill executed", success: true });
        return;

      // Auth
      case "auth":
        sendResponse(ws, id, {
          success: true,
          access_token: "mock-access-token",
          refresh_token: "mock-refresh-token",
          expires_in: 3600,
        });
        return;
      case "auth_refresh":
        sendResponse(ws, id, {
          success: true,
          access_token: "mock-access-token-2",
          refresh_token: "mock-refresh-token-2",
          expires_in: 3600,
        });
        return;

 // Job IPC
      case "job_create":
        sendResponse(ws, id, { job_id: nextJobId(), goal: params.goal, status: "created" });
        return;
      case "job_status":
        sendResponse(ws, id, {
          job_id: params.job_id,
          goal_status: "in_progress",
          completed: 0,
          total: 5,
          workers: 3,
        });
        return;
      case "job_pause":
        sendResponse(ws, id, { job_id: params.job_id, status: "paused" });
        return;
      case "job_resume":
        sendResponse(ws, id, { job_id: params.job_id, status: "resumed" });
        return;
      case "job_cancel":
        sendResponse(ws, id, { job_id: params.job_id, status: "cancelled" });
        return;
      case "job_dag":
        sendResponse(ws, id, {
          job_id: params.job_id,
          dag: "root_goal\n  ├── subtask_1\n  ├── subtask_2\n  └── subtask_3",
        });
        return;
      case "job_guidance":
        sendResponse(ws, id, { job_id: params.job_id, status: "guidance_received" });
        return;

      // Autopilot goal RPCs
      case "autopilot_status":
        sendResponse(ws, id, {
          state: "active",
          running: true,
          dreaming: false,
          loop_pool: { active: 1, idle: 2 },
        });
        return;
      case "autopilot_submit":
        sendResponse(ws, id, { status: "submitted", goal_id: nextJobId() });
        return;
      case "autopilot_list_goals":
        sendResponse(ws, id, { goals: [], source: "autopilot_service" });
        return;
      case "autopilot_get_goal":
        sendResponse(ws, id, {
          goal: { id: params.goal_id, status: "active" },
          source: "autopilot_service",
        });
        return;
      case "autopilot_cancel_goal":
        sendResponse(ws, id, {
          status: "cancelled",
          goal_id: params.goal_id,
          new_status: "cancelled",
        });
        return;
      case "autopilot_cancel_all":
        sendResponse(ws, id, { status: "cancelled", cancelled_count: 0, goal_ids: [] });
        return;
      case "autopilot_wake":
        sendResponse(ws, id, { status: "wake_sent" });
        return;
      case "autopilot_dream":
        sendResponse(ws, id, { status: "dream_sent" });
        return;
      case "autopilot_resume":
        sendResponse(ws, id, {
          status: "reactivated",
          goal_id: params.goal_id,
          new_status: "pending",
        });
        return;
      case "autopilot_list_jobs":
        sendResponse(ws, id, { jobs: [], source: "autopilot_service" });
        return;
      case "autopilot_get_job":
        sendResponse(ws, id, {
          job: { id: params.job_id, status: "active" },
          dag: { nodes: [] },
          active_goals: 0,
          completed_goals: 0,
          total_goals: 0,
          source: "autopilot_service",
        });
        return;

 // Cron IPC
      case "cron_add":
        sendResponse(ws, id, { job_id: "cron-1", text: params.text, status: "scheduled" });
        return;
      case "cron_list":
        sendResponse(ws, id, {
          jobs: [
            { job_id: "cron-1", text: "Daily report", status: "scheduled" },
            { job_id: "cron-2", text: "Weekly cleanup", status: "scheduled" },
          ],
          total: 2,
        });
        return;
      case "cron_show":
        sendResponse(ws, id, {
          job_id: params.job_id,
          text: "Daily report",
          status: "scheduled",
          schedule: "0 9 * * *",
        });
        return;
      case "cron_cancel":
        sendResponse(ws, id, { job_id: params.job_id, status: "cancelled" });
        return;

 // Slash / RPC commands
      case "slash_command":
        sendResponse(ws, id, { status: "ok", command: params.cmd });
        return;
      case "rpc_command": {
        const cmd = params.command as string | undefined;
        if (cmd === "memory") {
          sendResponse(ws, id, {
            context_window: 128000,
            limit: 128000,
            token_usage: 1500,
            used: 1500,
          });
        } else if (cmd === "clear") {
          sendResponse(ws, id, { status: "cleared" });
        } else if (cmd === "cancel") {
          sendResponse(ws, id, { status: "cancelled" });
        } else {
          sendResponse(ws, id, { status: "ok" });
        }
        return;
      }

      default:
        // Unknown method — echo back so the client sees a response.
        sendResponse(ws, id, { echo: true, method, params });
        return;
    }
  });
}

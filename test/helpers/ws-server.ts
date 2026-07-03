/**
 * Test WebSocket server utilities for unit tests (RFC-450 protocol-1).
 *
 * Every handler performs the connection_init/connection_ack handshake so the
 * client's connect() completes, then responds to request/subscribe envelopes
 * with response/next envelopes correlated by `id`.
 */

import { WebSocketServer, WebSocket } from "ws";
import type { AddressInfo } from "node:net";

/** Creates a WebSocket server on a random port. Returns the URL and a close function. */
export function createTestServer(handler: (ws: WebSocket) => void): {
  url: string;
  close: () => Promise<void>;
} {
  const wss = new WebSocketServer({ port: 0 });
  wss.on("connection", handler);
  const port = (wss.address() as AddressInfo).port;
  return {
    url: `ws://localhost:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        wss.close(err => (err ? reject(err) : resolve()));
      }),
  };
}

/** Returns true if the parsed message is a protocol-1 connection_init envelope. */
function isConnectionInit(m: Record<string, unknown>): boolean {
  return m.type === "connection_init";
}

/** Sends a connection_ack with readiness_state "ready" (and a leading status frame). */
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

/** Echo handler: handshakes, then sends back any message it receives. */
export function echoHandler(ws: WebSocket): void {
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
    ws.send(raw.toString());
  });
}

/** Responds to a request envelope with a `response` carrying `result`. */
function sendResponse(ws: WebSocket, id: unknown, result: Record<string, unknown>): void {
  ws.send(JSON.stringify({ proto: "1", type: "response", result, id }));
}

/** Responds to a request envelope with an `error`. */
function sendError(
  ws: WebSocket,
  id: unknown,
  code: number,
  message: string,
  data?: unknown,
): void {
  const error: Record<string, unknown> = { code, message };
  if (data !== undefined) error.data = data;
  ws.send(JSON.stringify({ proto: "1", type: "error", error, id }));
}

/**
 * Full bootstrap handler: handshakes, then handles loop_new / loop_events
 * subscribe / loop_detach with protocol-1 response/next envelopes.
 */
export function fullBootstrapHandler(ws: WebSocket): void {
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

    if (typ === "request" && method === "loop_new") {
      sendResponse(ws, id, { loop_id: "test-loop-123", success: true });
      return;
    }
    if (typ === "subscribe" && method === "loop_events") {
      const loopId = String(params.loop_id ?? "");
      // Subscription confirmation is a `next` frame carrying the subscription id.
      ws.send(
        JSON.stringify({
          proto: "1",
          type: "next",
          id,
          payload: {
            loop_id: loopId,
            event: "subscribed",
            success: true,
            client_id: "c1",
          },
        }),
      );
      return;
    }
    if (typ === "unsubscribe") {
      sendResponse(ws, id, { success: true, loop_id: params.loop_id });
      return;
    }
    if (typ === "notification" && method === "loop_input") {
      // Simulate input acceptance: emit a status frame with the loop id.
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
    // Unknown: echo back.
    ws.send(raw.toString());
  });
}

/** NDJSON handler: handshakes, then sends multiple JSON objects in one frame. */
export function ndjsonHandler(ws: WebSocket): void {
  ws.once("message", raw => {
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(raw.toString()) as Record<string, unknown>;
    } catch {
      return;
    }
    if (isConnectionInit(m)) {
      sendHandshake(ws, m);
      // Trigger the NDJSON payload on the next message.
      ws.once("message", () => {
        ws.send(
          `{"proto":"1","type":"next","payload":{"namespace":["soothe","output"],"mode":"event","data":{"type":"soothe.output.autonomous.final_report.reported","text":"hello"}}}\n` +
            `{"proto":"1","type":"status","state":"idle","loop_id":"ndjson-loop-123"}`,
        );
      });
    }
  });
}

/**
 * Request-response handler: handshakes, then answers request envelopes for
 * daemon_status / skills_list / models_list / config_get / daemon_shutdown /
 * loop_list / loop_get / loop_delete / invoke_skill.
 */
export function requestResponseHandler(ws: WebSocket): void {
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

    if (typ !== "request") {
      // Echo non-request frames (e.g. ping → handled by client; notifications).
      return;
    }

    switch (method) {
      case "daemon_status":
        sendResponse(ws, id, {
          running: true,
          port_live: true,
          active_loops: 2,
        });
        break;
      case "skills_list":
        sendResponse(ws, id, {
          skills: [{ name: "research" }, { name: "browser" }],
        });
        break;
      case "models_list":
        sendResponse(ws, id, { models: [{ id: "gpt-4" }, { id: "claude" }] });
        break;
      case "config_get": {
        const section = String(params.section ?? "all");
        sendResponse(ws, id, { [section]: { key: "value" } });
        break;
      }
      case "daemon_shutdown":
        sendResponse(ws, id, { status: "acknowledged" });
        break;
      case "loop_list":
        sendResponse(ws, id, {
          loops: [{ loop_id: "l1" }, { loop_id: "l2" }],
          total: 2,
        });
        break;
      case "loop_get":
        sendResponse(ws, id, {
          loop: { loop_id: params.loop_id, status: "idle" },
        });
        break;
      case "loop_delete":
        sendResponse(ws, id, { success: true, message: "deleted" });
        break;
      case "invoke_skill":
        sendResponse(ws, id, { echo: { skill: "test", status: "ok" } });
        break;
      case "error_test":
        sendError(ws, id, -32603, "test error message");
        break;
      default:
        // Echo unknown requests back as a response with the method as result.
        sendResponse(ws, id, { echoed: method });
        break;
    }
  });
}

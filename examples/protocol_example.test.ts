/**
 * Protocol-1 wire envelope examples: envelope constructors, encode/decode,
 * NDJSON splitting, and loop-id extraction.
 *
 * Mirrors the Go client's `protocol_example_test.go`.
 */

import { describe, it, expect } from "vitest";
import {
  PROTO_VERSION,
  DEFAULT_CLIENT_CAPABILITIES,
  CLIENT_VERSION,
  encodeMessage,
  decodeMessage,
  splitWirePayload,
  extractSootheLoopID,
  newRequestID,
  requestEnvelope,
  notificationEnvelope,
  subscribeEnvelope,
  unsubscribeEnvelope,
  connectionInitEnvelope,
  pingEnvelope,
  pongEnvelope,
  disconnectEnvelope,
  newLoopInputMessage,
  newLoopNewMessage,
  newLoopSubscribeMessage,
} from "../src/index.js";

describe("Example: protocol-1 envelope constructors", () => {
  it("envelopeConstructors: builds request, notification, subscribe, etc.", () => {
    // Request envelope with auto-generated id.
    const req = requestEnvelope("daemon_status");
    console.log(
      "Request: proto=%s type=%s method=%s id_len=%d",
      req.proto,
      req.type,
      req.method,
      req.id.length,
    );

    // Notification envelope (fire-and-forget, no id).
    const notif = notificationEnvelope("loop_input", {
      loop_id: "abc-123",
      content: "hello",
    });
    console.log("Notification: type=%s method=%s", notif.type, notif.method);

    // Subscribe envelope.
    const sub = subscribeEnvelope("loop_events", { loop_id: "abc-123" });
    console.log("Subscribe: type=%s method=%s", sub.type, sub.method);

    // Unsubscribe envelope by subscription id.
    const unsub = unsubscribeEnvelope("sub-id-123");
    console.log("Unsubscribe: type=%s id=%s", unsub.type, unsub.id);

    // Connection init handshake envelope.
    const init = connectionInitEnvelope();
    console.log("ConnectionInit: type=%s proto=%s", init.type, init.proto);

    // Heartbeat envelopes.
    const ping = pingEnvelope();
    const pong = pongEnvelope();
    console.log("Ping: type=%s Pong: type=%s", ping.type, pong.type);

    // Disconnect notification envelope.
    const disc = disconnectEnvelope();
    console.log("Disconnect: type=%s", disc.type);

    // NewRequestID generates a UUID for correlation.
    const id = newRequestID();
    console.log("RequestID length: %d", id.length);

    expect(req.proto).toBe(PROTO_VERSION);
    expect(req.type).toBe("request");
    expect(req.method).toBe("daemon_status");
    expect(req.id.length).toBe(36); // UUID

    expect(notif.type).toBe("notification");
    expect(notif.method).toBe("loop_input");

    expect(sub.type).toBe("subscribe");
    expect(sub.method).toBe("loop_events");

    expect(unsub.type).toBe("unsubscribe");
    expect(unsub.id).toBe("sub-id-123");

    expect(init.type).toBe("connection_init");
    expect(init.proto).toBe("1");

    expect(ping.type).toBe("ping");
    expect(pong.type).toBe("pong");
    expect(disc.type).toBe("disconnect");
    expect(id.length).toBe(36);
  });

  it("loopMessageFactories: builds loop_input, loop_new, loop_subscribe envelopes", () => {
    // loop_input notification.
    const input = newLoopInputMessage("loop-1", "Hello, Soothe!");
    console.log("LoopInput: type=%s method=%s", input.type, input.method);
    expect(input.type).toBe("notification");
    expect(input.method).toBe("loop_input");
    expect(input.params).toMatchObject({ loop_id: "loop-1", content: "Hello, Soothe!" });

    // loop_new request.
    const newLoop = newLoopNewMessage({ client_workspace: "/tmp/workspace" });
    console.log("LoopNew: type=%s method=%s", newLoop.type, newLoop.method);
    expect(newLoop.type).toBe("request");
    expect(newLoop.method).toBe("loop_new");
    expect(newLoop.params).toMatchObject({ client_workspace: "/tmp/workspace" });

    // loop_events subscribe.
    const sub = newLoopSubscribeMessage("loop-1", "normal");
    console.log("LoopSubscribe: type=%s method=%s", sub.type, sub.method);
    expect(sub.type).toBe("subscribe");
    expect(sub.method).toBe("loop_events");
    expect(sub.params).toMatchObject({ loop_id: "loop-1", verbosity: "normal" });
  });
});

describe("Example: encode / decode round-trip", () => {
  it("encodeMessage: serializes as JSON + newline (NDJSON frame)", () => {
    const env = requestEnvelope("daemon_status");
    const wire = encodeMessage(env);
    console.log("Wire ends with newline: %s", wire.endsWith("\n"));

    expect(wire.endsWith("\n")).toBe(true);
    expect(JSON.parse(wire)).toMatchObject({
      proto: "1",
      type: "request",
      method: "daemon_status",
    });
  });

  it("decodeMessage: decodes a protocol-1 request envelope", () => {
    const raw = JSON.stringify({
      proto: "1",
      type: "request",
      method: "daemon_status",
      id: "req-1",
    });
    const msg = decodeMessage(raw) as Record<string, unknown>;
    console.log("Decoded: type=%s method=%s id=%s", msg.type, msg.method, msg.id);

    expect(msg.type).toBe("request");
    expect(msg.method).toBe("daemon_status");
    expect(msg.id).toBe("req-1");
  });

  it("decodeMessage: decodes a notification envelope", () => {
    const raw = JSON.stringify({
      proto: "1",
      type: "notification",
      method: "loop_input",
      params: { content: "hi" },
    });
    const msg = decodeMessage(raw) as Record<string, unknown>;
    console.log("Notif: type=%s method=%s", msg.type, msg.method);

    expect(msg.type).toBe("notification");
    expect(msg.method).toBe("loop_input");
  });

  it("decodeMessage: decodes a status frame", () => {
    const raw = JSON.stringify({
      proto: "1",
      type: "status",
      state: "idle",
      loop_id: "loop-1",
    });
    const msg = decodeMessage(raw) as Record<string, unknown>;
    console.log("Status: state=%s loop_id=%s", msg.state, msg.loop_id);

    expect(msg.type).toBe("status");
    expect(msg.state).toBe("idle");
    expect(msg.loop_id).toBe("loop-1");
  });
});

describe("Example: NDJSON splitting", () => {
  it("splitWirePayload: splits newline-delimited JSON", () => {
    const ndjson = '{"type":"ping"}\n{"type":"pong"}';
    const parts = splitWirePayload(ndjson);
    console.log("Parts: %d", parts.length);
    for (let i = 0; i < parts.length; i++) {
      console.log("  [%d] %s", i, parts[i]);
    }

    expect(parts).toHaveLength(2);
    expect(JSON.parse(parts[0])).toMatchObject({ type: "ping" });
    expect(JSON.parse(parts[1])).toMatchObject({ type: "pong" });
  });

  it("splitWirePayload: single message returns one element", () => {
    const single = '{"type":"ping"}';
    const parts = splitWirePayload(single);
    console.log("Parts: %d", parts.length);
    expect(parts).toHaveLength(1);
  });
});

describe("Example: loop-id extraction", () => {
  it("extractSootheLoopID: from a status frame", () => {
    const msg = { type: "status", state: "running", loop_id: "loop-42" };
    const [id, ok] = extractSootheLoopID(msg);
    console.log("Loop ID: %s ok=%s", id, ok);

    expect(id).toBe("loop-42");
    expect(ok).toBe(true);
  });

  it("extractSootheLoopID: from a next envelope payload", () => {
    const msg = {
      type: "next",
      payload: { data: { loop_id: "loop-99", text: "hello" } },
    };
    const [id, ok] = extractSootheLoopID(msg);
    console.log("Loop ID: %s ok=%s", id, ok);

    expect(id).toBe("loop-99");
    expect(ok).toBe(true);
  });

  it("extractSootheLoopID: no loop_id returns empty", () => {
    const msg = { type: "ping" };
    const [id, ok] = extractSootheLoopID(msg);
    console.log("Loop ID: %s ok=%s", id, ok);

    expect(id).toBe("");
    expect(ok).toBe(false);
  });
});

describe("Example: protocol constants", () => {
  it("protocolConstants: PROTO_VERSION, capabilities, client version", () => {
    console.log("ProtoVersion: %s", PROTO_VERSION);
    console.log("ClientCapabilities: %s", DEFAULT_CLIENT_CAPABILITIES.join(", "));
    console.log("ClientVersion: %s", CLIENT_VERSION);

    expect(PROTO_VERSION).toBe("1");
    expect(DEFAULT_CLIENT_CAPABILITIES).toContain("streaming");
    expect(DEFAULT_CLIENT_CAPABILITIES).toContain("heartbeat");
    expect(CLIENT_VERSION).toBe("0.5.0");
  });
});

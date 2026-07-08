import { describe, it, expect } from "vitest";
import { INTENT_HINT_TEXT_COMPLETION } from "../src/intent_hints.js";
import {
  PROTO_VERSION,
  encodeMessage,
  decodeMessage,
  splitWirePayload,
  extractSootheLoopID,
  requestEnvelope,
  notificationEnvelope,
  subscribeEnvelope,
  unsubscribeEnvelope,
  connectionInitEnvelope,
  newLoopInputMessage,
  newLoopNewMessage,
  newLoopSubscribeMessage,
  newRequestID,
  type RequestEnvelope,
  type ResponseEnvelope,
  type NextEnvelope,
  type ErrorEnvelope,
  type ConnectionInitEnvelope,
  type ConnectionAckEnvelope,
  type StatusFrame,
  type NotificationEnvelope,
  type LoopInputParams,
} from "../src/protocol.js";

// ---------------------------------------------------------------------------
// Encode / Decode round-trip tests
// ---------------------------------------------------------------------------

describe("encodeMessage", () => {
  it("appends newline", () => {
    const encoded = encodeMessage(requestEnvelope("loop_get", { loop_id: "abc" }));
    expect(encoded.endsWith("\n")).toBe(true);
  });
});

describe("decodeMessage", () => {
  it("returns null for empty input", () => {
    expect(decodeMessage("")).toBeNull();
  });

  it("throws on invalid JSON", () => {
    expect(() => decodeMessage("not json")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Envelope round-trip tests (RFC-450 §5)
// ---------------------------------------------------------------------------

describe("round-trip", () => {
  it("requestEnvelope carries proto/type/method/params/id", () => {
    const env = requestEnvelope("loop_get", { loop_id: "abc", verbose: true });
    const decoded = decodeMessage(encodeMessage(env).slice(0, -1)) as RequestEnvelope;
    expect(decoded.proto).toBe(PROTO_VERSION);
    expect(decoded.type).toBe("request");
    expect(decoded.method).toBe("loop_get");
    expect(decoded.id).toBe(env.id);
    expect(decoded.params).toMatchObject({ loop_id: "abc", verbose: true });
  });

  it("notificationEnvelope has no id (fire-and-forget)", () => {
    const env = notificationEnvelope("loop_input", {
      loop_id: "L1",
      content: "hi",
    });
    const decoded = decodeMessage(encodeMessage(env).slice(0, -1)) as NotificationEnvelope;
    expect(decoded.type).toBe("notification");
    expect(decoded.method).toBe("loop_input");
    expect(decoded.id).toBeUndefined();
    expect(decoded.params).toMatchObject({ loop_id: "L1", content: "hi" });
  });

  it("subscribeEnvelope correlates by id", () => {
    const env = subscribeEnvelope("loop_events", { loop_id: "L1" });
    const decoded = decodeMessage(encodeMessage(env).slice(0, -1));
    expect(decoded).toMatchObject({
      type: "subscribe",
      method: "loop_events",
      id: env.id,
    });
  });

  it("unsubscribeEnvelope carries only id", () => {
    const env = unsubscribeEnvelope("sub-1");
    const decoded = decodeMessage(encodeMessage(env).slice(0, -1));
    expect(decoded).toMatchObject({ type: "unsubscribe", id: "sub-1" });
  });

  it("connectionInitEnvelope carries params with accept_proto", () => {
    const env = connectionInitEnvelope();
    const decoded = decodeMessage(encodeMessage(env).slice(0, -1)) as ConnectionInitEnvelope;
    expect(decoded.type).toBe("connection_init");
    expect(decoded.params?.accept_proto).toEqual(["1"]);
    expect(decoded.params?.capabilities).toContain("streaming");
  });

  it("ResponseEnvelope exposes result", () => {
    const raw = `{"proto":"1","type":"response","id":"r1","result":{"loop_id":"abc","status":"running"}}`;
    const decoded = decodeMessage(raw) as ResponseEnvelope;
    expect(decoded.type).toBe("response");
    expect(decoded.id).toBe("r1");
    expect(decoded.result).toMatchObject({ loop_id: "abc", status: "running" });
  });

  it("NextEnvelope exposes payload", () => {
    const raw = `{"proto":"1","type":"next","id":"s1","payload":{"mode":"event","data":{"loop_id":"L1"}}}`;
    const decoded = decodeMessage(raw) as NextEnvelope;
    expect(decoded.type).toBe("next");
    expect(decoded.id).toBe("s1");
    expect(decoded.payload).toMatchObject({ mode: "event" });
  });

  it("ErrorEnvelope has nested error object", () => {
    const raw = `{"proto":"1","type":"error","id":"r1","error":{"code":-32200,"message":"Loop not found","data":{"loop_id":"abc"}}}`;
    const decoded = decodeMessage(raw) as ErrorEnvelope;
    expect(decoded.type).toBe("error");
    expect(decoded.error.code).toBe(-32200);
    expect(decoded.error.message).toBe("Loop not found");
    expect(decoded.error.data).toMatchObject({ loop_id: "abc" });
  });

  it("connection_ack decodes", () => {
    const raw = `{"proto":"1","type":"connection_ack","result":{"protocol_version":"1","readiness_state":"ready","capabilities":["streaming"]}}`;
    const decoded = decodeMessage(raw) as ConnectionAckEnvelope;
    expect(decoded.type).toBe("connection_ack");
    expect(decoded.result?.readiness_state).toBe("ready");
  });

  it("StatusFrame decodes with loop_id", () => {
    const raw = `{"proto":"1","type":"status","state":"idle","loop_id":"loop-xyz"}`;
    const decoded = decodeMessage(raw) as StatusFrame;
    expect(decoded.type).toBe("status");
    expect(decoded.loop_id).toBe("loop-xyz");
  });

  it("StatusFrame does not tolerate camelCase loopId (protocol-1 strict)", () => {
    const raw = `{"proto":"1","type":"status","state":"idle","loopId":"loop-camel"}`;
    const decoded = decodeMessage(raw) as StatusFrame;
    // Protocol-1 uses snake_case; camelCase loopId is not normalized.
    expect(decoded.loop_id).toBeUndefined();
  });

  it("ping/pong/disconnect decode", () => {
    expect(decodeMessage(`{"proto":"1","type":"ping"}`)).toMatchObject({
      type: "ping",
    });
    expect(decodeMessage(`{"proto":"1","type":"pong"}`)).toMatchObject({
      type: "pong",
    });
    expect(decodeMessage(`{"proto":"1","type":"disconnect"}`)).toMatchObject({
      type: "disconnect",
    });
  });

  it("unknown type returns raw map", () => {
    const raw = `{"proto":"1","type":"future_type","data":"hello"}`;
    const decoded = decodeMessage(raw) as Record<string, unknown>;
    expect(decoded.type).toBe("future_type");
  });
});

// ---------------------------------------------------------------------------
// splitWirePayload tests
// ---------------------------------------------------------------------------

describe("splitWirePayload", () => {
  it("single JSON", () => {
    const lines = splitWirePayload(`{"proto":"1","type":"status","state":"idle"}`);
    expect(lines).toHaveLength(1);
  });

  it("NDJSON", () => {
    const lines = splitWirePayload(
      `{"proto":"1","type":"status","state":"idle"}\n{"proto":"1","type":"pong"}`,
    );
    expect(lines).toHaveLength(2);
  });

  it("empty input", () => {
    expect(splitWirePayload("")).toHaveLength(0);
  });

  it("trailing newline", () => {
    const lines = splitWirePayload(`{"proto":"1","type":"status"}\n`);
    expect(lines).toHaveLength(1);
  });

  it("whitespace only", () => {
    expect(splitWirePayload("  \n  \n  ")).toHaveLength(0);
  });

  it("multiple newlines", () => {
    const lines = splitWirePayload(`{"a":1}\n\n{"b":2}\n{"c":3}`);
    expect(lines).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// extractSootheLoopID tests (protocol-1 aware)
// ---------------------------------------------------------------------------

describe("extractSootheLoopID", () => {
  it("from StatusFrame loop_id", () => {
    const [id, ok] = extractSootheLoopID({
      proto: "1",
      type: "status",
      loop_id: "loop-1",
    });
    expect(ok).toBe(true);
    expect(id).toBe("loop-1");
  });

  it("from StatusFrame empty", () => {
    const [, ok] = extractSootheLoopID({ proto: "1", type: "status" });
    expect(ok).toBe(false);
  });

  it("from next payload.data.loop_id", () => {
    const [id, ok] = extractSootheLoopID({
      proto: "1",
      type: "next",
      payload: { mode: "event", data: { loop_id: "data-loop" } },
    });
    expect(ok).toBe(true);
    expect(id).toBe("data-loop");
  });

  it("from next payload.data.loopId (camelCase) - protocol-1 uses snake_case", () => {
    const [id, ok] = extractSootheLoopID({
      proto: "1",
      type: "next",
      payload: { data: { loopId: "camel-loop" } },
    });
    // Protocol-1 strict: camelCase loopId is not normalized.
    expect(ok).toBe(false);
    expect(id).toBe("");
  });

  it("returns false for non-object", () => {
    const [, ok] = extractSootheLoopID("not a message");
    expect(ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Factory function tests
// ---------------------------------------------------------------------------

describe("factory functions", () => {
  it("newLoopInputMessage is a notification with params", () => {
    const env = newLoopInputMessage("loop-1", "hello");
    expect(env.type).toBe("notification");
    expect(env.method).toBe("loop_input");
    expect(env.params?.content).toBe("hello");
    expect(env.params?.loop_id).toBe("loop-1");
    expect(env.id).toBeUndefined();
  });

  it("newLoopSubscribeMessage is a subscribe to loop_events", () => {
    const env = newLoopSubscribeMessage("loop-1", "debug");
    expect(env.type).toBe("subscribe");
    expect(env.method).toBe("loop_events");
    expect(env.params?.loop_id).toBe("loop-1");
    expect(env.params?.verbosity).toBe("debug");
    expect(env.id).toBeTruthy();
  });

  it("newLoopNewMessage with workspace string", () => {
    const env = newLoopNewMessage("/tmp/ws");
    expect(env.type).toBe("request");
    expect(env.method).toBe("loop_new");
    expect(env.params?.client_workspace).toBe("/tmp/ws");
  });

  it("newLoopNewMessage with options", () => {
    const env = newLoopNewMessage({
      client_workspace: "/tmp/proj",
      user_id: "alice",
      client_workspace_id: "app-1",
    });
    expect(env.params).toMatchObject({
      client_workspace: "/tmp/proj",
      user_id: "alice",
      client_workspace_id: "app-1",
    });
  });

  it("newLoopNewMessage without workspace", () => {
    const env = newLoopNewMessage();
    expect(env.type).toBe("request");
    expect(env.method).toBe("loop_new");
    expect(env.params?.client_workspace).toBeUndefined();
  });

  it("requestEnvelope generates unique ids", () => {
    const a = requestEnvelope("loop_get", {});
    const b = requestEnvelope("loop_get", {});
    expect(a.id).not.toBe(b.id);
  });

  it("newRequestID generates UUID", () => {
    const id = newRequestID();
    expect(id).toBeTruthy();
    expect(id).toMatch(/^[0-9a-f-]+$/);
  });

  it("newRequestID generates unique IDs", () => {
    expect(newRequestID()).not.toBe(newRequestID());
  });

  it("LoopInputParams type accepts full option set", () => {
    const params: LoopInputParams = {
      loop_id: "L1",
      content: "hi",
      autonomous: true,
      max_iterations: 5,
      preferred_subagent: "coder",
      model: "openai:gpt-4",
      intent_hint: INTENT_HINT_TEXT_COMPLETION,
      clarification_mode: "manual",
      clarification_answer: true,
      clarification_answers: ["a", "b"],
    };
    expect(params.loop_id).toBe("L1");
    expect(params.clarification_answers).toEqual(["a", "b"]);
  });
});

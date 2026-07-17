import { describe, it, expect } from "vitest";
import { Client } from "../src/client.js";
import {
  DROP_PRIORITY_CRITICAL,
  DROP_PRIORITY_NORMAL,
  inboundFrameDropPriority,
} from "../src/inbound_priority.js";

describe("inbound priority / backpressure", () => {
  it("classifies status idle as critical", () => {
    expect(inboundFrameDropPriority({ type: "status", state: "idle" })).toBe(
      DROP_PRIORITY_CRITICAL,
    );
    expect(inboundFrameDropPriority({ type: "event", mode: "updates", data: {} })).toBe(
      DROP_PRIORITY_NORMAL,
    );
  });

  it("drops NORMAL frames under overflow and fires degraded once", () => {
    const client = new Client("ws://127.0.0.1:9");
    client.setInboundMaxSize(3);
    let degraded = 0;
    client.setStreamDegradedCallback(() => {
      degraded += 1;
    });
    const internal = client as unknown as {
      enqueueMessageBuffer: (msg: Record<string, unknown>) => void;
    };
    for (let i = 0; i < 5; i++) {
      internal.enqueueMessageBuffer({ type: "event", mode: "updates", data: { n: i } });
    }
    internal.enqueueMessageBuffer({ type: "status", state: "idle", loop_id: "L1" });
    expect(client.inboundDropped()).toBeGreaterThan(0);
    expect(degraded).toBe(1);
  });
});

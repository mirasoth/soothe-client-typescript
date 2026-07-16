import { describe, it, expect } from "vitest";
import { Client } from "../src/client.js";
import { defaultConfig } from "../src/config.js";
import { STREAM_END, stalePendingFrameLabel } from "../src/stream_terminal.js";

describe("Client.peelStalePendingControlEvents", () => {
  it("removes stale terminals from the message buffer", () => {
    const client = new Client("ws://localhost:0", defaultConfig());
    const internal = client as unknown as { messageBuffer: Record<string, unknown>[] };
    internal.messageBuffer.push(
      { type: "complete" },
      {
        type: "event",
        mode: "custom",
        data: { type: STREAM_END, scope: "turn" },
      },
      { type: "status", state: "running", loop_id: "loop-1" },
    );
    const removed = client.peelStalePendingControlEvents();
    expect(removed).toContain("complete");
    expect(removed).toContain(STREAM_END);
    expect(internal.messageBuffer).toHaveLength(1);
    expect(internal.messageBuffer[0].type).toBe("status");
    expect(stalePendingFrameLabel(internal.messageBuffer[0])).toBeNull();
  });
});

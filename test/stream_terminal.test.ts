import { describe, it, expect } from "vitest";
import {
  STREAM_END,
  isTurnEndCustomData,
  isTurnProgressChunk,
  stalePendingFrameLabel,
} from "../src/stream_terminal.js";
import { EventPlanCreated, EventStrangeLoopCompleted } from "../src/events.js";

describe("stream_terminal", () => {
  it("isTurnEndCustomData recognizes turn-scoped stream.end", () => {
    expect(isTurnEndCustomData({ type: STREAM_END, scope: "turn" })).toBe(true);
    expect(isTurnEndCustomData({ type: STREAM_END })).toBe(true);
    expect(isTurnEndCustomData({ type: STREAM_END, scope: "step" })).toBe(false);
    expect(isTurnEndCustomData({ type: EventStrangeLoopCompleted })).toBe(true);
  });

  it("isTurnProgressChunk excludes intake-only and turn-end", () => {
    expect(isTurnProgressChunk("messages", { type: "ai", content: "hi" })).toBe(true);
    expect(isTurnProgressChunk("custom", { type: EventPlanCreated })).toBe(true);
    expect(isTurnProgressChunk("custom", { type: STREAM_END, scope: "turn" })).toBe(false);
    expect(isTurnProgressChunk("custom", { type: "soothe.cognition.plan.phase" })).toBe(false);
  });

  it("stalePendingFrameLabel peels complete and turn-end customs", () => {
    expect(stalePendingFrameLabel({ type: "complete" })).toBe("complete");
    expect(stalePendingFrameLabel({ type: "connection_ack" })).toBe("connection_ack");
    expect(
      stalePendingFrameLabel({
        type: "event",
        mode: "custom",
        data: { type: STREAM_END, scope: "turn" },
      }),
    ).toBe(STREAM_END);
    expect(
      stalePendingFrameLabel({
        type: "next",
        payload: { mode: "complete", data: {} },
      }),
    ).toBe("complete");
    expect(stalePendingFrameLabel({ type: "status", state: "running" })).toBeNull();
  });
});

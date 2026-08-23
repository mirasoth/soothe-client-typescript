import { describe, it, expect } from "vitest";
import {
  EventCardCreated,
  EventCardFinalized,
  EventCardReplayBegin,
  EventCardReplayEnd,
  EventCardUpdated,
} from "../src/events.js";
import { CardProjection, parseCardCustomPayload } from "../src/display/cardProjection.js";
import { isTurnProgressChunk, stalePendingFrameLabel } from "../src/stream_terminal.js";

describe("cardProjection", () => {
  it("rejects legacy bare card.* types", () => {
    expect(
      parseCardCustomPayload({
        type: "card.created",
        data: { id: "x", type: "user", content: "hi" },
      }),
    ).toBeNull();
  });

  it("applies soothe.card.* create/update/finalize", () => {
    const proj = new CardProjection();
    expect(
      proj.apply({
        type: EventCardCreated,
        card_id: "a1",
        data: { id: "a1", type: "assistant", content: "hel" },
      }),
    ).toBe(true);
    expect(proj.get("a1")?.content).toBe("hel");
    expect(proj.apply({ type: EventCardUpdated, card_id: "a1", data: { content: "hello" } })).toBe(
      true,
    );
    expect(proj.get("a1")?.content).toBe("hello");
    expect(proj.apply({ type: EventCardFinalized, card_id: "a1", data: {} })).toBe(true);
  });

  it("replay begin clears and loads", () => {
    const proj = new CardProjection();
    proj.apply({
      type: EventCardCreated,
      data: { id: "old", type: "user", content: "x" },
    });
    expect(proj.apply({ type: EventCardReplayBegin })).toBe(true);
    expect(proj.replaying).toBe(true);
    expect(proj.snapshot()).toEqual([]);
    proj.apply({
      type: EventCardCreated,
      data: { id: "new", type: "user", content: "y" },
    });
    expect(proj.apply({ type: EventCardReplayEnd })).toBe(true);
    expect(proj.snapshot().map(c => c.id)).toEqual(["new"]);
  });
});

describe("stream_terminal card progress", () => {
  it("treats soothe.card mutation frames as turn progress", () => {
    expect(isTurnProgressChunk("custom", { type: EventCardCreated })).toBe(true);
    expect(isTurnProgressChunk("custom", { type: EventCardUpdated })).toBe(true);
    expect(isTurnProgressChunk("custom", { type: EventCardFinalized })).toBe(true);
  });

  it("peels soothe.card.replay.begin leftovers", () => {
    expect(
      stalePendingFrameLabel({
        type: "next",
        payload: { mode: EventCardReplayBegin, data: { type: EventCardReplayBegin } },
      }),
    ).toBe(EventCardReplayBegin);
  });
});

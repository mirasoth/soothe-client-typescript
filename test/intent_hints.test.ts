import { describe, expect, it } from "vitest";
import { Client } from "../src/client.js";
import { inputMessageForLoop } from "../src/appkit/turn_runner.js";
import { INTENT_HINT_TEXT_COMPLETION } from "../src/intent_hints.js";

describe("intent_hint wire forwarding", () => {
  it("sendInput forwards daemon and pass-through hints", async () => {
    const client = new Client("ws://localhost:8765");
    // sendInput builds params without local legacy rejection.
    const msg = inputMessageForLoop("hello", "loop-1", undefined, {
      intentHint: INTENT_HINT_TEXT_COMPLETION,
    });
    expect(msg.intent_hint).toBe(INTENT_HINT_TEXT_COMPLETION);

    const passThrough = inputMessageForLoop("hello", "loop-1", undefined, {
      intentHint: "resume_clarification",
    });
    expect(passThrough.intent_hint).toBe("resume_clarification");
    expect(client).toBeTruthy();
  });
});

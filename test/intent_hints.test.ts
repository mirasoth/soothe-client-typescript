import { describe, expect, it } from "vitest";
import { Client } from "../src/client.js";
import { inputMessageForLoop } from "../src/appkit/turn_runner.js";
import {
  INTENT_HINT_TEXT_COMPLETION,
  validateLoopInputIntentHint,
} from "../src/intent_hints.js";

describe("validateLoopInputIntentHint", () => {
  it("rejects removed direct_llm and quiz", () => {
    expect(validateLoopInputIntentHint("direct_llm")).toMatch(/removed/);
    expect(validateLoopInputIntentHint("DIRECT_LLM")).toMatch(/removed/);
    expect(validateLoopInputIntentHint(" quiz ")).toMatch(/removed/);
  });

  it("allows direct hints and agent pass-through", () => {
    expect(validateLoopInputIntentHint(INTENT_HINT_TEXT_COMPLETION)).toBeNull();
    expect(validateLoopInputIntentHint("resume_clarification")).toBeNull();
    expect(validateLoopInputIntentHint("skill:search")).toBeNull();
  });
});

describe("legacy intent_hint rejection", () => {
  it("sendInput rejects direct_llm before wire", async () => {
    const client = new Client("ws://localhost:8765");
    await expect(
      client.sendInput("hello", { loopID: "loop-1", intentHint: "direct_llm" }),
    ).rejects.toThrow(/direct_llm is removed/);
  });

  it("inputMessageForLoop rejects quiz", () => {
    expect(() =>
      inputMessageForLoop("hello", "loop-1", undefined, { intentHint: "quiz" }),
    ).toThrow(/quiz is removed/);
  });
});

import { describe, expect, it } from "vitest";
import { inputMessageForLoop } from "../src/appkit/turn_runner.js";
import type { LoopInputParams } from "../src/protocol.js";

describe("intake_scope wire forwarding", () => {
  it("inputMessageForLoop forwards intake_scope", () => {
    const msg = inputMessageForLoop("fix typo", "loop-1", undefined, {
      intakeScope: "simple",
    });
    expect(msg.intake_scope).toBe("simple");
  });

  it("LoopInputParams accepts intake_scope", () => {
    const params: LoopInputParams = {
      loop_id: "L1",
      content: "hi",
      intake_scope: "complex",
    };
    expect(params.intake_scope).toBe("complex");
  });
});

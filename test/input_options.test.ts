/**
 * Unit tests for InputOptions and sendInput behavior.
 */

import { describe, it, expect } from "vitest";
import { Client, InputOptions } from "../src/client.js";

describe("InputOptions", () => {
  it("requires loopID", async () => {
    const client = new Client("ws://localhost:8765");
    // sendInput should reject without loopID
    await expect(client.sendInput("test message", {})).rejects.toThrow(
      "sendInput requires options.loopID",
    );
  });

  it("accepts loopID string", () => {
    // Test that InputOptions interface accepts loopID
    const opts: InputOptions = {
      loopID: "test-loop-id",
    };
    expect(opts.loopID).toBe("test-loop-id");
  });

  it("accepts clarificationMode", () => {
    const opts: InputOptions = {
      loopID: "test-loop-id",
      clarificationMode: "manual",
    };
    expect(opts.clarificationMode).toBe("manual");
  });

  it("accepts clarificationAnswer", () => {
    const opts: InputOptions = {
      loopID: "test-loop-id",
      clarificationAnswer: true,
    };
    expect(opts.clarificationAnswer).toBe(true);
  });

  it("accepts clarificationAnswers", () => {
    const opts: InputOptions = {
      loopID: "test-loop-id",
      clarificationAnswers: ["yes", "no", "maybe"],
    };
    expect(opts.clarificationAnswers).toEqual(["yes", "no", "maybe"]);
  });

  it("accepts intentHint", () => {
    const opts: InputOptions = {
      loopID: "test-loop-id",
      intentHint: "quiz",
    };
    expect(opts.intentHint).toBe("quiz");
  });

  it("accepts responseSchema", () => {
    const schema = {
      type: "object",
      properties: {
        result: { type: "string" },
      },
    };
    const opts: InputOptions = {
      loopID: "test-loop-id",
      responseSchema: schema,
    };
    expect(opts.responseSchema).toEqual(schema);
  });

  it("accepts responseSchemaName", () => {
    const opts: InputOptions = {
      loopID: "test-loop-id",
      responseSchemaName: "my_schema",
    };
    expect(opts.responseSchemaName).toBe("my_schema");
  });

  it("accepts responseSchemaStrict", () => {
    const opts: InputOptions = {
      loopID: "test-loop-id",
      responseSchemaStrict: true,
    };
    expect(opts.responseSchemaStrict).toBe(true);
  });

  it("accepts multiple options together", () => {
    const opts: InputOptions = {
      loopID: "test-loop-id",
      autonomous: true,
      maxIterations: 10,
      subagent: "coder",
      model: "openai:gpt-4",
      intentHint: "quiz",
      clarificationMode: "manual",
      clarificationAnswer: true,
      clarificationAnswers: ["a", "b"],
    };

    expect(opts.loopID).toBe("test-loop-id");
    expect(opts.autonomous).toBe(true);
    expect(opts.maxIterations).toBe(10);
    expect(opts.subagent).toBe("coder");
    expect(opts.model).toBe("openai:gpt-4");
    expect(opts.intentHint).toBe("quiz");
    expect(opts.clarificationMode).toBe("manual");
    expect(opts.clarificationAnswer).toBe(true);
    expect(opts.clarificationAnswers).toEqual(["a", "b"]);
  });

  it("accepts standard options", () => {
    const opts: InputOptions = {
      loopID: "test-loop-id",
      autonomous: true,
      maxIterations: 5,
      subagent: "researcher",
      interactive: true,
      model: "claude:claude-3",
      modelParams: { temperature: 0.7 },
      attachments: [{ mime_type: "image/png", data: "base64..." }],
    };

    expect(opts.autonomous).toBe(true);
    expect(opts.maxIterations).toBe(5);
    expect(opts.subagent).toBe("researcher");
    expect(opts.interactive).toBe(true);
    expect(opts.model).toBe("claude:claude-3");
    expect(opts.modelParams).toEqual({ temperature: 0.7 });
    expect(opts.attachments).toHaveLength(1);
  });
});

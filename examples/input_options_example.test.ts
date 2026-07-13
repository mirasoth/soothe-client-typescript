/**
 * Input options examples: sendInput variants — basic, autonomous, model
 * override, intent hints, and structured-output JSON schema.
 *
 * Mirrors the Go client's `input_options_example_test.go`.
 */

import { describe, it, expect } from "vitest";
import { Client, defaultConfig, bootstrapLoopSession } from "../src/index.js";
import {
  INTENT_HINT_TEXT_COMPLETION,
  INTENT_HINT_IMAGE_TO_TEXT,
  INTENT_HINT_OCR,
  INTENT_HINT_EMBED,
  REMOVED_INTENT_HINTS,
  validateLoopInputIntentHint,
} from "../src/index.js";
import { createMockDaemon } from "./helpers/mock-server.js";

describe("Example: sendInput variants", () => {
  it("sendInputBasic: sends simple text input (loopID required)", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      const loopId = "existing-loop-id";

      // sendInput sends a loop_input notification (fire-and-forget).
      // options.loopID is mandatory; other options are optional.
      await client.sendInput("Explain how goroutines work in Go", { loopID: loopId });
      console.log("Input sent");

      client.close();
      expect(true).toBe(true);
    } finally {
      await md.close();
    }
  });

  it("sendInputAutonomous: enables autonomous mode with max-iterations cap", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      const loopId = "existing-loop-id";

      // The daemon runs the agent graph without streaming intermediate steps.
      await client.sendInput("Refactor the auth module for better testability", {
        loopID: loopId,
        autonomous: true,
        maxIterations: 10,
      });
      console.log("Autonomous input sent");

      client.close();
      expect(true).toBe(true);
    } finally {
      await md.close();
    }
  });

  it("sendInputWithModel: overrides provider:model and passes model params", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      const loopId = "existing-loop-id";

      await client.sendInput("Summarize the quarterly report", {
        loopID: loopId,
        model: "openai:gpt-4o",
        modelParams: { temperature: 0.3, max_tokens: 2000 },
      });
      console.log("Model-override input sent");

      client.close();
      expect(true).toBe(true);
    } finally {
      await md.close();
    }
  });

  it("sendInputWithSubagent: routes to a named subagent", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      await client.sendInput("Explore the codebase structure", {
        loopID: "loop-1",
        subagent: "explore",
      });
      console.log("Subagent input sent");

      client.close();
      expect(true).toBe(true);
    } finally {
      await md.close();
    }
  });
});

describe("Example: intent hints (direct model turns)", () => {
  it("intentHintConstants: text_completion, image_to_text, ocr, embed", () => {
    console.log("text_completion:", INTENT_HINT_TEXT_COMPLETION);
    console.log("image_to_text:", INTENT_HINT_IMAGE_TO_TEXT);
    console.log("ocr:", INTENT_HINT_OCR);
    console.log("embed:", INTENT_HINT_EMBED);

    expect(INTENT_HINT_TEXT_COMPLETION).toBe("text_completion");
    expect(INTENT_HINT_IMAGE_TO_TEXT).toBe("image_to_text");
    expect(INTENT_HINT_OCR).toBe("ocr");
    expect(INTENT_HINT_EMBED).toBe("embed");
  });

  it("sendInputWithIntentHint: direct model text_completion", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      // text_completion: text-only chat completion via the default role.
      await client.sendInput("Write a haiku about TypeScript", {
        loopID: "loop-1",
        intentHint: INTENT_HINT_TEXT_COMPLETION,
      });
      console.log("text_completion input sent");

      client.close();
      expect(true).toBe(true);
    } finally {
      await md.close();
    }
  });

  it("sendInputWithIntentHint: image_to_text (vision with attachments)", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      // image_to_text: vision/image understanding (attachments required).
      await client.sendInput("Describe this image", {
        loopID: "loop-1",
        intentHint: INTENT_HINT_IMAGE_TO_TEXT,
        attachments: [{ mime_type: "image/png", data: "base64-encoded-data" }],
      });
      console.log("image_to_text input sent");

      client.close();
      expect(true).toBe(true);
    } finally {
      await md.close();
    }
  });

  it("sendInputWithIntentHint: OCR", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      await client.sendInput("Extract text from this document", {
        loopID: "loop-1",
        intentHint: INTENT_HINT_OCR,
        attachments: [{ mime_type: "image/png", data: "base64-doc" }],
      });
      console.log("ocr input sent");

      client.close();
      expect(true).toBe(true);
    } finally {
      await md.close();
    }
  });

  it("sendInputWithIntentHint: embed (vector embedding)", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      // embed: text embedding via the embedding role (JSON vector response).
      await client.sendInput("Embed this text for semantic search", {
        loopID: "loop-1",
        intentHint: INTENT_HINT_EMBED,
      });
      console.log("embed input sent");

      client.close();
      expect(true).toBe(true);
    } finally {
      await md.close();
    }
  });
});

describe("Example: removed intent hints", () => {
  it("removedIntentHints: direct_llm and quiz are rejected", () => {
    console.log("Removed hints:", REMOVED_INTENT_HINTS.join(", "));
    expect(REMOVED_INTENT_HINTS).toContain("direct_llm");
    expect(REMOVED_INTENT_HINTS).toContain("quiz");
  });

  it("validateLoopInputIntentHint: rejects direct_llm", () => {
    const err = validateLoopInputIntentHint("direct_llm");
    console.log("direct_llm error:", err);
    expect(err).not.toBeNull();
    expect(err).toContain("text_completion");
  });

  it("validateLoopInputIntentHint: rejects quiz", () => {
    const err = validateLoopInputIntentHint("quiz");
    console.log("quiz error:", err);
    expect(err).not.toBeNull();
    expect(err).toContain("quiz is removed");
  });

  it("validateLoopInputIntentHint: accepts valid hints (returns null)", () => {
    expect(validateLoopInputIntentHint("text_completion")).toBeNull();
    expect(validateLoopInputIntentHint("skill:foo")).toBeNull();
    expect(validateLoopInputIntentHint("resume_clarification")).toBeNull();
  });

  it("sendInput rejects removed intent_hint before send", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      // sendInput should reject the removed "direct_llm" hint locally.
      await expect(
        client.sendInput("test", { loopID: "loop-1", intentHint: "direct_llm" as never }),
      ).rejects.toThrow();

      client.close();
    } finally {
      await md.close();
    }
  });
});

describe("Example: structured output (response schema)", () => {
  it("sendInputWithResponseSchema: requests structured JSON output", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      // JSON Schema for structured output (text_completion or image_to_text).
      const schema = {
        type: "object",
        properties: {
          summary: { type: "string" },
          sentiment: { type: "string", enum: ["positive", "negative", "neutral"] },
        },
        required: ["summary", "sentiment"],
      };

      await client.sendInput("Analyze the sentiment of this review", {
        loopID: "loop-1",
        intentHint: INTENT_HINT_TEXT_COMPLETION,
        responseSchema: schema,
        responseSchemaName: "sentiment_analysis",
        responseSchemaStrict: true,
      });
      console.log("Structured-output input sent");

      client.close();
      expect(true).toBe(true);
    } finally {
      await md.close();
    }
  });
});

describe("Example: bootstrap + sendInput integration", () => {
  it("bootstrapThenSendInput: full flow", async () => {
    const md = createMockDaemon();
    try {
      const cfg = defaultConfig();
      const client = new Client(md.url, cfg);
      await client.connect();

      // Bootstrap a fresh loop (loop_new + loop_subscribe).
      const loopId = await bootstrapLoopSession(client, null, cfg);
      console.log("Bootstrapped loop:", loopId);

      // Send input to the bootstrapped loop.
      await client.sendInput("Analyze this codebase", { loopID: loopId });
      console.log("Input sent to bootstrapped loop");

      client.close();
      expect(loopId).toMatch(/^loop-\d+$/);
    } finally {
      await md.close();
    }
  });
});

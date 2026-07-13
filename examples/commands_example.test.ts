/**
 * Commands examples: sendCommand (slash commands), MCP status,
 * and loop state operations (get/update).
 *
 * Mirrors the Go client's `commands_example_test.go`.
 */

import { describe, it, expect } from "vitest";
import { Client } from "../src/index.js";
import { createMockDaemon } from "./helpers/mock-server.js";

describe("Example: slash commands", () => {
  it("sendCommand: sends a slash command to the daemon", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      // sendCommand sends a slash_command notification (fire-and-forget).
      await client.sendCommand("/help");
      console.log("Command sent: /help");

      client.close();
      expect(true).toBe(true);
    } finally {
      await md.close();
    }
  });

  it("sendCommand: /clear command", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      await client.sendCommand("/clear");
      console.log("Command sent: /clear");

      client.close();
      expect(true).toBe(true);
    } finally {
      await md.close();
    }
  });

  it("sendCommand: /model command with args", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      await client.sendCommand("/model openai:gpt-4o");
      console.log("Command sent: /model openai:gpt-4o");

      client.close();
      expect(true).toBe(true);
    } finally {
      await md.close();
    }
  });
});

describe("Example: low-level notify", () => {
  it("notify: sends a fire-and-forget notification envelope", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      // notify builds a notification envelope and sends it (no id, no response).
      await client.notify("loop_input", { loop_id: "loop-1", content: "hello" });
      console.log("Notification sent");

      client.close();
      expect(true).toBe(true);
    } finally {
      await md.close();
    }
  });
});

describe("Example: sendMessage (raw envelope)", () => {
  it("sendMessage: sends a pre-built envelope as a text frame", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      // sendMessage serializes msg as JSON and sends it as a WebSocket text frame.
      await client.sendMessage({ proto: "1", type: "ping" });
      console.log("Raw message sent");

      client.close();
      expect(true).toBe(true);
    } finally {
      await md.close();
    }
  });
});

describe("Example: detach notification", () => {
  it("sendDetach: sends a disconnect notification", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      // sendDetach sends a disconnect notification (best-effort clean close).
      await client.sendDetach();
      console.log("Detach notification sent");

      client.close();
      expect(true).toBe(true);
    } finally {
      await md.close();
    }
  });
});

describe("Example: loop new (sendLoopNew)", () => {
  it("sendLoopNew: fire-and-forget loop creation", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      // sendLoopNew sends a loop_new request (fire-and-forget; response via reader).
      await client.sendLoopNew({ client_workspace: "/tmp/workspace" });
      console.log("Loop new request sent");

      client.close();
      expect(true).toBe(true);
    } finally {
      await md.close();
    }
  });

  it("sendLoopNew: with string workspace", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      await client.sendLoopNew("/tmp/alt-workspace");
      console.log("Loop new (string) sent");

      client.close();
      expect(true).toBe(true);
    } finally {
      await md.close();
    }
  });
});

describe("Example: loop state operations (send methods)", () => {
  it("sendLoopStateGet: fire-and-forget state request", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      await client.sendLoopStateGet("loop-1");
      console.log("State get sent");

      client.close();
      expect(true).toBe(true);
    } finally {
      await md.close();
    }
  });

  it("sendLoopStateUpdate: fire-and-forget state update", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      await client.sendLoopStateUpdate("loop-1", { context_window: 256000 }, "node-1");
      console.log("State update sent");

      client.close();
      expect(true).toBe(true);
    } finally {
      await md.close();
    }
  });
});

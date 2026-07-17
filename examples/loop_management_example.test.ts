/**
 * Loop management examples: full lifecycle (create, subscribe, send input,
 * query, list, delete), subscribe/detach, state, messages, cards, history.
 *
 * Mirrors the Go client's `loop_management_example_test.go`.
 */

import { describe, it, expect } from "vitest";
import { Client, defaultConfig, bootstrapLoopSession, fetchLoopHistory } from "../src/index.js";
import { createMockDaemon } from "./helpers/mock-server.js";

describe("Example: loop lifecycle", () => {
  it("loopLifecycle: create → subscribe → send → query → list → delete", async () => {
    const md = createMockDaemon();
    try {
      const cfg = defaultConfig();
      const client = new Client(md.url, cfg);
      await client.connect();

      // Bootstrap a fresh loop (loop_new + loop_subscribe in one call).
      const loopId = await bootstrapLoopSession(client, null, cfg);
      console.log("Created loop:", loopId);

      // Send input as a fire-and-forget notification (does not block for response).
      await client.sendInput("Analyze this codebase", { loopID: loopId });
      console.log("Input sent");

      // Query loop details with verbose output.
      const details = await client.getLoop(loopId, 15_000);
      console.log("Loop details:", details);

      // List all loops, limited to 10.
      const loops = await client.listLoops(15_000);
      console.log("Loops:", loops);

      // Clean up the loop when done.
      await client.deleteLoop(loopId, 10_000);
      console.log("Loop deleted");

      client.close();

      expect(loopId).toMatch(/^loop-\d+$/);
      expect(details).toMatchObject({ loop_id: loopId, active: true, state: "idle" });
      expect(loops).toMatchObject({ total: 2 });
    } finally {
      await md.close();
    }
  });
});

describe("Example: loop subscribe / detach", () => {
  it("loopSubscribeUnsubscribe: manual subscribe/detach", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      const loopId = "loop-1";

      // Subscribe to loop events with normal verbosity.
      await client.sendLoopSubscribe(loopId, "normal");
      console.log("Subscribed to loop events");

      // Detach from the loop.
      await client.sendLoopDetach(loopId);
      console.log("Detached from loop");

      client.close();
      expect(true).toBe(true);
    } finally {
      await md.close();
    }
  });

  it("subscribeUnsubscribe: low-level subscribe/unsubscribe APIs", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      // Start a subscription stream (returns sub id).
      const subId = await client.subscribe(
        "loop_events",
        { loop_id: "loop-1", verbosity: "normal" },
        10_000,
      );
      console.log("Subscription id:", subId);

      // Cancel the subscription.
      await client.unsubscribe(subId);
      console.log("Unsubscribed");

      client.close();
      expect(subId).toBeTruthy();
    } finally {
      await md.close();
    }
  });
});

describe("Example: loop messages", () => {
  it("getLoopMessages: fetches persisted conversation", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      const messages = await client.getLoopMessages("loop-1", 50, 0, false, 15_000);
      console.log("Messages:", messages);

      client.close();
      expect(messages).toMatchObject({ total: 2 });
      expect(messages.messages).toBeInstanceOf(Array);
    } finally {
      await md.close();
    }
  });

  it("sendLoopMessages: fire-and-forget request", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      await client.sendLoopMessages("loop-1", 50, 0, true);
      console.log("Loop messages request sent");

      client.close();
      expect(true).toBe(true);
    } finally {
      await md.close();
    }
  });
});

describe("Example: loop state", () => {
  it("getLoopState: fetches checkpoint state", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      const state = await client.getLoopState("loop-1", 15_000);
      console.log("Loop state:", state);

      client.close();
      expect(state).toMatchObject({ loop_id: "loop-1" });
    } finally {
      await md.close();
    }
  });

  it("updateLoopState: applies partial checkpoint values", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      const result = await client.updateLoopState(
        "loop-1",
        { context_window: 256000 },
        undefined,
        15_000,
      );
      console.log("Update result:", result);

      client.close();
      expect(result).toMatchObject({ success: true });
    } finally {
      await md.close();
    }
  });

  it("sendLoopStateGet: fire-and-forget state request", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      await client.sendLoopStateGet("loop-1");
      console.log("State request sent");

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

      await client.sendLoopStateUpdate("loop-1", { key: "value" }, "node-1");
      console.log("State update sent");

      client.close();
      expect(true).toBe(true);
    } finally {
      await md.close();
    }
  });
});

describe("Example: loop cards", () => {
  it("fetchLoopCards: requests display card ledger snapshot", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      const cards = await client.fetchLoopCards("loop-1", 15_000);
      console.log("Cards:", cards);

      client.close();
      expect(cards).toMatchObject({ loop_id: "loop-1" });
      expect(cards.cards).toBeInstanceOf(Array);
    } finally {
      await md.close();
    }
  });

  it("sendLoopCardsFetch: fire-and-forget cards request", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      await client.sendLoopCardsFetch("loop-1");
      console.log("Cards request sent");

      client.close();
      expect(true).toBe(true);
    } finally {
      await md.close();
    }
  });
});

describe("Example: loop history", () => {
  it("fetchLoopHistory: blocking helper returns full history", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      const history = await fetchLoopHistory(client, "loop-1", 15_000);
      console.log("History:", history);

      client.close();
      expect(history).toMatchObject({ loop_id: "loop-1" });
      expect(history.history).toBeInstanceOf(Array);
    } finally {
      await md.close();
    }
  });

  it("sendLoopHistoryFetch: fire-and-forget history request", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      await client.sendLoopHistoryFetch("loop-1");
      console.log("History request sent");

      client.close();
      expect(true).toBe(true);
    } finally {
      await md.close();
    }
  });

  it("fetchLoopHistory (method): client.fetchLoopHistory blocking", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      const history = await client.fetchLoopHistory("loop-1", 15_000);
      console.log("History (method):", history);

      client.close();
      expect(history).toMatchObject({ loop_id: "loop-1" });
    } finally {
      await md.close();
    }
  });
});

describe("Example: loop tree", () => {
  it("getLoopTree: requests loop tree visualization", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      const tree = await client.getLoopTree("loop-1", 15_000);
      console.log("Loop tree:", tree);

      client.close();
      expect(tree).toMatchObject({ loop_id: "loop-1" });
      expect(tree.tree).toBeDefined();
    } finally {
      await md.close();
    }
  });
});

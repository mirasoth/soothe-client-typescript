/**
 * appkit examples: SSEBroadcaster, QueryGate,
 * EventClassifier, extractThinkingStep, ConnectionPool, and TurnRunner.
 *
 * Mirrors the Go client's `examples/appkit/appkit_example_test.go`.
 */

import { describe, it, expect } from "vitest";
import {
  SSEBroadcaster,
  type SSEEvent,
  QueryGate,
  ErrQueryBusy,
  EventClassifier,
  ChatEventTerminal,
  type ClassifierConfig,
  extractThinkingStep,
  DEFAULT_THINKING_STEP_EVENTS,
  ConnectionPool,
  defaultPoolConfig,
  TurnRunner,
  ErrQueryTimeout,
  inputMessageForLoop,
  type SessionStore,
  type SessionEntry,
  type SessionMessage,
} from "../../src/appkit/index.js";
import { DEFAULT_DELIVERABLE_PHASES } from "../../src/index.js";
import { createMockDaemon } from "../helpers/mock-server.js";

// ---------------------------------------------------------------------------
// SSEBroadcaster
// ---------------------------------------------------------------------------

describe("Example: SSEBroadcaster", () => {
  it("broadcast: fans events out to all subscribers for a session", async () => {
    const b = new SSEBroadcaster();

    // Two subscribers for the same session.
    const sub1 = b.subscribe("session-1");
    const sub2 = b.subscribe("session-1");

    // Broadcast an event — both subscribers receive it.
    const event: SSEEvent = { type: "delta", data: "hello" };
    b.broadcast("session-1", event);

    // Read from both subscribers.
    const iter1 = sub1.iterable[Symbol.asyncIterator]();
    const iter2 = sub2.iterable[Symbol.asyncIterator]();

    const ev1 = await iter1.next();
    const ev2 = await iter2.next();

    console.log("ch1:", ev1.value);
    console.log("ch2:", ev2.value);

    expect(ev1.done).toBe(false);
    expect(ev2.done).toBe(false);
    expect(ev1.value).toMatchObject({ type: "delta", data: "hello" });
    expect(ev2.value).toMatchObject({ type: "delta", data: "hello" });

    // Unsubscribe one subscriber.
    b.unsubscribe("session-1", sub1.id);

    // Broadcast again — only sub2 receives it.
    b.broadcast("session-1", { type: "complete", data: "done" });
    const ev2b = await iter2.next();
    console.log("ch2 (after unsubscribe ch1):", ev2b.value);
    expect(ev2b.value).toMatchObject({ type: "complete", data: "done" });

    // Close removes all subscribers for a session.
    b.close("session-1");
    console.log("closed");
  });

  it("closeAll: closes every subscriber across all sessions", async () => {
    const b = new SSEBroadcaster();
    const s1 = b.subscribe("s1");
    b.subscribe("s2"); // second subscriber on a different session

    b.closeAll();

    const iter1 = s1.iterable[Symbol.asyncIterator]();
    const r1 = await iter1.next();
    expect(r1.done).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// QueryGate
// ---------------------------------------------------------------------------

describe("Example: QueryGate", () => {
  it("acquire + isActive: single-flight enforcement", () => {
    const gate = new QueryGate();
    const abort = new AbortController();
    const sendCancel = async (_signal: AbortSignal) => {
      console.log("daemon cancel sent");
    };

    // Acquire the gate for session-1.
    gate.acquire("session-1", abort, sendCancel);
    console.log("Active:", gate.isActive("session-1"));

    expect(gate.isActive("session-1")).toBe(true);
  });

  it("second acquire for the same session fails with ErrQueryBusy", () => {
    const gate = new QueryGate();
    const abort = new AbortController();

    gate.acquire("session-1", abort, null);

    // A second acquire for the same session fails.
    expect(() => gate.acquire("session-1", new AbortController(), null)).toThrow(ErrQueryBusy);

    // A different session is fine.
    expect(() => gate.acquire("session-2", new AbortController(), null)).not.toThrow();
  });

  it("cancel: sends daemon cancel then aborts local context", async () => {
    const gate = new QueryGate();
    const abort = new AbortController();
    let cancelSent = false;

    gate.acquire("session-1", abort, async () => {
      cancelSent = true;
    });

    await gate.cancel("session-1");
    console.log("Active after cancel:", gate.isActive("session-1"));
    console.log("Abort signalled:", abort.signal.aborted);

    expect(gate.isActive("session-1")).toBe(false);
    expect(cancelSent).toBe(true);
    expect(abort.signal.aborted).toBe(true);
  });

  it("release: clears the gate without daemon cancel", () => {
    const gate = new QueryGate();
    const abort = new AbortController();

    gate.acquire("session-1", abort, null);
    gate.release("session-1");

    expect(gate.isActive("session-1")).toBe(false);
    expect(abort.signal.aborted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EventClassifier
// ---------------------------------------------------------------------------

describe("Example: EventClassifier", () => {
  // A classifier using the default deliverable phase set.
  function makeClassifier(): EventClassifier {
    const cfg: ClassifierConfig = {
      deliverablePhases: DEFAULT_DELIVERABLE_PHASES,
    };
    return new EventClassifier(cfg);
  }

  it("classify: a deliverable text_completion event", () => {
    const cl = makeClassifier();

    // A loop-tagged message with a deliverable phase.
    // mode="messages" data is an array of message objects (matching the wire shape).
    const event = {
      type: "next",
      payload: {
        namespace: ["soothe", "output"],
        mode: "messages",
        data: [
          {
            type: "ai",
            content: "Here is the final answer to your question.",
            phase: "text_completion",
            loop_id: "loop-1",
          },
        ],
      },
    };

    const result = cl.classify(event, "");
    console.log("Terminal:", result.terminal);
    console.log("Content:", result.content);
    console.log("CompletionEvent:", result.completionEvent);

    expect(result.terminal).toBe(ChatEventTerminal.DeliverableComplete);
    expect(result.content).toBe("Here is the final answer to your question.");
  });

  it("isDeliverableCompletionEvent: recognizes deliverable phases", () => {
    const cl = makeClassifier();

    expect(cl.isDeliverableCompletionEvent("soothe.protocol.message.text_completion")).toBe(true);
    expect(cl.isDeliverableCompletionEvent("soothe.protocol.message.quiz")).toBe(true);
    expect(cl.isDeliverableCompletionEvent("soothe.protocol.message.unknown_phase")).toBe(false);
    expect(cl.isDeliverableCompletionEvent("")).toBe(false);
  });

  it("isSubstantiveAssistantReply: checks minimum length", () => {
    const cl = makeClassifier();

    // Too short — not substantive.
    expect(cl.isSubstantiveAssistantReply("hi")).toBe(false);
    // Long enough — substantive.
    expect(cl.isSubstantiveAssistantReply("A full reply here.")).toBe(true);
  });

  it("resolveDeliverableFinalContent: resolves the final user-facing reply", () => {
    const cl = makeClassifier();

    const result = {
      terminal: ChatEventTerminal.DeliverableComplete,
      content: "Here is the final answer.",
      completionEvent: "soothe.protocol.message.text_completion",
    };

    const [final, ok] = cl.resolveDeliverableFinalContent(result, "");
    console.log("Final:", final, "ok=", ok);

    expect(ok).toBe(true);
    expect(final).toBe("Here is the final answer.");
  });
});

// ---------------------------------------------------------------------------
// extractThinkingStep
// ---------------------------------------------------------------------------

describe("Example: extractThinkingStep", () => {
  it("extractThinkingStep: maps an allowlisted progress event to a UI line", () => {
    const [line, ok] = extractThinkingStep("soothe.tool.execution.started", {
      tool_name: "file_read",
    });
    console.log("Thinking step:", line, "ok=", ok);

    expect(ok).toBe(true);
    expect(line).toContain("file_read");
  });

  it("extractThinkingStep: returns false for non-allowlisted events", () => {
    const [line, ok] = extractThinkingStep("soothe.unknown.event", { foo: "bar" });
    expect(ok).toBe(false);
    expect(line).toBe("");
  });

  it("DEFAULT_THINKING_STEP_EVENTS: contains expected allowlist", () => {
    expect(DEFAULT_THINKING_STEP_EVENTS.has("soothe.cognition.plan.created")).toBe(true);
    expect(DEFAULT_THINKING_STEP_EVENTS.has("soothe.tool.execution.started")).toBe(true);
    expect(DEFAULT_THINKING_STEP_EVENTS.has("soothe.unknown.event")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ConnectionPool
// ---------------------------------------------------------------------------

/** In-memory SessionStore implementation for examples. */
function makeMemoryStore(): SessionStore & {
  _entries: Map<string, SessionEntry>;
} {
  const entries = new Map<string, SessionEntry>();
  const store: SessionStore & {
    _entries: Map<string, SessionEntry>;
  } = {
    _entries: entries,
    async getSession(sessionID) {
      return entries.get(sessionID) ?? null;
    },
    async createSession(workspaceID, sessionID, loopID, sessionType) {
      entries.set(sessionID, {
        workspaceID,
        sessionID,
        loopID,
        sessionType,
        isActive: true,
        resetCount: 0,
        lastUsedAt: Date.now(),
      });
    },
    async updateLastUsed(sessionID) {
      const e = entries.get(sessionID);
      if (e) e.lastUsedAt = Date.now();
    },
    async incrementResetCount(sessionID) {
      const e = entries.get(sessionID);
      if (e) e.resetCount += 1;
    },
    async getLoopIDForSession(sessionID) {
      const e = entries.get(sessionID);
      if (e) return { loopID: e.loopID, ok: true };
      return { loopID: "", ok: false };
    },
    async appendMessage(_sessionID, _message: SessionMessage) {
      // no-op for examples
    },
  };
  return store;
}

describe("Example: ConnectionPool", () => {
  it("defaultPoolConfig: returns sensible defaults", () => {
    const cfg = defaultPoolConfig();
    console.log("Pool size:", cfg.poolSize);
    console.log("Query timeout:", cfg.queryTimeout);

    expect(cfg.poolSize).toBe(1000);
    expect(cfg.queryTimeout).toBe(30 * 60 * 1000);
  });

  it("acquire + release: bootstraps a fresh loop on first use", async () => {
    const md = createMockDaemon();
    try {
      const store = makeMemoryStore();
      const pool = new ConnectionPool(md.url, store);

      const conn = await pool.acquire("session-1", "ws-1", "user-1");
      console.log("Loop ID:", conn.getLoopID());
      console.log("Connected:", conn.isConnected());

      expect(conn.getLoopID()).toMatch(/^loop-\d+$/);
      expect(conn.isConnected()).toBe(true);

      await pool.release("session-1");
      console.log("Released");
    } finally {
      await md.close();
    }
  });

  it("resetSession: clears the session for a fresh bootstrap", async () => {
    const md = createMockDaemon();
    try {
      const store = makeMemoryStore();
      const pool = new ConnectionPool(md.url, store);

      await pool.acquire("session-1", "ws-1", "user-1");
      await pool.resetSession("session-1");
      console.log("Session reset");

      // After reset, a new acquire should bootstrap a new loop.
      const conn = await pool.acquire("session-1", "ws-1", "user-1");
      expect(conn.getLoopID()).toMatch(/^loop-\d+$/);

      await pool.release("session-1");
    } finally {
      await md.close();
    }
  });
});

// ---------------------------------------------------------------------------
// TurnRunner
// ---------------------------------------------------------------------------

describe("Example: TurnRunner", () => {
  it("inputMessageForLoop: builds a loop_input payload", () => {
    const msg = inputMessageForLoop("Hello, Soothe!", "loop-1");
    console.log("Input message:", msg);

    expect(msg).toMatchObject({
      type: "loop_input",
      content: "Hello, Soothe!",
      loop_id: "loop-1",
    });
  });

  it("inputMessageForLoop: with attachments and intent hint", () => {
    const msg = inputMessageForLoop(
      "Describe this image",
      "loop-1",
      [{ mime_type: "image/png", data: "base64" }],
      { intentHint: "image_to_text" },
    );
    console.log("Input (with attachments):", msg);

    expect(msg).toMatchObject({ type: "loop_input", intent_hint: "image_to_text" });
    expect(msg.attachments).toBeInstanceOf(Array);
  });

  it("ErrQueryTimeout: extends Error", () => {
    const err = new ErrQueryTimeout();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ErrQueryTimeout");
    expect(err.message).toContain("query timeout");
  });

  it("TurnRunner: constructs with all components", async () => {
    const md = createMockDaemon();
    try {
      const store = makeMemoryStore();
      const pool = new ConnectionPool(md.url, store);
      const gate = new QueryGate();
      const classifier = new EventClassifier({
        deliverablePhases: DEFAULT_DELIVERABLE_PHASES,
      });
      const broadcaster = new SSEBroadcaster();

      const runner = new TurnRunner(pool, gate, classifier, store, broadcaster, {
        queryTimeout: 5_000,
      });

      // Register completion and error hooks.
      let completed = false;
      runner.withOnComplete((_sessionID, _loopID, _content, _completionEvent, _elapsedMs) => {
        completed = true;
      });
      runner.withOnError((_sessionID, _loopID, _err) => {
        console.log("Error hook called");
      });

      // The runner is constructed but we don't execute a full turn here
      // because the mock daemon doesn't stream events to completion.
      expect(runner).toBeDefined();
      expect(completed).toBe(false);

      broadcaster.closeAll();
    } finally {
      await md.close();
    }
  });
});

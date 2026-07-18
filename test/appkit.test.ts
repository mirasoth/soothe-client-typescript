import { describe, it, expect } from "vitest";
import { DEFAULT_DELIVERABLE_PHASES, INTENT_HINT_TEXT_COMPLETION } from "../src/intent_hints.js";
import type { AbortSignal } from "node:events";
import type { DecodedMessage } from "../src/protocol.js";
import { DisconnectCause } from "../src/errors.js";
import {
  ChatEventTerminal,
  ConnectionPool,
  ErrIdleTimeout,
  ErrPoolExhausted,
  ErrQueryBusy,
  ErrQueryTimeout,
  EventClassifier,
  QueryGate,
  SSEBroadcaster,
  TimeoutPolicy,
  TurnRunner,
  idleTimeoutForTurn,
  inputMessageForLoop,
  type SessionEntry,
  type SessionMessage,
  type SessionStore,
  type Attachment,
  type InputOpts,
} from "../src/appkit/index.js";
import type { ManagedClient } from "../src/appkit/client.js";

// ---------------------------------------------------------------------------
// Test fakes
// ---------------------------------------------------------------------------

/** In-memory SessionStore for tests. */
class MemStore implements SessionStore {
  private sessions = new Map<string, SessionEntry>();
  private msgs = new Map<string, SessionMessage[]>();
  failCreate = false;

  async getSession(id: string): Promise<SessionEntry | null> {
    const e = this.sessions.get(id);
    return e ? { ...e } : null;
  }
  async createSession(ws: string, sid: string, loop: string, stype: string): Promise<void> {
    if (this.failCreate) throw new Error("create failed");
    this.sessions.set(sid, {
      workspaceID: ws,
      sessionID: sid,
      loopID: loop,
      sessionType: stype,
      isActive: true,
      resetCount: 0,
      lastUsedAt: Date.now(),
    });
  }
  async updateLastUsed(): Promise<void> {}
  async incrementResetCount(): Promise<void> {}
  async getLoopIDForSession(sid: string): Promise<{ loopID: string; ok: boolean }> {
    const e = this.sessions.get(sid);
    if (e && e.loopID) return { loopID: e.loopID, ok: true };
    return { loopID: "", ok: false };
  }
  async appendMessage(sid: string, m: SessionMessage): Promise<void> {
    const arr = this.msgs.get(sid) ?? [];
    arr.push(m);
    this.msgs.set(sid, arr);
  }
  messages(sid: string): SessionMessage[] {
    return [...(this.msgs.get(sid) ?? [])];
  }
}

/** A ManagedClient fake that handshakes on connect and replays a scripted stream. */
class FakeClient implements ManagedClient {
  connected = false;
  closed = false;
  private disconnFired = false;
  private cause: DisconnectCause | null = null;
  private scripted: unknown[];
  sendCapture: Record<string, unknown>[] = [];
  reattachErr: Error | null = null;
  connectErr: Error | null = null;
  /** When true, the event stream ends after scripted events (for stream-close tests). */
  endAfterScript = false;
  /** Delay (ms) before each scripted event. */
  eventDelayMs = 0;

  constructor(events: unknown[] = []) {
    this.scripted = events;
  }

  async connect(): Promise<void> {
    this.connected = true;
    if (this.connectErr) throw this.connectErr;
  }
  async reconnect(): Promise<void> {
    this.connected = true;
  }
  async reattachAndProbe(): Promise<void> {
    if (this.reattachErr) throw this.reattachErr;
  }
  async sendMessage(msg: unknown): Promise<void> {
    if (msg && typeof msg === "object") {
      this.sendCapture.push(msg as Record<string, unknown>);
    }
  }
  async sendInput(): Promise<void> {}
  receiveMessages(_signal?: AbortSignal): AsyncGenerator<DecodedMessage> {
    const scripted = this.scripted;
    const endAfter = this.endAfterScript;
    const delayMs = this.eventDelayMs;
    return (async function* (): AsyncGenerator<DecodedMessage> {
      for (const ev of scripted) {
        if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
        yield ev as DecodedMessage;
      }
      if (endAfter) return;
      await new Promise<void>(() => {});
    })();
  }
  isDisconnected(): boolean {
    return this.disconnFired;
  }
  disconnectCause(): DisconnectCause | null {
    return this.cause;
  }
  isConnected(): boolean {
    return this.connected && !this.closed;
  }
  close(): void {
    this.closed = true;
    this.connected = false;
  }
  fireDisconnect(cause: DisconnectCause): void {
    this.disconnFired = true;
    this.cause = cause;
  }
}

/** Builds a loop-tagged assistant deliverable `next` frame. */
function deliverableNext(phase: string, content: string): Record<string, unknown> {
  return {
    proto: "1",
    type: "next",
    id: "sub-1",
    payload: {
      namespace: ["soothe", "protocol", "message"],
      mode: "messages",
      data: [{ type: "AIMessage", phase, content }],
      loop_id: "loop-1",
    },
  };
}

/** Builds a streaming-chunk `next` frame. */
function streamingChunkNext(content: string): Record<string, unknown> {
  return {
    proto: "1",
    type: "next",
    id: "sub-1",
    payload: {
      namespace: ["soothe", "protocol", "message"],
      mode: "messages",
      data: [{ type: "AIMessageChunk", content }],
      loop_id: "loop-1",
    },
  };
}

// ---------------------------------------------------------------------------
// SSEBroadcaster
// ---------------------------------------------------------------------------

describe("SSEBroadcaster", () => {
  it("subscribe/broadcast/close", async () => {
    const b = new SSEBroadcaster();
    const { iterable, id } = b.subscribe("s1");
    b.broadcast("s1", { type: "delta", data: "hi" });
    const reader = iterable[Symbol.asyncIterator]();
    const ev = await reader.next();
    expect(ev.value?.type).toBe("delta");
    expect(ev.value?.data).toBe("hi");
    // Non-existent session: no panic.
    b.broadcast("nope", { type: "x" });
    b.close("s1");
    // After close, the iterator ends.
    const after = await reader.next();
    expect(after.done).toBe(true);
    void id;
  });

  it("drop-on-full does not block", async () => {
    const b = new SSEBroadcaster();
    const { iterable } = b.subscribe("s1");
    const reader = iterable[Symbol.asyncIterator]();
    // Fill the buffer (cap 100). The reader hasn't drained, so the queue fills.
    for (let i = 0; i < 100; i++) {
      b.broadcast("s1", { type: "delta", data: i });
    }
    // This must not block (drop-on-full).
    b.broadcast("s1", { type: "delta", data: "overflow" });
    // Drain a few to confirm events are still flowing.
    const first = await reader.next();
    expect(first.value?.data).toBe(0);
    b.close("s1");
  });
});

// ---------------------------------------------------------------------------
// EventClassifier
// ---------------------------------------------------------------------------

function triarchClassifier(): EventClassifier {
  return new EventClassifier({
    deliverablePhases: DEFAULT_DELIVERABLE_PHASES,
  });
}

describe("EventClassifier", () => {
  it("deliverable phase (triarch set) → DeliverableComplete", () => {
    const cl = triarchClassifier();
    const r = cl.classify(deliverableNext("quiz", "Hello, this is the answer."), "");
    expect(r.terminal).toBe(ChatEventTerminal.DeliverableComplete);
    expect(r.completionEvent).toContain("quiz");
  });

  it("phase not in config → not deliverable", () => {
    const cl = new EventClassifier({ deliverablePhases: new Set(["text_completion"]) });
    const r = cl.classify(deliverableNext("quiz", "Hello, this is the answer."), "");
    expect(r.terminal).not.toBe(ChatEventTerminal.DeliverableComplete);
  });

  it("streaming chunk → Continue", () => {
    const cl = triarchClassifier();
    const r = cl.classify(streamingChunkNext("partial"), "");
    expect(r.terminal).toBe(ChatEventTerminal.Continue);
    expect(r.content).toBe("partial");
  });

  it("substantive-reply guard (stub ACK not deliverable)", () => {
    const cl = triarchClassifier();
    const r = cl.classify(deliverableNext("quiz", "..."), "");
    expect(r.terminal).not.toBe(ChatEventTerminal.DeliverableComplete);
  });

  it("error envelope → FailedComplete", () => {
    const cl = triarchClassifier();
    const r = cl.classify({ type: "error", error: { code: -32603, message: "boom" } }, "");
    expect(r.terminal).toBe(ChatEventTerminal.FailedComplete);
    expect(r.err?.message).toContain("boom");
  });
});

// ---------------------------------------------------------------------------
// QueryGate
// ---------------------------------------------------------------------------

describe("QueryGate", () => {
  it("single-flight (ErrQueryBusy)", () => {
    const g = new QueryGate();
    const ac = new AbortController();
    g.acquire("s1", ac, null);
    expect(() => g.acquire("s1", new AbortController(), null)).toThrow(ErrQueryBusy);
    g.release("s1");
    // After release, acquire should succeed again.
    g.acquire("s1", ac, null);
    g.release("s1");
  });

  it("cancel ordering: daemon cancel before local abort", async () => {
    const g = new QueryGate();
    const localAC = new AbortController();
    let localAborted = false;
    localAC.signal.addEventListener("abort", () => {
      localAborted = true;
    });

    let daemonCancelCalled = false;
    const sendCancel = async () => {
      daemonCancelCalled = true;
      // Verify local abort has NOT happened yet (daemon cancel first).
      expect(localAborted).toBe(false);
    };
    g.acquire("s1", localAC, sendCancel);
    await g.cancel("s1");
    expect(daemonCancelCalled).toBe(true);
    expect(localAborted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ConnectionPool
// ---------------------------------------------------------------------------

function newTestPool(store: MemStore, fake: FakeClient): ConnectionPool {
  const pool = new ConnectionPool(
    "ws://localhost:0",
    store,
    {
      poolSize: 4,
      queryTimeout: 5_000,
      connectionTimeout: 1000,
      maxIdleTime: 1000,
      healthCheckInterval: 1000,
    },
    null,
    () => fake as unknown as ManagedClient,
  );
  pool.withBootstrap(async () => "loop-fresh");
  return pool;
}

describe("ConnectionPool", () => {
  it("bootstrap new session", async () => {
    const store = new MemStore();
    const fake = new FakeClient();
    const pool = newTestPool(store, fake);
    const conn = await pool.acquire("s1", "ws-1", "user-1");
    expect(conn.getLoopID()).toBe("loop-fresh");
    const entry = await store.getSession("s1");
    expect(entry?.loopID).toBe("loop-fresh");
    await pool.release("s1");
  });

  it("reuse active connection", async () => {
    const store = new MemStore();
    const fake = new FakeClient();
    const pool = newTestPool(store, fake);
    const conn1 = await pool.acquire("s1", "ws-1", "user-1");
    const conn2 = await pool.acquire("s1", "ws-1", "user-1");
    expect(conn2).toBe(conn1);
    await pool.release("s1");
  });

  it("pool exhausted when empty", async () => {
    const store = new MemStore();
    const fake = new FakeClient();
    const pool = new ConnectionPool(
      "ws://localhost:0",
      store,
      {
        poolSize: 1,
        queryTimeout: 5_000,
        connectionTimeout: 1000,
        maxIdleTime: 1000,
        healthCheckInterval: 1000,
      },
      null,
      () => fake as unknown as ManagedClient,
    );
    pool.withBootstrap(async () => "loop-a");
    const conn = await pool.acquire("s1", "ws-1", "user-1");
    await expect(pool.acquire("s2", "ws-1", "user-1")).rejects.toBeInstanceOf(ErrPoolExhausted);
    await pool.release("s1");
    void conn;
  });
});

// ---------------------------------------------------------------------------
// TurnRunner (end-to-end scripted)
// ---------------------------------------------------------------------------

describe("TurnRunner", () => {
  it("deliverable turn end-to-end", async () => {
    const store = new MemStore();
    const deliverable = deliverableNext("text_completion", "This is a substantive final answer.");
    const fake = new FakeClient([deliverable]);
    const pool = newTestPool(store, fake);
    const gate = new QueryGate();
    const cl = triarchClassifier();
    const b = new SSEBroadcaster();
    const tr = new TurnRunner(pool, gate, cl, store, b, { queryTimeout: 2_000 });
    const { iterable } = b.subscribe("s1");
    const reader = iterable[Symbol.asyncIterator]();

    const opts: InputOpts = { intentHint: INTENT_HINT_TEXT_COMPLETION };
    await tr.execute("s1", "what is 2+2", "user-1", "ws-1", null, opts);

    // Expect a complete SSE event with the deliverable content.
    const ev = await reader.next();
    expect(ev.value?.type).toBe("complete");
    // And the assistant reply persisted.
    const msgs = store.messages("s1");
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs[0].role).toBe("assistant");
    // And loop_input was sent with the intent hint.
    expect(fake.sendCapture.length).toBeGreaterThan(0);
    const sent = fake.sendCapture[0];
    expect(sent.type).toBe("loop_input");
    expect(sent.intent_hint).toBe(INTENT_HINT_TEXT_COMPLETION);
  });

  it("timeout when no deliverable arrives", async () => {
    const store = new MemStore();
    const fake = new FakeClient([]); // no events that complete
    const pool = newTestPool(store, fake);
    const gate = new QueryGate();
    const cl = triarchClassifier();
    const tr = new TurnRunner(pool, gate, cl, store, new SSEBroadcaster(), {
      queryTimeout: 100,
    });
    await expect(tr.execute("s1", "stalled", "user-1", "ws-1", null, null)).rejects.toBeInstanceOf(
      ErrQueryTimeout,
    );
    const msgs = store.messages("s1");
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs[0].role).toBe("error");
  });

  it("idle timeout fails when silent", async () => {
    const store = new MemStore();
    const fake = new FakeClient([streamingChunkNext("partial content here")]);
    const pool = newTestPool(store, fake);
    const tr = new TurnRunner(pool, new QueryGate(), triarchClassifier(), store, null, {
      queryTimeout: 5_000,
      idleTimeout: 40,
    });
    await expect(tr.execute("s1", "idle", "user-1", "ws-1", null, null)).rejects.toBeInstanceOf(
      ErrIdleTimeout,
    );
  });

  it("idle soft-complete persists accumulated content", async () => {
    const store = new MemStore();
    const fake = new FakeClient([streamingChunkNext("This is substantive soft-complete text.")]);
    const pool = newTestPool(store, fake);
    const tr = new TurnRunner(pool, new QueryGate(), triarchClassifier(), store, null, {
      queryTimeout: 5_000,
      idleTimeout: 40,
      onIdleTimeout: TimeoutPolicy.SoftComplete,
    });
    await tr.execute("s1", "idle-soft", "user-1", "ws-1", null, null);
    const msgs = store.messages("s1");
    expect(msgs.some(m => m.role === "assistant")).toBe(true);
    expect(msgs.find(m => m.role === "assistant")?.metadata?.completion_event).toBe("idle_timeout");
  });

  it("stream-close soft-complete", async () => {
    const store = new MemStore();
    const fake = new FakeClient([streamingChunkNext("Closed stream soft complete content.")]);
    fake.endAfterScript = true;
    const pool = newTestPool(store, fake);
    const tr = new TurnRunner(pool, new QueryGate(), triarchClassifier(), store, null, {
      queryTimeout: 5_000,
      onStreamClose: TimeoutPolicy.SoftComplete,
    });
    await tr.execute("s1", "close-soft", "user-1", "ws-1", null, null);
    expect(store.messages("s1").some(m => m.role === "assistant")).toBe(true);
  });

  it("idleTimeoutForTurn applies attachment floor", () => {
    expect(
      idleTimeoutForTurn(
        { queryTimeout: 1000, idleTimeout: 20, minIdleTimeoutWithAttachments: 70 },
        true,
      ),
    ).toBe(70);
    expect(
      idleTimeoutForTurn(
        { queryTimeout: 1000, idleTimeout: 30, minIdleTimeoutWithAttachments: 90 },
        false,
      ),
    ).toBe(30);
  });
});

describe("EventClassifier status idle", () => {
  it("opt-in status idle after content → DeliverableComplete", () => {
    const cl = new EventClassifier({
      deliverablePhases: DEFAULT_DELIVERABLE_PHASES,
      treatStatusIdleAsComplete: true,
      minDeliverableRunes: 8,
    });
    const r = cl.classify(
      { type: "status", state: "idle", loop_id: "loop-1" },
      "This is a substantive assistant reply.",
    );
    expect(r.terminal).toBe(ChatEventTerminal.DeliverableComplete);
    expect(r.completionEvent).toBe("status.idle");
  });

  it("status idle with no content is ignored even when opt-in", () => {
    const cl = new EventClassifier({
      deliverablePhases: DEFAULT_DELIVERABLE_PHASES,
      treatStatusIdleAsComplete: true,
    });
    const r = cl.classify({ type: "status", state: "idle" }, "");
    expect(r.terminal).toBe(ChatEventTerminal.Continue);
  });

  it("default config must not complete on status idle", () => {
    const cl = triarchClassifier();
    const r = cl.classify(
      { type: "status", state: "idle" },
      "This is a substantive assistant reply.",
    );
    expect(r.terminal).toBe(ChatEventTerminal.Continue);
  });
});

// ---------------------------------------------------------------------------
// inputMessageForLoop helper
// ---------------------------------------------------------------------------

describe("inputMessageForLoop", () => {
  it("builds loop_input with opts", () => {
    const msg = inputMessageForLoop("hi", "loop-1", undefined, {
      intentHint: INTENT_HINT_TEXT_COMPLETION,
      preferredSubagent: "explorer",
    });
    expect(msg.type).toBe("loop_input");
    expect(msg.content).toBe("hi");
    expect(msg.loop_id).toBe("loop-1");
    expect(msg.intent_hint).toBe(INTENT_HINT_TEXT_COMPLETION);
    expect(msg.preferred_subagent).toBe("explorer");
  });

  it("includes attachments", () => {
    const atts: Attachment[] = [{ mime_type: "image/png", data: "BASE64" }];
    const msg = inputMessageForLoop("hi", "loop-1", atts);
    expect(msg.attachments).toEqual(atts);
  });
});

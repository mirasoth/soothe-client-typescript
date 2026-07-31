import { describe, it, expect } from "vitest";
import { Client, CommandClient, DaemonSession, ConnectionPool, bootstrapLoopSession } from "../../src/index.js";
import { INTENT_HINT_TEXT_COMPLETION } from "../../src/intent_hints.js";
import { defaultPoolConfig } from "../../src/appkit/index.js";
import { createTestServer } from "../../test/helpers/ws-server.js";
import type { WebSocket } from "ws";
import type { LoopSessionStore, LoopSessionEntry, SessionMessage } from "../../src/appkit/loop_session_store.js";

function handshakeAndRpc(ws: WebSocket, opts?: { turn?: boolean; jobs?: boolean }) {
  const turn = opts?.turn ?? false;
  let loopN = 0;
  let jobN = 0;
  ws.on("message", raw => {
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(raw.toString()) as Record<string, unknown>;
    } catch {
      return;
    }
    const typ = String(m.type ?? "");
    const method = String(m.method ?? "");
    const id = m.id;
    const params = (m.params as Record<string, unknown>) ?? {};
    if (typ === "connection_init") {
      ws.send(JSON.stringify({ proto: "1", type: "status", state: "idle" }));
      ws.send(
        JSON.stringify({
          proto: "1",
          type: "connection_ack",
          result: {
            protocol_version: "1",
            readiness_state: "ready",
            capabilities: ["streaming", "batch", "heartbeat"],
            heartbeat_interval_ms: 0,
          },
        }),
      );
      return;
    }
    if (typ === "request" && method === "loop_new") {
      loopN += 1;
      ws.send(
        JSON.stringify({
          proto: "1",
          type: "response",
          id,
          result: { loop_id: `loop-${loopN}`, success: true },
        }),
      );
      return;
    }
    if (typ === "subscribe" && method === "loop_events") {
      ws.send(
        JSON.stringify({
          proto: "1",
          type: "next",
          id,
          payload: { success: true, loop_id: params.loop_id },
        }),
      );
      return;
    }
    if (typ === "notification" && method === "loop_input" && turn) {
      const lid = params.loop_id;
      const turnId = `${lid}:1`;
      ws.send(
        JSON.stringify({ type: "status", state: "running", loop_id: lid, turn_id: turnId }),
      );
      ws.send(
        JSON.stringify({
          type: "event",
          mode: "messages",
          loop_id: lid,
          turn_id: turnId,
          namespace: [],
          data: [{ type: "ai", content: "hi", phase: "text_completion" }, {}],
        }),
      );
      ws.send(
        JSON.stringify({
          type: "event",
          mode: "custom",
          loop_id: lid,
          turn_id: turnId,
          namespace: [],
          data: { type: "soothe.stream.end", scope: "turn", turn_id: turnId },
        }),
      );
      return;
    }
    if (typ === "request" && method.startsWith("job_")) {
      const result: Record<string, unknown> = { ok: true };
      if (method === "job_create") {
        jobN += 1;
        result.job_id = `job-${jobN}`;
      } else if (typeof params.job_id === "string") {
        result.job_id = params.job_id;
      }
      ws.send(JSON.stringify({ proto: "1", type: "response", id, result }));
      return;
    }
    if (typ === "request") {
      ws.send(JSON.stringify({ proto: "1", type: "response", id, result: { ok: true } }));
    }
  });
}

class MemStore implements LoopSessionStore {
  private loops = new Map<string, string>();
  async getSession(): Promise<LoopSessionEntry | null> {
    return null;
  }
  async createSession(_w: string, sessionID: string, loopID: string): Promise<void> {
    this.loops.set(sessionID, loopID);
  }
  async updateLastUsed(): Promise<void> {}
  async incrementResetCount(): Promise<void> {}
  async getLoopIDForSession(sessionID: string): Promise<{ loopID: string; ok: boolean }> {
    const loopID = this.loops.get(sessionID) ?? "";
    return { loopID, ok: Boolean(loopID) };
  }
  async appendMessage(_s: string, _m: SessionMessage): Promise<void> {}
}

describe("progressive examples", () => {
  it("01_hello: connect + bootstrap", async () => {
    const { url, close } = createTestServer(ws => handshakeAndRpc(ws));
    try {
      const client = new Client(url);
      await client.connect();
      const loopId = await bootstrapLoopSession(client, null);
      expect(loopId).toMatch(/^loop-/);
      client.close();
    } finally {
      await close();
    }
  });

  it("02_stream_turn: DaemonSession chunks", async () => {
    const { url, close } = createTestServer(ws => handshakeAndRpc(ws, { turn: true }));
    try {
      const session = new DaemonSession(url, { postIdleDrainDeadlineMs: 20 });
      await session.connect();
      await session.sendTurn("hello", { intentHint: INTENT_HINT_TEXT_COMPLETION });
      let n = 0;
      for await (const _chunk of session.iterTurnChunks({ maxWaitMs: 5_000 })) {
        n += 1;
      }
      expect(n).toBeGreaterThan(0);
      await session.close();
    } finally {
      await close();
    }
  });

  it("03_text_completion: intent hint", async () => {
    const { url, close } = createTestServer(ws => handshakeAndRpc(ws));
    try {
      const session = new DaemonSession(url);
      await session.connect();
      await session.sendTurn("one word", { intentHint: INTENT_HINT_TEXT_COMPLETION });
      await session.close();
    } finally {
      await close();
    }
  });

  it("04_multi_turn: same loop", async () => {
    const { url, close } = createTestServer(ws => handshakeAndRpc(ws));
    try {
      const session = new DaemonSession(url);
      await session.connect();
      const loop = session.activeLoopId;
      await session.sendTurn("first", { intentHint: INTENT_HINT_TEXT_COMPLETION });
      await session.sendTurn("second", { intentHint: INTENT_HINT_TEXT_COMPLETION });
      expect(session.activeLoopId).toBe(loop);
      await session.close();
    } finally {
      await close();
    }
  });

  it("05_pool_service: ConnectionPool stats", () => {
    const pool = new ConnectionPool("ws://127.0.0.1:9", new MemStore(), {
      ...defaultPoolConfig(),
      poolSize: 2,
    });
    const stats = pool.stats();
    expect(stats.idle).toBe(2);
    expect(stats.active).toBe(0);
  });

  it("06_jobs: CommandClient", async () => {
    const { url, close } = createTestServer(ws => handshakeAndRpc(ws, { jobs: true }));
    try {
      const cc = new CommandClient(url, { timeoutMs: 5_000 });
      const created = await cc.jobCreate("list files");
      expect(created.job_id).toMatch(/^job-/);
      await cc.jobStatus(String(created.job_id));
      await cc.jobCancel(String(created.job_id));
    } finally {
      await close();
    }
  });
});

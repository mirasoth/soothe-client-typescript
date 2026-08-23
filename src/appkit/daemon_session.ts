/**
 * Dual-socket daemon loop session with turn streaming (Python DaemonSession parity).
 *
 * Owns a subscribed stream WebSocket plus an RPC sidecar so metadata calls do not
 * starve loop events. `iterTurnChunks` handles idle timeout, post-idle drain,
 * loop scoping, and connection-loss detection.
 */

import { Client } from "../client.js";
import { defaultConfig, type Config } from "../config.js";
import { StaleLoopError } from "../errors.js";
import { bootstrapLoopSession, connectWithRetries } from "../session.js";
import { STREAM_END, isTurnEndCustomData, isTurnProgressChunk } from "../stream_terminal.js";
import {
  frameTurnId,
  isIdleTerminalAllowed,
  isTurnTerminalAllowed,
  parseTurnGeneration,
  turnIdsMatch,
} from "../turn_boundary.js";
import { shouldDropStreamChunkEarly } from "./chunk_filter.js";
import { unwrapNext } from "./events.js";
import { TurnEventStats } from "./observability.js";

export const DEFAULT_POST_IDLE_DRAIN_MS = 500;

export type EarlyDropFn = (namespace: unknown[], mode: string, data: unknown) => boolean;
export type StatsFactory = () => TurnEventStats;
export type StreamDeliveryResolver = () => string;

export interface DaemonSessionOptions {
  workspace?: string | null;
  streamDelivery?: string | StreamDeliveryResolver;
  postIdleDrainDeadlineMs?: number;
  earlyDropFn?: EarlyDropFn | null;
  statsFactory?: StatsFactory | null;
  config?: Config;
}

export type TurnChunk = [namespace: unknown[], mode: string, data: unknown];

/** Daemon-backed loop session with stream + RPC sockets. */
export class DaemonSession {
  private wsUrl: string;
  private workspace: string | null | undefined;
  private streamDelivery: string | StreamDeliveryResolver;
  private client: Client;
  private rpcClient: Client;
  private loopId: string | null = null;
  private readBusy = false;
  private rpcBusy = false;
  private rpcConnected = false;
  private streaming = false;
  private postIdleDrainDeadlineMs: number;
  private closed = false;
  private earlyDropFn: EarlyDropFn;
  private statsFactory: StatsFactory;
  private config: Config;

  turnEventStats: TurnEventStats;
  lastTurnEndState: string | null = null;
  lastTurnCancellationSeen = false;
  lastTurnErrorMessage: string | null = null;

  constructor(wsUrl: string, opts: DaemonSessionOptions = {}) {
    this.wsUrl = wsUrl;
    this.workspace = opts.workspace;
    this.streamDelivery = opts.streamDelivery ?? "adaptive";
    this.config = opts.config ?? defaultConfig();
    this.client = new Client(wsUrl, this.config);
    this.rpcClient = new Client(wsUrl, this.config);
    this.postIdleDrainDeadlineMs =
      opts.postIdleDrainDeadlineMs && opts.postIdleDrainDeadlineMs > 0
        ? opts.postIdleDrainDeadlineMs
        : DEFAULT_POST_IDLE_DRAIN_MS;
    this.earlyDropFn = opts.earlyDropFn ?? shouldDropStreamChunkEarly;
    this.statsFactory = opts.statsFactory ?? (() => new TurnEventStats());
    this.turnEventStats = this.statsFactory();
  }

  get streamClient(): Client {
    return this.client;
  }

  get rpcSideClient(): Client {
    return this.rpcClient;
  }

  get activeLoopId(): string | null {
    return this.loopId;
  }

  private resolveStreamDeliveryMode(): string {
    const delivery = this.streamDelivery;
    if (typeof delivery === "function") return String(delivery() || "adaptive");
    return String(delivery || "adaptive");
  }

  get streamDeliveryMode(): string {
    return this.resolveStreamDeliveryMode();
  }

  private shouldDrop(namespace: unknown[], mode: string, data: unknown): boolean {
    return Boolean(this.earlyDropFn(namespace, mode, data));
  }

  async connect(resumeLoopId?: string | null): Promise<Record<string, unknown>> {
    await connectWithRetries(this.client);
    return this.bootstrapLoop(resumeLoopId ?? null);
  }

  private async bootstrapLoop(resumeLoopId: string | null): Promise<Record<string, unknown>> {
    const loopNew = this.workspace
      ? { client_workspace: this.workspace, workspace: this.workspace }
      : undefined;
    const loopId = await bootstrapLoopSession(this.client, resumeLoopId, this.config, loopNew);
    this.loopId = loopId;
    return { type: "status", loop_id: loopId, state: "ready" };
  }

  async newLoop(): Promise<Record<string, unknown>> {
    return this.bootstrapLoop(null);
  }

  async switchLoop(loopId: string): Promise<Record<string, unknown>> {
    return this.bootstrapLoop(loopId);
  }

  async ensureConnected(): Promise<void> {
    if (this.client.isConnected() && !this.client.isDisconnected()) return;

    let resumeLoopId = this.loopId;
    if (this.rpcConnected) {
      this.rpcClient.close();
      this.rpcConnected = false;
    }

    try {
      await this.client.reconnect();
    } catch {
      this.client.close();
      await connectWithRetries(this.client);
    }

    if (resumeLoopId) {
      try {
        await this.client.reattachAndProbe(resumeLoopId);
        this.loopId = resumeLoopId;
        return;
      } catch (err) {
        if (!(err instanceof StaleLoopError)) throw err;
        resumeLoopId = null;
      }
    }

    await this.bootstrapLoop(resumeLoopId);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.client.close();
    this.rpcClient.close();
    this.rpcConnected = false;
  }

  async detach(): Promise<void> {
    if (!this.client.isConnected()) return;
    try {
      await this.client.notify("disconnect", {});
    } catch {
      // ignore
    }
  }

  async sendTurn(
    text: string,
    options?: {
      preferredSubagent?: string;
      model?: string;
      modelParams?: Record<string, unknown>;
      attachments?: Array<{ mime_type: string; data: string }>;
      clarificationMode?: string;
      clarificationAnswer?: boolean;
      intentHint?: string;
    },
  ): Promise<void> {
    if (!this.loopId) throw new Error("No active loop session");
    await this.client.sendInput(text, {
      loopID: this.loopId,
      subagent: options?.preferredSubagent,
      model: options?.model,
      modelParams: options?.modelParams,
      attachments: options?.attachments,
      clarificationMode: options?.clarificationMode,
      clarificationAnswer: options?.clarificationAnswer,
      intentHint: options?.intentHint as
        import("../intent_hints.js").LoopInputIntentHint | undefined,
    });
  }

  async cancelActiveTurn(): Promise<void> {
    await this.client.notify("slash_command", { cmd: "/cancel" });
  }

  private async *drainStreamEventsAfterIdle(
    expectedLoopId: string | null,
  ): AsyncGenerator<TurnChunk> {
    const deadline = Date.now() + this.postIdleDrainDeadlineMs;
    let exp = expectedLoopId;
    while (Date.now() < deadline) {
      const event = await this.client.readEventWithTimeout(250);
      if (!event) break;
      let frame = event;
      let eventType = String(frame.type ?? "");
      if (eventType === "next") {
        frame = unwrapNext(frame) ?? frame;
        eventType = String(frame.type ?? "");
      }
      const eventLoopId = frame.loop_id;
      if (exp && typeof eventLoopId === "string" && eventLoopId && eventLoopId !== exp) {
        continue;
      }
      if (eventType === "error") {
        const errObj = (frame.error as { message?: string }) ?? {};
        throw new Error(String(errObj.message || frame.message || "daemon error"));
      }
      if (eventType === "status") {
        const loopEv = frame.loop_id;
        if (typeof loopEv === "string" && loopEv) {
          this.loopId = loopEv;
          exp = loopEv;
        }
        continue;
      }
      if (eventType !== "event") continue;
      const data = frame.data;
      const namespace = Array.isArray(frame.namespace) ? (frame.namespace as unknown[]) : [];
      const mode = String(frame.mode ?? "");
      if (this.shouldDrop(namespace, mode, data)) {
        this.turnEventStats.filteredEarly += 1;
        continue;
      }
      this.turnEventStats.postIdleDrained += 1;
      yield [namespace, mode, data];
    }
  }

  private async withRpcLock<T>(fn: () => Promise<T>): Promise<T> {
    while (this.rpcBusy) {
      await new Promise(r => setTimeout(r, 5));
    }
    this.rpcBusy = true;
    try {
      return await fn();
    } finally {
      this.rpcBusy = false;
    }
  }

  private async ensureRpcConnected(): Promise<void> {
    if (this.rpcConnected && this.rpcClient.isConnected()) return;
    await connectWithRetries(this.rpcClient);
    this.rpcConnected = true;
  }

  async listLoops(_limit = 20): Promise<Record<string, unknown>> {
    return this.withRpcLock(async () => {
      await this.ensureRpcConnected();
      return this.rpcClient.listLoops(15_000);
    });
  }

  async fetchLoopHistory(loopId: string): Promise<{
    goals: unknown[];
    liveCards: unknown[];
    liveGoalIndex: number | null;
    contextTokens: number;
    success: boolean;
  }> {
    const lid = String(loopId || "").trim();
    if (!lid) {
      return { goals: [], liveCards: [], liveGoalIndex: null, contextTokens: 0, success: false };
    }
    return this.withRpcLock(async () => {
      await this.ensureRpcConnected();
      try {
        const resp = await this.rpcClient.fetchLoopHistory(lid, 30_000);
        const liveGoalIndex = resp.live_goal_index;
        return {
          goals: Array.isArray(resp.goals) ? resp.goals : [],
          liveCards: Array.isArray(resp.live_cards) ? resp.live_cards : [],
          liveGoalIndex: typeof liveGoalIndex === "number" ? liveGoalIndex : null,
          contextTokens:
            typeof resp.context_tokens === "number" && resp.context_tokens >= 0
              ? resp.context_tokens
              : 0,
          success: Boolean(resp.success ?? true),
        };
      } catch {
        return {
          goals: [],
          liveCards: [],
          liveGoalIndex: null,
          contextTokens: 0,
          success: false,
        };
      }
    });
  }

  async fetchConversationLog(
    loopId: string,
    opts: { limit?: number; offset?: number; includeEvents?: boolean } = {},
  ): Promise<Record<string, unknown>[]> {
    const lid = String(loopId || "").trim();
    if (!lid) return [];
    return this.withRpcLock(async () => {
      await this.ensureRpcConnected();
      const resp = await this.rpcClient.getLoopMessages(
        lid,
        opts.limit ?? 100,
        opts.offset ?? 0,
        opts.includeEvents ?? false,
      );
      const raw = resp.messages;
      if (!Array.isArray(raw)) return [];
      return raw.filter((m): m is Record<string, unknown> => !!m && typeof m === "object");
    });
  }

  async *iterTurnChunks(opts: { maxWaitMs?: number } = {}): AsyncGenerator<TurnChunk> {
    this.turnEventStats = this.statsFactory();
    this.lastTurnEndState = null;
    this.lastTurnCancellationSeen = false;
    this.lastTurnErrorMessage = null;

    let queryStarted = false;
    let expectedLoopId = this.loopId;
    let expectedTurnId: string | null = null;
    let turnProgressSeen = false;
    this.streaming = true;
    const absoluteDeadline =
      opts.maxWaitMs !== undefined && opts.maxWaitMs > 0 ? Date.now() + opts.maxWaitMs : null;

    this.client.peelStalePendingControlEvents();

    while (this.readBusy) {
      await new Promise(r => setTimeout(r, 5));
    }
    this.readBusy = true;
    try {
      while (true) {
        if (absoluteDeadline !== null && Date.now() >= absoluteDeadline) {
          throw new Error(
            `Turn timed out after ${opts.maxWaitMs}ms (loop=${expectedLoopId ?? "?"})`,
          );
        }
        const event = await this.client.readEvent();
        if (!event) {
          if (queryStarted && !this.client.isConnectionAlive()) {
            this.lastTurnEndState = "connection_lost";
            throw new Error("Daemon connection lost");
          }
          break;
        }

        let frame: Record<string, unknown> = event;
        let eventType = String(frame.type ?? "");
        if (eventType === "next") {
          frame = unwrapNext(frame) ?? frame;
          eventType = String(frame.type ?? "");
        }

        const eventLoopId = frame.loop_id;
        if (
          expectedLoopId &&
          typeof eventLoopId === "string" &&
          eventLoopId &&
          eventLoopId !== expectedLoopId
        ) {
          continue;
        }

        const evTurnId = frameTurnId(frame);
        const statusState = eventType === "status" ? String(frame.state ?? "") : "";
        const isRunningStatus = statusState === "running";
        const isTerminalStatus = statusState === "idle" || statusState === "stopped";
        if (
          expectedTurnId &&
          (eventType === "event" || eventType === "status") &&
          !isRunningStatus
        ) {
          if (isTerminalStatus) {
            if (evTurnId && !turnIdsMatch(expectedTurnId, evTurnId)) continue;
          } else if (!turnIdsMatch(expectedTurnId, evTurnId)) {
            continue;
          }
        }

        if (eventType === "error") {
          const errObj = (frame.error as { message?: string }) ?? {};
          throw new Error(String(errObj.message || frame.message || "daemon error"));
        }

        if (eventType === "status") {
          const loopEv = frame.loop_id;
          if (typeof loopEv === "string" && loopEv) {
            this.loopId = loopEv;
            expectedLoopId = loopEv;
          }
          if (statusState === "running") {
            queryStarted = true;
            const statusTurn = frameTurnId(frame);
            if (statusTurn) {
              const newGen = parseTurnGeneration(statusTurn);
              const oldGen = parseTurnGeneration(expectedTurnId);
              if (
                expectedTurnId === null ||
                (newGen !== null && (oldGen === null || newGen >= oldGen))
              ) {
                if (expectedTurnId && statusTurn !== expectedTurnId) {
                  turnProgressSeen = false;
                }
                expectedTurnId = statusTurn;
              }
            }
          } else if (queryStarted && statusState === "stopped") {
            const stopTurn = frameTurnId(frame);
            if (expectedTurnId && !turnIdsMatch(expectedTurnId, stopTurn)) continue;
            this.lastTurnEndState = statusState;
            yield* this.drainStreamEventsAfterIdle(expectedLoopId);
            break;
          } else if (queryStarted && statusState === "idle") {
            const idleTurn = frameTurnId(frame);
            if (
              !isIdleTerminalAllowed({
                expectedTurnId,
                frameTurnId: idleTurn,
                queryStarted,
                turnProgressSeen,
                cancellationSeen: this.lastTurnCancellationSeen,
              })
            ) {
              continue;
            }
            this.lastTurnEndState = statusState;
            yield* this.drainStreamEventsAfterIdle(expectedLoopId);
            break;
          }
          continue;
        }

        if (eventType === "command_response") {
          const content = String(frame.content ?? "");
          if (content.includes("Cancellation requested")) {
            this.lastTurnCancellationSeen = true;
          }
          continue;
        }

        if (eventType !== "event") continue;

        const data = frame.data;
        const namespace = Array.isArray(frame.namespace) ? (frame.namespace as unknown[]) : [];
        const mode = String(frame.mode ?? "");
        if (this.shouldDrop(namespace, mode, data)) {
          this.turnEventStats.filteredEarly += 1;
          continue;
        }

        if (mode === "custom" && isTurnEndCustomData(data)) {
          const dataTurn = frameTurnId(data as Record<string, unknown> | null) || evTurnId;
          if (
            !isTurnTerminalAllowed({
              expectedTurnId,
              frameTurnId: dataTurn,
              queryStarted,
              turnProgressSeen,
            })
          ) {
            continue;
          }
        }

        if (isTurnProgressChunk(mode, data)) turnProgressSeen = true;
        yield [namespace, mode, data];

        if (mode === "custom" && isTurnEndCustomData(data)) {
          const customType = String((data as Record<string, unknown>).type ?? "").trim();
          this.lastTurnEndState = customType === STREAM_END ? "stream_end" : "completed";
          yield* this.drainStreamEventsAfterIdle(expectedLoopId);
          break;
        }
      }
    } catch (exc) {
      this.lastTurnErrorMessage = String(exc);
      throw exc;
    } finally {
      this.streaming = false;
      this.readBusy = false;
    }
  }
}

/**
 * Turn runner for appkit.
 *
 * Executes one query turn end-to-end: acquire a pooled connection, enforce
 * single-flight, send loop_input, consume the event stream, persist/broadcast.
 *
 * Turn end is owned by TurnBoundary (DaemonSession.iterTurnChunks contract).
 * EventClassifier selects content and may early-complete on deliverable phases.
 */

import type { PooledConn } from "./pool.js";
import { type ConnectionPool } from "./pool.js";
import { type EventClassifier, ChatEventTerminal } from "./classifier.js";
import { type QueryGate } from "./query_gate.js";
import { type SSEBroadcaster, SSEEvent } from "./broadcaster.js";
import type { LoopSessionStore, SessionMessage } from "./loop_session_store.js";
import type { LoopInputIntentHint } from "../intent_hints.js";
import type { DecodedMessage } from "../protocol.js";
import { compactAttachments, type CompactImageOptions } from "./attachments.js";
import { TurnBoundary, isDaemonTurnEndEvent } from "./turn_boundary.js";

/** Returned when a turn exceeds the configured timeout and policy is Fail. */
export class ErrQueryTimeout extends Error {
  constructor() {
    super("appkit: query timeout");
    this.name = "ErrQueryTimeout";
  }
}

/** Returned when no events arrive within IdleTimeout and policy is Fail. */
export class ErrIdleTimeout extends Error {
  constructor() {
    super("appkit: idle timeout");
    this.name = "ErrIdleTimeout";
  }
}

/** Selects fail vs soft-complete behaviour for idle, query, and stream-close. */
export enum TimeoutPolicy {
  Fail = 0,
  SoftComplete = 1,
}

export type StreamClosePolicy = TimeoutPolicy;
export const StreamCloseFail = TimeoutPolicy.Fail;
export const StreamCloseSoftComplete = TimeoutPolicy.SoftComplete;

/** Configures a TurnRunner. */
export interface TurnConfig {
  /** Per-turn deadline in ms. Defaults to 30m. */
  queryTimeout: number;
  /** Max silence between classified events in ms. Zero disables (default). */
  idleTimeout?: number;
  /**
   * When > 0, raises idleTimeout for turns with attachments if idleTimeout
   * is positive but below this floor.
   */
  minIdleTimeoutWithAttachments?: number;
  /** Fail vs soft-complete when the idle watchdog fires. Default Fail. */
  onIdleTimeout?: TimeoutPolicy;
  /** Fail vs soft-complete when queryTimeout fires. Default Fail. */
  onQueryTimeout?: TimeoutPolicy;
  /** Fail vs soft-complete when the event stream closes. Default Fail. */
  onStreamClose?: StreamClosePolicy;
  /** Run compactAttachments before buildInput. Default false. */
  compactAttachmentsBeforeSend?: boolean;
  /** Overrides for compactAttachmentsBeforeSend. */
  compactImageOpts?: CompactImageOptions | null;
}

/** Carries optional daemon hints on a loop_input payload. */
export interface InputOpts {
  intentHint?: LoopInputIntentHint;
  preferredSubagent?: string;
  intakeScope?: "trivial" | "simple" | "complex";
  responseSchema?: Record<string, unknown>;
  responseSchemaName?: string;
  responseSchemaStrict?: boolean;
  interactionMode?: "agent" | "ask";
}

/** Optional attachment shape ({mime_type, data(base64)}). */
export type Attachment = Record<string, unknown>;

/**
 * Builds a loop_input payload with optional attachments. Apps build this from
 * their product modes (e.g. triarch's ask/agent/deep-research).
 */
export function inputMessageForLoop(
  text: string,
  loopID: string,
  attachments?: Attachment[],
  opts?: InputOpts,
): Record<string, unknown> {
  const msg: Record<string, unknown> = { type: "loop_input", content: text };
  if (loopID) msg.loop_id = loopID;
  if (attachments && attachments.length > 0) msg.attachments = attachments;
  if (opts) {
    if (opts.intentHint?.trim()) {
      msg.intent_hint = opts.intentHint.trim();
    }
    if (opts.preferredSubagent?.trim()) msg.preferred_subagent = opts.preferredSubagent.trim();
    if (opts.intakeScope?.trim()) msg.intake_scope = opts.intakeScope.trim();
    if (opts.responseSchema && Object.keys(opts.responseSchema).length > 0) {
      msg.response_schema = opts.responseSchema;
    }
    if (opts.responseSchemaName?.trim()) msg.response_schema_name = opts.responseSchemaName.trim();
    if (opts.responseSchemaStrict !== undefined)
      msg.response_schema_strict = opts.responseSchemaStrict;
    if (opts.interactionMode) msg.interaction_mode = opts.interactionMode;
  }
  return msg;
}

/** Effective idle timeout for a turn (attachment floor applied). */
export function idleTimeoutForTurn(cfg: TurnConfig, hasAttachments: boolean): number {
  const idle = cfg.idleTimeout ?? 0;
  if (idle <= 0) return 0;
  const floor = cfg.minIdleTimeoutWithAttachments ?? 0;
  if (hasAttachments && floor > 0 && idle < floor) return floor;
  return idle;
}

/** Completion hook signature. */
export type OnComplete = (
  sessionID: string,
  loopID: string,
  content: string,
  completionEvent: string,
  elapsedMs: number,
) => void;
/** Error hook signature. */
export type OnError = (sessionID: string, loopID: string, err: Error) => void;

/**
 * TurnRunner executes one query turn end-to-end.
 */
export class TurnRunner {
  private pool: ConnectionPool;
  private gate: QueryGate;
  private classifier: EventClassifier;
  private store: LoopSessionStore;
  private broadcaster: SSEBroadcaster | null;
  private cfg: TurnConfig;
  private buildInput: typeof inputMessageForLoop = inputMessageForLoop;
  private onComplete: OnComplete | null = null;
  private onError: OnError | null = null;

  constructor(
    pool: ConnectionPool,
    gate: QueryGate,
    classifier: EventClassifier,
    store: LoopSessionStore,
    broadcaster: SSEBroadcaster | null,
    cfg: TurnConfig,
  ) {
    this.pool = pool;
    this.gate = gate;
    this.classifier = classifier;
    this.store = store;
    this.broadcaster = broadcaster;
    this.cfg = {
      ...cfg,
      queryTimeout: cfg.queryTimeout > 0 ? cfg.queryTimeout : 30 * 60 * 1000,
    };
  }

  withInputBuilder(f: typeof inputMessageForLoop): TurnRunner {
    if (f) this.buildInput = f;
    return this;
  }

  withOnComplete(f: OnComplete): TurnRunner {
    this.onComplete = f;
    return this;
  }

  withOnError(f: OnError): TurnRunner {
    this.onError = f;
    return this;
  }

  async execute(
    sessionID: string,
    message: string,
    userID: string,
    workspaceID: string,
    attachments: Attachment[] | null,
    opts: InputOpts | null,
    signal?: AbortSignal,
  ): Promise<void> {
    let conn: PooledConn;
    try {
      conn = await this.pool.acquire(sessionID, workspaceID, userID, signal);
    } catch (err) {
      await this.persistFailed(sessionID, "", err as Error);
      this.broadcastError(sessionID, err as Error);
      this.onError?.(sessionID, "", err as Error);
      throw err;
    }
    const loopID = conn.getLoopID();

    const timeoutController = new AbortController();
    const timeoutMs = this.cfg.queryTimeout;
    const timer = setTimeout(() => timeoutController.abort(), timeoutMs);

    const sendCancel = async (detachedSignal: AbortSignal) => {
      await this.sendLoopCancel(detachedSignal, conn, loopID);
    };
    try {
      this.gate.acquire(sessionID, timeoutController, sendCancel);
    } catch (err) {
      clearTimeout(timer);
      await this.pool.release(sessionID);
      await this.persistFailed(sessionID, loopID, err as Error);
      this.broadcastError(sessionID, err as Error);
      this.onError?.(sessionID, loopID, err as Error);
      throw err;
    }

    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const clearIdle = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    };

    try {
      let atts = attachments ?? undefined;
      if (this.cfg.compactAttachmentsBeforeSend && atts && atts.length > 0) {
        atts = await compactAttachments(atts, this.cfg.compactImageOpts);
      }

      const inputMsg = this.buildInput(message, loopID, atts, opts ?? undefined);
      try {
        await conn.client.sendMessage(inputMsg);
      } catch (err) {
        await this.persistFailed(sessionID, loopID, err as Error);
        this.broadcastError(sessionID, err as Error);
        this.onError?.(sessionID, loopID, err as Error);
        throw err;
      }

      const eventStream = conn.eventStream;
      if (!eventStream) {
        const err = new Error(`missing event stream for session ${sessionID} (loop ${loopID})`);
        await this.persistFailed(sessionID, loopID, err);
        this.broadcastError(sessionID, err);
        this.onError?.(sessionID, loopID, err);
        throw err;
      }

      let assistantContent = "";
      const startedAt = Date.now();
      const boundary = new TurnBoundary();
      const idleForTurn = idleTimeoutForTurn(this.cfg, (attachments?.length ?? 0) > 0);

      type RaceTag = "timeout" | "caller" | "idle";
      let idleReject: (() => void) | null = null;

      const armIdle = (): Promise<"idle"> => {
        clearIdle();
        idleReject = null;
        if (idleForTurn <= 0) {
          return new Promise<"idle">(() => {});
        }
        return new Promise<"idle">(resolve => {
          idleReject = () => resolve("idle");
          idleTimer = setTimeout(() => {
            idleReject?.();
          }, idleForTurn);
        });
      };

      let idleRace = armIdle();

      const abortRace = new Promise<RaceTag>(resolve => {
        const onTimeout = () => resolve("timeout");
        timeoutController.signal.addEventListener("abort", onTimeout, { once: true });
        if (signal) {
          const onCaller = () => resolve("caller");
          signal.addEventListener("abort", onCaller, { once: true });
        }
      });

      const iterator = eventStream[Symbol.asyncIterator]();

      while (true) {
        const next = iterator.next();
        const raced = await Promise.race([
          next.then(res => ({ tag: "msg" as const, res })),
          abortRace.then(tag => ({ tag })),
          idleRace.then(tag => ({ tag })),
        ]);

        if ("tag" in raced && raced.tag !== "msg") {
          if (raced.tag === "caller" || signal?.aborted) {
            clearIdle();
            const err = new Error("aborted");
            await this.persistFailed(sessionID, loopID, err);
            this.broadcastError(sessionID, err);
            this.onError?.(sessionID, loopID, err);
            throw err;
          }
          if (raced.tag === "idle") {
            clearIdle();
            await this.sendLoopCancel(new AbortController().signal, conn, loopID).catch(() => {});
            await this.finishTimeout(
              sessionID,
              loopID,
              assistantContent,
              startedAt,
              new ErrIdleTimeout(),
              "idle_timeout",
              this.cfg.onIdleTimeout ?? TimeoutPolicy.Fail,
            );
            return;
          }
          clearIdle();
          await this.sendLoopCancel(new AbortController().signal, conn, loopID).catch(() => {});
          await this.finishTimeout(
            sessionID,
            loopID,
            assistantContent,
            startedAt,
            new ErrQueryTimeout(),
            "query_timeout",
            this.cfg.onQueryTimeout ?? TimeoutPolicy.Fail,
          );
          return;
        }

        const res = (raced as { tag: "msg"; res: IteratorResult<DecodedMessage> }).res;
        if (res.done) {
          clearIdle();
          if (
            (this.cfg.onStreamClose ?? TimeoutPolicy.Fail) === TimeoutPolicy.SoftComplete &&
            assistantContent.trim() !== ""
          ) {
            await this.completeTurn(
              sessionID,
              loopID,
              assistantContent,
              startedAt,
              "stream_closed",
            );
            return;
          }
          const err = new Error("event stream closed");
          await this.persistFailed(sessionID, loopID, err);
          this.broadcastError(sessionID, err);
          this.onError?.(sessionID, loopID, err);
          throw err;
        }

        idleRace = armIdle();
        const msg = res.value;

        const [ended, endReason] = boundary.feed(msg);
        const eventResult = this.classifier.classify(msg, assistantContent);
        if (eventResult.err && eventResult.terminal === ChatEventTerminal.FailedComplete) {
          clearIdle();
          await this.persistFailed(sessionID, loopID, eventResult.err);
          this.broadcastError(sessionID, eventResult.err);
          this.onError?.(sessionID, loopID, eventResult.err);
          throw eventResult.err;
        }

        const step = (eventResult.thinkingStep ?? "").trim();
        if (step) this.broadcastThinkingStep(sessionID, step);

        if (eventResult.content) {
          if (eventResult.content.startsWith(assistantContent)) {
            assistantContent = eventResult.content;
          } else {
            assistantContent += eventResult.content;
          }
        }

        const [final, deliverable] = this.classifier.resolveDeliverableFinalContent(
          eventResult,
          assistantContent,
        );
        if (deliverable && !isDaemonTurnEndEvent(eventResult.completionEvent ?? "")) {
          clearIdle();
          await this.completeTurn(
            sessionID,
            loopID,
            final,
            startedAt,
            eventResult.completionEvent ?? "",
          );
          return;
        }

        if (ended) {
          clearIdle();
          if (this.classifier.isSubstantiveAssistantReply(assistantContent)) {
            await this.completeTurn(
              sessionID,
              loopID,
              assistantContent.trim(),
              startedAt,
              endReason,
            );
            return;
          }
          const err = new Error(`turn ended (${endReason}) with no assistant content`);
          await this.persistFailed(sessionID, loopID, err);
          this.broadcastError(sessionID, err);
          this.onError?.(sessionID, loopID, err);
          throw err;
        }
      }
    } finally {
      clearIdle();
      clearTimeout(timer);
      this.gate.release(sessionID);
    }
  }

  private async finishTimeout(
    sessionID: string,
    loopID: string,
    content: string,
    startedAt: number,
    failErr: Error,
    completionEvent: string,
    policy: TimeoutPolicy,
  ): Promise<void> {
    if (policy === TimeoutPolicy.SoftComplete && content.trim() !== "") {
      await this.completeTurn(sessionID, loopID, content, startedAt, completionEvent);
      return;
    }
    await this.persistFailed(sessionID, loopID, failErr);
    this.broadcastError(sessionID, failErr);
    this.onError?.(sessionID, loopID, failErr);
    throw failErr;
  }

  private async completeTurn(
    sessionID: string,
    loopID: string,
    final: string,
    startedAt: number,
    completionEvent: string,
  ): Promise<void> {
    const elapsedMs = Date.now() - startedAt;
    await this.persistResponse(sessionID, loopID, final, startedAt, completionEvent);
    this.broadcastComplete(sessionID, final);
    this.onComplete?.(sessionID, loopID, final, completionEvent, elapsedMs);
  }

  private async sendLoopCancel(
    _signal: AbortSignal,
    conn: PooledConn,
    loopID: string,
  ): Promise<void> {
    const lid = (loopID ?? "").trim();
    if (!conn || !lid) return;
    const cancelMsg = { type: "command_request", command: "cancel", loop_id: lid };
    await conn.client.sendMessage(cancelMsg);
  }

  private async persistResponse(
    sessionID: string,
    loopID: string,
    content: string,
    startedAt: number,
    completionEvent: string,
  ): Promise<void> {
    const msg: SessionMessage = {
      role: "assistant",
      content,
      metadata: {
        started_at: startedAt,
        completed_at: Date.now(),
        duration_ms: Date.now() - startedAt,
        status: "completed",
        completion_event: completionEvent,
        deliverable: true,
      },
    };
    await this.store.appendMessage(sessionID, msg).catch(() => {});
  }

  private async persistFailed(sessionID: string, _loopID: string, err: Error): Promise<void> {
    const msg: SessionMessage = {
      role: "error",
      content: err.message,
      metadata: { status: "failed", error_message: err.message },
    };
    await this.store.appendMessage(sessionID, msg).catch(() => {});
  }

  private broadcastThinkingStep(sessionID: string, step: string): void {
    if (!this.broadcaster) return;
    this.broadcaster.broadcast(sessionID, { type: "delta", data: step + "\n" } as SSEEvent);
  }

  private broadcastComplete(sessionID: string, content: string): void {
    this.broadcaster?.broadcast(sessionID, { type: "complete", data: content } as SSEEvent);
  }

  private broadcastError(sessionID: string, err: Error): void {
    this.broadcaster?.broadcast(sessionID, { type: "query_error", data: err.message } as SSEEvent);
  }
}

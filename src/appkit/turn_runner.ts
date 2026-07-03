/**
 * Turn runner for appkit (RFC-629 Layer 1).
 *
 * Executes one query turn end-to-end: acquire a pooled connection, enforce
 * single-flight, send loop_input, consume the event stream, classify events,
 * resolve the deliverable, persist the reply, and broadcast completion.
 *
 * The app-agnostic successor to triarch's ExecuteQuery.
 */

import type { PooledConn } from "./pool.js";
import { type ConnectionPool } from "./pool.js";
import { type EventClassifier, ChatEventTerminal } from "./classifier.js";
import { type QueryGate } from "./query_gate.js";
import { type SSEBroadcaster, SSEEvent } from "./broadcaster.js";
import type { SessionStore, SessionMessage } from "./session_store.js";
import type { LoopInputIntentHint } from "../intent_hints.js";
import { validateLoopInputIntentHint } from "../intent_hints.js";
import type { DecodedMessage } from "../protocol.js";

/** Returned when a turn exceeds the configured timeout. */
export class ErrQueryTimeout extends Error {
  constructor() {
    super("appkit: query timeout");
    this.name = "ErrQueryTimeout";
  }
}

/** Configures a TurnRunner. */
export interface TurnConfig {
  /** Per-turn deadline in ms. Defaults to 30m. */
  queryTimeout: number;
}

/** Carries optional daemon hints on a loop_input payload. */
export interface InputOpts {
  intentHint?: LoopInputIntentHint;
  preferredSubagent?: string;
  responseSchema?: Record<string, unknown>;
  responseSchemaName?: string;
  responseSchemaStrict?: boolean;
}

/** Optional attachment shape (IG-327: {mime_type, data(base64)}). */
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
      const hintError = validateLoopInputIntentHint(opts.intentHint);
      if (hintError) {
        throw new Error(hintError);
      }
      msg.intent_hint = opts.intentHint.trim();
    }
    if (opts.preferredSubagent?.trim()) msg.preferred_subagent = opts.preferredSubagent.trim();
    if (opts.responseSchema && Object.keys(opts.responseSchema).length > 0) {
      msg.response_schema = opts.responseSchema;
    }
    if (opts.responseSchemaName?.trim()) msg.response_schema_name = opts.responseSchemaName.trim();
    if (opts.responseSchemaStrict !== undefined)
      msg.response_schema_strict = opts.responseSchemaStrict;
  }
  return msg;
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
  private store: SessionStore;
  private broadcaster: SSEBroadcaster | null;
  private cfg: TurnConfig;
  private buildInput: typeof inputMessageForLoop = inputMessageForLoop;
  private onComplete: OnComplete | null = null;
  private onError: OnError | null = null;

  /**
   * Constructs a TurnRunner. pool, gate, classifier, and store are required;
   * broadcaster may be null.
   */
  constructor(
    pool: ConnectionPool,
    gate: QueryGate,
    classifier: EventClassifier,
    store: SessionStore,
    broadcaster: SSEBroadcaster | null,
    cfg: TurnConfig,
  ) {
    this.pool = pool;
    this.gate = gate;
    this.classifier = classifier;
    this.store = store;
    this.broadcaster = broadcaster;
    this.cfg = { queryTimeout: cfg.queryTimeout > 0 ? cfg.queryTimeout : 30 * 60 * 1000 };
  }

  /** Overrides the loop_input payload builder. */
  withInputBuilder(f: typeof inputMessageForLoop): TurnRunner {
    if (f) this.buildInput = f;
    return this;
  }

  /** Sets a completion hook (runs inline on success). */
  withOnComplete(f: OnComplete): TurnRunner {
    this.onComplete = f;
    return this;
  }

  /** Sets an error hook (runs inline on failure). */
  withOnError(f: OnError): TurnRunner {
    this.onError = f;
    return this;
  }

  /**
   * Runs one query turn. The response is broadcast via the SSE broadcaster and
   * persisted via the SessionStore; it is not returned to the caller (SSE
   * subscribers receive it). Resolves on success; rejects on failure
   * (ErrQueryTimeout, AbortError, or a daemon/processing error).
   */
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

    // Build the daemon-cancel sender for this loop; register with the gate.
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

    try {
      // Send loop_input.
      const inputMsg = this.buildInput(
        message,
        loopID,
        attachments ?? undefined,
        opts ?? undefined,
      );
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

      // A promise that resolves when the per-turn timeout OR the caller's
      // abort signal fires, so the stream-wait loop can race against it
      // instead of blocking forever on a stalled stream.
      const abortRace = new Promise<"timeout" | "caller">(resolve => {
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
        ]);

        if ("tag" in raced && raced.tag !== "msg") {
          if (raced.tag === "caller" || signal?.aborted) {
            const err = new Error("aborted");
            await this.persistFailed(sessionID, loopID, err);
            this.broadcastError(sessionID, err);
            this.onError?.(sessionID, loopID, err);
            throw err;
          }
          // Timeout: tell the daemon to stop, then persist/broadcast.
          await this.sendLoopCancel(new AbortController().signal, conn, loopID).catch(() => {});
          await this.persistFailed(sessionID, loopID, new ErrQueryTimeout());
          this.broadcastError(sessionID, new ErrQueryTimeout());
          this.onError?.(sessionID, loopID, new ErrQueryTimeout());
          throw new ErrQueryTimeout();
        }

        const res = (raced as { tag: "msg"; res: IteratorResult<DecodedMessage> }).res;
        if (res.done) {
          // Stream ended without a deliverable — treat as failure.
          const err = new Error("event stream closed");
          await this.persistFailed(sessionID, loopID, err);
          this.broadcastError(sessionID, err);
          this.onError?.(sessionID, loopID, err);
          throw err;
        }
        const msg = res.value;

        const eventResult = this.classifier.classify(msg, assistantContent);
        if (eventResult.err && eventResult.terminal === ChatEventTerminal.FailedComplete) {
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
        if (deliverable) {
          const elapsedMs = Date.now() - startedAt;
          await this.persistResponse(
            sessionID,
            loopID,
            final,
            startedAt,
            eventResult.completionEvent ?? "",
          );
          this.broadcastComplete(sessionID, final);
          this.onComplete?.(sessionID, loopID, final, eventResult.completionEvent ?? "", elapsedMs);
          return;
        }
      }
    } finally {
      clearTimeout(timer);
      this.gate.release(sessionID);
    }
  }

  /** Asks the daemon to cooperatively stop the loop runner on a detached signal. */
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

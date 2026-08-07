/**
 * Client manages a WebSocket session with the Soothe daemon.
 *
 * After close(), a new Client must be created to reconnect. The connection
 * begins with a bidirectional connection_init/connection_ack handshake; no
 * requests are accepted until the daemon reports readiness_state "ready".
 */

import { EventEmitter } from "node:events";
import WebSocket from "ws";
import type { Config } from "./config.js";
import { defaultConfig } from "./config.js";
import { DaemonError, DisconnectCause, ReconnectError, StaleLoopError } from "./errors.js";
import { Multiplexer } from "./multiplexer.js";
import type { LoopInputIntentHint } from "./intent_hints.js";
import { extractLoopIdFromInbound, inboundNeedsDeliveryAck, stalePendingFrameLabel } from "./stream_terminal.js";
import {
  DEFAULT_INBOUND_MAX_SIZE,
  DROP_PRIORITY_NORMAL,
  inboundFrameDropPriority,
} from "./inbound_priority.js";
import {
  CLIENT_VERSION,
  DEFAULT_CLIENT_CAPABILITIES,
  PROTO_VERSION,
  connectionInitEnvelope,
  decodeMessage,
  disconnectEnvelope,
  newLoopNewMessage,
  newRequestID,
  notificationEnvelope,
  pingEnvelope,
  pongEnvelope,
  requestEnvelope,
  splitWirePayload,
  subscribeEnvelope,
  unsubscribeEnvelope,
  type ConnectionAckEnvelope,
  type DecodedMessage,
  type LoopNewOptions,
  type MethodName,
} from "./protocol.js";

/** Input options for `sendInput` (loop_input). */
export interface InputOptions {
  /** Subscribed StrangeLoop id (required for loop_input). */
  loopID?: string;
  subagent?: string;
  /** Forced StrangeLoop intake scope (trivial|simple|complex). */
  intakeScope?: "trivial" | "simple" | "complex";
  model?: string;
  modelParams?: Record<string, unknown>;
  attachments?: Record<string, unknown>[];
  /** Daemon intent_hint or agent-path pass-through (resume_clarification, skill:foo). */
  intentHint?: LoopInputIntentHint;
  /** JSON Schema for structured output (text_completion or image_to_text). */
  responseSchema?: Record<string, unknown>;
  /** Provider schema name for structured output. */
  responseSchemaName?: string;
  /** Strict mode for JSON schema (default true). */
  responseSchemaStrict?: boolean;
  /** Clarification relay mode ("auto" / "manual"). */
  clarificationMode?: string;
  /** Treat this input as answer to pending clarification interrupt. */
  clarificationAnswer?: boolean;
  /** Per-question answers for multi-question clarifications. */
  clarificationAnswers?: string[];
}

/** Capability set negotiated with the daemon. */
export type NegotiatedCapabilities = ReadonlySet<string>;

export class Client extends EventEmitter {
  private url: string;
  private config: Config;
  private ws: WebSocket | null = null;
  private messageBuffer: DecodedMessage[] = [];
  private inboundMaxSize = DEFAULT_INBOUND_MAX_SIZE;
  private inboundDroppedCount = 0;
  private onStreamDegraded: ((dropped: number, reason: string) => void) | null = null;
  private resolvers: Array<(value: DecodedMessage | null) => void> = [];
 // Protocol-1 handshake state
  private handshakeComplete = false;
  private negotiatedCapabilities: NegotiatedCapabilities = new Set();
  private protocolVersion: string | null = null;
  private readinessState: string | null = null;
  private heartbeatIntervalMs = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private lastPongMonotonic = 0;
 // Mid-session drop signal. The 'disconnected' event is
  // emitted exactly once when the connection drops, carrying a DisconnectCause
  // that distinguishes clean (peer `disconnect`) from unclean (read/write
  // error or missed pong). `disconnFired` guards the once-only delivery.
  private disconnFired = false;
 // Pending-request/subscription multiplexer. Routes
  // inbound frames by (type, id) instead of discarding non-matching events.
  private mux = new Multiplexer();
  private deliveryRecvSeq = new Map<string, number>();
  private deliveryAckedSeq = new Map<string, number>();

  constructor(url: string, config?: Config) {
    super();
    this.url = url;
    this.config = config ?? defaultConfig();
  }

  // ---------------------------------------------------------------------------
  // Connection lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Dials the Soothe daemon WebSocket and completes the protocol-1 handshake
   * (connection_init → connection_ack with readiness_state "ready").
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url, {
        handshakeTimeout: 10_000,
      });

      ws.on("open", () => {
        this.ws = ws;
        // Reset the drop signal and multiplexer for a fresh connection so
        // reconnect() on the same Client starts with a clean slate.
        this.disconnFired = false;
        this._lastCause = null;
        this.mux = new Multiplexer();
        // Kick off the protocol-1 handshake; resolve connect() once ready.
        this._performHandshake()
          .then(ack => {
            this.handshakeComplete = true;
            this.readinessState = ack.result?.readiness_state ?? "ready";
            this._startHeartbeat();
            resolve();
          })
          .catch(err => {
            // Handshake failed — tear down the underlying socket so server
            // close() does not hang on a lingering connection.
            this._stopHeartbeat();
            this.ws = null;
            this.handshakeComplete = false;
            try {
              ws.close(1011, "handshake failed");
            } catch {
              // ignore
            }
            reject(err);
          });
      });

      ws.on("error", err => {
        // A write/read error indicates a broken connection — signal an unclean
        // drop so consumers (e.g. ConnectionPool) can reconnect + reattach.
        // Idempotent if the close handler already fired.
        this._signalDisconnect(DisconnectCause.Unclean);
        if (!this.ws) {
          reject(new Error(`soothe dial: ${err.message}`));
        }
      });

      ws.on("message", (data: WebSocket.RawData) => {
        const text = data.toString();
        for (const frame of splitWirePayload(text)) {
          let msg: DecodedMessage | null;
          try {
            msg = decodeMessage(frame);
          } catch {
            continue;
          }
          if (msg === null) continue;

 // Intercept heartbeat frames.
          const m = msg as Record<string, unknown>;
          if (m.type === "ping") {
            this._sendRaw(pongEnvelope());
            continue;
          }
          if (m.type === "pong") {
            this.lastPongMonotonic = Date.now();
            continue;
          }
          // A `disconnect` notification is a clean peer-initiated drop
 //; loops keep running server-side.
          if (m.type === "disconnect") {
            this._signalDisconnect(DisconnectCause.Clean);
            // Still surface it to listeners (existing behavior) before close.
          }

          // Route solicited frames (response/error/next/complete/receipt with
          // a matching pending multiplexer waiter) to their waiters; do not
 // forward to the resolver queue.
          if (this.mux.route(m)) {
            this._trackInboundDeliveryAck(m);
            continue;
          }

          this._trackInboundDeliveryAck(m);

          // If a reader is waiting, deliver directly; otherwise buffer for
          // later readEvent/receiveMessages calls. Never do both — a single
          // inbound frame must be consumed exactly once.
          const resolver = this.resolvers.shift();
          if (resolver) {
            resolver(msg);
          } else {
            this.enqueueMessageBuffer(msg);
          }
          this.emit("message", msg);
        }
      });

      ws.on("close", () => {
        this.ws = null;
        this._stopHeartbeat();
        this.handshakeComplete = false;
        // Signal an unclean drop (a close without a `disconnect` notification
        // is an abrupt loss). Idempotent if a clean signal already fired.
        this._signalDisconnect(DisconnectCause.Unclean);
        this.emit("close");
        // Resolve any pending readEvent calls with null.
        for (const resolver of this.resolvers) {
          resolver(null);
        }
        this.resolvers = [];
      });
    });
  }

  /** Sends a `disconnect` notification and closes the WebSocket. */
  close(): void {
    this._stopHeartbeat();
    if (!this.ws) return;
    try {
      // Best-effort clean disconnect (daemon keeps loops running).
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(disconnectEnvelope()));
      }
      this.ws.close(1000, "");
    } catch {
      // ignore close errors
    }
    this.ws = null;
    this.handshakeComplete = false;
  }

  /** Returns whether the client has an active, handshaked WebSocket connection. */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN && this.handshakeComplete;
  }

  // ---------------------------------------------------------------------------
 // Mid-session drop signal + reconnect/reattach
  // ---------------------------------------------------------------------------

  /**
   * Returns whether the connection has dropped (the `'disconnected'` event has
   * fired). Pair with the `'disconnected'` event for the signal. Use
   * `disconnectCause()` to read the cause.
   */
  isDisconnected(): boolean {
    return this.disconnFired;
  }

  /**
   * Returns the cause of the most recent drop, or `null` if the connection has
   * not dropped. Clean follows a `disconnect` notification (loops keep running
   * server-side); unclean is a read/write error or missed pong.
   */
  disconnectCause(): DisconnectCause | null {
    if (!this.disconnFired) return null;
    return this._lastCause ?? DisconnectCause.Unclean;
  }

  private _lastCause: DisconnectCause | null = null;

  /**
   * Delivers the disconnect cause exactly once via the `'disconnected'` event.
   * Safe to call from any path; subsequent calls are no-ops. Listeners receive
   * the cause as the event argument.
   */
  private _signalDisconnect(cause: DisconnectCause): void {
    if (this.disconnFired) return;
    this.disconnFired = true;
    this._lastCause = cause;
    // Emit synchronously so a listener wired during the same message-handler
    // tick receives it. Callers that attach a listener after the drop can poll
    // isDisconnected()/disconnectCause() instead — mirroring Go's closed
    // buffered channel, which unblocks late readers immediately.
    try {
      this.emit("disconnected", cause);
    } catch {
      // Listener errors must not propagate into the read loop.
    }
  }

  /**
   * Re-dials the daemon and re-handshakes after a connection drop.
   * Does not re-establish loop subscriptions; follow with
   * `reattachAndProbe()` to resume a loop session. The caller should invoke
   * this after the `'disconnected'` event fires. Reuses the same Client,
   * resetting the drop signal and multiplexer.
   *
   * Performs bounded-retry backoff using the configured reconnect knobs.
   */
  async reconnect(): Promise<void> {
    const maxAttempts = this.config.reconnectMaxAttempts || 10;
    const initialDelay = this.config.reconnectInitialDelay || 500;
    const maxDelay = this.config.reconnectMaxDelay || 10_000;

    let lastErr: Error | null = null;
    let delay = initialDelay;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // connect() resets disconnFired / mux and performs the
        // connection_init/connection_ack handshake with readiness retry.
        await this.connect();
        return;
      } catch (err) {
        lastErr = err as Error;
      }
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, maxDelay);
      }
    }
    throw new ReconnectError(this.url, maxAttempts, lastErr ?? new Error("unknown error"));
  }

  /**
   * Resumes an existing loop after a reconnect: issues `loop_reattach`,
   * re-subscribes to `loop_events`, then runs a `loop_get` liveness probe to
   * detect stale loops that accept the handshake but silently drop input.
   * Returns a `StaleLoopError` when the probe fails; callers should fall back
   * to a fresh `loop_new` bootstrap.
   *
   * Note: connection-level readiness is the handshake's readiness_state
   * (+ daemon_status); loop_get is a loop-scoped probe only, not a readiness
   * probe.
   */
  async reattachAndProbe(loopID: string): Promise<void> {
    if (!loopID || !loopID.trim()) {
      throw new Error("soothe: reattachAndProbe requires a loop id");
    }
    const lid = loopID.trim();

 // 1. loop_reattach: reconstruct event history and replay.
    const reattachTimeout = this.config.loopStatusTimeout || 15_000;
    try {
      await this.requestResponse(
        "loop_reattach" as unknown as MethodName,
        { loop_id: lid },
        "loop_reattach",
        reattachTimeout,
      );
    } catch (err) {
      throw new Error(`loop_reattach: ${(err as Error).message}`);
    }

 // 2. Re-subscribe to the loop event stream (: subscribe +
    //    method:"loop_events"). Confirmation arrives as a `next` frame.
    const subTimeout = this.config.subscriptionTimeout || 10_000;
    try {
      await this.subscribe(
        "loop_events",
        { loop_id: lid, verbosity: this.config.verbosityLevel },
        subTimeout,
      );
    } catch (err) {
      throw new Error(`loop events subscription failed: ${(err as Error).message}`);
    }

 // 3. loop_get liveness probe — side-effect-free read.
    //    A LOOP_NOT_FOUND (-32200) or timeout means the loop is stale: it
    //    accepted the reattach handshake but is not actually live.
    const probeTimeout = this.config.reattachProbeTimeout || 5_000;
    try {
      await this.getLoop(lid, probeTimeout);
    } catch (err) {
      if (err instanceof DaemonError && err.code === -32200) {
        throw new StaleLoopError(lid, err);
      }
      // Timeout or other error during probe → treat as stale.
      throw new StaleLoopError(lid, err as Error);
    }
  }

  // ---------------------------------------------------------------------------
 // Protocol-1 handshake
  // ---------------------------------------------------------------------------

  /** Send connection_init and wait for connection_ack with readiness "ready". */
  private async _performHandshake(): Promise<ConnectionAckEnvelope> {
    const init = connectionInitEnvelope({
      client_version: CLIENT_VERSION,
      client_name: "soothe-client-ts",
      accept_proto: [PROTO_VERSION],
      capabilities: DEFAULT_CLIENT_CAPABILITIES,
    });
    await this.sendMessage(init);

    const deadline = Date.now() + this.config.daemonReadyTimeout;
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const ev = (await this.readEventWithTimeout(remaining)) as Record<string, unknown> | null;
      if (ev === null) {
        throw new Error("connection closed during handshake");
      }
      // Discard the initial `status` frame; keep other frames for later.
      if (ev.type === "status") {
        continue;
      }
      if (ev.type !== "connection_ack") {
        continue;
      }
      const ack = ev as unknown as ConnectionAckEnvelope;
      const result = ack.result ?? {};
      const state = result.readiness_state ?? "ready";
      this.protocolVersion = result.protocol_version ?? PROTO_VERSION;
      this.negotiatedCapabilities = new Set(result.capabilities ?? []);
      this.heartbeatIntervalMs = result.heartbeat_interval_ms ?? 0;

      if (state === "incompatible") {
        throw new Error(`protocol version incompatible: daemon returned ${this.protocolVersion}`);
      }
      if (state === "ready") {
        return ack;
      }
      if (state === "error") {
        throw new Error("daemon startup failed");
      }
      if (state === "degraded") {
        throw new Error("daemon is degraded");
      }
      // starting / warming — bounded retry by re-sending connection_init.
      await this._sleep(50);
      await this.sendMessage(init);
    }
    throw new Error(`timeout after ${this.config.daemonReadyTimeout}ms waiting for connection_ack`);
  }

  // ---------------------------------------------------------------------------
 // Heartbeat
  // ---------------------------------------------------------------------------

  private _startHeartbeat(): void {
    if (!this.negotiatedCapabilities.has("heartbeat")) return;
    const interval = this.heartbeatIntervalMs;
    if (interval <= 0) return;
    this.lastPongMonotonic = Date.now();
    this.heartbeatTimer = setInterval(() => this._heartbeatTick(interval), interval);
  }

  private _stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private _heartbeatTick(intervalMs: number): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const timeoutMs = Math.max(10_000, intervalMs * 2);
    const now = Date.now();
    if (now - (this.lastPongMonotonic || now) > intervalMs + timeoutMs) {
 // Dead connection — signal an unclean drop
      // and force close so consumers can reconnect + reattach.
      this._signalDisconnect(DisconnectCause.Unclean);
      try {
        this.ws.close(1001, "heartbeat timeout");
      } catch {
        // ignore
      }
      return;
    }
    try {
      this.ws.send(JSON.stringify(pingEnvelope()));
    } catch {
      // ignore transient send failures
    }
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ---------------------------------------------------------------------------
  // Core messaging
  // ---------------------------------------------------------------------------

  /** Serializes msg as JSON and sends it as a WebSocket text frame. */
  sendMessage(msg: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("soothe: not connected"));
        return;
      }
      const payload = JSON.stringify(msg);
      this.ws.send(payload, err => {
        if (err) {
          // Write failure indicates a broken connection — signal an unclean
          // drop so consumers can reconnect. Idempotent if the read loop
          // already fired.
          this._signalDisconnect(DisconnectCause.Unclean);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /** Low-level send that does not reject on a missing connection (best-effort). */
  private _sendRaw(msg: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(msg));
    } catch {
      // ignore
    }
  }

  /** Returns an async iterable of decoded messages. Ends when connection closes. */
  async *receiveMessages(signal?: AbortSignal): AsyncGenerator<DecodedMessage> {
    while (true) {
      if (signal?.aborted) return;

      // Drain buffer first.
      while (this.messageBuffer.length > 0) {
        const msg = this.messageBuffer.shift()!;
        yield msg;
      }

      // Wait for next message or close.
      const msg = await new Promise<DecodedMessage | null>(resolve => {
        if (!this.ws) {
          resolve(null);
          return;
        }
        this.resolvers.push(resolve);
      });

      if (msg === null) return;
      yield msg;
    }
  }

  /** Reads a single event from the daemon. Returns null on connection close. */
  async readEvent(): Promise<Record<string, unknown> | null> {
    if (this.messageBuffer.length > 0) {
      const msg = this.messageBuffer.shift()!;
      return msg as Record<string, unknown>;
    }
    if (!this.ws) return null;
    const msg = await new Promise<DecodedMessage | null>(resolve => {
      this.resolvers.push(resolve);
    });
    if (msg === null) return null;
    return msg as Record<string, unknown>;
  }

  /** Reads a single event with a timeout. Returns null on timeout or close. */
  readEventWithTimeout(timeout: number): Promise<Record<string, unknown> | null> {
    if (this.messageBuffer.length > 0) {
      const msg = this.messageBuffer.shift()!;
      return Promise.resolve(msg as Record<string, unknown>);
    }
    if (!this.ws) return Promise.resolve(null);

    return new Promise<Record<string, unknown> | null>(resolve => {
      const timer = setTimeout(() => {
        const idx = this.resolvers.indexOf(resolver);
        if (idx >= 0) this.resolvers.splice(idx, 1);
        resolve(null);
      }, timeout);

      const resolver = (val: DecodedMessage | null) => {
        clearTimeout(timer);
        resolve(val as Record<string, unknown> | null);
      };

      this.resolvers.push(resolver);
    });
  }

  /**
   * Remove stale handshake/terminal frames left in `messageBuffer` before a turn.
   * Returns labels of removed frames (in order).
   */
  peelStalePendingControlEvents(): string[] {
    if (this.messageBuffer.length === 0) return [];
    const kept: DecodedMessage[] = [];
    const removed: string[] = [];
    while (this.messageBuffer.length > 0) {
      const event = this.messageBuffer.shift()! as Record<string, unknown>;
      const label = stalePendingFrameLabel(event);
      if (label !== null) {
        removed.push(label);
        continue;
      }
      kept.push(event as DecodedMessage);
    }
    this.messageBuffer = kept;
    return removed;
  }

  /** True when the underlying socket is still open (may not be handshaked). */
  isConnectionAlive(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /** Override pending buffer cap (tests / tuning). */
  setInboundMaxSize(n: number): void {
    if (n > 0) this.inboundMaxSize = n;
  }

  /** How many NORMAL-priority frames were dropped under backpressure. */
  inboundDropped(): number {
    return this.inboundDroppedCount;
  }

  /** Hook invoked on the first inbound overflow drop. */
  setStreamDegradedCallback(fn: ((dropped: number, reason: string) => void) | null): void {
    this.onStreamDegraded = fn;
  }

  private enqueueMessageBuffer(msg: DecodedMessage): void {
    const max = this.inboundMaxSize > 0 ? this.inboundMaxSize : DEFAULT_INBOUND_MAX_SIZE;
    if (this.messageBuffer.length < max) {
      this.messageBuffer.push(msg);
      return;
    }
    const ev = msg as Record<string, unknown>;
    let dropIdx = -1;
    let dropPri = -1;
    for (let i = 0; i < this.messageBuffer.length; i++) {
      const p = inboundFrameDropPriority(this.messageBuffer[i] as Record<string, unknown>);
      if (p > dropPri) {
        dropPri = p;
        dropIdx = i;
      }
    }
    const incomingPri = inboundFrameDropPriority(ev);
    if (dropIdx >= 0 && dropPri >= DROP_PRIORITY_NORMAL) {
      this.messageBuffer.splice(dropIdx, 1);
      this.messageBuffer.push(msg);
      this.noteInboundDrop();
      return;
    }
    if (incomingPri >= DROP_PRIORITY_NORMAL) {
      this.noteInboundDrop();
      return;
    }
    if (this.messageBuffer.length > 0) {
      this.messageBuffer.shift();
      this.noteInboundDrop();
    }
    this.messageBuffer.push(msg);
  }

  private noteInboundDrop(): void {
    this.inboundDroppedCount += 1;
    if (this.onStreamDegraded && this.inboundDroppedCount === 1) {
      try {
        this.onStreamDegraded(1, "inbound_queue_overflow");
      } catch {
        // ignore callback errors
      }
    }
  }

  // ---------------------------------------------------------------------------
 // Protocol-1 RPC primitives
  // ---------------------------------------------------------------------------

  /**
   * Reads the next frame directly from the live socket (via a resolver),
   * bypassing `messageBuffer`. Used by RPC waits so that stream events
   * previously buffered for `readEvent()`/`receiveMessages()` consumers are
   * not re-cycled through the RPC wait loop (which would stall behind a
   * continuous subscription stream). Non-RPC frames read here are pushed to
   * `messageBuffer` for the stream readers.
   */
  private readLiveEventWithTimeout(timeout: number): Promise<Record<string, unknown> | null> {
    if (!this.ws) return Promise.resolve(null);
    return new Promise<Record<string, unknown> | null>(resolve => {
      const timer = setTimeout(() => {
        const idx = this.resolvers.indexOf(resolver);
        if (idx >= 0) this.resolvers.splice(idx, 1);
        resolve(null);
      }, timeout);

      const resolver = (val: DecodedMessage | null) => {
        clearTimeout(timer);
        resolve(val as Record<string, unknown> | null);
      };

      this.resolvers.push(resolver);
    });
  }

  /**
   * Sends a `request` envelope and waits for the matching `response` (or
 * `error`) correlated by `id`. Returns the `result` object.
   *
 * Multiplexer-aware: registers a pending RPC wait
   * keyed by the request id so that, even when a `receiveMessages()` reader
   * is concurrently active, the matching `response`/`error` is routed to
   * this caller instead of being discarded or buffered behind a stream.
   * Non-matching frames are routed to their own waiters by the multiplexer
   * or flow on to the resolver queue for stream readers.
   */
  async requestResponse(
    method: MethodName,
    params: Record<string, unknown>,
    responseType?: string,
    timeout: number = 15_000,
  ): Promise<Record<string, unknown>> {
    const req = requestEnvelope(method, params);
    const rid = req.id;
    // Register the RPC waiter BEFORE sending so a fast echo response is not
 // routed before the waiter exists.
    const { call, unregister } = this.mux.registerRPC(rid);
    const label = responseType ?? method;
    try {
      await this.sendMessage(req);
      const result = await this._raceRPC(call, timeout, label);
      return result;
    } finally {
      unregister();
    }
  }

  /**
   * Races the multiplexer's RPC promise against a timeout and the connection
   * drop signal. Resolves with the `result` on `response`; rejects with a
   * `DaemonError` on `error`; rejects with a timeout/close error otherwise.
   * The disconnect listener is always removed to avoid accumulating handlers.
   */
  private async _raceRPC(
    call: Promise<Record<string, unknown>>,
    timeout: number,
    label: string,
  ): Promise<Record<string, unknown>> {
    let timer: NodeJS.Timeout | undefined;
    let cleanupDisconnect: () => void = () => {};
    const timeoutP = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`timeout after ${timeout}ms waiting for ${label}`)),
        timeout,
      );
    });
    const closedP = new Promise<never>((_, reject) => {
      if (this.disconnFired) {
        reject(new Error(`connection closed waiting for ${label}`));
        return;
      }
      const onDisconnect = () => {
        reject(new Error(`connection closed waiting for ${label}`));
      };
      this.once("disconnected", onDisconnect);
      cleanupDisconnect = () => this.removeListener("disconnected", onDisconnect);
    });
    try {
      return await Promise.race([call, timeoutP, closedP]);
    } finally {
      if (timer) clearTimeout(timer);
      cleanupDisconnect();
    }
  }

  /**
   * Sends a pre-built envelope (e.g. `unsubscribe`) that carries an `id` and
   * waits for the matching `response`/`error`. Used for envelope types that
   * are not `request` (e.g. `unsubscribe` → `autopilot_unsubscribe`) but still
   * expect a correlated response from the daemon.
   */
  private async _requestResponseForEnvelope(
    env: { id: string; proto?: string; type?: string },
    label: string,
    timeout: number,
  ): Promise<Record<string, unknown>> {
    const rid = env.id;
    const { call, unregister } = this.mux.registerRPC(rid);
    try {
      await this.sendMessage(env);
      return await this._raceRPC(call, timeout, label);
    } finally {
      unregister();
    }
  }

  /** Sends a fire-and-forget `notification` envelope (no response expected). */
  notify(method: MethodName, params: Record<string, unknown>): Promise<void> {
    return this.sendMessage(notificationEnvelope(method, params));
  }

  private _trackInboundDeliveryAck(event: Record<string, unknown>): void {
    if (String(event.type ?? "") === "event_batch") {
      const events = event.events;
      if (Array.isArray(events)) {
        for (const sub of events) {
          if (sub && typeof sub === "object") {
            this._trackInboundDeliveryAck(sub as Record<string, unknown>);
          }
        }
      }
      return;
    }
    if (!inboundNeedsDeliveryAck(event)) return;
    const loopId = extractLoopIdFromInbound(event);
    if (!loopId) return;
    const next = (this.deliveryRecvSeq.get(loopId) ?? 0) + 1;
    this.deliveryRecvSeq.set(loopId, next);
    void this._sendDeliveryAck(loopId, next);
  }

  private async _sendDeliveryAck(loopId: string, seq: number): Promise<void> {
    const acked = this.deliveryAckedSeq.get(loopId) ?? 0;
    if (seq <= acked) return;
    this.deliveryAckedSeq.set(loopId, seq);
    if (!this.isConnected()) return;
    try {
      await this.notify("delivery_ack", { loop_id: loopId, seq });
    } catch {
      // best-effort; daemon drain may retry
    }
  }

  /**
   * Starts a subscription stream. Returns the subscription `id` for later
   * correlation and `unsubscribe()`. Stream events arrive as `next` frames
   * carrying the same `id`.
   */
  async subscribe(
    method: "loop_events" | "autopilot_events",
    params: Record<string, unknown>,
    timeout: number = 5_000,
  ): Promise<string> {
    const req = subscribeEnvelope(method, params);
    const subId = req.id;
    await this.sendMessage(req);

    // Wait briefly for either a subscription-confirmation `next` or an `error`
    // with the matching id. If neither arrives, assume accepted. Read from the
    // live socket so buffered stream events do not stall the confirmation wait.
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const ev = await this.readLiveEventWithTimeout(remaining);
      if (ev === null) break;
      const evId = ev.id as string | undefined;
      if (evId !== subId) {
        this.enqueueMessageBuffer(ev as DecodedMessage);
        continue;
      }
      const typ = ev.type as string;
      if (typ === "error") {
        const errObj = (ev.error as { code?: number; message?: string; data?: unknown }) ?? {};
        throw new DaemonError(
          errObj.code ?? -32603,
          errObj.message ?? "subscription rejected",
          errObj.data,
        );
      }
      if (typ === "next" || typ === "complete") {
        // Subscription confirmed (next) or already complete. Re-buffer for the
        // stream reader so it sees the first event.
        this.messageBuffer.unshift(ev as DecodedMessage);
        break;
      }
    }
    return subId;
  }

  /** Cancels an active subscription by id. */
  unsubscribe(subscriptionId: string): Promise<void> {
    return this.sendMessage(unsubscribeEnvelope(subscriptionId));
  }

  /**
   * Reads the next stream event from a subscription. For `next` frames the
   * `payload` is returned; for `complete`/`error` the full envelope is
   * returned so the caller can inspect termination.
   */
  async next(): Promise<Record<string, unknown> | null> {
    const ev = await this.readEvent();
    if (ev === null) return null;
    if (ev.type === "next") {
      return (ev.payload as Record<string, unknown>) ?? {};
    }
    return ev;
  }

  // ---------------------------------------------------------------------------
 // High-level API methods
  // ---------------------------------------------------------------------------

  /** Sends user input to the daemon (loop_input notification; requires loopID). */
  sendInput(text: string, options?: InputOptions): Promise<void> {
    const loopId = (options?.loopID ?? "").trim();
    if (!loopId) {
      return Promise.reject(new Error("sendInput requires options.loopID"));
    }
    const params: Record<string, unknown> = {
      loop_id: loopId,
      content: text,
    };
    if (options?.subagent) params.preferred_subagent = options.subagent;
    if (options?.intakeScope) params.intake_scope = options.intakeScope;
    if (options?.model) params.model = options.model;
    if (options?.modelParams) params.model_params = options.modelParams;
    if (options?.attachments) params.attachments = options.attachments;
    if (options?.intentHint) {
      params.intent_hint = options.intentHint;
    }
    if (options?.responseSchema) params.response_schema = options.responseSchema;
    if (options?.responseSchemaName) params.response_schema_name = options.responseSchemaName;
    if (options?.responseSchemaStrict !== undefined)
      params.response_schema_strict = options.responseSchemaStrict;
    if (options?.clarificationMode) params.clarification_mode = options.clarificationMode;
    if (options?.clarificationAnswer) params.clarification_answer = true;
    if (options?.clarificationAnswers) params.clarification_answers = options.clarificationAnswers;
    return this.notify("loop_input", params);
  }

  /** Sends a slash command to the daemon (slash_command notification). */
  sendCommand(cmd: string): Promise<void> {
    return this.notify("slash_command", { cmd });
  }

  // ---------------------------------------------------------------------------
 // Loop lifecycle methods
  // ---------------------------------------------------------------------------

  /** Requests the daemon to create a new StrangeLoop and waits for the response. */
  sendLoopNew(opts?: LoopNewOptions | string): Promise<void> {
    return this.sendMessage(newLoopNewMessage(opts));
  }

  /** Subscribes to events for a loop (subscribe → loop_events). */
  async sendLoopSubscribe(
    loopID: string,
    verbosity: string,
    streamDelivery?: "batch" | "adaptive" | "streaming",
  ): Promise<void> {
    await this.subscribe("loop_events", {
      loop_id: loopID,
      verbosity,
      stream_delivery: streamDelivery,
    });
  }

  /** Detaches from a loop (unsubscribe by subscription id). */
  sendLoopDetach(loopID: string): Promise<void> {
    // To preserve the loopID-based signature we send an unsubscribe envelope
    // carrying the loop-derived subscription id.
    return this.sendMessage(unsubscribeEnvelope(loopID));
  }

  /** Notifies the daemon that this client is leaving (disconnect notification). */
  sendDetach(): Promise<void> {
    return this.sendMessage(disconnectEnvelope());
  }

  /** Requests daemon status check. */
  sendDaemonStatus(): Promise<void> {
    return this.sendMessage(requestEnvelope("daemon_status", {}));
  }

  /** Requests daemon shutdown. */
  sendDaemonShutdown(): Promise<void> {
    return this.sendMessage(requestEnvelope("daemon_shutdown", {}));
  }

  /** Requests a config section from the daemon. */
  sendConfigGet(section: string): Promise<void> {
    return this.sendMessage(requestEnvelope("config_get", { section }));
  }

  // ---------------------------------------------------------------------------
  // Convenience RPC methods (blocking request/response)
  // ---------------------------------------------------------------------------

  /** Requests the skills catalog and waits for the response. */
  listSkills(timeout?: number): Promise<Record<string, unknown>> {
    return this.requestResponse("skills_list", {}, "skills_list", timeout ?? 15_000);
  }

  /** Requests the models catalog and waits for the response. */
  listModels(timeout?: number): Promise<Record<string, unknown>> {
    return this.requestResponse("models_list", {}, "models_list", timeout ?? 15_000);
  }

  /** Invokes a skill on the daemon host and receives echo. */
  invokeSkill(skill: string, args?: string, timeout?: number): Promise<Record<string, unknown>> {
    const params: Record<string, unknown> = { skill, args: args ?? "" };
    return this.requestResponse("invoke_skill", params, "invoke_skill", timeout ?? 120_000);
  }

  /** Requests loop list and waits for response. */
  listLoops(timeout?: number, workspace?: string): Promise<Record<string, unknown>> {
    const params: Record<string, unknown> = {};
    if (workspace) params.filter = { workspace };
    return this.requestResponse("loop_list", params, "loop_list", timeout ?? 15_000);
  }

  /** Requests loop details and waits for response. */
  getLoop(loopID: string, timeout?: number): Promise<Record<string, unknown>> {
    return this.requestResponse("loop_get", { loop_id: loopID }, "loop_get", timeout ?? 15_000);
  }

  /** Requests loop tree and waits for response. */
  getLoopTree(loopID: string, timeout?: number): Promise<Record<string, unknown>> {
    return this.requestResponse("loop_tree", { loop_id: loopID }, "loop_tree", timeout ?? 15_000);
  }

  /** Requests loop deletion and waits for response. */
  deleteLoop(loopID: string, timeout?: number): Promise<Record<string, unknown>> {
    return this.requestResponse(
      "loop_delete",
      { loop_id: loopID },
      "loop_delete",
      timeout ?? 15_000,
    );
  }

  /** Requests persisted conversation/activity rows. */
  sendLoopMessages(
    loopID: string,
    limit?: number,
    offset?: number,
    includeEvents?: boolean,
  ): Promise<void> {
    const params: Record<string, unknown> = { loop_id: loopID };
    if (limit !== undefined) params.limit = limit;
    if (offset !== undefined) params.offset = offset;
    if (includeEvents) params.include_events = true;
    return this.sendMessage(requestEnvelope("loop_messages", params));
  }

  /** Requests LangGraph checkpoint channel values. */
  sendLoopStateGet(loopID: string): Promise<void> {
    return this.sendMessage(requestEnvelope("loop_state_get", { loop_id: loopID }));
  }

  /** Applies partial checkpoint values. */
  sendLoopStateUpdate(
    loopID: string,
    values: Record<string, unknown>,
    asNode?: string,
  ): Promise<void> {
    const params: Record<string, unknown> = { loop_id: loopID, values };
    if (asNode) params.as_node = asNode;
    return this.sendMessage(requestEnvelope("loop_state_update", params));
  }

 /** Requests the full loop history. */
  sendLoopHistoryFetch(loopID: string): Promise<void> {
    return this.sendMessage(requestEnvelope("loop_history_fetch", { loop_id: loopID }));
  }

  /** Requests MCP server status. */
  sendMCPStatus(): Promise<void> {
    return this.sendMessage(requestEnvelope("mcp_status", {}));
  }

  /** Requests daemon config reload. */
  sendConfigReload(): Promise<void> {
    return this.sendMessage(requestEnvelope("config_reload", {}));
  }

  /** Submits credentials for daemon-side authentication. */
  sendAuth(accessKey: string, secretKey: string): Promise<void> {
    return this.sendMessage(
      requestEnvelope("auth", { access_key: accessKey, secret_key: secretKey }),
    );
  }

  /** Refreshes the daemon-side auth token. */
  sendAuthRefresh(refreshToken: string): Promise<void> {
    return this.sendMessage(requestEnvelope("auth_refresh", { refresh_token: refreshToken }));
  }

  /** Requests persisted messages and waits for response. */
  getLoopMessages(
    loopID: string,
    limit?: number,
    offset?: number,
    includeEvents?: boolean,
    timeout?: number,
  ): Promise<Record<string, unknown>> {
    const params: Record<string, unknown> = { loop_id: loopID };
    if (limit !== undefined) params.limit = limit;
    if (offset !== undefined) params.offset = offset;
    if (includeEvents) params.include_events = true;
    return this.requestResponse("loop_messages", params, "loop_messages", timeout ?? 15_000);
  }

  /** Requests loop state and waits for response. */
  getLoopState(loopID: string, timeout?: number): Promise<Record<string, unknown>> {
    return this.requestResponse(
      "loop_state_get",
      { loop_id: loopID },
      "loop_state_get",
      timeout ?? 15_000,
    );
  }

  /** Updates loop state and waits for response. */
  updateLoopState(
    loopID: string,
    values: Record<string, unknown>,
    asNode?: string,
    timeout?: number,
  ): Promise<Record<string, unknown>> {
    const params: Record<string, unknown> = { loop_id: loopID, values };
    if (asNode) params.as_node = asNode;
    return this.requestResponse(
      "loop_state_update",
      params,
      "loop_state_update",
      timeout ?? 15_000,
    );
  }

  /** Requests MCP status and waits for response. */
  getMCPStatus(timeout?: number): Promise<Record<string, unknown>> {
    return this.requestResponse("mcp_status", {}, "mcp_status", timeout ?? 15_000);
  }

  /** Requests loop history and waits for response. */
  fetchLoopHistory(loopID: string, timeout?: number): Promise<Record<string, unknown>> {
    return this.requestResponse(
      "loop_history_fetch",
      { loop_id: loopID },
      "loop_history_fetch",
      timeout ?? 15_000,
    );
  }

  /** Requests daemon config reload and waits for response. */
  reloadConfig(timeout?: number): Promise<Record<string, unknown>> {
    return this.requestResponse("config_reload", {}, "config_reload", timeout ?? 15_000);
  }

  /** Submits credentials for daemon-side authentication and waits for response. */
  authenticate(
    accessKey: string,
    secretKey: string,
    timeout?: number,
  ): Promise<Record<string, unknown>> {
    return this.requestResponse(
      "auth",
      { access_key: accessKey, secret_key: secretKey },
      "auth",
      timeout ?? 15_000,
    );
  }

  /** Refreshes the daemon-side auth token and waits for response. */
  refreshAuthToken(refreshToken: string, timeout?: number): Promise<Record<string, unknown>> {
    return this.requestResponse(
      "auth_refresh",
      { refresh_token: refreshToken },
      "auth_refresh",
      timeout ?? 15_000,
    );
  }

  // ---------------------------------------------------------------------------
 // Job IPC methods
  // ---------------------------------------------------------------------------

  /** Creates an autopilot job and waits for the response. */
  createJob(
    goal: string,
    verificationRules?: string,
    workspace?: string,
    timeout?: number,
  ): Promise<Record<string, unknown>> {
    const params: Record<string, unknown> = { goal };
    if (verificationRules) params.verification_rules = verificationRules;
    if (workspace) params.workspace = workspace;
    return this.requestResponse("job_create", params, "job_create", timeout ?? 15_000);
  }

  /** Queries job status and waits for the response. */
  getJobStatus(jobId: string, timeout?: number): Promise<Record<string, unknown>> {
    return this.requestResponse("job_status", { job_id: jobId }, "job_status", timeout ?? 15_000);
  }

  /** Pauses a running job. */
  pauseJob(jobId: string, timeout?: number): Promise<Record<string, unknown>> {
    return this.requestResponse("job_pause", { job_id: jobId }, "job_pause", timeout ?? 15_000);
  }

  /** Resumes a paused job. */
  resumeJob(jobId: string, timeout?: number): Promise<Record<string, unknown>> {
    return this.requestResponse("job_resume", { job_id: jobId }, "job_resume", timeout ?? 15_000);
  }

  /** Cancels a job. */
  cancelJob(jobId: string, timeout?: number): Promise<Record<string, unknown>> {
    return this.requestResponse("job_cancel", { job_id: jobId }, "job_cancel", timeout ?? 15_000);
  }

  /** Requests the DAG visualization for a job. */
  getJobDag(jobId: string, timeout?: number): Promise<Record<string, unknown>> {
    return this.requestResponse("job_dag", { job_id: jobId }, "job_dag", timeout ?? 15_000);
  }

  /** Sends guidance to a job or specific goal. */
  sendJobGuidance(
    jobId: string,
    text: string,
    goalId?: string,
    timeout?: number,
  ): Promise<Record<string, unknown>> {
    const params: Record<string, unknown> = { job_id: jobId, content: text };
    if (goalId) params.goal_id = goalId;
    return this.requestResponse("job_guidance", params, "job_guidance", timeout ?? 30_000);
  }

  // ---------------------------------------------------------------------------
  // Autopilot goal RPCs (protocol-1 request methods)
  // ---------------------------------------------------------------------------

  /** Return autopilot scheduler status (running / dreaming / pool). */
  autopilotStatus(timeout?: number): Promise<Record<string, unknown>> {
    return this.requestResponse("autopilot_status", {}, "autopilot_status", timeout ?? 15_000);
  }

  /** Submit a new autopilot goal (returns goal_id). */
  autopilotSubmit(
    description: string,
    opts?: { priority?: number; workspace?: string; timeout?: number },
  ): Promise<Record<string, unknown>> {
    const params: Record<string, unknown> = {
      description,
      priority: opts?.priority ?? 50,
    };
    if (opts?.workspace) params.workspace = opts.workspace;
    return this.requestResponse(
      "autopilot_submit",
      params,
      "autopilot_submit",
      opts?.timeout ?? 15_000,
    );
  }

  /** List all goals (including non-root children). */
  autopilotListGoals(timeout?: number): Promise<Record<string, unknown>> {
    return this.requestResponse(
      "autopilot_list_goals",
      {},
      "autopilot_list_goals",
      timeout ?? 15_000,
    );
  }

  /** Fetch one goal by id. */
  autopilotGetGoal(goalId: string, timeout?: number): Promise<Record<string, unknown>> {
    return this.requestResponse(
      "autopilot_get_goal",
      { goal_id: goalId },
      "autopilot_get_goal",
      timeout ?? 15_000,
    );
  }

  /** Cancel a goal and its non-terminal descendants. */
  autopilotCancelGoal(goalId: string, timeout?: number): Promise<Record<string, unknown>> {
    return this.requestResponse(
      "autopilot_cancel_goal",
      { goal_id: goalId },
      "autopilot_cancel_goal",
      timeout ?? 15_000,
    );
  }

  /** Cancel every open (non-terminal) goal. */
  autopilotCancelAll(timeout?: number): Promise<Record<string, unknown>> {
    return this.requestResponse(
      "autopilot_cancel_all",
      {},
      "autopilot_cancel_all",
      timeout ?? 15_000,
    );
  }

  /** Exit dreaming mode and resume scheduling. */
  autopilotWake(timeout?: number): Promise<Record<string, unknown>> {
    return this.requestResponse("autopilot_wake", {}, "autopilot_wake", timeout ?? 15_000);
  }

  /** Force dreaming mode. */
  autopilotDream(timeout?: number): Promise<Record<string, unknown>> {
    return this.requestResponse("autopilot_dream", {}, "autopilot_dream", timeout ?? 15_000);
  }

  /** Resume a suspended or blocked goal. */
  autopilotResume(goalId: string, timeout?: number): Promise<Record<string, unknown>> {
    return this.requestResponse(
      "autopilot_resume",
      { goal_id: goalId },
      "autopilot_resume",
      timeout ?? 15_000,
    );
  }

  /** List root goals only (jobs). Prefer createJob / getJobStatus for job control. */
  autopilotListJobs(timeout?: number): Promise<Record<string, unknown>> {
    return this.requestResponse(
      "autopilot_list_jobs",
      {},
      "autopilot_list_jobs",
      timeout ?? 15_000,
    );
  }

  /** Get a root job with DAG snapshot. Prefer getJobStatus / getJobDag. */
  autopilotGetJob(jobId: string, timeout?: number): Promise<Record<string, unknown>> {
    return this.requestResponse(
      "autopilot_get_job",
      { job_id: jobId },
      "autopilot_get_job",
      timeout ?? 15_000,
    );
  }

  /** Jobs → goals → loops snapshot for CLI top. */
  autopilotTop(
    timeoutOrOptions?: number | { includeTerminal?: boolean; timeout?: number },
  ): Promise<Record<string, unknown>> {
    const options =
      typeof timeoutOrOptions === "number"
        ? { timeout: timeoutOrOptions }
        : timeoutOrOptions;
    return this.requestResponse(
      "autopilot_top",
      { include_terminal: options?.includeTerminal ?? false },
      "autopilot_top",
      options?.timeout ?? 15_000,
    );
  }

  /** Subscribes to autopilot worker events. */
  autopilotSubscribe(timeout?: number): Promise<string> {
    return this.subscribe("autopilot_events", {}, timeout ?? 15_000);
  }

  /** Unsubscribes from autopilot worker events. */
  autopilotUnsubscribe(timeout?: number): Promise<Record<string, unknown>> {
    // Send an unsubscribe envelope (no loop_id in params → daemon infers
    // autopilot_unsubscribe). The daemon sends a `response` correlated by
    // the envelope id; wait for it via requestResponse semantics.
    const req = unsubscribeEnvelope(newRequestID());
    return this._requestResponseForEnvelope(req, "autopilot_unsubscribe", timeout ?? 15_000);
  }

  // ---------------------------------------------------------------------------
 // Cron IPC methods
  // ---------------------------------------------------------------------------

  /** Creates a scheduled job from natural language. */
  cronAdd(text: string, priority?: number, timeout?: number): Promise<Record<string, unknown>> {
    const params: Record<string, unknown> = { text };
    if (priority !== undefined) params.priority = priority;
    return this.requestResponse(
      "cron_add",
      params,
      "cron_add",
      timeout ?? 30_000, // Longer timeout for NL extraction
    );
  }

  /** Lists scheduled jobs. */
  cronList(status?: string, timeout?: number): Promise<Record<string, unknown>> {
    const params: Record<string, unknown> = {};
    if (status !== undefined) params.status = status;
    return this.requestResponse("cron_list", params, "cron_list", timeout ?? 15_000);
  }

  /** Shows a specific scheduled job. */
  cronShow(jobId: string, timeout?: number): Promise<Record<string, unknown>> {
    return this.requestResponse("cron_show", { job_id: jobId }, "cron_show", timeout ?? 15_000);
  }

  /** Cancels a scheduled job. */
  cronCancel(jobId: string, timeout?: number): Promise<Record<string, unknown>> {
    return this.requestResponse("cron_cancel", { job_id: jobId }, "cron_cancel", timeout ?? 15_000);
  }

  // ---------------------------------------------------------------------------
  // Wait helpers
  /**
   * Waits for the connection_ack to report readiness (already done in
   * connect(); kept for callers that reconnect manually). Resolves
   * immediately if the handshake is already complete.
   */
  async waitForDaemonReady(timeout?: number): Promise<Record<string, unknown>> {
    if (this.handshakeComplete) {
      return { readiness_state: this.readinessState ?? "ready" };
    }
    const t = timeout ?? 10_000;
    const deadline = Date.now() + t;
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const ev = await this.readEventWithTimeout(remaining);
      if (ev === null) break;
      if (ev.type !== "connection_ack") continue;
      const result = (ev.result as Record<string, unknown> | undefined) ?? {};
      const state = result.readiness_state as string | undefined;
      if (state === "ready") return ev;
      throw new Error(`daemon not ready: state=${state ?? "unknown"}`);
    }
    throw new Error(`timeout after ${t}ms waiting for connection_ack`);
  }
}

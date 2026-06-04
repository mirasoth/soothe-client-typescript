/**
 * Client manages a WebSocket session with the Soothe daemon.
 * After close(), a new Client must be created to reconnect.
 */

import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import type { Config } from './config.js';
import { defaultConfig } from './config.js';
import {
  decodeMessage,
  splitWirePayload,
  newRequestID,
  newLoopNewMessage,
  newLoopSubscribeMessage,
  type DecodedMessage,
  type LoopNewOptions,
} from './protocol.js';

export interface InputOptions {
  /** Subscribed AgentLoop id (required for loop_input). */
  loopID?: string;
  autonomous?: boolean;
  maxIterations?: number;
  subagent?: string;
  interactive?: boolean;
  model?: string;
  modelParams?: Record<string, unknown>;
  attachments?: Record<string, unknown>[];
}

export class Client extends EventEmitter {
  private url: string;
  private config: Config;
  private ws: WebSocket | null = null;
  private messageBuffer: DecodedMessage[] = [];
  private resolvers: Array<(value: DecodedMessage | null) => void> = [];

  constructor(url: string, config?: Config) {
    super();
    this.url = url;
    this.config = config ?? defaultConfig();
  }

  // ---------------------------------------------------------------------------
  // Connection lifecycle
  // ---------------------------------------------------------------------------

  /** Dials the Soothe daemon WebSocket. No WS-level ping/pong (RFC-0013). */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url, {
        handshakeTimeout: 10_000,
      });

      ws.on('open', () => {
        this.ws = ws;
        resolve();
      });

      ws.on('error', err => {
        if (!this.ws) {
          reject(new Error(`soothe dial: ${err.message}`));
        }
      });

      ws.on('message', (data: WebSocket.RawData) => {
        const text = data.toString();
        for (const frame of splitWirePayload(text)) {
          try {
            const msg = decodeMessage(frame);
            if (msg !== null) {
              this.messageBuffer.push(msg);
              this.emit('message', msg);
              // Resolve pending readEvent calls
              const resolver = this.resolvers.shift();
              if (resolver) resolver(msg);
            }
          } catch {
            // skip malformed messages
          }
        }
      });

      ws.on('close', () => {
        this.ws = null;
        this.emit('close');
        // Resolve any pending readEvent calls with null
        for (const resolver of this.resolvers) {
          resolver(null);
        }
        this.resolvers = [];
      });
    });
  }

  /** Shuts down the WebSocket connection. */
  close(): void {
    if (!this.ws) return;
    try {
      this.ws.close(1000, '');
    } catch {
      // ignore close errors
    }
    this.ws = null;
  }

  /** Returns whether the client has an active WebSocket connection. */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  // ---------------------------------------------------------------------------
  // Core messaging
  // ---------------------------------------------------------------------------

  /** Serializes msg as JSON and sends it as a WebSocket text frame. */
  sendMessage(msg: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error('soothe: not connected'));
        return;
      }
      const payload = JSON.stringify(msg);
      this.ws.send(payload, err => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /** Returns an async iterable of decoded messages. Ends when connection closes. */
  async *receiveMessages(signal?: AbortSignal): AsyncGenerator<DecodedMessage> {
    while (true) {
      if (signal?.aborted) return;

      // Drain buffer first
      while (this.messageBuffer.length > 0) {
        const msg = this.messageBuffer.shift()!;
        yield msg;
      }

      // Wait for next message or close
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
    // Check buffer first
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

  /** Reads a single event with a timeout. Returns null on timeout or connection close. */
  readEventWithTimeout(timeout: number): Promise<Record<string, unknown> | null> {
    // Check buffer first
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

  // ---------------------------------------------------------------------------
  // High-level API methods (Loop-first, RFC-503)
  // ---------------------------------------------------------------------------

  /** Sends user input to the daemon (loop_input; requires loopID). */
  sendInput(text: string, options?: InputOptions): Promise<void> {
    const loopId = (options?.loopID ?? '').trim();
    if (!loopId) {
      return Promise.reject(new Error('sendInput requires options.loopID'));
    }
    const payload: Record<string, unknown> = {
      type: 'loop_input',
      loop_id: loopId,
      content: text,
      autonomous: options?.autonomous ?? false,
    };
    if (options?.maxIterations !== undefined) payload.max_iterations = options.maxIterations;
    if (options?.subagent) payload.preferred_subagent = options.subagent;
    if (options?.interactive) payload.interactive = true;
    if (options?.model) payload.model = options.model;
    if (options?.modelParams) payload.model_params = options.modelParams;
    if (options?.attachments) payload.attachments = options.attachments;
    return this.sendMessage(payload);
  }

  /** Sends a slash command to the daemon. */
  sendCommand(cmd: string): Promise<void> {
    return this.sendMessage({ type: 'command', cmd });
  }

  // ---------------------------------------------------------------------------
  // Loop lifecycle methods (RFC-503)
  // ---------------------------------------------------------------------------

  /** Requests the daemon to create a new AgentLoop. */
  sendLoopNew(opts?: LoopNewOptions | string): Promise<void> {
    return this.sendMessage(newLoopNewMessage(opts));
  }

  /** Subscribes to events for a loop. */
  sendLoopSubscribe(loopID: string, verbosity: string, streamDelivery?: 'batch' | 'streaming'): Promise<void> {
    const msg = newLoopSubscribeMessage(loopID, verbosity);
    if (streamDelivery) {
      (msg as unknown as Record<string, unknown>).stream_delivery = streamDelivery;
    }
    return this.sendMessage(msg);
  }

  /** Detaches from a loop (keeps loop running). */
  sendLoopDetach(loopID: string, requestID?: string): Promise<void> {
    return this.sendMessage({
      type: 'loop_detach',
      loop_id: loopID,
      request_id: requestID ?? newRequestID(),
    });
  }

  /** Notifies the daemon that this client is detaching. */
  sendDetach(): Promise<void> {
    return this.sendMessage({ type: 'detach' });
  }

  /** Sends the daemon_ready handshake message. */
  sendDaemonReady(): Promise<void> {
    return this.sendMessage({ type: 'daemon_ready' });
  }

  /** Requests daemon status check. */
  sendDaemonStatus(requestID?: string): Promise<void> {
    return this.sendMessage({
      type: 'daemon_status',
      request_id: requestID ?? newRequestID(),
    });
  }

  /** Requests daemon shutdown. */
  sendDaemonShutdown(requestID?: string): Promise<void> {
    return this.sendMessage({
      type: 'daemon_shutdown',
      request_id: requestID ?? newRequestID(),
    });
  }

  /** Requests a config section from the daemon. */
  sendConfigGet(section: string, requestID?: string): Promise<void> {
    return this.sendMessage({
      type: 'config_get',
      section,
      request_id: requestID ?? newRequestID(),
    });
  }

  // ---------------------------------------------------------------------------
  // Loop management RPC methods (RFC-504)
  // ---------------------------------------------------------------------------

  /** Requests the persisted loop list. */
  sendLoopList(filter?: Record<string, unknown>, limit?: number, requestID?: string): Promise<void> {
    const msg: Record<string, unknown> = {
      type: 'loop_list',
      request_id: requestID ?? newRequestID(),
    };
    if (filter) msg.filter = filter;
    if (limit !== undefined) msg.limit = limit;
    return this.sendMessage(msg);
  }

  /** Requests detailed loop metadata. */
  sendLoopGet(loopID: string, verbose?: boolean, requestID?: string): Promise<void> {
    const msg: Record<string, unknown> = {
      type: 'loop_get',
      loop_id: loopID,
      request_id: requestID ?? newRequestID(),
    };
    if (verbose) msg.verbose = verbose;
    return this.sendMessage(msg);
  }

  /** Requests loop tree visualization. */
  sendLoopTree(loopID: string, format?: string, requestID?: string): Promise<void> {
    const msg: Record<string, unknown> = {
      type: 'loop_tree',
      loop_id: loopID,
      request_id: requestID ?? newRequestID(),
    };
    if (format) msg.format = format;
    return this.sendMessage(msg);
  }

  /** Requests pruning of old failed branches. */
  sendLoopPrune(loopID: string, retentionDays?: number, dryRun?: boolean, requestID?: string): Promise<void> {
    const msg: Record<string, unknown> = {
      type: 'loop_prune',
      loop_id: loopID,
      request_id: requestID ?? newRequestID(),
    };
    if (retentionDays !== undefined) msg.retention_days = retentionDays;
    if (dryRun !== undefined) msg.dry_run = dryRun;
    return this.sendMessage(msg);
  }

  /** Requests loop deletion. */
  sendLoopDelete(loopID: string, requestID?: string): Promise<void> {
    return this.sendMessage({
      type: 'loop_delete',
      loop_id: loopID,
      request_id: requestID ?? newRequestID(),
    });
  }

  /** Requests reattachment to a loop with history replay. */
  sendLoopReattach(loopID: string, requestID?: string): Promise<void> {
    return this.sendMessage({
      type: 'loop_reattach',
      loop_id: loopID,
      request_id: requestID ?? newRequestID(),
    });
  }

  // ---------------------------------------------------------------------------
  // Skills and models
  // ---------------------------------------------------------------------------

  /** Requests the skills catalog (RFC-400). */
  sendSkillsList(requestID?: string): Promise<void> {
    return this.sendMessage({
      type: 'skills_list',
      request_id: requestID ?? newRequestID(),
    });
  }

  /** Requests the models catalog (RFC-400). */
  sendModelsList(requestID?: string): Promise<void> {
    return this.sendMessage({
      type: 'models_list',
      request_id: requestID ?? newRequestID(),
    });
  }

  /** Invokes a skill on the daemon (RFC-400). */
  sendInvokeSkill(skill: string, args?: string, requestID?: string): Promise<void> {
    const msg: Record<string, unknown> = {
      type: 'invoke_skill',
      skill,
      request_id: requestID ?? newRequestID(),
    };
    if (args) msg.args = args;
    return this.sendMessage(msg);
  }

  // ---------------------------------------------------------------------------
  // Request-Response pattern
  // ---------------------------------------------------------------------------

  /** Sends a request with a unique request_id and waits for a matching response. */
  async requestResponse(
    payload: Record<string, unknown>,
    responseType: string,
    timeout: number,
  ): Promise<Record<string, unknown>> {
    const rid = newRequestID();
    payload.request_id = rid;

    await this.sendMessage(payload);

    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;

      const ev = await this.readEventWithTimeout(remaining);
      if (ev === null) {
        break; // timeout or connection closed
      }

      const evRid = ev.request_id as string | undefined;
      if (evRid !== rid) continue;

      const typ = ev.type as string;
      if (typ === 'error') {
        const msg = (ev.message as string) ?? 'unknown error';
        throw new Error(`daemon error: ${msg}`);
      }
      if (typ === responseType) {
        return ev;
      }
    }

    throw new Error(`timeout after ${timeout}ms waiting for ${responseType}`);
  }

  // ---------------------------------------------------------------------------
  // Convenience RPC methods
  // ---------------------------------------------------------------------------

  /** Requests the skills catalog and waits for the response. */
  listSkills(timeout?: number): Promise<Record<string, unknown>> {
    return this.requestResponse({ type: 'skills_list' }, 'skills_list_response', timeout ?? 15_000);
  }

  /** Requests the models catalog and waits for the response. */
  listModels(timeout?: number): Promise<Record<string, unknown>> {
    return this.requestResponse({ type: 'models_list' }, 'models_list_response', timeout ?? 15_000);
  }

  /** Invokes a skill on the daemon host and receives echo (RFC-400). */
  invokeSkill(skill: string, args?: string, timeout?: number): Promise<Record<string, unknown>> {
    return this.requestResponse({ type: 'invoke_skill', skill, args }, 'invoke_skill_response', timeout ?? 120_000);
  }

  /** Requests loop list and waits for response. */
  listLoops(timeout?: number): Promise<Record<string, unknown>> {
    return this.requestResponse({ type: 'loop_list' }, 'loop_list_response', timeout ?? 15_000);
  }

  /** Requests loop details and waits for response. */
  getLoop(loopID: string, timeout?: number): Promise<Record<string, unknown>> {
    return this.requestResponse({ type: 'loop_get', loop_id: loopID }, 'loop_get_response', timeout ?? 15_000);
  }

  /** Requests loop tree and waits for response. */
  getLoopTree(loopID: string, timeout?: number): Promise<Record<string, unknown>> {
    return this.requestResponse({ type: 'loop_tree', loop_id: loopID }, 'loop_tree_response', timeout ?? 15_000);
  }

  /** Requests loop deletion and waits for response. */
  deleteLoop(loopID: string, timeout?: number): Promise<Record<string, unknown>> {
    return this.requestResponse({ type: 'loop_delete', loop_id: loopID }, 'loop_delete_response', timeout ?? 15_000);
  }

  // ---------------------------------------------------------------------------
  // Wait helpers
  // ---------------------------------------------------------------------------

  /** Reads events until a daemon_ready with state == "ready". */
  async waitForDaemonReady(timeout?: number): Promise<Record<string, unknown>> {
    const t = timeout ?? 10_000;
    const deadline = Date.now() + t;
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const ev = await this.readEventWithTimeout(remaining);
      if (ev === null) break;
      if (ev.type !== 'daemon_ready') continue;
      if (ev.state === 'ready') return ev;
      const msg = (ev.message as string) ?? `daemon state is ${ev.state}`;
      throw new Error(`daemon not ready: ${msg}`);
    }
    throw new Error(`timeout after ${t}ms waiting for daemon_ready`);
  }

  /** Waits for subscription confirmation matching loop id. */
  async waitForSubscriptionConfirmed(loopID: string, _verbosity: string, timeout?: number): Promise<void> {
    const t = timeout ?? 5_000;
    const deadline = Date.now() + t;
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const ev = await this.readEventWithTimeout(remaining);
      if (ev === null) break;
      if (ev.type === 'loop_subscribe_response' && ev.success === true) {
        if (String(ev.loop_id ?? '') === loopID) return;
        continue;
      }
      if (ev.type !== 'subscription_confirmed') continue;
      const lid = String((ev as { loop_id?: string }).loop_id ?? '');
      if (lid === loopID) return;
    }
    throw new Error(`timeout after ${t}ms waiting for subscription_confirmed`);
  }
}
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
  newNewThreadMessage,
  newResumeThreadMessage,
  newSubscribeThreadMessage,
  type DecodedMessage,
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
  // High-level API methods
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
    return this.sendMessage(payload);
  }

  /** Sends a slash command to the daemon. */
  sendCommand(cmd: string): Promise<void> {
    return this.sendMessage({ type: 'command', cmd });
  }

  /** Requests the daemon to start a new thread. */
  sendNewThread(workspace: string): Promise<void> {
    return this.sendMessage(newNewThreadMessage(workspace));
  }

  /** Requests the daemon to resume a specific thread. */
  sendResumeThread(threadID: string, workspace?: string): Promise<void> {
    return this.sendMessage(newResumeThreadMessage(threadID, workspace ?? ''));
  }

  /** Subscribes to events for a thread. */
  sendSubscribeThread(threadID: string, verbosity: string): Promise<void> {
    return this.sendMessage(newSubscribeThreadMessage(threadID, verbosity));
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

  /** Requests the persisted thread list. */
  sendThreadList(filter?: Record<string, unknown>, includeStats?: boolean, includeLastMessage?: boolean, requestID?: string): Promise<void> {
    const msg: Record<string, unknown> = {
      type: 'thread_list',
      request_id: requestID ?? newRequestID(),
    };
    if (filter) msg.filter = filter;
    if (includeStats) msg.include_stats = includeStats;
    if (includeLastMessage) msg.include_last_message = includeLastMessage;
    return this.sendMessage(msg);
  }

  /** Requests metadata for a specific thread. */
  sendThreadGet(threadID: string, requestID?: string): Promise<void> {
    return this.sendMessage({
      type: 'thread_get',
      thread_id: threadID,
      request_id: requestID ?? newRequestID(),
    });
  }

  /** Requests paginated thread messages. */
  sendThreadMessages(threadID: string, limit?: number, offset?: number, requestID?: string): Promise<void> {
    const msg: Record<string, unknown> = {
      type: 'thread_messages',
      thread_id: threadID,
      request_id: requestID ?? newRequestID(),
    };
    if (limit !== undefined) msg.limit = limit;
    if (offset !== undefined) msg.offset = offset;
    return this.sendMessage(msg);
  }

  /** Requests raw checkpoint state for a thread. */
  sendThreadState(threadID: string, requestID?: string): Promise<void> {
    return this.sendMessage({
      type: 'thread_state',
      thread_id: threadID,
      request_id: requestID ?? newRequestID(),
    });
  }

  /** Persists partial state values for a thread. */
  sendThreadUpdateState(threadID: string, values: Record<string, unknown>, requestID?: string): Promise<void> {
    return this.sendMessage({
      type: 'thread_update_state',
      thread_id: threadID,
      values,
      request_id: requestID ?? newRequestID(),
    });
  }

  /** Requests thread archival. */
  sendThreadArchive(threadID: string, requestID?: string): Promise<void> {
    return this.sendMessage({
      type: 'thread_archive',
      thread_id: threadID,
      request_id: requestID ?? newRequestID(),
    });
  }

  /** Requests thread deletion. */
  sendThreadDelete(threadID: string, requestID?: string): Promise<void> {
    return this.sendMessage({
      type: 'thread_delete',
      thread_id: threadID,
      request_id: requestID ?? newRequestID(),
    });
  }

  /** Requests creation of a persisted thread (RFC-402). */
  sendThreadCreate(initialMessage?: string, metadata?: Record<string, unknown>, requestID?: string): Promise<void> {
    const msg: Record<string, unknown> = {
      type: 'thread_create',
      request_id: requestID ?? newRequestID(),
    };
    if (initialMessage) msg.initial_message = initialMessage;
    if (metadata) msg.metadata = metadata;
    return this.sendMessage(msg);
  }

  /** Requests thread artifacts (RFC-402). */
  sendThreadArtifacts(threadID: string, requestID?: string): Promise<void> {
    return this.sendMessage({
      type: 'thread_artifacts',
      thread_id: threadID,
      request_id: requestID ?? newRequestID(),
    });
  }

  /** Sends interactive continuation payload for a paused loop (resume_interrupts). */
  sendResumeInterrupts(loopID: string, resumePayload: Record<string, unknown>, requestID?: string): Promise<void> {
    return this.sendMessage({
      type: 'resume_interrupts',
      loop_id: loopID,
      resume_payload: resumePayload,
      request_id: requestID ?? newRequestID(),
    });
  }

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
      if (lid === loopID || ev.thread_id === loopID) return;
    }
    throw new Error(`timeout after ${t}ms waiting for subscription_confirmed`);
  }
}

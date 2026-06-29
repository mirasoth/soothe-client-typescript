/**
 * Protocol-1 wire envelope: message types, encode/decode, NDJSON splitting,
 * and factory functions for the Soothe daemon (RFC-450).
 *
 * The unified `{proto, type, method, params, id}` envelope combines
 * JSON-RPC 2.0's `method`/`params`/`id` structure with graphql-ws's `type`
 * semantics for message class distinction.
 */

import { randomUUID } from 'node:crypto';

/** Protocol version string (RFC-450 §8.1). */
export const PROTO_VERSION = '1';

/** Default client capabilities declared in the connection_init handshake. */
export const DEFAULT_CLIENT_CAPABILITIES = ['streaming', 'batch', 'heartbeat', 'receipts'];

/** Client version reported in the connection_init handshake. */
export const CLIENT_VERSION = '0.1.0';

// ---------------------------------------------------------------------------
// Envelope message classes (RFC-450 §9.1)
// ---------------------------------------------------------------------------

export type MessageType =
  | 'connection_init'
  | 'connection_ack'
  | 'request'
  | 'response'
  | 'notification'
  | 'subscribe'
  | 'next'
  | 'error'
  | 'complete'
  | 'unsubscribe'
  | 'ping'
  | 'pong'
  | 'receipt_response'
  | 'disconnect'
  | 'status';

/** Method names carried in the envelope `method` field (RFC-450 §9.2). */
export type MethodName =
  | 'loop_list'
  | 'loop_get'
  | 'loop_tree'
  | 'loop_prune'
  | 'loop_delete'
  | 'loop_new'
  | 'loop_reattach'
  | 'loop_input'
  | 'loop_messages'
  | 'loop_state_get'
  | 'loop_state_update'
  | 'loop_cards_fetch'
  | 'loop_events'
  | 'autopilot_events'
  | 'job_create'
  | 'job_status'
  | 'job_pause'
  | 'job_resume'
  | 'job_cancel'
  | 'job_dag'
  | 'job_guidance'
  | 'daemon_status'
  | 'daemon_shutdown'
  | 'config_get'
  | 'skills_list'
  | 'invoke_skill'
  | 'models_list'
  | 'mcp_status'
  | 'auth'
  | 'auth_refresh'
  | 'slash_command'
  | 'rpc_command'
  | 'disconnect';

// ---------------------------------------------------------------------------
// Envelope interfaces (RFC-450 §5.2)
// ---------------------------------------------------------------------------

/** Base fields shared by every protocol-1 message. */
export interface BaseEnvelope {
  proto: string;
  type: MessageType;
}

/** A client→server RPC request (expects a `response` correlated by `id`). */
export interface RequestEnvelope extends BaseEnvelope {
  type: 'request';
  method: MethodName;
  params?: Record<string, unknown>;
  id: string;
}

/** A server→client RPC success response. */
export interface ResponseEnvelope extends BaseEnvelope {
  type: 'response';
  result?: Record<string, unknown>;
  id?: string;
}

/** A fire-and-forget client→server notification (no `id`, no response). */
export interface NotificationEnvelope extends BaseEnvelope {
  type: 'notification';
  method: MethodName;
  params?: Record<string, unknown>;
  /** Optional receipt id for delivery confirmation (RFC-450 §5.7). */
  receipt?: string;
}

/** Start a subscription stream (events arrive as `next`). */
export interface SubscribeEnvelope extends BaseEnvelope {
  type: 'subscribe';
  method: 'loop_events' | 'autopilot_events';
  params?: Record<string, unknown>;
  id: string;
}

/** A stream event for an active subscription. */
export interface NextEnvelope extends BaseEnvelope {
  type: 'next';
  payload?: Record<string, unknown>;
  id?: string;
}

/** Structured error response (terminates the operation). */
export interface ErrorEnvelope extends BaseEnvelope {
  type: 'error';
  error: { code: number; message: string; data?: unknown };
  id?: string;
}

/** Explicit stream-completion signal. */
export interface CompleteEnvelope extends BaseEnvelope {
  type: 'complete';
  id?: string;
}

/** Cancel a subscription by `id`. */
export interface UnsubscribeEnvelope extends BaseEnvelope {
  type: 'unsubscribe';
  id: string;
}

/** Connection handshake (client→server, first message). */
export interface ConnectionInitEnvelope extends BaseEnvelope {
  type: 'connection_init';
  params?: {
    client_version: string;
    client_name?: string;
    accept_proto?: string[];
    capabilities?: string[];
  };
}

/** Connection handshake response (server→client). */
export interface ConnectionAckEnvelope extends BaseEnvelope {
  type: 'connection_ack';
  result?: {
    server_version?: string;
    protocol_version?: string;
    capabilities?: string[];
    readiness_state?: string;
    heartbeat_interval_ms?: number;
  };
}

/** Heartbeat ping (either direction). */
export interface PingEnvelope extends BaseEnvelope {
  type: 'ping';
}

/** Heartbeat pong response. */
export interface PongEnvelope extends BaseEnvelope {
  type: 'pong';
}

/** Delivery confirmation for a notification that carried a `receipt`. */
export interface ReceiptResponseEnvelope extends BaseEnvelope {
  type: 'receipt_response';
  receipt: string;
}

/** Clean connection close (daemon keeps loops running). */
export interface DisconnectEnvelope extends BaseEnvelope {
  type: 'disconnect';
}

/**
 * A daemon status frame. `status` is a defined protocol-1 top-level type
 * (RFC-450 §9.1): it passes through the daemon's legacy→`next` translator
 * unchanged, so it is NOT wrapped in a `next` envelope.
 */
export interface StatusFrame extends BaseEnvelope {
  type: 'status';
  state?: string;
  loop_id?: string;
  workspace?: string;
  input_history?: string[];
  conversation_history?: unknown[];
  [key: string]: unknown;
}

/** Discriminated union of all decoded protocol-1 messages. */
export type DecodedMessage =
  | RequestEnvelope
  | ResponseEnvelope
  | NotificationEnvelope
  | SubscribeEnvelope
  | NextEnvelope
  | ErrorEnvelope
  | CompleteEnvelope
  | UnsubscribeEnvelope
  | ConnectionInitEnvelope
  | ConnectionAckEnvelope
  | PingEnvelope
  | PongEnvelope
  | ReceiptResponseEnvelope
  | DisconnectEnvelope
  | StatusFrame
  | Record<string, unknown>;

// ---------------------------------------------------------------------------
// Typed request/notification payload interfaces (params shapes)
// ---------------------------------------------------------------------------

/** Params for `loop_input` (notification or request). */
export interface LoopInputParams {
  loop_id: string;
  content: string;
  autonomous?: boolean;
  max_iterations?: number;
  preferred_subagent?: string;
  interactive?: boolean;
  model?: string;
  model_params?: Record<string, unknown>;
  attachments?: Record<string, unknown>[];
  intent_hint?: string;
  response_schema?: Record<string, unknown>;
  response_schema_name?: string;
  response_schema_strict?: boolean;
  clarification_mode?: string;
  clarification_answer?: boolean;
  clarification_answers?: string[];
}

/** Options for `loop_new` workspace fields. */
export interface LoopNewOptions {
  client_workspace?: string;
  client_workspace_id?: string;
  user_id?: string;
  is_ephemeral?: boolean;
  /** @deprecated Use `client_workspace`. */
  workspace?: string;
}

// ---------------------------------------------------------------------------
// Stream-event payload helpers (RFC-450 §9.3)
// ---------------------------------------------------------------------------

/**
 * Shape of a `next` payload when the daemon wraps a legacy free-form frame.
 * The original frame type becomes `mode`; `data` carries the frame body with
 * `loop_id` preserved.
 */
export interface StreamEventPayload {
  namespace?: unknown;
  mode?: string;
  data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Encode / Decode
// ---------------------------------------------------------------------------

/** Encodes a message as JSON with a newline delimiter (NDJSON frame). */
export function encodeMessage(msg: unknown): string {
  return JSON.stringify(msg) + '\n';
}

/**
 * Decodes a JSON message and returns a typed object. Unknown types return a
 * raw map. The decoder is permissive: it accepts protocol-1 envelopes and
 * surfaces `response.result` / `next.payload` for consumers that read them,
 * but always returns the full envelope so callers can inspect `type`/`id`.
 */
export function decodeMessage(data: string): DecodedMessage | null {
  if (!data || data.length === 0) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new Error(`invalid JSON: ${data}`);
  }

  if (!parsed || typeof parsed !== 'object') return parsed;

  const type = parsed.type as MessageType | undefined;
  if (!type) return parsed;

  switch (type) {
    case 'connection_init':
      return { ...parsed } as unknown as ConnectionInitEnvelope;
    case 'connection_ack':
      return { ...parsed } as unknown as ConnectionAckEnvelope;
    case 'request':
      return { ...parsed } as unknown as RequestEnvelope;
    case 'response':
      return { ...parsed } as unknown as ResponseEnvelope;
    case 'notification':
      return { ...parsed } as unknown as NotificationEnvelope;
    case 'subscribe':
      return { ...parsed } as unknown as SubscribeEnvelope;
    case 'next':
      return { ...parsed } as unknown as NextEnvelope;
    case 'error':
      return { ...parsed } as unknown as ErrorEnvelope;
    case 'complete':
      return { ...parsed } as unknown as CompleteEnvelope;
    case 'unsubscribe':
      return { ...parsed } as unknown as UnsubscribeEnvelope;
    case 'ping':
      return { ...parsed } as unknown as PingEnvelope;
    case 'pong':
      return { ...parsed } as unknown as PongEnvelope;
    case 'receipt_response':
      return { ...parsed } as unknown as ReceiptResponseEnvelope;
    case 'disconnect':
      return { ...parsed } as unknown as DisconnectEnvelope;
    case 'status': {
      const msg = { ...parsed } as unknown as StatusFrame;
      // Tolerate camelCase loopId from some daemon builds.
      if ((!msg.loop_id || msg.loop_id === '') && typeof parsed.loopId === 'string') {
        msg.loop_id = parsed.loopId as string;
      }
      return msg;
    }
    default:
      return parsed;
  }
}

// ---------------------------------------------------------------------------
// Envelope factory helpers (RFC-450 §5)
// ---------------------------------------------------------------------------

/** Builds a `request` envelope. */
export function requestEnvelope(
  method: MethodName,
  params?: Record<string, unknown>,
  id?: string,
): RequestEnvelope {
  return { proto: PROTO_VERSION, type: 'request', method, params, id: id ?? newRequestID() };
}

/** Builds a `notification` envelope (no `id`). */
export function notificationEnvelope(
  method: MethodName,
  params?: Record<string, unknown>,
): NotificationEnvelope {
  return { proto: PROTO_VERSION, type: 'notification', method, params };
}

/** Builds a `subscribe` envelope. */
export function subscribeEnvelope(
  method: 'loop_events' | 'autopilot_events',
  params?: Record<string, unknown>,
  id?: string,
): SubscribeEnvelope {
  return { proto: PROTO_VERSION, type: 'subscribe', method, params, id: id ?? newRequestID() };
}

/** Builds an `unsubscribe` envelope. */
export function unsubscribeEnvelope(id: string): UnsubscribeEnvelope {
  return { proto: PROTO_VERSION, type: 'unsubscribe', id };
}

/** Builds a `connection_init` handshake envelope. */
export function connectionInitEnvelope(opts?: {
  client_version?: string;
  client_name?: string;
  accept_proto?: string[];
  capabilities?: string[];
}): ConnectionInitEnvelope {
  return {
    proto: PROTO_VERSION,
    type: 'connection_init',
    params: {
      client_version: opts?.client_version ?? CLIENT_VERSION,
      client_name: opts?.client_name ?? 'soothe-client-ts',
      accept_proto: opts?.accept_proto ?? [PROTO_VERSION],
      capabilities: opts?.capabilities ?? DEFAULT_CLIENT_CAPABILITIES,
    },
  };
}

/** Builds a `ping` heartbeat envelope. */
export function pingEnvelope(): PingEnvelope {
  return { proto: PROTO_VERSION, type: 'ping' };
}

/** Builds a `pong` heartbeat envelope. */
export function pongEnvelope(): PongEnvelope {
  return { proto: PROTO_VERSION, type: 'pong' };
}

/** Builds a `disconnect` notification envelope. */
export function disconnectEnvelope(): DisconnectEnvelope {
  return { proto: PROTO_VERSION, type: 'disconnect' };
}

// ---------------------------------------------------------------------------
// NDJSON splitting
// ---------------------------------------------------------------------------

/** Splits a single WebSocket text payload into individual JSON lines. */
export function splitWirePayload(data: string): string[] {
  const trimmed = data.trim();
  if (trimmed === '') return [];

  const lines = trimmed.split('\n').map(l => l.trim()).filter(l => l !== '');
  return lines.length > 0 ? lines : [data];
}

// ---------------------------------------------------------------------------
// Event/loop extraction helpers
// ---------------------------------------------------------------------------

/**
 * Returns the StrangeLoop id when present in a message.
 *
 * Under protocol-1, loop-scoped stream events arrive as `next` envelopes
 * whose `payload.data` carries the original frame (with `loop_id`). Raw
 * `status` frames carry `loop_id` at the top level. This helper inspects
 * both shapes.
 */
export function extractSootheLoopID(msg: unknown): [string, boolean] {
  if (!msg || typeof msg !== 'object') return ['', false];
  const m = msg as Record<string, unknown>;

  // `next` envelope: dig into payload.data.loop_id.
  if (m.type === 'next') {
    const payload = m.payload as Record<string, unknown> | undefined;
    if (payload && typeof payload === 'object') {
      const data = payload.data as Record<string, unknown> | undefined;
      if (data && typeof data === 'object') {
        const id = (data.loop_id ?? data.loopId) as string | undefined;
        if (id && id !== '') return [id, true];
      }
      // Some payloads carry loop_id directly.
      const pid = (payload.loop_id ?? payload.loopId) as string | undefined;
      if (pid && pid !== '') return [pid, true];
    }
    return ['', false];
  }

  if (m.type === 'status') {
    const id = m.loop_id as string | undefined;
    if (id && id !== '') return [id, true];
    return ['', false];
  }

  // Generic fallback: top-level loop_id / loopId.
  const generic = (m.loop_id ?? m.loopId) as string | undefined;
  if (generic && generic !== '') return [generic, true];

  return ['', false];
}

// ---------------------------------------------------------------------------
// Message factory functions
// ---------------------------------------------------------------------------

/** Generates a new UUID correlation ID (RFC-450 §5.2 `id`). */
export function newRequestID(): string {
  return randomUUID();
}

/** Creates a `loop_input` notification envelope. */
export function newLoopInputMessage(loopID: string, content: string): NotificationEnvelope {
  return notificationEnvelope('loop_input', { loop_id: loopID, content, autonomous: false });
}

/** Creates a `loop_new` request envelope. */
export function newLoopNewMessage(opts?: LoopNewOptions | string): RequestEnvelope {
  const options: LoopNewOptions =
    typeof opts === 'string' ? { client_workspace: opts } : opts ?? {};
  const clientWorkspace = options.client_workspace ?? options.workspace;
  const params: Record<string, unknown> = {};
  if (clientWorkspace?.trim()) {
    params.client_workspace = clientWorkspace.trim();
  }
  if (options.user_id?.trim()) {
    params.user_id = options.user_id.trim();
  }
  if (options.client_workspace_id?.trim()) {
    params.client_workspace_id = options.client_workspace_id.trim();
  }
  if (options.is_ephemeral) {
    params.is_ephemeral = true;
  }
  return requestEnvelope('loop_new', params);
}

/** Creates a `loop_events` subscribe envelope. */
export function newLoopSubscribeMessage(
  loopID: string,
  verbosity: string,
  streamDelivery?: 'batch' | 'adaptive' | 'streaming',
): SubscribeEnvelope {
  const params: Record<string, unknown> = { loop_id: loopID, verbosity };
  if (streamDelivery) {
    params.stream_delivery = streamDelivery;
  }
  return subscribeEnvelope('loop_events', params);
}

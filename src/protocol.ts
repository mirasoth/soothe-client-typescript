/**
 * Message types, encode/decode, NDJSON splitting, and factory functions
 * for the Soothe daemon wire protocol.
 */

import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Base types
// ---------------------------------------------------------------------------

export interface BaseMessage {
  type: string;
  request_id?: string;
}

// ---------------------------------------------------------------------------
// Client → Daemon messages (Loop-first architecture, RFC-503)
// ---------------------------------------------------------------------------

/** Loop-scoped user input. */
export interface LoopInputMessage extends BaseMessage {
  type: 'loop_input';
  loop_id: string;
  content: string;
  autonomous?: boolean;
  max_iterations?: number;
  preferred_subagent?: string;
  interactive?: boolean;
  model?: string;
  model_params?: Record<string, unknown>;
  attachments?: Record<string, unknown>[];
}

export interface CommandMessage extends BaseMessage {
  type: 'command';
  cmd: string;
}

export interface DaemonStatusMessage extends BaseMessage {
  type: 'daemon_status';
}

export interface DaemonShutdownMessage extends BaseMessage {
  type: 'daemon_shutdown';
}

export interface ConfigGetMessage extends BaseMessage {
  type: 'config_get';
  section: string;
}

// Loop lifecycle messages (RFC-503)

export interface LoopNewMessage extends BaseMessage {
  type: 'loop_new';
  /** Project directory; runner uses this path directly when set. */
  client_workspace?: string;
  /** Stable scope for persisted sandbox when client_workspace is unset. */
  client_workspace_id?: string;
  /** User segment under $SOOTHE_HOME/workspaces/ (empty → anonymous). */
  user_id?: string;
  /** When true, loop execution data is GC'd after idle period (workspace retained). */
  is_ephemeral?: boolean;
  /**
   * @deprecated Use `client_workspace`. Still accepted by the daemon as an alias.
   */
  workspace?: string;
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

export interface LoopSubscribeMessage extends BaseMessage {
  type: 'loop_subscribe';
  loop_id: string;
  verbosity: string;
  stream_delivery?: 'batch' | 'streaming'; // RFC-614 stream shaping
}

export interface LoopDetachMessage extends BaseMessage {
  type: 'loop_detach';
  loop_id: string;
}

// Loop management RPC messages (RFC-504)

export interface LoopListMessage extends BaseMessage {
  type: 'loop_list';
  filter?: Record<string, unknown>;
  limit?: number;
}

export interface LoopGetMessage extends BaseMessage {
  type: 'loop_get';
  loop_id: string;
  verbose?: boolean;
}

export interface LoopTreeMessage extends BaseMessage {
  type: 'loop_tree';
  loop_id: string;
  format?: string;
}

export interface LoopPruneMessage extends BaseMessage {
  type: 'loop_prune';
  loop_id: string;
  retention_days?: number;
  dry_run?: boolean;
}

export interface LoopDeleteMessage extends BaseMessage {
  type: 'loop_delete';
  loop_id: string;
}

export interface LoopReattachMessage extends BaseMessage {
  type: 'loop_reattach';
  loop_id: string;
}

// Other messages

export interface SkillsListMessage extends BaseMessage {
  type: 'skills_list';
}

export interface ModelsListMessage extends BaseMessage {
  type: 'models_list';
}

export interface InvokeSkillMessage extends BaseMessage {
  type: 'invoke_skill';
  skill: string;
  args?: string;
}

export interface DetachMessage extends BaseMessage {
  type: 'detach';
}

// ---------------------------------------------------------------------------
// Daemon → Client messages
// ---------------------------------------------------------------------------

export interface EventMessage extends BaseMessage {
  type: 'event';
  loop_id?: string;
  namespace: string;
  data: Record<string, unknown>;
  timestamp?: string;
}

export interface StatusResponse extends BaseMessage {
  type: 'status';
  state: string;
  loop_id?: string;
  workspace: string;
  input_history?: string[];
  conversation_history?: unknown[];
}

export interface SubscriptionConfirmedResponse extends BaseMessage {
  type: 'subscription_confirmed';
  loop_id?: string;
  client_id: string;
  verbosity: string;
}

export interface ErrorResponse extends BaseMessage {
  type: 'error';
  code: string;
  message: string;
}

export interface DaemonReadyResponse extends BaseMessage {
  type: 'daemon_ready';
  state: string;
  message?: string;
}

export interface DaemonStatusResponse extends BaseMessage {
  type: 'daemon_status_response';
  running: boolean;
  port_live: boolean;
  active_loops: number;
}

export interface ShutdownAckResponse extends BaseMessage {
  type: 'shutdown_ack';
  status: string;
}

// Loop lifecycle responses (RFC-503)

export interface LoopNewResponse extends BaseMessage {
  type: 'loop_new_response';
  loop_id: string;
  success?: boolean;
  is_ephemeral?: boolean;
}

export interface LoopSubscribeResponse extends BaseMessage {
  type: 'loop_subscribe_response';
  loop_id?: string;
  success: boolean;
  message?: string;
}

export interface LoopDetachResponse extends BaseMessage {
  type: 'loop_detach_response';
  loop_id?: string;
  success: boolean;
}

// Loop management responses (RFC-504)

export interface LoopListResponse extends BaseMessage {
  type: 'loop_list_response';
  loops?: Record<string, unknown>[];
  total?: number;
}

export interface LoopGetResponse extends BaseMessage {
  type: 'loop_get_response';
  loop?: Record<string, unknown>;
}

export interface LoopTreeResponse extends BaseMessage {
  type: 'loop_tree_response';
  tree?: Record<string, unknown>;
}

export interface LoopPruneResponse extends BaseMessage {
  type: 'loop_prune_response';
  result?: Record<string, unknown>;
}

export interface LoopDeleteResponse extends BaseMessage {
  type: 'loop_delete_response';
  success: boolean;
  message?: string;
}

export interface LoopReattachResponse extends BaseMessage {
  type: 'loop_reattach_response';
  loop_id?: string;
  success?: boolean;
}

// History replay messages (RFC-411)

export interface HistoryReplayMessage extends BaseMessage {
  type: 'history_replay';
  loop_id?: string;
  events?: Record<string, unknown>[];
  total_events?: number;
}

export interface HistoryReplayCompleteMessage extends BaseMessage {
  type: 'history_replay_complete';
  loop_id?: string;
}

export interface ReplayCompleteMessage extends BaseMessage {
  type: 'replay_complete';
  loop_id?: string;
  event_count?: number;
}

export interface LoopReattachedWireMessage extends BaseMessage {
  type: 'loop_reattached';
  loop_id?: string;
  timestamp?: string;
}

// Other responses

export interface SkillsListResponse extends BaseMessage {
  type: 'skills_list_response';
  skills?: Record<string, unknown>[];
}

export interface ModelsListResponse extends BaseMessage {
  type: 'models_list_response';
  models?: Record<string, unknown>[];
}

// Discriminated union for all decoded messages
export type DecodedMessage =
  | LoopInputMessage
  | CommandMessage
  | DaemonStatusMessage
  | DaemonShutdownMessage
  | ConfigGetMessage
  | LoopNewMessage
  | LoopSubscribeMessage
  | LoopDetachMessage
  | LoopListMessage
  | LoopGetMessage
  | LoopTreeMessage
  | LoopPruneMessage
  | LoopDeleteMessage
  | LoopReattachMessage
  | SkillsListMessage
  | ModelsListMessage
  | InvokeSkillMessage
  | DetachMessage
  | EventMessage
  | StatusResponse
  | SubscriptionConfirmedResponse
  | ErrorResponse
  | DaemonReadyResponse
  | DaemonStatusResponse
  | ShutdownAckResponse
  | LoopNewResponse
  | LoopSubscribeResponse
  | LoopDetachResponse
  | LoopListResponse
  | LoopGetResponse
  | LoopTreeResponse
  | LoopPruneResponse
  | LoopDeleteResponse
  | LoopReattachResponse
  | HistoryReplayMessage
  | HistoryReplayCompleteMessage
  | SkillsListResponse
  | ModelsListResponse
  | Record<string, unknown>;

// ---------------------------------------------------------------------------
// Encode / Decode
// ---------------------------------------------------------------------------

/** Encodes a message as JSON with newline delimiter. */
export function encodeMessage(msg: unknown): string {
  return JSON.stringify(msg) + '\n';
}

/** Decodes a JSON message and returns a typed object. Unknown types return a raw map. */
export function decodeMessage(data: string): DecodedMessage | null {
  if (!data || data.length === 0) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new Error(`invalid JSON: ${data}`);
  }

  const type = parsed.type as string | undefined;
  if (!type) return parsed;

  switch (type) {
    // Client → Daemon (loop-first)
    case 'loop_input': return { ...parsed } as unknown as LoopInputMessage;
    case 'command': return { ...parsed } as unknown as CommandMessage;
    case 'daemon_status': return { ...parsed } as unknown as DaemonStatusMessage;
    case 'daemon_shutdown': return { ...parsed } as unknown as DaemonShutdownMessage;
    case 'config_get': return { ...parsed } as unknown as ConfigGetMessage;
    case 'loop_new': return { ...parsed } as unknown as LoopNewMessage;
    case 'loop_subscribe': return { ...parsed } as unknown as LoopSubscribeMessage;
    case 'loop_detach': return { ...parsed } as unknown as LoopDetachMessage;
    case 'loop_list': return { ...parsed } as unknown as LoopListMessage;
    case 'loop_get': return { ...parsed } as unknown as LoopGetMessage;
    case 'loop_tree': return { ...parsed } as unknown as LoopTreeMessage;
    case 'loop_prune': return { ...parsed } as unknown as LoopPruneMessage;
    case 'loop_delete': return { ...parsed } as unknown as LoopDeleteMessage;
    case 'loop_reattach': return { ...parsed } as unknown as LoopReattachMessage;
    case 'skills_list': return { ...parsed } as unknown as SkillsListMessage;
    case 'models_list': return { ...parsed } as unknown as ModelsListMessage;
    case 'invoke_skill': return { ...parsed } as unknown as InvokeSkillMessage;
    case 'detach': return { ...parsed } as unknown as DetachMessage;

    // Daemon → Client
    case 'event': return { ...parsed } as unknown as EventMessage;
    case 'status': {
      const msg = { ...parsed } as unknown as StatusResponse;
      if (!msg.loop_id && parsed.loopId && typeof parsed.loopId === 'string') {
        msg.loop_id = parsed.loopId;
      }
      return msg;
    }
    case 'subscription_confirmed': return { ...parsed } as unknown as SubscriptionConfirmedResponse;
    case 'error': return { ...parsed } as unknown as ErrorResponse;
    case 'daemon_ready': return { ...parsed } as unknown as DaemonReadyResponse;
    case 'daemon_status_response': return { ...parsed } as unknown as DaemonStatusResponse;
    case 'shutdown_ack': return { ...parsed } as unknown as ShutdownAckResponse;
    case 'loop_new_response': return { ...parsed } as unknown as LoopNewResponse;
    case 'loop_subscribe_response': return { ...parsed } as unknown as LoopSubscribeResponse;
    case 'loop_detach_response': return { ...parsed } as unknown as LoopDetachResponse;
    case 'loop_list_response': return { ...parsed } as unknown as LoopListResponse;
    case 'loop_get_response': return { ...parsed } as unknown as LoopGetResponse;
    case 'loop_tree_response': return { ...parsed } as unknown as LoopTreeResponse;
    case 'loop_prune_response': return { ...parsed } as unknown as LoopPruneResponse;
    case 'loop_delete_response': return { ...parsed } as unknown as LoopDeleteResponse;
    case 'loop_reattach_response': return { ...parsed } as unknown as LoopReattachResponse;
    case 'history_replay': return { ...parsed } as unknown as HistoryReplayMessage;
    case 'history_replay_complete':
    case 'replay_complete':
      return { ...parsed } as unknown as ReplayCompleteMessage;
    case 'loop_reattached':
      return { ...parsed } as unknown as LoopReattachedWireMessage;
    case 'config_get_response':
    case 'invoke_skill_response':
      return parsed;
    case 'skills_list_response': return { ...parsed } as unknown as SkillsListResponse;
    case 'models_list_response': return { ...parsed } as unknown as ModelsListResponse;

    default:
      return parsed;
  }
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

/**
 * Returns the AgentLoop id when present in a message.
 * Prefers loop_id field.
 */
export function extractSootheLoopID(msg: unknown): [string, boolean] {
  if (!msg || typeof msg !== 'object') return ['', false];
  const m = msg as Record<string, unknown>;

  if (m.type === 'status') {
    const id = m.loop_id as string | undefined;
    if (id && id !== '') return [id, true];
    return ['', false];
  }

  if (m.type === 'event') {
    const top = m.loop_id as string | undefined;
    if (top && top !== '') return [top, true];

    const data = m.data as Record<string, unknown> | undefined;
    if (data && typeof data === 'object') {
      const dataId = (data['loop_id'] ?? data['loopId']) as string | undefined;
      if (dataId && dataId !== '') return [dataId, true];
    }
  }

  const generic = (m['loop_id'] ?? m['loopId']) as string | undefined;
  if (generic && generic !== '') return [generic, true];

  return ['', false];
}

// ---------------------------------------------------------------------------
// Message factory functions
// ---------------------------------------------------------------------------

/** Generates a new UUID request ID. */
export function newRequestID(): string {
  return randomUUID();
}

/** Creates a loop_input message with required fields. */
export function newLoopInputMessage(loopID: string, content: string): LoopInputMessage {
  return {
    request_id: newRequestID(),
    type: 'loop_input',
    loop_id: loopID,
    content,
    autonomous: false,
  };
}

/** Creates a loop_new message. */
export function newLoopNewMessage(opts?: LoopNewOptions | string): LoopNewMessage {
  const options: LoopNewOptions =
    typeof opts === 'string' ? { client_workspace: opts } : opts ?? {};
  const clientWorkspace = options.client_workspace ?? options.workspace;
  const msg: LoopNewMessage = {
    request_id: newRequestID(),
    type: 'loop_new',
  };
  if (clientWorkspace?.trim()) {
    msg.client_workspace = clientWorkspace.trim();
  }
  if (options.user_id?.trim()) {
    msg.user_id = options.user_id.trim();
  }
  if (options.client_workspace_id?.trim()) {
    msg.client_workspace_id = options.client_workspace_id.trim();
  }
  if (options.is_ephemeral) {
    msg.is_ephemeral = true;
  }
  return msg;
}

/** Creates a loop_subscribe message. */
export function newLoopSubscribeMessage(loopID: string, verbosity: string, streamDelivery?: 'batch' | 'streaming'): LoopSubscribeMessage {
  const msg: LoopSubscribeMessage = {
    request_id: newRequestID(),
    type: 'loop_subscribe',
    loop_id: loopID,
    verbosity,
  };
  if (streamDelivery) {
    msg.stream_delivery = streamDelivery;
  }
  return msg;
}
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
// Client → Daemon messages
// ---------------------------------------------------------------------------

export interface InputMessage extends BaseMessage {
  type: 'input';
  text: string;
  thread_id?: string;
  autonomous?: boolean;
  max_iterations?: number;
  subagent?: string;
  interactive?: boolean;
  model?: string;
  model_params?: Record<string, unknown>;
}

/** Loop-scoped user input (replaces legacy `input` for AgentLoop runs). */
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
}

export interface CommandMessage extends BaseMessage {
  type: 'command';
  cmd: string;
}

export interface SubscribeThreadMessage extends BaseMessage {
  type: 'subscribe_thread';
  thread_id: string;
  verbosity: string;
}

export interface NewThreadMessage extends BaseMessage {
  type: 'new_thread';
  workspace: string;
}

export interface ResumeThreadMessage extends BaseMessage {
  type: 'resume_thread';
  thread_id: string;
  workspace?: string;
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

export interface ThreadListMessage extends BaseMessage {
  type: 'thread_list';
  filter?: Record<string, unknown>;
  include_stats?: boolean;
  include_last_message?: boolean;
}

export interface ThreadGetMessage extends BaseMessage {
  type: 'thread_get';
  thread_id: string;
}

export interface ThreadMessagesMessage extends BaseMessage {
  type: 'thread_messages';
  thread_id: string;
  limit?: number;
  offset?: number;
}

export interface ThreadStateMessage extends BaseMessage {
  type: 'thread_state';
  thread_id: string;
}

export interface ThreadUpdateStateMessage extends BaseMessage {
  type: 'thread_update_state';
  thread_id: string;
  values: Record<string, unknown>;
}

export interface ThreadArchiveMessage extends BaseMessage {
  type: 'thread_archive';
  thread_id: string;
}

export interface ThreadDeleteMessage extends BaseMessage {
  type: 'thread_delete';
  thread_id: string;
}

export interface ThreadCreateMessage extends BaseMessage {
  type: 'thread_create';
  initial_message?: string;
  metadata?: Record<string, unknown>;
}

export interface ThreadArtifactsMessage extends BaseMessage {
  type: 'thread_artifacts';
  thread_id: string;
}

export interface ResumeInterruptsMessage extends BaseMessage {
  type: 'resume_interrupts';
  loop_id: string;
  resume_payload: Record<string, unknown>;
}

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
  thread_id?: string;
  namespace: string;
  data: Record<string, unknown>;
  timestamp?: string;
}

export interface StatusResponse extends BaseMessage {
  type: 'status';
  state: string;
  loop_id?: string;
  thread_id?: string;
  workspace: string;
  input_history?: string[];
  conversation_history?: unknown[];
  thread_resumed?: boolean;
  new_thread?: boolean;
}

export interface SubscriptionConfirmedResponse extends BaseMessage {
  type: 'subscription_confirmed';
  loop_id?: string;
  thread_id?: string;
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
  active_threads: number;
}

export interface ShutdownAckResponse extends BaseMessage {
  type: 'shutdown_ack';
  status: string;
}

export interface ThreadListResponse extends BaseMessage {
  type: 'thread_list_response';
  threads?: Record<string, unknown>[];
}

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
  | InputMessage
  | LoopInputMessage
  | CommandMessage
  | SubscribeThreadMessage
  | NewThreadMessage
  | ResumeThreadMessage
  | DaemonStatusMessage
  | DaemonShutdownMessage
  | ConfigGetMessage
  | ThreadListMessage
  | ThreadGetMessage
  | ThreadMessagesMessage
  | ThreadStateMessage
  | ThreadUpdateStateMessage
  | ThreadArchiveMessage
  | ThreadDeleteMessage
  | ThreadCreateMessage
  | ThreadArtifactsMessage
  | ResumeInterruptsMessage
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
  | ThreadListResponse
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
    // Client → Daemon
    case 'input': return { ...parsed } as unknown as InputMessage;
    case 'loop_input': return { ...parsed } as unknown as LoopInputMessage;
    case 'command': return { ...parsed } as unknown as CommandMessage;
    case 'subscribe_thread': return { ...parsed } as unknown as SubscribeThreadMessage;
    case 'new_thread': return { ...parsed } as unknown as NewThreadMessage;
    case 'resume_thread': return { ...parsed } as unknown as ResumeThreadMessage;
    case 'daemon_status': return { ...parsed } as unknown as DaemonStatusMessage;
    case 'daemon_shutdown': return { ...parsed } as unknown as DaemonShutdownMessage;
    case 'config_get': return { ...parsed } as unknown as ConfigGetMessage;
    case 'thread_list': return { ...parsed } as unknown as ThreadListMessage;
    case 'thread_get': return { ...parsed } as unknown as ThreadGetMessage;
    case 'thread_messages': return { ...parsed } as unknown as ThreadMessagesMessage;
    case 'thread_state': return { ...parsed } as unknown as ThreadStateMessage;
    case 'thread_update_state': return { ...parsed } as unknown as ThreadUpdateStateMessage;
    case 'thread_archive': return { ...parsed } as unknown as ThreadArchiveMessage;
    case 'thread_delete': return { ...parsed } as unknown as ThreadDeleteMessage;
    case 'thread_create': return { ...parsed } as unknown as ThreadCreateMessage;
    case 'thread_artifacts': return { ...parsed } as unknown as ThreadArtifactsMessage;
    case 'resume_interrupts':
      return { ...parsed } as unknown as ResumeInterruptsMessage;
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
      if (!msg.thread_id && parsed.threadId && typeof parsed.threadId === 'string') {
        msg.thread_id = parsed.threadId;
      }
      return msg;
    }
    case 'subscription_confirmed': return { ...parsed } as unknown as SubscriptionConfirmedResponse;
    case 'error': return { ...parsed } as unknown as ErrorResponse;
    case 'daemon_ready': return { ...parsed } as unknown as DaemonReadyResponse;
    case 'daemon_status_response': return { ...parsed } as unknown as DaemonStatusResponse;
    case 'shutdown_ack': return { ...parsed } as unknown as ShutdownAckResponse;
    case 'config_get_response':
    case 'invoke_skill_response':
      return parsed;
    case 'thread_list_response': return { ...parsed } as unknown as ThreadListResponse;
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
 * Returns a non-empty AgentLoop id when present (`loop_id` preferred, then `thread_id` on
 * daemon payloads that still use the checkpoint field name).
 */
export function extractSootheLoopID(msg: unknown): [string, boolean] {
  if (!msg || typeof msg !== 'object') return ['', false];
  const m = msg as Record<string, unknown>;

  if (m.type === 'status') {
    const id = (m.loop_id ?? m.thread_id) as string | undefined;
    if (id && id !== '') return [id, true];
    return ['', false];
  }

  if (m.type === 'event') {
    const top = (m.loop_id ?? m.thread_id) as string | undefined;
    if (top && top !== '') return [top, true];

    const data = m.data as Record<string, unknown> | undefined;
    if (data && typeof data === 'object') {
      const dataId = (data['loop_id'] ?? data['loopId'] ?? data['thread_id'] ?? data['threadId']) as
        | string
        | undefined;
      if (dataId && dataId !== '') return [dataId, true];
    }
  }

  const generic = (m['loop_id'] ?? m['loopId'] ?? m['thread_id'] ?? m['threadId']) as string | undefined;
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

/** Creates a new input message with required fields. */
export function newInputMessage(text: string, threadID: string): InputMessage {
  return {
    request_id: newRequestID(),
    type: 'input',
    text,
    thread_id: threadID,
  };
}

/** Creates a new subscription message. */
export function newSubscribeThreadMessage(threadID: string, verbosity: string): SubscribeThreadMessage {
  return {
    request_id: newRequestID(),
    type: 'subscribe_thread',
    thread_id: threadID,
    verbosity,
  };
}

/** Creates a new thread message. */
export function newNewThreadMessage(workspace: string): NewThreadMessage {
  return {
    request_id: newRequestID(),
    type: 'new_thread',
    workspace,
  };
}

/** Creates a resume thread message. */
export function newResumeThreadMessage(threadID: string, workspace: string): ResumeThreadMessage {
  return {
    request_id: newRequestID(),
    type: 'resume_thread',
    thread_id: threadID,
    workspace,
  };
}

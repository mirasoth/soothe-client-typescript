/**
 * appkit — reusable application-architecture layer over the core Client
 *. Public surface mirrors Python soothe_client.appkit.
 *
 * Demoted internals (import from submodule paths in source / future subpath
 * exports): chunk_filter, events.unwrapNext, managed client factories.
 */

// Persistence seam.
export { type SessionEntry, type SessionMessage, type SessionStore } from "./session_store.js";

// SSE fan-out.
export { type SSEEvent, SSEBroadcaster } from "./broadcaster.js";

// Event classification.
export {
  ChatEventTerminal,
  EventClassifier,
  type ChatEventResult,
  type ClassifierConfig,
} from "./classifier.js";
export { DEFAULT_THINKING_STEP_EVENTS, extractThinkingStep } from "./thinking_step.js";

// Single-flight query gate.
export { ErrQueryBusy, QueryGate } from "./query_gate.js";

// Connection pool.
export {
  ConnectionPool,
  ErrPoolExhausted,
  PooledConn,
  type PoolConfig,
  defaultPoolConfig,
} from "./pool.js";

// Attachments.
export {
  compactAttachments,
  compactImageAttachment,
  type CompactImageOptions,
} from "./attachments.js";

// Turn execution.
export {
  ErrIdleTimeout,
  ErrQueryTimeout,
  StreamCloseFail,
  StreamCloseSoftComplete,
  TimeoutPolicy,
  TurnRunner,
  idleTimeoutForTurn,
  inputMessageForLoop,
  type Attachment,
  type InputOpts,
  type OnComplete,
  type OnError,
  type StreamClosePolicy,
  type TurnConfig,
} from "./turn_runner.js";

export {
  TURN_END_IDLE,
  TURN_END_STOPPED,
  TURN_END_STREAM_END,
  TurnBoundary,
  TurnLifecycleGate,
  isDaemonTurnEndEvent,
} from "./turn_boundary.js";

// DaemonSession (dual-socket TUI/CLI surface).
export {
  DEFAULT_POST_IDLE_DRAIN_MS,
  DaemonSession,
  type DaemonSessionOptions,
  type EarlyDropFn,
  type StatsFactory,
  type StreamDeliveryResolver,
  type TurnChunk,
} from "./daemon_session.js";

export { TurnEventStats } from "./observability.js";

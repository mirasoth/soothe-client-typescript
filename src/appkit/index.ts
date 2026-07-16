/**
 * appkit — reusable application-architecture layer over the core Client
 * (RFC-629 Layer 1).
 *
 * appkit is product-agnostic. Product decisions — which event phases count as
 * user-facing deliverables, how sessions are persisted, what SSE event
 * vocabulary the frontend expects — are supplied by the application via
 * configuration (e.g. deliverablePhases) and interfaces (e.g. SessionStore).
 *
 * # Layers (RFC-629)
 *
 *   - Layer 0 — the core Client (transport/lifecycle, concurrent multiplexing).
 *   - Layer 1 — this package: ConnectionPool, QueryGate, TurnRunner,
 *     EventClassifier, SSEBroadcaster, SessionStore, DaemonSession.
 *   - Layer 2 — the application: domain types, persistence implementation,
 *     product config, user-facing copy.
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
export {
  type BootstrapFunc,
  type ClientFactory,
  type ManagedClient,
  defaultBootstrapFunc,
  defaultClientFactory,
} from "./client.js";

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

export { shouldDropStreamChunkEarly } from "./chunk_filter.js";
export { isLoopScopedEvent, unwrapNext } from "./events.js";
export { TurnEventStats } from "./observability.js";

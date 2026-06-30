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
 *     EventClassifier, SSEBroadcaster, SessionStore.
 *   - Layer 2 — the application: domain types, persistence implementation,
 *     product config, user-facing copy.
 *
 * Applications construct a TurnRunner from a ConnectionPool, QueryGate,
 * EventClassifier, SessionStore, and SSEBroadcaster, then call execute() per
 * query turn.
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
export {
  DEFAULT_THINKING_STEP_EVENTS,
  extractThinkingStep,
} from "./thinking_step.js";

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

// Turn execution.
export {
  ErrQueryTimeout,
  TurnRunner,
  type Attachment,
  type InputOpts,
  type OnComplete,
  type OnError,
  type TurnConfig,
  inputMessageForLoop,
} from "./turn_runner.js";

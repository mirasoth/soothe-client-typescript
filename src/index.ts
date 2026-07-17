/**
 * Soothe WebSocket Client - TypeScript
 *
 * A WebSocket client for the Soothe daemon,
 * providing the unified `{proto, type, method, params, id}` envelope, session
 * bootstrap, and convenience RPC helpers.
 */

// Errors
export {
  ConnectionError,
  DaemonError,
  TimeoutError,
  ReconnectError,
  StaleLoopError,
  DisconnectCause,
  disconnectCauseName,
} from "./errors.js";

// Verbosity
export { VerbosityTier, shouldShow, isValidVerbosityLevel } from "./verbosity.js";
export type { VerbosityLevel } from "./verbosity.js";

// Config
export { defaultConfig, loadConfigFromEnv } from "./config.js";
export type { Config } from "./config.js";

// Protocol
export {
  PROTO_VERSION,
  DEFAULT_CLIENT_CAPABILITIES,
  CLIENT_VERSION,
  encodeMessage,
  decodeMessage,
  splitWirePayload,
  extractSootheLoopID,
  newRequestID,
  requestEnvelope,
  notificationEnvelope,
  subscribeEnvelope,
  unsubscribeEnvelope,
  connectionInitEnvelope,
  pingEnvelope,
  pongEnvelope,
  disconnectEnvelope,
  newLoopInputMessage,
  newLoopNewMessage,
  newLoopSubscribeMessage,
} from "./protocol.js";
export type {
  MessageType,
  MethodName,
  BaseEnvelope,
  RequestEnvelope,
  ResponseEnvelope,
  NotificationEnvelope,
  SubscribeEnvelope,
  NextEnvelope,
  ErrorEnvelope,
  CompleteEnvelope,
  UnsubscribeEnvelope,
  ConnectionInitEnvelope,
  ConnectionAckEnvelope,
  PingEnvelope,
  PongEnvelope,
  ReceiptResponseEnvelope,
  DisconnectEnvelope,
  StatusFrame,
  DecodedMessage,
  LoopInputParams,
  LoopNewOptions,
  StreamEventPayload,
} from "./protocol.js";
export type {
  IntentHint,
  LoopAssistantOutputPhase,
  LoopInputIntentHint,
  RemovedIntentHint,
} from "./intent_hints.js";
export {
  DEFAULT_DELIVERABLE_PHASES,
  INTENT_HINT_EMBED,
  INTENT_HINT_IMAGE_TO_TEXT,
  INTENT_HINT_OCR,
  INTENT_HINT_TEXT_COMPLETION,
  LOOP_ASSISTANT_OUTPUT_PHASES,
  REMOVED_INTENT_HINTS,
  validateLoopInputIntentHint,
} from "./intent_hints.js";

// Events
export {
  EventPlanCreated,
  EventExploreStarted,
  EventExploreMilestone,
  EventExploreStepCompleted,
  EventExploreCompleted,
  EventTacitusStarted,
  EventTacitusGatherSummary,
  EventTacitusCompleted,
  EventReplayComplete,
  EventLoopReattachedWire,
  EventCardReplayBegin,
  EventCardCreated,
  EventCardReplayEnd,
  EventStrangeLoopStarted,
  EventStrangeLoopCompleted,
  EventStrangeLoopPlanDecision,
  EventStrangeLoopReasoned,
  EventStrangeLoopStepStarted,
  EventStrangeLoopStepQueued,
  EventStrangeLoopStepCompleted,
  EventStrangeLoopContextCompacted,
  EventToolStarted,
  EventToolCompleted,
  EventToolError,
  EventStreamToolCallUpdate,
  EventToolCallUpdatesBatch,
  EventMessageReceived,
  EventMessageSent,
  EventFinalReport,
  EventAutopilotGoalStatus,
  EventAutopilotGoalProgress,
  EventAutopilotGoalCreated,
  EventAutopilotGoalCompleted,
  EventAutopilotWorkerAssigned,
  EventAutopilotWorkerUnassigned,
  EventGeneralFailed,
  parseNamespace,
  classifyEventVerbosity,
  isCompletionEvent,
  isSubagentProgressEvent,
} from "./events.js";

// Client
export { Client } from "./client.js";
export type { InputOptions, NegotiatedCapabilities } from "./client.js";

// Ephemeral one-shot RPCs (jobs / cron / autopilot)
export { CommandClient } from "./command_client.js";

// Helpers
export {
  checkDaemonStatus,
  isDaemonLive,
  requestDaemonShutdown,
  requestDaemonConfigReload,
  fetchSkillsCatalog,
  fetchConfigSection,
  fetchLoopHistory,
  fetchLoopCards,
  fetchLoopMessages,
  authenticate,
  refreshAuthToken,
  connectedWebsocket,
  protocol1Rpc,
} from "./helpers.js";

// Session
export {
  bootstrapLoopSession,
  waitDaemonReady,
  waitLoopStatusWithID,
  waitSubscriptionConfirmed,
  connectWithRetries,
} from "./session.js";

// Stream terminal helpers (used by DaemonSession consumers)
export {
  STREAM_END,
  isTurnEndCustomData,
  isTurnProgressChunk,
  inboundNeedsDeliveryAck,
} from "./stream_terminal.js";

// appkit — slim surface matching Python
export {
  DaemonSession,
  ConnectionPool,
  TurnRunner,
  QueryGate,
  EventClassifier,
  ChatEventTerminal,
  SSEBroadcaster,
  ErrPoolExhausted,
  ErrQueryBusy,
  ErrIdleTimeout,
  ErrQueryTimeout,
  TimeoutPolicy,
  StreamCloseFail,
  StreamCloseSoftComplete,
  defaultPoolConfig,
  PooledConn,
  compactAttachments,
  compactImageAttachment,
  extractThinkingStep,
  DEFAULT_THINKING_STEP_EVENTS,
  idleTimeoutForTurn,
  inputMessageForLoop,
  TurnEventStats,
  DEFAULT_POST_IDLE_DRAIN_MS,
} from "./appkit/index.js";
export type {
  SessionStore,
  SessionEntry,
  SessionMessage,
  SSEEvent,
  ChatEventResult,
  ClassifierConfig,
  PoolConfig,
  TurnConfig,
  InputOpts,
  Attachment,
  OnComplete,
  OnError,
  StreamClosePolicy,
  DaemonSessionOptions,
  TurnChunk,
  CompactImageOptions,
} from "./appkit/index.js";

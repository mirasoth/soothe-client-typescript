/**
 * Soothe WebSocket Client - TypeScript
 *
 * A WebSocket client for the Soothe daemon, providing typed message
 * protocol, session bootstrap, and convenience RPC helpers.
 */

// Errors
export { ConnectionError, DaemonError, TimeoutError } from './errors.js';

// Verbosity
export { VerbosityTier, shouldShow, isValidVerbosityLevel } from './verbosity.js';
export type { VerbosityLevel } from './verbosity.js';

// Config
export { defaultConfig, loadConfigFromEnv } from './config.js';
export type { Config } from './config.js';

// Protocol
export {
  encodeMessage,
  decodeMessage,
  splitWirePayload,
  extractSootheLoopID,
  newRequestID,
  newLoopInputMessage,
  newLoopNewMessage,
  newLoopSubscribeMessage,
} from './protocol.js';
export type {
  BaseMessage,
  LoopInputMessage,
  CommandMessage,
  DaemonStatusMessage,
  DaemonShutdownMessage,
  ConfigGetMessage,
  LoopNewMessage,
  LoopSubscribeMessage,
  LoopDetachMessage,
  LoopListMessage,
  LoopGetMessage,
  LoopTreeMessage,
  LoopPruneMessage,
  LoopDeleteMessage,
  LoopReattachMessage,
  ResumeInterruptsMessage,
  SkillsListMessage,
  ModelsListMessage,
  InvokeSkillMessage,
  DetachMessage,
  EventMessage,
  StatusResponse,
  SubscriptionConfirmedResponse,
  ErrorResponse,
  DaemonReadyResponse,
  DaemonStatusResponse,
  ShutdownAckResponse,
  LoopNewResponse,
  LoopSubscribeResponse,
  LoopDetachResponse,
  LoopListResponse,
  LoopGetResponse,
  LoopTreeResponse,
  LoopPruneResponse,
  LoopDeleteResponse,
  LoopReattachResponse,
  HistoryReplayMessage,
  HistoryReplayCompleteMessage,
  SkillsListResponse,
  ModelsListResponse,
  DecodedMessage,
} from './protocol.js';

// Events
export {
  EventPlanCreated,
  EventPlanStepStarted,
  EventPlanStepCompleted,
  EventBrowserStarted,
  EventBrowserCompleted,
  EventBrowserStepRunning,
  EventBrowserCDPConnecting,
  EventClaudeStarted,
  EventClaudeTextRunning,
  EventClaudeToolRunning,
  EventClaudeCompleted,
  EventResearchStarted,
  EventResearchCompleted,
  EventResearchJudgementReporting,
  EventResearchInternalLLM,
  EventLoopCreated,
  EventLoopStarted,
  EventLoopResumed,
  EventLoopCompleted,
  EventLoopError,
  EventLoopReattached,
  EventToolStarted,
  EventToolCompleted,
  EventToolError,
  EventAgentLoopStarted,
  EventAgentLoopIterated,
  EventAgentLoopCompleted,
  EventMessageReceived,
  EventMessageSent,
  EventChitchatResponse,
  EventFinalReport,
  parseNamespace,
  classifyEventVerbosity,
  isCompletionEvent,
  isSubagentProgressEvent,
  ESSENTIAL_EVENT_TYPES,
} from './events.js';

// Client
export { Client } from './client.js';
export type { InputOptions } from './client.js';

// Helpers
export {
  checkDaemonStatus,
  isDaemonLive,
  requestDaemonShutdown,
  fetchSkillsCatalog,
  fetchConfigSection,
} from './helpers.js';

// Session
export {
  bootstrapLoopSession,
  waitDaemonReady,
  waitLoopStatusWithID,
  waitSubscriptionConfirmed,
  connectWithRetries,
} from './session.js';
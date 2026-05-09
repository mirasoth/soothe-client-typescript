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
  newInputMessage,
  newSubscribeThreadMessage,
  newNewThreadMessage,
  newResumeThreadMessage,
} from './protocol.js';
export type {
  BaseMessage,
  InputMessage,
  LoopInputMessage,
  CommandMessage,
  SubscribeThreadMessage,
  NewThreadMessage,
  ResumeThreadMessage,
  DaemonStatusMessage,
  DaemonShutdownMessage,
  ConfigGetMessage,
  ThreadListMessage,
  ThreadGetMessage,
  ThreadMessagesMessage,
  ThreadStateMessage,
  ThreadUpdateStateMessage,
  ThreadArchiveMessage,
  ThreadDeleteMessage,
  ThreadCreateMessage,
  ThreadArtifactsMessage,
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
  ThreadListResponse,
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
  EventThreadStarted,
  EventThreadResumed,
  EventThreadCompleted,
  EventThreadError,
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
  waitThreadStatusWithID,
  waitSubscriptionConfirmed,
  connectWithRetries,
} from './session.js';

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
  LoopNewOptions,
  LoopSubscribeMessage,
  LoopDetachMessage,
  LoopListMessage,
  LoopGetMessage,
  LoopTreeMessage,
  LoopPruneMessage,
  LoopDeleteMessage,
  LoopReattachMessage,
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
  ReplayCompleteMessage,
  LoopReattachedWireMessage,
  CardReplayBeginMessage,
  CardCreatedMessage,
  CardReplayEndMessage,
  SkillsListResponse,
  ModelsListResponse,
  JobCreateMessage,
  JobCreateResponse,
  JobStatusMessage,
  JobStatusResponse,
  JobPauseMessage,
  JobPauseResponse,
  JobResumeMessage,
  JobResumeResponse,
  JobCancelMessage,
  JobCancelResponse,
  JobDagMessage,
  JobDagResponse,
  DagNode,
  DagEdge,
  JobGuidanceMessage,
  JobGuidanceResponse,
  AutopilotSubscribeMessage,
  AutopilotSubscribeResponse,
  AutopilotUnsubscribeMessage,
  AutopilotUnsubscribeResponse,
  DecodedMessage,
} from './protocol.js';

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
  isCardReplayFrame,
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
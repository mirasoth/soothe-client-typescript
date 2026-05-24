/**
 * Event namespace constants matching the Soothe daemon wire protocol.
 * Format: soothe.<domain>.<component>.<action>
 */

import { VerbosityTier } from './verbosity.js';

// Plan events
export const EventPlanCreated = 'soothe.cognition.plan.created';
export const EventPlanStepStarted = 'soothe.cognition.plan.step.started';
export const EventPlanStepCompleted = 'soothe.cognition.plan.step.completed';

// Explore subagent events (built-in wire, IG-339)
export const EventExploreStarted = 'soothe.subagent.explore.started';
export const EventExploreMilestone = 'soothe.subagent.explore.milestone';
export const EventExploreStepCompleted = 'soothe.subagent.explore.step.completed';
export const EventExploreCompleted = 'soothe.subagent.explore.completed';

// Tacitus subagent events (built-in wire, IG-339)
export const EventTacitusStarted = 'soothe.subagent.tacitus.started';
export const EventTacitusGatherSummary = 'soothe.subagent.tacitus.gather.summary';
export const EventTacitusCompleted = 'soothe.subagent.tacitus.completed';

// Loop lifecycle events (RFC-503)
export const EventLoopCreated = 'soothe.lifecycle.loop.created';
export const EventLoopStarted = 'soothe.lifecycle.loop.started';
export const EventLoopDetached = 'soothe.lifecycle.loop.detached';
export const EventLoopReattached = 'soothe.lifecycle.loop.reattached';
export const EventLoopCompleted = 'soothe.lifecycle.loop.completed';
export const EventLoopHistoryReplayed = 'soothe.lifecycle.loop.history.replayed';

// Tool events
export const EventToolStarted = 'soothe.tool.execution.started';
export const EventToolCompleted = 'soothe.tool.execution.completed';
export const EventToolError = 'soothe.tool.execution.error';

// Stream tool call events (RFC-450, IG-416)
export const EventStreamToolCallUpdate = 'soothe.stream.tool_call.update';
export const EventToolCallUpdatesBatch = 'tool_call_updates_batch';

// Agent loop events (cognition domain)
export const EventAgentLoopStarted = 'soothe.cognition.agent_loop.started';
export const EventAgentLoopIterated = 'soothe.cognition.agent_loop.iterated';
export const EventAgentLoopCompleted = 'soothe.cognition.agent_loop.completed';

// Message protocol events
export const EventMessageReceived = 'soothe.protocol.message.received';
export const EventMessageSent = 'soothe.protocol.message.sent';

// Output events
export const EventFinalReport = 'soothe.output.autonomous.final_report.reported';

// Error events
export const EventGeneralFailed = 'soothe.error.general.failed';

// ---------------------------------------------------------------------------
// Namespace parsing
// ---------------------------------------------------------------------------

/** Splits a 4-segment event namespace into domain, component, and action. */
export function parseNamespace(ns: string): { domain: string; component: string; action: string } | null {
  const parts = splitNamespace(ns);
  if (parts.length < 4 || parts[0] !== 'soothe') {
    return null;
  }
  return { domain: parts[1], component: parts[2], action: parts[3] };
}

function splitNamespace(ns: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < ns.length; i++) {
    if (ns[i] === '.') {
      parts.push(ns.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(ns.slice(start));
  return parts;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/** Returns the VerbosityTier for a given event type string. */
export function classifyEventVerbosity(eventTypeOrNamespace: string): VerbosityTier {
  const parsed = parseNamespace(eventTypeOrNamespace);
  if (!parsed) {
    return classifyByEventTypeString(eventTypeOrNamespace);
  }
  return classifyByDomainAndComponent(parsed.domain, parsed.component, eventTypeOrNamespace);
}

function classifyByDomainAndComponent(domain: string, _component: string, full: string): VerbosityTier {
  switch (domain) {
    case 'lifecycle':
      return classifyLifecycleEvent(full);
    case 'protocol':
      return VerbosityTier.Detailed;
    case 'cognition':
      return VerbosityTier.Normal;
    case 'tool':
      return VerbosityTier.Internal;
    case 'subagent':
      return classifySubagentEvent(full);
    case 'output':
    case 'error':
      return VerbosityTier.Quiet;
    default:
      return VerbosityTier.Normal;
  }
}

function classifyLifecycleEvent(full: string): VerbosityTier {
  const parsed = parseNamespace(full);
  if (!parsed) return VerbosityTier.Detailed;
  switch (parsed.action) {
    case 'completed':
    case 'ended':
    case 'error':
      return VerbosityTier.Quiet;
    case 'started':
    case 'reattached':
      return VerbosityTier.Normal;
    default:
      return VerbosityTier.Detailed;
  }
}

function classifySubagentEvent(full: string): VerbosityTier {
  const parsed = parseNamespace(full);
  if (!parsed) return VerbosityTier.Normal;
  switch (parsed.action) {
    case 'started':
    case 'completed':
      return VerbosityTier.Normal;
    default:
      return VerbosityTier.Detailed;
  }
}

function classifyByEventTypeString(s: string): VerbosityTier {
  switch (s) {
    case EventFinalReport:
    case EventGeneralFailed:
      return VerbosityTier.Quiet;
    case EventPlanCreated:
    case EventPlanStepStarted:
    case EventPlanStepCompleted:
    case EventAgentLoopStarted:
    case EventAgentLoopIterated:
    case EventExploreStarted:
    case EventExploreCompleted:
    case EventTacitusStarted:
    case EventTacitusCompleted:
    case EventLoopCreated:
    case EventLoopStarted:
    case EventLoopReattached:
      return VerbosityTier.Normal;
    case EventAgentLoopCompleted:
      return VerbosityTier.Quiet;
    default:
      return VerbosityTier.Normal;
  }
}

/** Checks if an event namespace signals loop/run completion. */
export function isCompletionEvent(namespace: string): boolean {
  const parsed = parseNamespace(namespace);
  if (!parsed) return false;
  return parsed.action === 'completed' || namespace === EventLoopCompleted;
}

/** Checks if an event is a subagent progress event. */
export function isSubagentProgressEvent(namespace: string): boolean {
  switch (namespace) {
    case EventExploreStarted:
    case EventExploreCompleted:
    case EventTacitusStarted:
    case EventTacitusCompleted:
      return true;
    default:
      return false;
  }
}

/** Essential event types that are always processed regardless of verbosity. */
export const ESSENTIAL_EVENT_TYPES: ReadonlySet<string> = new Set([
  EventLoopCompleted,
  EventGeneralFailed,
  EventFinalReport,
  EventPlanCreated,
  EventPlanStepStarted,
  EventPlanStepCompleted,
  EventAgentLoopStarted,
  EventAgentLoopIterated,
  EventAgentLoopCompleted,
  EventExploreStarted,
  EventExploreCompleted,
  EventTacitusStarted,
  EventTacitusCompleted,
]);

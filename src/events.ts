/**
 * Client-facing event namespace constants for the Soothe daemon wire protocol.
 *
 * Internal catalog types (`soothe.internal.*`) are server-only and are never
 * broadcast to WebSocket clients. Do not add them here.
 *
 * Format: soothe.<domain>.<component>.<action>
 */

import { VerbosityTier } from './verbosity.js';

// Plan events (client UX)
export const EventPlanCreated = 'soothe.cognition.plan.created';

// Explore subagent events (built-in wire, IG-339)
export const EventExploreStarted = 'soothe.subagent.explore.started';
export const EventExploreMilestone = 'soothe.subagent.explore.milestone';
export const EventExploreStepCompleted = 'soothe.subagent.explore.step.completed';
export const EventExploreCompleted = 'soothe.subagent.explore.completed';

// Tacitus subagent events (built-in wire, IG-339)
export const EventTacitusStarted = 'soothe.subagent.tacitus.started';
export const EventTacitusGatherSummary = 'soothe.subagent.tacitus.gather.summary';
export const EventTacitusCompleted = 'soothe.subagent.tacitus.completed';

// Control-plane wire envelopes (not soothe.* catalog events)
export const EventReplayComplete = 'replay_complete';
export const EventLoopReattachedWire = 'loop_reattached';

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
export const EventAgentLoopReasoned = 'soothe.cognition.agent_loop.reasoned';

// Message protocol events (client stream metadata)
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
  if (parts[1] === 'internal') {
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
    case 'cognition':
      return VerbosityTier.Normal;
    case 'protocol':
      return VerbosityTier.Detailed;
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

function classifyByEventTypeString(eventType: string): VerbosityTier {
  if (eventType === EventFinalReport || eventType === EventGeneralFailed) {
    return VerbosityTier.Quiet;
  }
  if (eventType === EventToolStarted) {
    return VerbosityTier.Internal;
  }
  return VerbosityTier.Normal;
}

// ---------------------------------------------------------------------------
// Event classification helpers
// ---------------------------------------------------------------------------

/** Event types that represent completion milestones. */
export function isCompletionEvent(eventType: string): boolean {
  return (
    eventType.endsWith('.completed') ||
    eventType.endsWith('.failed') ||
    eventType === EventGeneralFailed
  );
}

/** Lifecycle subagent events (started/completed) for progress UI. */
export function isSubagentProgressEvent(eventType: string): boolean {
  const parsed = parseNamespace(eventType);
  if (!parsed || parsed.domain !== 'subagent') {
    return false;
  }
  return parsed.action === 'started' || parsed.action === 'completed';
}

/** Essential progress event types for minimal UI surfaces. */
export const ESSENTIAL_EVENT_TYPES: ReadonlySet<string> = new Set([
  EventAgentLoopStarted,
  EventAgentLoopCompleted,
  EventAgentLoopReasoned,
  EventPlanCreated,
  EventExploreStarted,
  EventExploreCompleted,
  EventTacitusStarted,
  EventTacitusCompleted,
  EventGeneralFailed,
]);

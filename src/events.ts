/**
 * Event namespace constants matching the Soothe daemon wire protocol.
 * Format: soothe.<domain>.<component>.<action>
 */

import { VerbosityTier } from './verbosity.js';

// Plan events
export const EventPlanCreated = 'soothe.cognition.plan.created';
export const EventPlanStepStarted = 'soothe.cognition.plan.step.started';
export const EventPlanStepCompleted = 'soothe.cognition.plan.step.completed';

// Browser subagent events
export const EventBrowserStarted = 'soothe.capability.browser.started';
export const EventBrowserCompleted = 'soothe.capability.browser.completed';
export const EventBrowserStepRunning = 'soothe.capability.browser.step.running';
export const EventBrowserCDPConnecting = 'soothe.capability.browser.cdp.connecting';

// Claude subagent events
export const EventClaudeStarted = 'soothe.capability.claude.started';
export const EventClaudeTextRunning = 'soothe.capability.claude.text.running';
export const EventClaudeToolRunning = 'soothe.capability.claude.tool.running';
export const EventClaudeCompleted = 'soothe.capability.claude.completed';

// Research subagent events
export const EventResearchStarted = 'soothe.capability.research.started';
export const EventResearchCompleted = 'soothe.capability.research.completed';
export const EventResearchJudgementReporting = 'soothe.capability.research.judgement.reporting';
export const EventResearchInternalLLM = 'soothe.capability.research.internal_llm.run';

// Loop lifecycle events (RFC-503)
export const EventLoopCreated = 'soothe.loop.created';
export const EventLoopStarted = 'soothe.loop.started';
export const EventLoopResumed = 'soothe.loop.resumed';
export const EventLoopCompleted = 'soothe.loop.completed';
export const EventLoopError = 'soothe.loop.error';
export const EventLoopReattached = 'soothe.loop.reattached';

// Tool events
export const EventToolStarted = 'soothe.tool.execution.started';
export const EventToolCompleted = 'soothe.tool.execution.completed';
export const EventToolError = 'soothe.tool.execution.error';

// Agent loop events (cognition domain)
export const EventAgentLoopStarted = 'soothe.cognition.agent_loop.started';
export const EventAgentLoopIterated = 'soothe.cognition.agent_loop.iterated';
export const EventAgentLoopCompleted = 'soothe.cognition.agent_loop.completed';

// Message protocol events
export const EventMessageReceived = 'soothe.protocol.message.received';
export const EventMessageSent = 'soothe.protocol.message.sent';

// Output events
export const EventFinalReport = 'soothe.output.autonomous.final_report.reported';

// ---------------------------------------------------------------------------
// Namespace parsing
// ---------------------------------------------------------------------------

/** Splits an event namespace into its components. Handles both 3 and 4-segment namespaces. */
export function parseNamespace(ns: string): { domain: string; component: string; action: string } | null {
  const parts = splitNamespace(ns);
  if (parts.length < 3 || parts[0] !== 'soothe') {
    return null;
  }
  // 3-segment: soothe.loop.completed -> domain=loop, component=loop, action=completed
  // 4-segment: soothe.cognition.plan.created -> domain=cognition, component=plan, action=created
  if (parts.length === 3) {
    return { domain: parts[1], component: parts[1], action: parts[2] };
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
    case 'loop': return VerbosityTier.Detailed;
    case 'protocol': return VerbosityTier.Detailed;
    case 'cognition': return VerbosityTier.Normal;
    case 'tool': return VerbosityTier.Internal;
    case 'capability': return classifyCapabilityEvent(full);
    case 'output': return VerbosityTier.Quiet;
    default: return VerbosityTier.Normal;
  }
}

function classifyCapabilityEvent(full: string): VerbosityTier {
  const parsed = parseNamespace(full);
  if (!parsed) return VerbosityTier.Normal;
  switch (parsed.action) {
    case 'started': case 'completed': return VerbosityTier.Normal;
    default: return VerbosityTier.Detailed;
  }
}

function classifyByEventTypeString(s: string): VerbosityTier {
  switch (s) {
    case EventFinalReport:
    case EventLoopError:
      return VerbosityTier.Quiet;
    case EventPlanCreated:
    case EventPlanStepStarted:
    case EventPlanStepCompleted:
    case EventAgentLoopStarted:
    case EventAgentLoopIterated:
    case EventBrowserStarted:
    case EventBrowserCompleted:
    case EventClaudeStarted:
    case EventClaudeCompleted:
    case EventResearchStarted:
    case EventResearchCompleted:
    case EventResearchJudgementReporting:
    case EventLoopCreated:
    case EventLoopStarted:
    case EventLoopResumed:
    case EventLoopCompleted:
    case EventLoopReattached:
      return VerbosityTier.Normal;
    case EventAgentLoopCompleted:
      return VerbosityTier.Quiet;
    default:
      return VerbosityTier.Normal;
  }
}

/** Checks if an event namespace signals loop completion. */
export function isCompletionEvent(namespace: string): boolean {
  const parsed = parseNamespace(namespace);
  if (!parsed) return false;
  return parsed.action === 'completed' || namespace === EventLoopCompleted;
}

/** Checks if an event is a subagent progress event. */
export function isSubagentProgressEvent(namespace: string): boolean {
  switch (namespace) {
    case EventBrowserStarted:
    case EventBrowserCompleted:
    case EventClaudeStarted:
    case EventClaudeCompleted:
    case EventResearchStarted:
    case EventResearchCompleted:
    case EventResearchJudgementReporting:
      return true;
    default:
      return false;
  }
}

/** Essential event types that are always processed regardless of verbosity. */
export const ESSENTIAL_EVENT_TYPES: ReadonlySet<string> = new Set([
  EventLoopCompleted,
  EventLoopError,
  EventFinalReport,
  EventPlanCreated,
  EventPlanStepStarted,
  EventPlanStepCompleted,
  EventAgentLoopStarted,
  EventAgentLoopIterated,
  EventAgentLoopCompleted,
  EventBrowserStarted,
  EventBrowserCompleted,
  EventClaudeStarted,
  EventClaudeCompleted,
  EventResearchStarted,
  EventResearchCompleted,
  EventResearchJudgementReporting,
]);
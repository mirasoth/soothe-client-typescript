import { describe, it, expect } from 'vitest';
import {
  parseNamespace, classifyEventVerbosity, isCompletionEvent, isSubagentProgressEvent,
  ESSENTIAL_EVENT_TYPES,
  EventPlanCreated, EventPlanStepStarted, EventPlanStepCompleted,
  EventBrowserStarted, EventBrowserCompleted, EventBrowserStepRunning, EventBrowserCDPConnecting,
  EventClaudeStarted, EventClaudeTextRunning, EventClaudeToolRunning, EventClaudeCompleted,
  EventResearchStarted, EventResearchCompleted, EventResearchJudgementReporting,
  EventLoopStarted, EventLoopResumed, EventLoopCompleted, EventLoopError,
  EventToolStarted,
  EventFinalReport,
  EventAgentLoopCompleted,
} from '../src/events.js';
import { VerbosityTier } from '../src/verbosity.js';

describe('parseNamespace', () => {
  it('valid namespace', () => {
    const result = parseNamespace('soothe.cognition.plan.created');
    expect(result).toEqual({ domain: 'cognition', component: 'plan', action: 'created' });
  });

  it('loop namespace', () => {
    const result = parseNamespace('soothe.loop.completed');
    expect(result).toEqual({ domain: 'loop', component: 'loop', action: 'completed' });
  });

  it('invalid namespace', () => {
    expect(parseNamespace('invalid')).toBeNull();
  });

  it('short path', () => {
    expect(parseNamespace('soothe.cognition')).toBeNull();
  });

  it('deep path takes index 3', () => {
    const result = parseNamespace('soothe.capability.research.internal_llm.run');
    expect(result).toEqual({ domain: 'capability', component: 'research', action: 'internal_llm' });
  });
});

describe('classifyEventVerbosity', () => {
  it('quiet tier', () => {
    expect(classifyEventVerbosity(EventFinalReport)).toBe(VerbosityTier.Quiet);
  });

  it('normal tier', () => {
    expect(classifyEventVerbosity(EventPlanCreated)).toBe(VerbosityTier.Normal);
    expect(classifyEventVerbosity(EventPlanStepStarted)).toBe(VerbosityTier.Normal);
    expect(classifyEventVerbosity(EventPlanStepCompleted)).toBe(VerbosityTier.Normal);
    expect(classifyEventVerbosity(EventBrowserStarted)).toBe(VerbosityTier.Normal);
    expect(classifyEventVerbosity(EventBrowserCompleted)).toBe(VerbosityTier.Normal);
    expect(classifyEventVerbosity(EventClaudeStarted)).toBe(VerbosityTier.Normal);
    expect(classifyEventVerbosity(EventClaudeCompleted)).toBe(VerbosityTier.Normal);
    expect(classifyEventVerbosity(EventResearchStarted)).toBe(VerbosityTier.Normal);
    expect(classifyEventVerbosity(EventResearchCompleted)).toBe(VerbosityTier.Normal);
  });

  it('detailed tier', () => {
    expect(classifyEventVerbosity(EventLoopStarted)).toBe(VerbosityTier.Detailed);
    expect(classifyEventVerbosity(EventLoopResumed)).toBe(VerbosityTier.Detailed);
    expect(classifyEventVerbosity(EventBrowserStepRunning)).toBe(VerbosityTier.Detailed);
    expect(classifyEventVerbosity(EventBrowserCDPConnecting)).toBe(VerbosityTier.Detailed);
    expect(classifyEventVerbosity(EventClaudeTextRunning)).toBe(VerbosityTier.Detailed);
    expect(classifyEventVerbosity(EventClaudeToolRunning)).toBe(VerbosityTier.Detailed);
  });

  it('internal tier', () => {
    expect(classifyEventVerbosity(EventToolStarted)).toBe(VerbosityTier.Internal);
  });
});

describe('isCompletionEvent', () => {
  it('completed actions', () => {
    expect(isCompletionEvent(EventLoopCompleted)).toBe(true);
    expect(isCompletionEvent('soothe.capability.browser.completed')).toBe(true);
    expect(isCompletionEvent('soothe.cognition.plan.completed')).toBe(true);
  });

  it('non-completed events', () => {
    expect(isCompletionEvent(EventPlanCreated)).toBe(false);
    expect(isCompletionEvent(EventBrowserStarted)).toBe(false);
    expect(isCompletionEvent('invalid')).toBe(false);
  });
});

describe('isSubagentProgressEvent', () => {
  it('subagent progress events', () => {
    expect(isSubagentProgressEvent(EventBrowserStarted)).toBe(true);
    expect(isSubagentProgressEvent(EventBrowserCompleted)).toBe(true);
    expect(isSubagentProgressEvent(EventClaudeStarted)).toBe(true);
    expect(isSubagentProgressEvent(EventClaudeCompleted)).toBe(true);
    expect(isSubagentProgressEvent(EventResearchStarted)).toBe(true);
    expect(isSubagentProgressEvent(EventResearchCompleted)).toBe(true);
    expect(isSubagentProgressEvent(EventResearchJudgementReporting)).toBe(true);
  });

  it('non-progress events', () => {
    expect(isSubagentProgressEvent(EventBrowserStepRunning)).toBe(false);
    expect(isSubagentProgressEvent(EventPlanCreated)).toBe(false);
  });
});

describe('ESSENTIAL_EVENT_TYPES', () => {
  it('contains essential events', () => {
    const essential = [
      EventLoopCompleted, EventLoopError, EventFinalReport,
      EventPlanCreated, EventBrowserStarted, EventClaudeStarted, EventResearchStarted,
    ];
    for (const ev of essential) {
      expect(ESSENTIAL_EVENT_TYPES.has(ev)).toBe(true);
    }
  });

  it('does not contain non-essential events', () => {
    expect(ESSENTIAL_EVENT_TYPES.has(EventBrowserStepRunning)).toBe(false);
  });
});
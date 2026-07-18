import { describe, it, expect } from "vitest";
import {
  parseNamespace,
  classifyEventVerbosity,
  isCompletionEvent,
  isSubagentProgressEvent,
  EventPlanCreated,
  EventExplorerStarted,
  EventExplorerCompleted,
  EventExplorerStepCompleted,
  EventDeepResearchStarted,
  EventDeepResearchCompleted,
  EventToolStarted,
  EventFinalReport,
  EventGeneralFailed,
  EventStrangeLoopCompleted,
  EventStrangeLoopReasoned,
} from "../src/events.js";
import { VerbosityTier } from "../src/verbosity.js";

describe("parseNamespace", () => {
  it("valid namespace", () => {
    const result = parseNamespace("soothe.cognition.plan.created");
    expect(result).toEqual({
      domain: "cognition",
      component: "plan",
      action: "created",
    });
  });

  it("rejects internal namespaces (not exposed to clients)", () => {
    expect(parseNamespace("soothe.internal.loop.completed")).toBeNull();
  });

  it("invalid namespace", () => {
    expect(parseNamespace("invalid")).toBeNull();
  });

  it("short path", () => {
    expect(parseNamespace("soothe.cognition")).toBeNull();
  });

  it("legacy 3-segment path is rejected", () => {
    expect(parseNamespace("soothe.loop.completed")).toBeNull();
  });
});

describe("classifyEventVerbosity", () => {
  it("quiet tier", () => {
    expect(classifyEventVerbosity(EventFinalReport)).toBe(VerbosityTier.Quiet);
    expect(classifyEventVerbosity(EventGeneralFailed)).toBe(VerbosityTier.Quiet);
  });

  it("normal tier", () => {
    expect(classifyEventVerbosity(EventPlanCreated)).toBe(VerbosityTier.Normal);
    expect(classifyEventVerbosity(EventStrangeLoopReasoned)).toBe(VerbosityTier.Normal);
    expect(classifyEventVerbosity(EventExplorerStarted)).toBe(VerbosityTier.Normal);
    expect(classifyEventVerbosity(EventExplorerCompleted)).toBe(VerbosityTier.Normal);
    expect(classifyEventVerbosity(EventDeepResearchStarted)).toBe(VerbosityTier.Normal);
    expect(classifyEventVerbosity(EventDeepResearchCompleted)).toBe(VerbosityTier.Normal);
  });

  it("detailed tier", () => {
    expect(classifyEventVerbosity(EventExplorerStepCompleted)).toBe(VerbosityTier.Detailed);
  });

  it("internal tier", () => {
    expect(classifyEventVerbosity(EventToolStarted)).toBe(VerbosityTier.Internal);
  });
});

describe("isCompletionEvent", () => {
  it("completed actions", () => {
    expect(isCompletionEvent(EventStrangeLoopCompleted)).toBe(true);
    expect(isCompletionEvent("soothe.subagent.explorer.completed")).toBe(true);
    expect(isCompletionEvent("soothe.cognition.plan.completed")).toBe(true);
  });

  it("non-completed events", () => {
    expect(isCompletionEvent(EventPlanCreated)).toBe(false);
    expect(isCompletionEvent(EventExplorerStarted)).toBe(false);
    expect(isCompletionEvent("invalid")).toBe(false);
  });
});

describe("isSubagentProgressEvent", () => {
  it("subagent progress events", () => {
    expect(isSubagentProgressEvent(EventExplorerStarted)).toBe(true);
    expect(isSubagentProgressEvent(EventExplorerCompleted)).toBe(true);
    expect(isSubagentProgressEvent(EventDeepResearchStarted)).toBe(true);
    expect(isSubagentProgressEvent(EventDeepResearchCompleted)).toBe(true);
  });

  it("non-progress events", () => {
    expect(isSubagentProgressEvent(EventExplorerStepCompleted)).toBe(false);
    expect(isSubagentProgressEvent(EventPlanCreated)).toBe(false);
  });
});

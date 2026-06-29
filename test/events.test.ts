import { describe, it, expect } from "vitest";
import {
  parseNamespace,
  classifyEventVerbosity,
  isCompletionEvent,
  isSubagentProgressEvent,
  ESSENTIAL_EVENT_TYPES,
  EventPlanCreated,
  EventExploreStarted,
  EventExploreCompleted,
  EventExploreStepCompleted,
  EventTacitusStarted,
  EventTacitusCompleted,
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
    expect(classifyEventVerbosity(EventGeneralFailed)).toBe(
      VerbosityTier.Quiet,
    );
  });

  it("normal tier", () => {
    expect(classifyEventVerbosity(EventPlanCreated)).toBe(VerbosityTier.Normal);
    expect(classifyEventVerbosity(EventStrangeLoopReasoned)).toBe(
      VerbosityTier.Normal,
    );
    expect(classifyEventVerbosity(EventExploreStarted)).toBe(
      VerbosityTier.Normal,
    );
    expect(classifyEventVerbosity(EventExploreCompleted)).toBe(
      VerbosityTier.Normal,
    );
    expect(classifyEventVerbosity(EventTacitusStarted)).toBe(
      VerbosityTier.Normal,
    );
    expect(classifyEventVerbosity(EventTacitusCompleted)).toBe(
      VerbosityTier.Normal,
    );
  });

  it("detailed tier", () => {
    expect(classifyEventVerbosity(EventExploreStepCompleted)).toBe(
      VerbosityTier.Detailed,
    );
  });

  it("internal tier", () => {
    expect(classifyEventVerbosity(EventToolStarted)).toBe(
      VerbosityTier.Internal,
    );
  });
});

describe("isCompletionEvent", () => {
  it("completed actions", () => {
    expect(isCompletionEvent(EventStrangeLoopCompleted)).toBe(true);
    expect(isCompletionEvent("soothe.subagent.explore.completed")).toBe(true);
    expect(isCompletionEvent("soothe.cognition.plan.completed")).toBe(true);
  });

  it("non-completed events", () => {
    expect(isCompletionEvent(EventPlanCreated)).toBe(false);
    expect(isCompletionEvent(EventExploreStarted)).toBe(false);
    expect(isCompletionEvent("invalid")).toBe(false);
  });
});

describe("isSubagentProgressEvent", () => {
  it("subagent progress events", () => {
    expect(isSubagentProgressEvent(EventExploreStarted)).toBe(true);
    expect(isSubagentProgressEvent(EventExploreCompleted)).toBe(true);
    expect(isSubagentProgressEvent(EventTacitusStarted)).toBe(true);
    expect(isSubagentProgressEvent(EventTacitusCompleted)).toBe(true);
  });

  it("non-progress events", () => {
    expect(isSubagentProgressEvent(EventExploreStepCompleted)).toBe(false);
    expect(isSubagentProgressEvent(EventPlanCreated)).toBe(false);
  });
});

describe("ESSENTIAL_EVENT_TYPES", () => {
  it("contains essential events", () => {
    const essential = [
      EventStrangeLoopReasoned,
      EventGeneralFailed,
      EventPlanCreated,
      EventExploreStarted,
      EventTacitusStarted,
    ];
    for (const ev of essential) {
      expect(ESSENTIAL_EVENT_TYPES.has(ev)).toBe(true);
    }
  });

  it("does not contain non-essential events", () => {
    expect(ESSENTIAL_EVENT_TYPES.has(EventExploreStepCompleted)).toBe(false);
  });
});

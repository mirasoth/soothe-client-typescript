/**
 * Event classifier for appkit.
 *
 * Maps a stream of decoded daemon events into deliverable/streaming/terminal
 * outcomes, keyed on (namespace, mode, phase). The app-agnostic successor to
 * product-specific ProcessChatEvent helpers, with the deliverable phase set
 * promoted from hardcoded constants to configuration.
 *
 * Event shape: a protocol-1 `next` envelope carries
 * `{type:"next", payload:{namespace, mode, data, loop_id}}`. The daemon
 * wraps legacy free-form frames as `{payload:{namespace, mode:<orig type>,
 * data:<orig frame>}}`. The classifier inspects the payload's
 * `mode`/`data`/`namespace` and the inner message's `phase`/`type`/`content`.
 */

import { DaemonError } from "../errors.js";
import { EventFinalReport } from "../events.js";
import { DEFAULT_THINKING_STEP_EVENTS, extractThinkingStep } from "./thinking_step.js";

/** How a processed event should end the query loop. */
export enum ChatEventTerminal {
  /** Accumulate content; the query is still running. */
  Continue = 0,
  /** A user-visible final reply; persist it. */
  DeliverableComplete = 1,
  /** The query failed; persist an error. */
  FailedComplete = 2,
}

/** The structured outcome of classifying one daemon event. */
export interface ChatEventResult {
  content?: string;
  /** User-visible progress line (not a final reply). */
  thinkingStep?: string;
  terminal: ChatEventTerminal;
  /** soothe wire event type when terminal === DeliverableComplete. */
  completionEvent?: string;
  err?: Error;
}

/**
 * Product-specific decisions an EventClassifier needs. The DeliverablePhases
 * set is the key product knob: which message `phase` values count as
 * user-facing deliverables (triarch uses quiz, goal_completion, chitchat, and
 * direct intent_hint phases text_completion, image_to_text, ocr, embed;
 * other apps pass their own).
 */
export interface ClassifierConfig {
  /** Recognizes loop-tagged message phases that may end a query with
   * user-facing text. Required. */
  deliverablePhases: ReadonlySet<string>;
  /** Minimum trimmed rune count for a reply to be persisted as final
   * (avoids finishing on stub ACKs like "..."). Defaults to 8. */
  minDeliverableRunes?: number;
  /** Optional app override of the default thinking-step event allowlist. */
  thinkingStepEvents?: ReadonlySet<string>;
  /**
   * When true, a status frame with state=idle and non-empty accumulated
   * assistant text is DeliverableComplete (typical for intent-hint turns).
   * Default false keeps Continue-on-status behaviour.
   */
  treatStatusIdleAsComplete?: boolean;
}

/** Event type of the daemon's replay completion signal (internal). */
const EVENT_LOOP_HISTORY_REPLAYED = "soothe.lifecycle.loop.history.replayed";

/** Maps a stream of decoded daemon events into deliverable/streaming/terminal outcomes. */
export class EventClassifier {
  private deliverablePhases: ReadonlySet<string>;
  private minDeliverableRunes: number;
  private thinkingStepEvents?: ReadonlySet<string>;
  private treatStatusIdleAsComplete: boolean;

  constructor(cfg: ClassifierConfig) {
    if (!cfg.deliverablePhases) {
      throw new Error("appkit: ClassifierConfig.deliverablePhases must not be nil");
    }
    this.deliverablePhases = cfg.deliverablePhases;
    this.minDeliverableRunes =
      cfg.minDeliverableRunes && cfg.minDeliverableRunes > 0 ? cfg.minDeliverableRunes : 8;
    this.thinkingStepEvents = cfg.thinkingStepEvents;
    this.treatStatusIdleAsComplete = Boolean(cfg.treatStatusIdleAsComplete);
  }

  /**
   * Inspects one decoded event and returns its outcome. `accumulated` is the
   * running assistant text so far, used to pick the final reply when a
   * deliverable event arrives.
   */
  classify(msg: unknown, accumulated: string): ChatEventResult {
    return this.processChatEvent(msg, accumulated);
  }

  /**
   * Reports whether a persisted completion_event is user-facing. Uses the
   * configured deliverable phase set; recognizes the protocol output namespace
   * and final_report component as deliverable.
   */
  isDeliverableCompletionEvent(eventType: string): boolean {
    if (!eventType) return false;
    switch (eventType) {
      case "status.idle":
      case "idle_timeout":
      case "query_timeout":
      case "stream_closed":
        return true;
    }
    if (eventType === EventFinalReport) return true;
    if (eventType.startsWith("soothe.protocol.message.")) {
      const phase = eventType.slice("soothe.protocol.message.".length);
      return this.isDeliverableLoopPhase(phase);
    }
    return eventType.includes("soothe.output") && eventType.includes("responded");
  }

  isDeliverableLoopPhase(phase: string): boolean {
    return this.deliverablePhases.has(phase);
  }

  private deliverableResult(content: string, completionEvent: string): ChatEventResult {
    return { content, terminal: ChatEventTerminal.DeliverableComplete, completionEvent };
  }

  private continueResult(content: string): ChatEventResult {
    return { content, terminal: ChatEventTerminal.Continue };
  }

  private failedResult(err: Error): ChatEventResult {
    return { terminal: ChatEventTerminal.FailedComplete, err };
  }

  /** Reports whether trimmed assistant text is long enough to persist as final. */
  isSubstantiveAssistantReply(content: string): boolean {
    return [...content.trim()].length >= this.minDeliverableRunes;
  }

  /**
   * Picks the user-visible reply for a completed query. Only a deliverable
   * terminal result with a recognized completion event yields a final reply.
   */
  resolveDeliverableFinalContent(
    eventResult: ChatEventResult,
    _accumulated: string,
  ): [string, boolean] {
    if (eventResult.terminal !== ChatEventTerminal.DeliverableComplete) return ["", false];
    if (!this.isDeliverableCompletionEvent(eventResult.completionEvent ?? "")) return ["", false];
    const final = (eventResult.content ?? "").trim();
    if (final) return [final, true];
    return ["", false];
  }

  /** The event→outcome mapper, ported from triarch's ProcessChatEvent. */
  private processChatEvent(msg: unknown, accumulated: string): ChatEventResult {
    if (!msg || typeof msg !== "object") {
      return { terminal: ChatEventTerminal.Continue };
    }
    const m = msg as Record<string, unknown>;
    const typ = m.type as string | undefined;

    // Protocol-1 `next` envelope: the daemon wraps legacy frames in payload.
    if (typ === "next") {
      return this.classifyNextEnvelope(m, accumulated);
    }

    // Protocol-1 RPC responses / subscription confirmations arrive as
    // response/next/complete envelopes. An `error` envelope is a daemon
    // failure; everything else is a protocol-level ack (not a deliverable).
    if (
      typ === "response" ||
      typ === "complete" ||
      typ === "receipt_response" ||
      typ === "connection_ack"
    ) {
      return { terminal: ChatEventTerminal.Continue };
    }
    if (typ === "status") {
      if (
        this.treatStatusIdleAsComplete &&
        String(m.state ?? "")
          .trim()
          .toLowerCase() === "idle" &&
        this.isSubstantiveAssistantReply(accumulated)
      ) {
        return this.deliverableResult(accumulated.trim(), "status.idle");
      }
      return { terminal: ChatEventTerminal.Continue };
    }
    if (typ === "error") {
      const errObj = (m.error as { code?: number; message?: string; data?: unknown }) ?? {};
      const code = typeof errObj.code === "number" ? errObj.code : -32603;
      return this.failedResult(
        new DaemonError(code, errObj.message ?? "daemon error", errObj.data),
      );
    }

    // Legacy flat-form `event` frame (mode/data at top level).
    if (typ === "event") {
      return this.classifyEventPayload(
        (m.namespace as unknown) ?? null,
        (m.mode as string) ?? "",
        m.data,
      );
    }

    return { terminal: ChatEventTerminal.Continue };
  }

  /** Classifies a `next` envelope by projecting its payload. */
  private classifyNextEnvelope(env: Record<string, unknown>, accumulated: string): ChatEventResult {
    const payload = (env.payload as Record<string, unknown> | undefined) ?? {};
    // The inner event frame lives in payload.data, with its own mode/data.
    const innerData = payload.data as Record<string, unknown> | undefined;
    if (innerData && typeof innerData === "object") {
      const innerType = (innerData.type as string) ?? "";
      if (innerType === "status") {
        return this.processChatEvent(innerData, accumulated);
      }
      const innerMode = (innerData.mode as string) ?? "";
      if (innerMode) {
        return this.classifyEventPayload(
          (innerData.namespace as unknown) ?? payload.namespace ?? null,
          innerMode,
          innerData.data,
        );
      }
    }
    // Fallback: payload itself carries mode/data directly.
    const mode = (payload.mode as string) ?? "";
    if (mode === "status" || mode === "") {
      if (typeof payload.state === "string" || (innerData && "state" in (innerData ?? {}))) {
        return this.processChatEvent({ type: "status", ...(innerData ?? payload) }, accumulated);
      }
    }
    if (mode) {
      return this.classifyEventPayload((payload.namespace as unknown) ?? null, mode, payload.data);
    }
    return { terminal: ChatEventTerminal.Continue };
  }

  /**
   * Classifies an event payload by (namespace, mode, phase). `data` may be a
   * map or an array of messages (mode="messages").
   */
  private classifyEventPayload(namespace: unknown, mode: string, data: unknown): ChatEventResult {
    // Normalize namespace to a string for matching.
    const ns = namespaceToString(namespace);

    // Normalize data to a map for thinking-step / output extraction.
    const dataMap = normalizeEventData(data);

    if (dataMap) {
      let dataType = ns;
      const dt = dataMap["type"];
      if (typeof dt === "string" && dt) dataType = dt;
      if (dataType === EVENT_LOOP_HISTORY_REPLAYED) {
        return { terminal: ChatEventTerminal.Continue };
      }
      const [step, ok] = extractThinkingStep(dataType, dataMap, this.thinkingStepEvents);
      if (ok) {
        return { thinkingStep: step, terminal: ChatEventTerminal.Continue };
      }
    }

    // mode="messages": assistant content (streaming chunks or deliverable).
    if (mode === "messages") {
      const result = this.classifyMessagesMode(data, ns);
      if (result) return result;
    }

    if (!dataMap) {
      return { terminal: ChatEventTerminal.Continue };
    }

    let dataType = ns;
    const dt = dataMap["type"];
    if (typeof dt === "string" && dt) dataType = dt;
    let completionEvent = dataType;
    if (!completionEvent) completionEvent = ns;

    // soothe.output / responded namespaces.
    if (
      isNamespaceMatch(ns, dataType, "soothe.output") ||
      isNamespaceMatch(ns, dataType, "responded")
    ) {
      const [content, ok] = extractContentFromData(dataMap);
      if (ok) {
        if (this.isFinalOutputEvent(dataType, ns)) {
          return this.deliverableResult(content, completionEvent);
        }
        return this.continueResult(content);
      }
    }

    if (
      isNamespaceMatch(ns, dataType, "agent_loop.completed") ||
      isNamespaceMatch(ns, dataType, "agent_loop.reasoned") ||
      isNamespaceMatch(ns, dataType, "loop.completed")
    ) {
      const [content, ok] = extractContentFromData(dataMap);
      if (ok) return this.continueResult(content);
    }

    if (isNamespaceMatch(ns, dataType, "final_report")) {
      const [content, ok] = extractContentFromData(dataMap);
      if (ok) return this.deliverableResult(content, completionEvent);
    }

    if (dataType.includes("soothe.error.") || ns.includes("soothe.error.")) {
      const errType = dataType || ns;
      const msg = dataMap["message"];
      if (typeof msg === "string" && msg) {
        return this.failedResult(new Error(`${errType}: ${msg}`));
      }
      const [content, ok] = extractContentFromData(dataMap);
      if (ok) return this.failedResult(new Error(`${errType}: ${content}`));
      return this.failedResult(new Error(errType));
    }

    if (
      isNamespaceMatch(ns, dataType, "stream") ||
      isNamespaceMatch(ns, dataType, "progress") ||
      isNamespaceMatch(ns, dataType, "tool_call_updates_batch") ||
      isNamespaceMatch(ns, dataType, "soothe.stream.tool_call.update")
    ) {
      const delta = dataMap["delta"];
      if (typeof delta === "string") return this.continueResult(delta);
    }

    if (
      isNamespaceMatch(ns, dataType, "heartbeat") ||
      isNamespaceMatch(ns, dataType, "system.daemon") ||
      isNamespaceMatch(ns, dataType, "agent_loop.started") ||
      isNamespaceMatch(ns, dataType, "intent.classified")
    ) {
      return { terminal: ChatEventTerminal.Continue };
    }

    return { terminal: ChatEventTerminal.Continue };
  }

  /** Classifies a mode="messages" payload (array of message objects). */
  private classifyMessagesMode(data: unknown, _ns: string): ChatEventResult | null {
    const items = Array.isArray(data) ? data : null;
    if (!items || items.length === 0) return null;
    const first = items[0];
    if (!first || typeof first !== "object") return null;

    const [msgType, rawContent, phase, hasPayload] = firstMessagePayload(data);
    if (hasPayload && rawContent && isStreamingMessageType(msgType)) {
      return this.continueResult(rawContent);
    }

    // Loop-tagged assistant message.
    const loopMsg = loopAIMessage(data);
    if (loopMsg) {
      const content = loopMsg.content;
      if (content) {
        if (isStreamingMessageType(loopMsg.type)) {
          return this.continueResult(content);
        }
        if (
          this.isDeliverableLoopPhase(loopMsg.phase) &&
          this.isSubstantiveAssistantReply(content)
        ) {
          return this.deliverableResult(content, "soothe.protocol.message." + loopMsg.phase);
        }
        return this.continueResult(content);
      }
    }

    // Unphased terminal AI text is streamable narration only.
    const [unphasedContent, unphasedOk] = this.messagesModeAssistantContent(data);
    if (unphasedOk) {
      return this.continueResult(unphasedContent);
    }

    if (hasPayload && rawContent) {
      if (isTerminalMessageType(msgType) || msgType === "") {
        if (this.isDeliverableLoopPhase(phase) && this.isSubstantiveAssistantReply(rawContent)) {
          return this.deliverableResult(rawContent, "soothe.protocol.message." + phase);
        }
        return this.continueResult(rawContent);
      }
      return this.continueResult(rawContent);
    }
    return null;
  }

  /**
   * Extracts plain assistant text from mode="messages" events that carry a
   * terminal AIMessage without loop-tagged phase metadata (prefer named
   * deliverablePhases such as text_completion).
   */
  private messagesModeAssistantContent(data: unknown): [string, boolean] {
    if (!Array.isArray(data) || data.length === 0) return ["", false];
    const msgMap = data[0] as Record<string, unknown>;
    if (!msgMap || typeof msgMap !== "object") return ["", false];
    const phase = typeof msgMap.phase === "string" ? msgMap.phase.trim() : "";
    if (phase) return ["", false];
    const msgType = typeof msgMap.type === "string" ? msgMap.type : "";
    if (msgType && !isTerminalMessageType(msgType)) return ["", false];
    const content = extractContentFromMessage(msgMap).trim();
    if (!content) return ["", false];
    return [content, true];
  }

  /** soothe output/responded events that carry user-facing final text. */
  private isFinalOutputEvent(dataType: string, ns: string): boolean {
    const combined = dataType + " " + ns;
    if (combined.includes("final_report")) return true;
    for (const phase of this.deliverablePhases) {
      if (combined.includes(phase)) return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Helpers (module-private)
// ---------------------------------------------------------------------------

function isStreamingMessageType(msgType: string): boolean {
  return msgType === "AIMessageChunk" || msgType === "ai_chunk" || msgType === "message_chunk";
}

function isTerminalMessageType(msgType: string): boolean {
  return msgType === "AIMessage" || msgType === "ai" || msgType === "assistant";
}

/** Extracts the first message's (type, content, phase, hasPayload). */
function firstMessagePayload(data: unknown): [string, string, string, boolean] {
  if (!Array.isArray(data) || data.length === 0) return ["", "", "", false];
  const msgMap = data[0] as Record<string, unknown>;
  if (!msgMap || typeof msgMap !== "object") return ["", "", "", false];
  const msgType = typeof msgMap.type === "string" ? msgMap.type : "";
  const phase = typeof msgMap.phase === "string" ? msgMap.phase : "";
  const content = extractContentFromMessage(msgMap);
  return [msgType, content, phase, true];
}

/** Extracts a loop-tagged assistant message (type, content, phase). */
function loopAIMessage(data: unknown): { type: string; content: string; phase: string } | null {
  if (!Array.isArray(data) || data.length === 0) return null;
  const msgMap = data[0] as Record<string, unknown>;
  if (!msgMap || typeof msgMap !== "object") return null;
  const phase = typeof msgMap.phase === "string" ? msgMap.phase.trim() : "";
  if (!phase) return null;
  const type = typeof msgMap.type === "string" ? msgMap.type : "";
  const content = extractContentFromMessage(msgMap);
  return { type, content, phase };
}

function extractContentFromMessage(msgMap: Record<string, unknown>): string {
  const c = msgMap.content;
  if (typeof c === "string" && c) return c;
  if (Array.isArray(c) && c.length > 0) {
    let b = "";
    for (const item of c) {
      if (typeof item === "string") {
        b += item;
        continue;
      }
      if (item && typeof item === "object") {
        const blk = item as Record<string, unknown>;
        const t = blk.text;
        if (typeof t === "string") b += t;
      }
    }
    return b;
  }
  const blocks = msgMap.content_blocks;
  if (Array.isArray(blocks) && blocks.length > 0) {
    let b = "";
    for (const blk of blocks) {
      if (blk && typeof blk === "object") {
        const m = blk as Record<string, unknown>;
        const t = m.text;
        if (typeof t === "string") b += t;
      }
    }
    return b;
  }
  return "";
}

function extractContentFromData(data: Record<string, unknown>): [string, boolean] {
  for (const key of [
    "final_stdout_message",
    "completion_summary",
    "content",
    "text",
    "response",
    "output",
    "message",
    "report",
  ]) {
    const val = data[key];
    if (typeof val === "string" && val) return [val, true];
  }
  const nested = data.data;
  if (nested && typeof nested === "object") {
    const nm = nested as Record<string, unknown>;
    for (const key of [
      "final_stdout_message",
      "completion_summary",
      "content",
      "text",
      "response",
      "output",
      "message",
      "report",
    ]) {
      const val = nm[key];
      if (typeof val === "string" && val) return [val, true];
    }
  }
  return ["", false];
}

function isNamespaceMatch(ns: string, dataType: string, pattern: string): boolean {
  return dataType.includes(pattern) || ns.includes(pattern);
}

/** Normalizes a namespace value (string or string[]) to a dotted string. */
function namespaceToString(namespace: unknown): string {
  if (typeof namespace === "string") return namespace;
  if (Array.isArray(namespace)) return namespace.filter(s => typeof s === "string").join(".");
  return "";
}

/** Normalizes event data to a map. Strings are parsed as JSON. */
function normalizeEventData(data: unknown): Record<string, unknown> | null {
  if (data == null) return null;
  if (typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  if (typeof data === "string") {
    try {
      const m = JSON.parse(data);
      if (m && typeof m === "object" && !Array.isArray(m)) return m;
    } catch {
      return null;
    }
  }
  return null;
}

// Re-export for callers that want the default allowlist.
export { DEFAULT_THINKING_STEP_EVENTS };

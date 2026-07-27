/**
 * Shared stream/turn terminal frame helpers for Client and DaemonSession.
 *
 * Keeps peel-at-turn-start and turn-end detection on one vocabulary so leftover
 * prior-goal terminals cannot blank the next query.
 */

import {
  EventCardCreated,
  EventCardFinalized,
  EventCardReplayBegin,
  EventCardReplayEnd,
  EventCardUpdated,
  EventPlanCreated,
  EventStrangeLoopCompleted,
  EventStrangeLoopStepCompleted,
  EventStrangeLoopStepQueued,
  EventStrangeLoopStepStarted,
} from "./events.js";

/** Daemon turn-scoped stream end custom type. */
export const STREAM_END = "soothe.stream.end";

export const TURN_END_CUSTOM_TYPES: ReadonlySet<string> = new Set([
  STREAM_END,
  EventStrangeLoopCompleted,
]);

const TURN_PROGRESS_CUSTOM_TYPES: ReadonlySet<string> = new Set([
  EventPlanCreated,
  EventStrangeLoopStepStarted,
  EventStrangeLoopStepQueued,
  EventStrangeLoopStepCompleted,
  EventCardCreated,
  EventCardUpdated,
  EventCardFinalized,
]);

/** Handshake / card-replay / subscription leftovers safe to drop at turn start. */
export const STALE_TURN_PENDING_TYPES: ReadonlySet<string> = new Set([
  "connection_ack",
  EventCardReplayBegin,
  EventCardReplayEnd,
  EventCardCreated,
  "complete",
]);

/** True when `data` is a turn-scoped terminal custom payload. */
export function isTurnEndCustomData(data: unknown): data is Record<string, unknown> {
  if (!data || typeof data !== "object") return false;
  const customType = String((data as Record<string, unknown>).type ?? "").trim();
  if (!TURN_END_CUSTOM_TYPES.has(customType)) return false;
  if (customType === STREAM_END) {
    const scope = String((data as Record<string, unknown>).scope ?? "turn")
      .trim()
      .toLowerCase();
    return scope === "" || scope === "turn";
  }
  return true;
}

/**
 * True when a chunk proves the active turn has non-intake progress.
 * Used so late prior-goal stream.end cannot close a turn that has only seen
 * intake lifecycle (e.g. plan.phase).
 */
export function isTurnProgressChunk(mode: string, data: unknown): boolean {
  if (mode === "messages" || mode === "updates") return true;
  if (mode !== "custom" || !data || typeof data !== "object") return false;
  if (isTurnEndCustomData(data)) return false;
  const customType = String((data as Record<string, unknown>).type ?? "").trim();
  if (TURN_PROGRESS_CUSTOM_TYPES.has(customType)) return true;
  if (customType.startsWith("soothe.cognition.strange_loop.step")) return true;
  return false;
}

/** Return a peel label when `event` is safe to drop at turn start. */
export function stalePendingFrameLabel(event: Record<string, unknown>): string | null {
  const eventType = String(event.type ?? "");
  if (STALE_TURN_PENDING_TYPES.has(eventType)) return eventType;

  if (eventType === "next") {
    const payload = event.payload;
    if (!payload || typeof payload !== "object") return null;
    const p = payload as Record<string, unknown>;
    const staleMode = String(p.mode ?? "");
    if (STALE_TURN_PENDING_TYPES.has(staleMode)) return staleMode;
    const inner = p.data;
    if (inner && typeof inner === "object") {
      return stalePendingFrameLabel(inner as Record<string, unknown>);
    }
    return null;
  }

  if (eventType === "event") {
    const mode = String(event.mode ?? "");
    const data = event.data;
    if (mode === "custom" && isTurnEndCustomData(data)) {
      return String((data as Record<string, unknown>).type ?? "").trim();
    }
  }
  return null;
}

/** True when the client should bump delivery_ack sequence for this frame. */
export function inboundNeedsDeliveryAck(event: Record<string, unknown>): boolean {
  const eventType = String(event.type ?? "");
  if (eventType === "complete") return true;
  if (eventType === "next") {
    const payload = event.payload;
    if (!payload || typeof payload !== "object") return false;
    const p = payload as Record<string, unknown>;
    const inner = p.data;
    if (!inner || typeof inner !== "object") return false;
    if (String(p.mode ?? "") === "event") {
      return inboundNeedsAckFromEventShape(inner as Record<string, unknown>);
    }
    return false;
  }
  if (eventType === "event") return inboundNeedsAckFromEventShape(event);
  return false;
}

function inboundNeedsAckFromEventShape(event: Record<string, unknown>): boolean {
  const mode = String(event.mode ?? "");
  const data = event.data;
  if (mode === "custom" && isTurnEndCustomData(data)) return true;
  if (mode === "messages" && Array.isArray(data) && data.length > 0) {
    const body = data[0];
    if (!body || typeof body !== "object") return false;
    const t = String((body as Record<string, unknown>).type ?? "");
    return t === STREAM_END || t.includes("stream.end");
  }
  return false;
}

/** Extract loop_id from a frame or nested next payload. */
export function extractLoopIdFromInbound(event: Record<string, unknown>): string {
  const direct = String(event.loop_id ?? "").trim();
  if (direct) return direct;
  if (String(event.type ?? "") !== "next") return "";
  const payload = event.payload;
  if (!payload || typeof payload !== "object") return "";
  const p = payload as Record<string, unknown>;
  const fromPayload = String(p.loop_id ?? "").trim();
  if (fromPayload) return fromPayload;
  const inner = p.data;
  if (inner && typeof inner === "object") {
    return String((inner as Record<string, unknown>).loop_id ?? "").trim();
  }
  return "";
}

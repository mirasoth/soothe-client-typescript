/**
 * Inbound drop priorities (lower = keep). Python WebSocketClient parity.
 */

import { STREAM_END, isTurnEndCustomData } from "./stream_terminal.js";

export const DROP_PRIORITY_CRITICAL = 0;
export const DROP_PRIORITY_HIGH = 1;
export const DROP_PRIORITY_NORMAL = 2;

/** Pending / messageBuffer cap (Python inbound queue parity). */
export const DEFAULT_INBOUND_MAX_SIZE = 20_000;

/** Return drop priority for an inbound frame. */
export function inboundFrameDropPriority(event: Record<string, unknown> | null | undefined): number {
  if (!event) return DROP_PRIORITY_CRITICAL;
  let eventType = String(event.type ?? "");
  if (eventType === "event_batch" || eventType === "tool_call_updates_batch") {
    return DROP_PRIORITY_HIGH;
  }
  if (eventType === "next") {
    const payload = event.payload;
    if (payload && typeof payload === "object") {
      const p = payload as Record<string, unknown>;
      const innerMode = String(p.mode ?? "");
      const innerData = p.data;
      if (innerMode === "messages") {
        if (messagesWireTerminal(innerData)) return DROP_PRIORITY_CRITICAL;
        if (Array.isArray(innerData) && innerData[0] && typeof innerData[0] === "object") {
          if (String((innerData[0] as Record<string, unknown>).phase ?? "") === "goal_completion") {
            return DROP_PRIORITY_CRITICAL;
          }
        }
      }
      if (String(p.type ?? "") === "complete") return DROP_PRIORITY_CRITICAL;
      if (innerData && typeof innerData === "object") {
        return inboundFrameDropPriority(innerData as Record<string, unknown>);
      }
      eventType = String(p.type ?? "");
    }
  }
  if (eventType === "complete" || eventType === "error" || eventType === "connection_ack") {
    return DROP_PRIORITY_CRITICAL;
  }
  if (eventType === "status") {
    const state = String(event.state ?? "");
    if (["idle", "running", "stopped", "detached"].includes(state)) {
      return DROP_PRIORITY_CRITICAL;
    }
  }
  if (eventType === "event") {
    const mode = String(event.mode ?? "");
    const data = event.data;
    if (mode === "custom") {
      if (isTurnEndCustomData(data)) return DROP_PRIORITY_CRITICAL;
      if (data && typeof data === "object") {
        const customType = String((data as Record<string, unknown>).type ?? "");
        if (customType.startsWith("soothe.cognition.")) return DROP_PRIORITY_HIGH;
        if (customType.startsWith("soothe.error.") || customType === "stream_degraded") {
          return DROP_PRIORITY_CRITICAL;
        }
        if (customType === "soothe.ux.stream_tool_wire.tool_call_updates_batch") {
          return DROP_PRIORITY_HIGH;
        }
      }
    }
    if (mode === "messages") {
      if (messagesWireTerminal(data)) return DROP_PRIORITY_CRITICAL;
      if (Array.isArray(data) && data[0] && typeof data[0] === "object") {
        if (String((data[0] as Record<string, unknown>).phase ?? "") === "goal_completion") {
          return DROP_PRIORITY_CRITICAL;
        }
      }
    }
  }
  return DROP_PRIORITY_NORMAL;
}

function messagesWireTerminal(data: unknown): boolean {
  if (!Array.isArray(data) || data.length === 0) return false;
  const body = data[0];
  if (!body || typeof body !== "object") return false;
  const t = String((body as Record<string, unknown>).type ?? "");
  return t === STREAM_END || t.includes("stream.end");
}

/**
 * Protocol-1 streaming frame helpers for application loops.
 */

/** Unwrap a protocol-1 next envelope to its inner streaming frame. */
export function unwrapNext(
  event: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null | undefined {
  if (!event || typeof event !== "object") return event;
  if (event.type !== "next") return event;
  const payload = event.payload;
  if (!payload || typeof payload !== "object") return event;
  const data = (payload as Record<string, unknown>).data;
  return data && typeof data === "object" ? (data as Record<string, unknown>) : event;
}

/**
 * Return whether a daemon frame belongs to the active StrangeLoop session.
 */
export function isLoopScopedEvent(event: Record<string, unknown>, activeLoopId: string): boolean {
  let eventType = String(event.type ?? "");
  let frame = event;
  if (eventType === "next") {
    const inner = unwrapNext(event);
    if (inner && typeof inner === "object") {
      frame = inner;
      eventType = String(inner.type ?? "");
      return eventType !== "status" && eventType !== "event"
        ? true
        : String(inner.loop_id ?? "") === activeLoopId;
    }
  }
  if (eventType !== "status" && eventType !== "event") return true;
  return String(frame.loop_id ?? "") === activeLoopId;
}

/**
 * DaemonSession turn-end contract for the pool TurnRunner path.
 * TurnRunner owns one TurnBoundary per execute; EventClassifier may
 * early-complete on deliverable phases for UX only.
 */

import { STREAM_END, isTurnEndCustomData, isTurnProgressChunk } from "../stream_terminal.js";
import type { DecodedMessage } from "../protocol.js";

export const TURN_END_STREAM_END = STREAM_END;
export const TURN_END_IDLE = "status.idle";
export const TURN_END_STOPPED = "status.stopped";

export class TurnLifecycleGate {
  sawRunning = false;
  sawStreamPayload = false;
  sawTurnProgress = false;

  observe(msg: unknown): void {
    const frame = normalizeFrame(msg);
    if (!frame) return;
    const typ = String(frame.type ?? "");
    if (typ === "status") {
      if (
        String(frame.state ?? "")
          .trim()
          .toLowerCase() === "running"
      ) {
        this.sawRunning = true;
      }
      return;
    }
    if (typ === "event") {
      this.sawStreamPayload = true;
      const mode = String(frame.mode ?? "");
      if (isTurnProgressChunk(mode, frame.data)) {
        this.sawTurnProgress = true;
      }
    }
  }

  allowStreamEnd(): boolean {
    return this.sawRunning && this.sawTurnProgress;
  }

  allowIdleComplete(): boolean {
    return this.sawRunning && this.sawStreamPayload;
  }
}

export class TurnBoundary {
  readonly gate = new TurnLifecycleGate();
  ended = false;
  reason = "";

  feed(msg: unknown): [boolean, string] {
    if (this.ended) return [true, this.reason];
    this.gate.observe(msg);
    const frame = normalizeFrame(msg);
    if (!frame) return [false, ""];

    const typ = String(frame.type ?? "");
    if (typ === "status") {
      const state = String(frame.state ?? "")
        .trim()
        .toLowerCase();
      if (state === "stopped" && this.gate.sawRunning) {
        return this.mark(TURN_END_STOPPED);
      }
      if (state === "idle" && this.gate.allowIdleComplete()) {
        return this.mark(TURN_END_IDLE);
      }
      return [false, ""];
    }

    if (typ === "event") {
      const mode = String(frame.mode ?? "");
      if (mode === "custom" && isTurnEndCustomData(frame.data) && this.gate.allowStreamEnd()) {
        return this.mark(TURN_END_STREAM_END);
      }
    }
    return [false, ""];
  }

  private mark(reason: string): [boolean, string] {
    this.ended = true;
    this.reason = reason;
    return [true, reason];
  }
}

export function isDaemonTurnEndEvent(completionEvent: string): boolean {
  const e = (completionEvent ?? "").trim();
  return e === TURN_END_STREAM_END || e === TURN_END_IDLE || e === TURN_END_STOPPED;
}

function normalizeFrame(msg: unknown): Record<string, unknown> | null {
  if (!msg || typeof msg !== "object") return null;
  const m = msg as Record<string, unknown>;
  if (m.type === "next") {
    const payload = (m.payload as Record<string, unknown> | undefined) ?? {};
    const inner = payload.data as Record<string, unknown> | undefined;
    if (inner && typeof inner === "object" && inner.type === "status") {
      return inner;
    }
    if (inner && typeof inner === "object" && inner.mode) {
      return {
        type: "event",
        mode: inner.mode,
        data: inner.data,
        namespace: inner.namespace ?? payload.namespace,
      };
    }
    if (payload.mode) {
      return {
        type: "event",
        mode: payload.mode,
        data: payload.data,
        namespace: payload.namespace,
      };
    }
    return null;
  }
  return m;
}

/** Type alias so DecodedMessage callers stay explicit. */
export type TurnBoundaryMessage = DecodedMessage | Record<string, unknown>;

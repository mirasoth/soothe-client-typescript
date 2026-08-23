/**
 * DaemonSession turn-end contract for the pool TurnRunner path.
 * TurnRunner owns one TurnBoundary per execute; EventClassifier may
 * early-complete on deliverable phases for UX only.
 */

import { STREAM_END, isTurnEndCustomData, isTurnProgressChunk } from "../stream_terminal.js";
import {
  frameTurnId,
  isIdleTerminalAllowed,
  isTurnTerminalAllowed,
  parseTurnGeneration,
  turnIdsMatch,
} from "../turn_boundary.js";
import type { DecodedMessage } from "../protocol.js";

export const TURN_END_STREAM_END = STREAM_END;
export const TURN_END_IDLE = "status.idle";
export const TURN_END_STOPPED = "status.stopped";

export class TurnLifecycleGate {
  sawRunning = false;
  sawTurnProgress = false;
  expectedTurnId: string | null = null;
  cancellationSeen = false;

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
        const statusTurn = frameTurnId(frame);
        if (statusTurn) {
          const newGen = parseTurnGeneration(statusTurn);
          const oldGen = parseTurnGeneration(this.expectedTurnId);
          if (
            this.expectedTurnId === null ||
            (newGen !== null && (oldGen === null || newGen >= oldGen))
          ) {
            if (this.expectedTurnId && statusTurn !== this.expectedTurnId) {
              this.sawTurnProgress = false;
            }
            this.expectedTurnId = statusTurn;
          }
        }
      }
      return;
    }
    if (typ === "event") {
      const mode = String(frame.mode ?? "");
      if (isTurnProgressChunk(mode, frame.data)) {
        this.sawTurnProgress = true;
      }
    }
  }

  allowStreamEnd(frameTurn: string | null): boolean {
    return isTurnTerminalAllowed({
      expectedTurnId: this.expectedTurnId,
      frameTurnId: frameTurn,
      queryStarted: this.sawRunning,
      turnProgressSeen: this.sawTurnProgress,
    });
  }

  allowIdleComplete(frameTurn: string | null): boolean {
    return isIdleTerminalAllowed({
      expectedTurnId: this.expectedTurnId,
      frameTurnId: frameTurn,
      queryStarted: this.sawRunning,
      turnProgressSeen: this.sawTurnProgress,
      cancellationSeen: this.cancellationSeen,
    });
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
      const frameTurn = frameTurnId(frame);
      if (state === "stopped" && this.gate.sawRunning) {
        if (this.gate.expectedTurnId && !turnIdsMatch(this.gate.expectedTurnId, frameTurn)) {
          return [false, ""];
        }
        return this.mark(TURN_END_STOPPED);
      }
      if (state === "idle" && this.gate.allowIdleComplete(frameTurn)) {
        return this.mark(TURN_END_IDLE);
      }
      return [false, ""];
    }

    if (typ === "event") {
      const mode = String(frame.mode ?? "");
      const data = frame.data;
      const dataTurn = frameTurnId(data as Record<string, unknown> | null) || frameTurnId(frame);
      if (mode === "custom" && isTurnEndCustomData(data) && this.gate.allowStreamEnd(dataTurn)) {
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
      const out: Record<string, unknown> = {
        type: "event",
        mode: inner.mode,
        data: inner.data,
        namespace: inner.namespace ?? payload.namespace,
      };
      const tid = inner.turn_id ?? payload.turn_id ?? m.turn_id;
      if (tid) out.turn_id = tid;
      return out;
    }
    if (payload.mode) {
      const out: Record<string, unknown> = {
        type: "event",
        mode: payload.mode,
        data: payload.data,
        namespace: payload.namespace,
      };
      const tid = payload.turn_id ?? m.turn_id;
      if (tid) out.turn_id = tid;
      return out;
    }
    return null;
  }
  return m;
}

/** Type alias so DecodedMessage callers stay explicit. */
export type TurnBoundaryMessage = DecodedMessage | Record<string, unknown>;

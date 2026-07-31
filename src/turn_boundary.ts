/**
 * Turn / stream boundary helpers (`turn_id` / `seq`).
 * Used by DaemonSession for demuxing concurrent goal turns.
 */

export function formatTurnId(loopId: string, generation: number): string {
  const lid = String(loopId || "").trim();
  const gen = Number(generation);
  if (!lid || !Number.isFinite(gen) || gen <= 0) return "";
  return `${lid}:${Math.trunc(gen)}`;
}

export function parseTurnGeneration(turnId: string | null | undefined): number | null {
  const raw = String(turnId || "").trim();
  if (!raw || !raw.includes(":")) return null;
  const suffix = raw.split(":").pop() ?? "";
  const gen = Number.parseInt(suffix, 10);
  return Number.isFinite(gen) && gen > 0 ? gen : null;
}

export function frameTurnId(frame: Record<string, unknown> | null | undefined): string | null {
  if (!frame || typeof frame !== "object") return null;
  const tid = frame.turn_id;
  if (typeof tid === "string" && tid.trim()) return tid.trim();
  const data = frame.data;
  if (data && typeof data === "object") {
    const inner = (data as Record<string, unknown>).turn_id;
    if (typeof inner === "string" && inner.trim()) return inner.trim();
  }
  return null;
}

export function frameSeq(frame: Record<string, unknown> | null | undefined): number | null {
  if (!frame || typeof frame !== "object") return null;
  const raw = frame.seq;
  if (typeof raw === "boolean") return null;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && Number.isInteger(raw)) {
    return raw;
  }
  return null;
}

/** Absent ids never match. */
export function turnIdsMatch(
  expected: string | null | undefined,
  candidate: string | null | undefined,
): boolean {
  const exp = String(expected || "").trim();
  const cand = String(candidate || "").trim();
  return Boolean(exp) && Boolean(cand) && exp === cand;
}

export function isTurnTerminalAllowed(opts: {
  expectedTurnId: string | null | undefined;
  frameTurnId: string | null | undefined;
  queryStarted: boolean;
  turnProgressSeen: boolean;
}): boolean {
  if (!opts.queryStarted || !opts.turnProgressSeen) return false;
  return turnIdsMatch(opts.expectedTurnId, opts.frameTurnId);
}

export function isIdleTerminalAllowed(opts: {
  expectedTurnId: string | null | undefined;
  frameTurnId: string | null | undefined;
  queryStarted: boolean;
  turnProgressSeen: boolean;
  cancellationSeen?: boolean;
}): boolean {
  if (!opts.queryStarted || !String(opts.expectedTurnId || "").trim()) return false;
  const cand = String(opts.frameTurnId || "").trim();
  if (cand) {
    if (!turnIdsMatch(opts.expectedTurnId, cand)) return false;
    return Boolean(opts.turnProgressSeen || opts.cancellationSeen);
  }
  return Boolean(opts.cancellationSeen);
}

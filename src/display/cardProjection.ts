/**
 * In-memory apply helpers for daemon `soothe.card.*` frames.
 *
 * Language clients stay transport/appkit — this projects card_id → wire dict
 * without mounting UI widgets.
 */

import {
  EventCardCreated,
  EventCardFinalized,
  EventCardReplayBegin,
  EventCardReplayEnd,
  EventCardUpdated,
} from "../events.js";

export type CardWireDict = Record<string, unknown> & { id?: string; type?: string; content?: string };

const CARD_MUTATION_TYPES = new Set([
  EventCardCreated,
  EventCardUpdated,
  EventCardFinalized,
  EventCardReplayBegin,
  EventCardReplayEnd,
]);

export type ParsedCardFrame =
  | { wireType: typeof EventCardReplayBegin | typeof EventCardReplayEnd; card: null; patch: Record<string, unknown> }
  | { wireType: typeof EventCardCreated; card: CardWireDict; patch: Record<string, unknown> }
  | { wireType: typeof EventCardUpdated | typeof EventCardFinalized; card: null; patch: Record<string, unknown> };

/** Parse a custom-mode card frame, or null if not a card frame. */
export function parseCardCustomPayload(data: unknown): ParsedCardFrame | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const wireType = String(d.type ?? "").trim();
  if (!CARD_MUTATION_TYPES.has(wireType)) return null;

  if (wireType === EventCardReplayBegin || wireType === EventCardReplayEnd) {
    return { wireType, card: null, patch: {} };
  }

  const payload =
    d.data && typeof d.data === "object" ? ({ ...(d.data as Record<string, unknown>) } as CardWireDict) : ({} as CardWireDict);
  const cardId = String(d.card_id ?? payload.id ?? "").trim();

  if (wireType === EventCardCreated) {
    if (!payload.type || payload.content === undefined) return null;
    if (!payload.id && cardId) payload.id = cardId;
    return { wireType, card: payload, patch: {} };
  }

  if (!payload.id && cardId) payload.id = cardId;
  return {
    wireType: wireType as typeof EventCardUpdated | typeof EventCardFinalized,
    card: null,
    patch: payload,
  };
}

/** card_id → wire dict projection driven by `soothe.card.*` frames. */
export class CardProjection {
  private cards = new Map<string, CardWireDict>();
  private _replaying = false;

  get replaying(): boolean {
    return this._replaying;
  }

  snapshot(): CardWireDict[] {
    return [...this.cards.values()];
  }

  get(cardId: string): CardWireDict | undefined {
    return this.cards.get(cardId);
  }

  /** Apply one custom-mode card payload. Returns true when handled. */
  apply(data: unknown): boolean {
    const parsed = parseCardCustomPayload(data);
    if (!parsed) return false;

    if (parsed.wireType === EventCardReplayBegin) {
      this._replaying = true;
      this.cards.clear();
      return true;
    }
    if (parsed.wireType === EventCardReplayEnd) {
      this._replaying = false;
      return true;
    }
    if (parsed.wireType === EventCardCreated && parsed.card) {
      const id = String(parsed.card.id ?? "").trim();
      if (id) this.cards.set(id, { ...parsed.card });
      return true;
    }
    if (parsed.wireType === EventCardUpdated || parsed.wireType === EventCardFinalized) {
      const id = String(parsed.patch.id ?? "").trim();
      if (!id) return true;
      const existing = this.cards.get(id);
      if (!existing) return true;
      const next = { ...existing };
      for (const [key, value] of Object.entries(parsed.patch)) {
        if (key === "id" || key === "type") continue;
        next[key] = value;
      }
      this.cards.set(id, next);
      return true;
    }
    return true;
  }
}

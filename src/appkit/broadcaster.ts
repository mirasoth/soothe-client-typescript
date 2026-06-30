/**
 * SSE-style pub/sub fan-out for appkit (RFC-629 Layer 1).
 *
 * Generic, string-keyed pub/sub for SSE-style event delivery. The
 * application-agnostic successor to a domain-keyed broadcaster: applications
 * convert from their domain key type to `string` at their own boundary.
 *
 * Slow consumers do not stall the broadcaster: each subscriber has a bounded
 * queue and overflowing events are dropped (drop-on-full).
 */

/** One Server-Sent Event payload. The Type vocabulary is app-defined. */
export interface SSEEvent {
  type: string;
  data: unknown;
}

/** Per-subscriber bounded queue. Events past the cap are dropped. */
const SUBSCRIBER_QUEUE_CAP = 100;

interface Subscriber {
  queue: SSEEvent[];
  /** Resolvers waiting for the next event. */
  waiters: Array<(ev: SSEEvent | null) => void>;
  closed: boolean;
}

/**
 * SSEBroadcaster fans events out to all subscribers for a session id.
 * Non-blocking: a full subscriber queue drops the event so one slow consumer
 * cannot block the others.
 */
export class SSEBroadcaster {
  private subscribers = new Map<string, Map<string, Subscriber>>();
  private nextSubID = 0;

  /** Creates an empty broadcaster. */
  constructor() {}

  /**
   * Registers a new subscriber channel for a session id. Returns an async
   * iterable the subscriber reads events from. Unsubscribe via
   * `unsubscribe()` or `close()`.
   */
  subscribe(sessionID: string): { iterable: AsyncIterable<SSEEvent>; id: string } {
    const subID = String(this.nextSubID++);
    const sub: Subscriber = { queue: [], waiters: [], closed: false };
    let subs = this.subscribers.get(sessionID);
    if (!subs) {
      subs = new Map();
      this.subscribers.set(sessionID, subs);
    }
    subs.set(subID, sub);

    const iterable: AsyncIterable<SSEEvent> = {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<SSEEvent>> {
            if (sub.queue.length > 0) {
              return Promise.resolve({ value: sub.queue.shift()!, done: false });
            }
            if (sub.closed) {
              return Promise.resolve({ value: undefined as unknown as SSEEvent, done: true });
            }
            return new Promise<IteratorResult<SSEEvent>>((resolve) => {
              sub.waiters.push((ev) => {
                if (ev === null) {
                  resolve({ value: undefined as unknown as SSEEvent, done: true });
                } else {
                  resolve({ value: ev, done: false });
                }
              });
            });
          },
        };
      },
    };
    return { iterable, id: subID };
  }

  /** Removes a subscriber by id and closes its iterable. Safe if unknown. */
  unsubscribe(sessionID: string, subID: string): void {
    const subs = this.subscribers.get(sessionID);
    if (!subs) return;
    const sub = subs.get(subID);
    if (!sub) return;
    sub.closed = true;
    for (const w of sub.waiters) w(null);
    sub.waiters = [];
    subs.delete(subID);
    if (subs.size === 0) this.subscribers.delete(sessionID);
  }

  /**
   * Sends an event to all subscribers for a session id. Non-blocking: a full
   * subscriber queue is skipped (drop-on-full) so one slow consumer cannot
   * block the others.
   */
  broadcast(sessionID: string, event: SSEEvent): void {
    const subs = this.subscribers.get(sessionID);
    if (!subs) return;
    for (const sub of subs.values()) {
      if (sub.closed) continue;
      if (sub.waiters.length > 0) {
        const w = sub.waiters.shift()!;
        w(event);
      } else if (sub.queue.length < SUBSCRIBER_QUEUE_CAP) {
        sub.queue.push(event);
      }
      // else: drop-on-full.
    }
  }

  /** Closes all subscribers for a session id and removes the entry. */
  close(sessionID: string): void {
    const subs = this.subscribers.get(sessionID);
    if (!subs) return;
    for (const sub of subs.values()) {
      sub.closed = true;
      for (const w of sub.waiters) w(null);
      sub.waiters = [];
    }
    this.subscribers.delete(sessionID);
  }

  /** Closes every subscriber channel across all sessions. */
  closeAll(): void {
    for (const [sessionID, subs] of this.subscribers) {
      for (const sub of subs.values()) {
        sub.closed = true;
        for (const w of sub.waiters) w(null);
        sub.waiters = [];
      }
      this.subscribers.delete(sessionID);
    }
  }
}

/**
 * Inbound-frame multiplexer for the protocol-1 client.
 *
 * Routes inbound protocol-1 frames to the correct waiter by `(type, id)`
 * instead of discarding non-matching events. This makes the Client safe for
 * concurrent RPCs and lets an active subscription stream coexist with RPC
 * waits without starvation.
 *
 * Routing rules:
 *   - `response`/`error` with `id` in pending RPCs   → pending RPC waiter
 *   - `next`/`complete` with `id` in pending subs     → pending subscription waiter
 *   - `receipt_response` with `receipt` in receipts   → receipt waiter
 *   - everything else                                  → not consumed (flows to
 *                                                          the application event
 *                                                          stream / resolver queue)
 *
 * `ping`/`pong`/`connection_ack` are id-less lifecycle frames handled by the
 * Client before reaching the multiplexer; the multiplexer leaves them
 * un-consumed so the Client's existing handlers still see them.
 *
 * A frame routed to a waiter is consumed (returns `true`) and must NOT be
 * forwarded to the resolver queue / event stream.
 */

import { DaemonError } from "./errors.js";

/** A single in-flight RPC wait. */
interface PendingCall {
  /** Resolve with the `result` object on `response`; reject with DaemonError on `error`. */
  resolve: (result: Record<string, unknown>) => void;
  reject: (err: Error) => void;
}

/** A single in-flight subscription stream. */
interface PendingSubscription {
  /** Push `next`/`complete` frames to the subscriber. */
  push: (frame: Record<string, unknown>) => void;
  /** Resolves when the waiter has gone away (unsubscribed/timed out). */
  done: Promise<void>;
  /** Internal — resolves `done`. */
  resolveDone: () => void;
  /** Whether the waiter is still registered. */
  settled: boolean;
}

/**
 * Multiplexer holds pending RPC, subscription, and receipt waiters keyed by
 * their correlation id. The Client consults `route()` for each inbound frame
 * before pushing it to the resolver queue.
 */
export class Multiplexer {
  private rpcs = new Map<string, PendingCall>();
  private subs = new Map<string, PendingSubscription>();
  private receipts = new Map<string, (frame: Record<string, unknown>) => void>();

  /**
   * Installs a pending RPC wait keyed by `id`. Returns the pending call and an
   * unregister function that MUST be called when the wait ends (success,
   * timeout, or cancel) to avoid leaks. If a late response arrives after the
   * caller has unregistered, it is dropped (log-and-drop) — no leak.
   */
  registerRPC(id: string): {
    call: Promise<Record<string, unknown>>;
    unregister: () => void;
  } {
    let callResolve!: (result: Record<string, unknown>) => void;
    let callReject!: (err: Error) => void;
    const call = new Promise<Record<string, unknown>>((resolve, reject) => {
      callResolve = resolve;
      callReject = reject;
    });
    const pending: PendingCall = { resolve: callResolve, reject: callReject };
    this.rpcs.set(id, pending);
    const unregister = () => {
      // Only delete if still our entry (a later registration with the same id
      // should not be clobbered).
      if (this.rpcs.get(id) === pending) {
        this.rpcs.delete(id);
      }
    };
    return { call, unregister };
  }

  /**
   * Installs a pending subscription stream keyed by `id`. Returns the stream
   * channel (an async-iterable-like push sink), a `done` signal, and an
   * unregister function. The Client pushes `next`/`complete` frames via
   * `push`; the application reads from the channel.
   */
  registerSubscription(id: string): {
    push: (frame: Record<string, unknown>) => void;
    done: Promise<void>;
    unregister: () => void;
  } {
    let resolveDone!: () => void;
    const done = new Promise<void>(resolve => {
      resolveDone = resolve;
    });
    const pending: PendingSubscription = {
      push: () => {
        // Overridden by the caller via the returned push closure below.
      },
      done,
      resolveDone,
      settled: false,
    };
    // Wire the push closure to the subscription's push so unregister can
    // short-circuit later deliveries.
    const push = (frame: Record<string, unknown>) => {
      if (pending.settled) return;
      pending.push(frame);
    };
    // Default push is a no-op until the caller installs a real sink. The
    // Client wires a real sink after registering; this guards against a race
    // where a frame arrives between register and sink-install.
    pending.push = () => {};
    this.subs.set(id, pending);
    const unregister = () => {
      if (this.subs.get(id) === pending) {
        pending.settled = true;
        this.subs.delete(id);
        resolveDone();
      }
    };
    return { push, done, unregister };
  }

  /**
   * Installs a pending receipt wait keyed by `receipt`. Returns an unregister
   * function.
   */
  registerReceipt(receipt: string): {
    wait: Promise<Record<string, unknown>>;
    unregister: () => void;
  } {
    let resolveWait!: (frame: Record<string, unknown>) => void;
    const wait = new Promise<Record<string, unknown>>(resolve => {
      resolveWait = resolve;
    });
    this.receipts.set(receipt, resolveWait);
    const unregister = () => {
      this.receipts.delete(receipt);
    };
    return { wait, unregister };
  }

  /**
   * Wires a real sink for a registered subscription's `push`. Called by the
   * Client right after `registerSubscription` to install the channel/queue the
   * application reads from.
   */
  setSubscriptionSink(id: string, sink: (frame: Record<string, unknown>) => void): void {
    const sub = this.subs.get(id);
    if (sub) sub.push = sink;
  }

  /**
   * Inspects one decoded frame, delivers it to a matching waiter if one
   * exists, and returns `true` (consumed). Returns `false` for frames with no
   * matching waiter — these flow on to the resolver queue / event stream.
   * Safe to call from the message handler.
   */
  route(frame: Record<string, unknown>): boolean {
    if (!frame || typeof frame !== "object") return false;
    const typ = frame.type as string | undefined;
    const id = frame.id as string | undefined;

    if (typ === "response" || typ === "error") {
      if (!id) return false;
      const pc = this.rpcs.get(id);
      if (!pc) return false;
      if (typ === "error") {
        const errObj =
          (frame.error as {
            code?: number;
            message?: string;
            data?: unknown;
          }) ?? {};
        const code = typeof errObj.code === "number" ? errObj.code : -32603;
        const message = errObj.message ?? "daemon error";
        pc.reject(new DaemonError(code, message, errObj.data));
      } else {
        const result = (frame.result as Record<string, unknown> | undefined) ?? frame;
        pc.resolve(result);
      }
      // Waiter is single-shot; remove so a duplicate late frame is dropped.
      this.rpcs.delete(id);
      return true;
    }

    if (typ === "next" || typ === "complete") {
      if (!id) return false;
      const ps = this.subs.get(id);
      if (!ps) return false;
      if (ps.settled) return true; // waiter gone; consume to avoid re-forwarding
      ps.push(frame);
      return true;
    }

    if (typ === "receipt_response") {
      const rid = frame.receipt as string | undefined;
      if (!rid) return false;
      const ch = this.receipts.get(rid);
      if (!ch) return false;
      ch(frame);
      this.receipts.delete(rid);
      return true;
    }

    return false;
  }

  /** Reports whether an RPC waiter is registered for `id`. */
  hasRPCWaiter(id: string): boolean {
    return this.rpcs.has(id);
  }
}

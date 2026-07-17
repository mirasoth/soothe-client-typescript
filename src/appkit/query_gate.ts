/**
 * Single-flight query gate for appkit.
 *
 * Enforces single-flight query execution per session id and the
 * cancel-before-context ordering: when a query is cancelled, the daemon is
 * told to stop (command_request{command:"cancel"}) BEFORE the local abort
 * signal is cancelled, on a detached timeout so the caller's cancellation
 * cannot block the wire send.
 *
 * The app-agnostic successor to triarch's AcquireQuery/CancelQuery/
 * sendLoopCancelCommand.
 */

/** Returned when a session already has an in-flight query. */
export class ErrQueryBusy extends Error {
  constructor() {
    super("appkit: query already in progress for session");
    this.name = "ErrQueryBusy";
  }
}

interface QueryState {
  /** Local abort for the query's timeout context. */
  abort: AbortController;
  /** Daemon-cancel sender (sends command_request{cancel} for the loop). */
  sendCancel: ((signal: AbortSignal) => Promise<void>) | null;
}

/**
 * QueryGate enforces single-flight query execution per session id.
 */
export class QueryGate {
  private active = new Map<string, QueryState>();

  /** Constructs an empty gate. */
  constructor() {}

  /**
   * Reserves sessionID for one agent turn. Returns ErrQueryBusy if a query is
   * already in flight. `abort` is the AbortController for the query's timeout
   * context. `sendCancel` is the daemon-cancel sender; it is invoked from
   * `cancel()` on a detached 10s timeout.
   */
  acquire(
    sessionID: string,
    abort: AbortController,
    sendCancel: ((signal: AbortSignal) => Promise<void>) | null,
  ): void {
    if (this.active.has(sessionID)) {
      throw new ErrQueryBusy();
    }
    this.active.set(sessionID, { abort, sendCancel });
  }

  /**
   * Cooperatively stops a running query for sessionID. Sends the daemon cancel
   * (on a detached 10s-timeout abort so caller cancellation cannot block the
   * wire send) BEFORE aborting the local context. Returns silently if no query
   * is in flight (intent already satisfied).
   */
  async cancel(sessionID: string): Promise<void> {
    const state = this.active.get(sessionID);
    if (!state) return;
    this.active.delete(sessionID);

    if (state.sendCancel) {
      const detached = new AbortController();
      const timer = setTimeout(() => detached.abort(), 10_000);
      try {
        await state.sendCancel(detached.signal);
      } catch {
        // Log but proceed to local cancel; the query is still stopping locally.
      } finally {
        clearTimeout(timer);
      }
    }
    state.abort.abort();
  }

  /**
   * Clears the gate for sessionID without sending a daemon cancel. Call when a
   * query completes normally (success or local failure) so the next turn can
   * acquire.
   */
  release(sessionID: string): void {
    this.active.delete(sessionID);
  }

  /** Reports whether a query is in flight for sessionID. */
  isActive(sessionID: string): boolean {
    return this.active.has(sessionID);
  }
}

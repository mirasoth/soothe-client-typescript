/**
 * Per-session connection pool for appkit.
 *
 * Manages a pool of daemon connections, one active per session. Reuses an
 * active connection when still live, otherwise bootstraps a fresh loop
 * (loop_new + subscribe) or reattaches an existing one (loop_reattach +
 * subscribe + reattachAndProbe). Persistence of session↔loop mappings is
 * abstracted behind LoopSessionStore.
 *
 * The app-agnostic successor to triarch's SoothePoolManager connection
 * mechanics.
 */

import { StaleLoopError } from "../errors.js";
import type { Config } from "../config.js";
import { defaultConfig } from "../config.js";
import type { DecodedMessage } from "../protocol.js";
import type { LoopSessionStore } from "./loop_session_store.js";
import {
  type BootstrapFunc,
  type ClientFactory,
  type ManagedClient,
  defaultBootstrapFunc,
  defaultClientFactory,
} from "./client.js";

/** Returned when no free connection slot is available. */
export class ErrPoolExhausted extends Error {
  constructor() {
    super("appkit: connection pool exhausted");
    this.name = "ErrPoolExhausted";
  }
}

/** Configures a ConnectionPool. Zero values use defaults. */
export interface PoolConfig {
  poolSize: number;
  queryTimeout: number; // ms
  connectionTimeout: number; // ms
  maxIdleTime: number; // ms
  healthCheckInterval: number; // ms
}

/** Returns env-overridable defaults (mirrors triarch).
 * `maxIdleTime` is enforced on acquire; `healthCheckInterval` is reserved. */
export function defaultPoolConfig(): PoolConfig {
  return {
    poolSize: 1000,
    queryTimeout: 30 * 60 * 1000,
    connectionTimeout: 30_000,
    maxIdleTime: 10 * 60 * 1000,
    healthCheckInterval: 30_000,
  };
}

/** One connection slot in the pool. */
export class PooledConn {
  slotID: number;
  client: ManagedClient;
  eventStream: AsyncGenerator<DecodedMessage> | null = null;
  streamController: AbortController | null = null;
  sessionID = "";
  loopID = "";
  workspaceID = "";
  lastUsed = 0;

  constructor(slotID: number, client: ManagedClient) {
    this.slotID = slotID;
    this.client = client;
  }

  /** Reports whether the underlying client signalled a drop. */
  isDisconnected(): boolean {
    return this.client.isDisconnected();
  }

  isConnected(): boolean {
    return this.client.isConnected() && !this.isDisconnected();
  }

  getLoopID(): string {
    return this.loopID;
  }
}

/**
 * ConnectionPool manages a pool of daemon connections, one active per session.
 */
export class ConnectionPool {
  private cfg: PoolConfig;
  private scfg: Config;
  private factory: ClientFactory;
  private bootstrap: BootstrapFunc;
  private store: LoopSessionStore;
  private pool: PooledConn[] = [];
  private activeSlots = new Map<string, PooledConn>();
  private nextSlotID = 1;
  private url: string;

  /**
   * Constructs a pool. `url` is the daemon WebSocket URL. If cfg is null,
   * defaultPoolConfig is used; if scfg is null, defaultConfig is used; nil
   * factory/bootstrap fall back to the defaults.
   */
  constructor(
    url: string,
    store: LoopSessionStore,
    cfg?: PoolConfig | null,
    scfg?: Config | null,
    factory?: ClientFactory | null,
  ) {
    this.cfg = cfg ?? defaultPoolConfig();
    this.scfg = scfg ?? defaultConfig();
    this.factory = factory ?? defaultClientFactory();
    this.bootstrap = defaultBootstrapFunc();
    this.store = store;
    this.url = url;
    // Pre-seed the pool with up to poolSize slots.
    for (let i = 0; i < this.cfg.poolSize; i++) {
      this.pool.push(new PooledConn(this.nextSlotID++, this.factory(url, this.scfg)));
    }
  }

  /** Overrides the loop bootstrap function (useful for test fakes). */
  withBootstrap(f: BootstrapFunc): ConnectionPool {
    if (f) this.bootstrap = f;
    return this;
  }

  /**
   * Returns a live connection for sessionID, reusing an active slot or
   * bootstrapping/reattaching as needed. The caller must call `release()`
   * when done with the connection (a turn completes or the session is reset).
   */
  async acquire(
    sessionID: string,
    workspaceID: string,
    userID: string,
    _signal?: AbortSignal,
  ): Promise<PooledConn> {
    // 1. Reuse active connection when still live.
    const existing = this.activeSlots.get(sessionID);
    if (existing) {
      if (existing.isDisconnected() || !existing.isConnected()) {
        await this.release(sessionID);
      } else {
        const idleTooLong =
          this.cfg.maxIdleTime > 0 &&
          existing.lastUsed > 0 &&
          Date.now() - existing.lastUsed > this.cfg.maxIdleTime;
        if (idleTooLong) {
          await this.release(sessionID);
        } else {
          existing.lastUsed = Date.now();
          await this.store.updateLastUsed(sessionID).catch(() => {});
          return existing;
        }
      }
    }

    // 2. Pull a slot from the pool.
    const conn = this.pool.pop();
    if (!conn) throw new ErrPoolExhausted();
    this.activeSlots.set(sessionID, conn);

    const { loopID, ok } = await this.store
      .getLoopIDForSession(sessionID)
      .catch(() => ({ loopID: "", ok: false }));
    let finalLoopID = "";
    try {
      if (!ok || !loopID) {
        // Fresh bootstrap.
        await conn.client.connect();
        finalLoopID = await this.bootstrapNew(conn, workspaceID, userID);
        await this.store.createSession(workspaceID, sessionID, finalLoopID, "").catch(() => {});
      } else {
        // Reattach.
        try {
          await this.resumeAndReattach(conn, loopID);
          finalLoopID = loopID;
        } catch {
          // Reattach failed (incl. StaleLoopError) → fresh bootstrap.
          await conn.client.connect();
          finalLoopID = await this.bootstrapNew(conn, workspaceID, userID);
          await this.store.createSession(workspaceID, sessionID, finalLoopID, "").catch(() => {});
        }
      }
    } catch (err) {
      await this.release(sessionID);
      throw err;
    }

    conn.sessionID = sessionID;
    conn.loopID = finalLoopID;
    conn.workspaceID = workspaceID;
    conn.lastUsed = Date.now();
    await this.store.updateLastUsed(sessionID).catch(() => {});
    return conn;
  }

  /** Tears down the connection for sessionID and returns the slot. */
  async release(sessionID: string): Promise<void> {
    const conn = this.activeSlots.get(sessionID);
    if (!conn) return;
    this.activeSlots.delete(sessionID);
    if (conn.streamController) {
      conn.streamController.abort();
      conn.streamController = null;
    }
    try {
      conn.client.close();
    } catch {
      // ignore
    }
    conn.sessionID = "";
    conn.loopID = "";
    conn.eventStream = null;
    // Return a fresh slot to the pool (the closed client is spent).
    this.pool.push(new PooledConn(this.nextSlotID++, this.factory(this.url, this.scfg)));
  }

  /**
   * Tears down the connection for sessionID so the next acquire bootstraps
   * fresh. The store should archive the loop id so getLoopIDForSession returns
   * false next time.
   */
  async resetSession(sessionID: string): Promise<void> {
    await this.release(sessionID);
  }

  /** Gracefully shuts down all active connections. */
  stop(): void {
    for (const [sid, conn] of this.activeSlots) {
      if (conn.streamController) conn.streamController.abort();
      try {
        conn.client.close();
      } catch {
        // ignore
      }
      this.activeSlots.delete(sid);
    }
  }

  /** Stats snapshot for observability. */
  stats(): { active: number; idle: number } {
    return { active: this.activeSlots.size, idle: this.pool.length };
  }

  /** Bootstrap a fresh loop and start the reader. */
  private async bootstrapNew(
    conn: PooledConn,
    workspaceID: string,
    userID: string,
  ): Promise<string> {
    const loopID = await this.bootstrap(conn.client, workspaceID, userID, this.scfg);
    this.startReader(conn);
    return loopID;
  }

  /** Reconnect + reattach an existing loop, then start the reader. */
  private async resumeAndReattach(conn: PooledConn, loopID: string): Promise<void> {
    await conn.client.connect();
    try {
      await conn.client.reattachAndProbe(loopID);
    } catch (err) {
      if (err instanceof StaleLoopError) throw err;
      throw err;
    }
    this.startReader(conn);
  }

  /** Starts a receiveMessages generator and stores the stream + controller. */
  private startReader(conn: PooledConn): void {
    const controller = new AbortController();
    conn.streamController = controller;
    conn.eventStream = conn.client.receiveMessages(controller.signal);
  }
}

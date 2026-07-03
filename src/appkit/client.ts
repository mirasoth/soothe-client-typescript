/**
 * ManagedClient — the subset of the core Client that appkit's ConnectionPool
 * and TurnRunner depend on (RFC-629 Layer 1).
 *
 * The concrete `Client` satisfies it; tests supply a fake. Defining it as an
 * interface lets appkit be unit-tested without a live WebSocket daemon.
 */

import type { Client, InputOptions } from "../client.js";
import type { Config } from "../config.js";
import type { DecodedMessage } from "../protocol.js";
import type { DisconnectCause } from "../errors.js";

/**
 * ManagedClient is the subset of the core Client that appkit depends on.
 * Methods are async (TS) rather than channel-based (Go).
 */
export interface ManagedClient {
  /** Dials and handshakes. */
  connect(): Promise<void>;
  /** Re-dials after a drop. */
  reconnect(): Promise<void>;
  /** Resumes a loop by id and probes liveness. */
  reattachAndProbe(loopID: string): Promise<void>;
  /** Sends a fire-and-forget notification (e.g. loop_input). */
  sendMessage(msg: unknown): Promise<void>;
  /** Sends user input to the daemon (loop_input notification). */
  sendInput(text: string, options?: InputOptions): Promise<void>;
  /** Starts the read loop, returning the event stream. */
  receiveMessages(signal?: AbortSignal): AsyncGenerator<DecodedMessage>;
  /** Returns whether the connection has dropped. */
  isDisconnected(): boolean;
  /** Returns the drop cause, or null if not dropped. */
  disconnectCause(): DisconnectCause | null;
  /** Reports connection liveness. */
  isConnected(): boolean;
  /** Tears down the connection. */
  close(): void;
}

/**
 * Builds a fresh ManagedClient for a daemon URL and config. ConnectionPool
 * calls it per pooled connection. Applications may supply a custom factory
 * (e.g. wrapping Client with logging/metrics).
 */
export type ClientFactory = (url: string, config?: Config) => ManagedClient;

import { defaultConfig } from "../config.js";
import { Client as CoreClient } from "../client.js";

/** Returns a ClientFactory that builds a core Client. */
export function defaultClientFactory(): ClientFactory {
  return (url: string, config?: Config) => {
    return new CoreClient(url, config ?? defaultConfig()) as unknown as ManagedClient;
  };
}

/**
 * Creates a new loop (loop_new + subscribe) on a connected client and returns
 * the new loop id. The default implementation calls bootstrapLoopSession;
 * apps may override it.
 */
export type BootstrapFunc = (
  client: ManagedClient,
  workspaceID: string,
  userID: string,
  config?: Config,
) => Promise<string>;

import { bootstrapLoopSession } from "../session.js";
import type { LoopNewOptions } from "../protocol.js";

/** Default bootstrap: loop_new + subscribe(loop_events). */
export function defaultBootstrapFunc(): BootstrapFunc {
  return async (client: ManagedClient, workspaceID: string, userID: string, config?: Config) => {
    // bootstrapLoopSession expects a Client; cast through unknown.
    const c = client as unknown as Client;
    const opts: LoopNewOptions = {
      client_workspace: workspaceID,
      user_id: userID,
      client_workspace_id: workspaceID,
    };
    return bootstrapLoopSession(c, "", config, opts);
  };
}

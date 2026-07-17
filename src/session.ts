/**
 * Session bootstrap flows, wait helpers, and connect-with-retries.
 *
 * Under protocol-1 the connection handshake (connection_init /
 * connection_ack) is performed by `client.connect()`. Bootstrap therefore
 * jumps straight to loop_new + subscribe(loop_events).
 */

import type { Client } from "./client.js";
import type { Config } from "./config.js";
import { defaultConfig } from "./config.js";
import { newLoopNewMessage } from "./protocol.js";
import { DaemonError } from "./errors.js";

// ---------------------------------------------------------------------------
// Bootstrap flows
// ---------------------------------------------------------------------------

/**
 * loop_new (or reuse id) → subscribe(loop_events); returns the loop id.
 * The protocol-1 handshake is assumed to have completed in `client.connect()`.
 */
export async function bootstrapLoopSession(
  client: Client,
  resumeLoopId: string | null | undefined,
  config?: Config,
  loopNew?: import("./protocol.js").LoopNewOptions,
): Promise<string> {
  const cfg = config ?? defaultConfig();

  let loopId = (resumeLoopId ?? "").trim();
  if (!loopId) {
    const env = newLoopNewMessage(loopNew);
    const newResp = await client.requestResponse(
      env.method,
      env.params ?? {},
      "loop_new",
      cfg.loopStatusTimeout,
    );
    loopId = String(newResp.loop_id ?? "").trim();
    if (!loopId) {
      throw new Error("loop_new response missing loop_id");
    }
  }

  // Subscribe to the loop event stream. Confirmation arrives as a `next`
  // frame; client.subscribe() handles the initial ack/error window.
  await client.subscribe(
    "loop_events",
    { loop_id: loopId, verbosity: cfg.verbosityLevel },
    cfg.subscriptionTimeout,
  );

  return loopId;
}

// ---------------------------------------------------------------------------
// Wait helpers (use client's readEventWithTimeout internally)
// ---------------------------------------------------------------------------

/**
 * Blocks until connection_ack reports readiness "ready". Resolves immediately
 * if the handshake already completed during connect().
 */
export async function waitDaemonReady(client: Client, timeout: number): Promise<void> {
  if (client.isConnected()) return;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const ev = (await client.readEventWithTimeout(remaining)) as Record<string, unknown> | null;
    if (ev === null) break;
    if (ev.type === "connection_ack") {
      const result = (ev.result as Record<string, unknown> | undefined) ?? {};
      const state = result.readiness_state as string | undefined;
      if (state === "ready") return;
      throw new Error(`daemon not ready: state=${JSON.stringify(state ?? "unknown")}`);
    }
  }
  throw new Error(`timeout after ${timeout}ms waiting for connection_ack (ready)`);
}

/** Waits for a status message with a non-empty loop_id. */
export async function waitLoopStatusWithID(
  client: Client,
  timeout: number,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const ev = (await client.readEventWithTimeout(remaining)) as Record<string, unknown> | null;
    if (ev === null) break;

    if (ev.type === "error") {
      const errObj = (ev.error as { code?: number; message?: string }) ?? {};
      throw new DaemonError(errObj.code ?? -32603, errObj.message ?? "daemon error");
    }

    if (ev.type === "status") {
      const lid = ev.loop_id as string | undefined;
      if (lid && lid !== "") {
        return ev;
      }
    }
  }
  throw new Error(`timeout after ${timeout}ms waiting for status with loop_id`);
}

/** Waits for a subscription confirmation `next` matching loop id. */
export async function waitSubscriptionConfirmed(
  client: Client,
  wantLoopID: string,
  _wantVerbosity: string,
  timeout: number,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const ev = (await client.readEventWithTimeout(remaining)) as Record<string, unknown> | null;
    if (ev === null) break;
    if (ev.type === "next") {
      const payload = (ev.payload as Record<string, unknown> | undefined) ?? {};
      const lid = String(payload.loop_id ?? "");
      if (lid === wantLoopID && payload.success === true) return;
      continue;
    }
    if (ev.type === "error") {
      const errObj = (ev.error as { message?: string }) ?? {};
      throw new Error(`daemon error: ${errObj.message ?? "subscription failed"}`);
    }
  }
  throw new Error(`timeout after ${timeout}ms waiting for subscription confirmation`);
}

// ---------------------------------------------------------------------------
// Connect with retries
// ---------------------------------------------------------------------------

/** Attempts to connect to the Soothe daemon with bounded retries. */
export async function connectWithRetries(
  client: Client,
  maxRetries?: number,
  retryDelay?: number,
): Promise<void> {
  const retries = maxRetries && maxRetries > 0 ? maxRetries : 40;
  const delay = retryDelay && retryDelay > 0 ? retryDelay : 250;

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await client.connect();
      return;
    } catch (err) {
      lastErr = err as Error;
    }
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  throw new Error(
    `failed to connect after ${retries} attempts: ${lastErr?.message ?? "unknown error"}`,
  );
}

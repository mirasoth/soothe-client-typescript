/**
 * Session bootstrap flows, wait helpers, and connect-with-retries.
 */

import type { Client } from './client.js';
import type { Config } from './config.js';
import { defaultConfig } from './config.js';
import type { DecodedMessage, LoopNewOptions, StatusResponse, ErrorResponse } from './protocol.js';
import { newLoopNewMessage } from './protocol.js';

// ---------------------------------------------------------------------------
// Bootstrap flows (loop-first, RFC-503)
// ---------------------------------------------------------------------------

/** Daemon ready → loop_new (or reuse id) → loop_subscribe; returns loop id. */
export async function bootstrapLoopSession(
  client: Client,
  resumeLoopId: string | null | undefined,
  config?: Config,
  loopNew?: LoopNewOptions,
): Promise<string> {
  const cfg = config ?? defaultConfig();

  await client.sendMessage({ type: 'daemon_ready' });
  await waitDaemonReady(client, cfg.daemonReadyTimeout);

  let loopId = (resumeLoopId ?? '').trim();
  if (!loopId) {
    const newResp = await client.requestResponse(
      newLoopNewMessage(loopNew) as unknown as Record<string, unknown>,
      'loop_new_response',
      cfg.loopStatusTimeout,
    );
    loopId = String(newResp.loop_id ?? '').trim();
    if (!loopId) {
      throw new Error('loop_new_response missing loop_id');
    }
  }

  const subResp = await client.requestResponse(
    { type: 'loop_subscribe', loop_id: loopId, verbosity: cfg.verbosityLevel },
    'loop_subscribe_response',
    cfg.subscriptionTimeout,
  );
  if (subResp.success === false) {
    throw new Error(String(subResp.message ?? 'loop_subscribe failed'));
  }

  return loopId;
}

// ---------------------------------------------------------------------------
// Wait helpers (use client's readEventWithTimeout internally)
// ---------------------------------------------------------------------------

/** Blocks until a daemon_ready message with state == "ready". */
export async function waitDaemonReady(
  client: Client,
  timeout: number,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const ev = (await client.readEventWithTimeout(remaining)) as Record<string, unknown> | null;
    if (ev === null) break;
    if (ev.type === 'daemon_ready') {
      if (ev.state === 'ready') return;
      throw new Error(
        `daemon not ready: state=${JSON.stringify(ev.state)} message=${JSON.stringify(ev.message ?? '')}`,
      );
    }
  }
  throw new Error(`timeout after ${timeout}ms waiting for daemon_ready (state=ready)`);
}

/** Waits for daemon_ready using messages from an ``AsyncIterable`` (e.g. ``receiveMessages()``). */
export async function waitDaemonReadyFromStream(
  eventStream: AsyncIterable<DecodedMessage>,
  timeout: number,
): Promise<void> {
  const deadline = Date.now() + timeout;
  for await (const msg of eventStream) {
    if (msg && typeof msg === 'object') {
      const m = msg as Record<string, unknown>;
      if (m.type === 'daemon_ready') {
        if (m.state === 'ready') return;
        throw new Error(
          `daemon not ready: state=${JSON.stringify(m.state)} message=${JSON.stringify(m.message ?? '')}`,
        );
      }
    }
    if (Date.now() >= deadline) break;
  }
  throw new Error(`timeout after ${timeout}ms waiting for daemon_ready (state=ready)`);
}

/** Waits for a status message with a non-empty ``loop_id``. */
export async function waitLoopStatusWithID(
  client: Client,
  timeout: number,
): Promise<StatusResponse> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const ev = (await client.readEventWithTimeout(remaining)) as Record<string, unknown> | null;
    if (ev === null) break;

    if (ev.type === 'error') {
      const errResp = ev as unknown as ErrorResponse;
      throw new Error(`daemon error: ${errResp.code}: ${errResp.message}`);
    }

    if (ev.type === 'status') {
      const status = ev as unknown as StatusResponse;
      const lid = status.loop_id;
      if (lid && lid !== '') {
        return status;
      }
    }
  }
  throw new Error(`timeout after ${timeout}ms waiting for status with loop_id`);
}

/** Waits for subscription_confirmed or loop_subscribe_response matching loop id. */
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
    if (ev.type === 'loop_subscribe_response' && ev.success === true) {
      if (String(ev.loop_id ?? '') === wantLoopID) return;
    }
    if (ev.type === 'subscription_confirmed') {
      const lid = String((ev as { loop_id?: string }).loop_id ?? '');
      if (lid === wantLoopID) return;
    }
  }
  throw new Error(`timeout after ${timeout}ms waiting for subscription_confirmed`);
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
  throw new Error(`failed to connect after ${retries} attempts: ${lastErr?.message ?? 'unknown error'}`);
}
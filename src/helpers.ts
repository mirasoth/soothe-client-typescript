/**
 * Convenience RPC helper functions for the Soothe client.
 */

import type { Client } from "./client.js";
import { defaultConfig } from "./config.js";

/** Checks daemon status via RPC. */
export async function checkDaemonStatus(
  client: Client,
  timeout?: number,
): Promise<Record<string, unknown>> {
  return client.requestResponse("daemon_status", {}, "daemon_status", timeout ?? 5_000);
}

/** Performs a composite health check: connect + handshake + status RPC. */
export async function isDaemonLive(wsURL: string, timeout?: number): Promise<boolean> {
  const { Client } = await import("./client.js");
  const t = timeout ?? 5_000;
  const client = new Client(wsURL, defaultConfig());

  try {
    await client.connect();
  } catch {
    return false;
  }

  try {
    await checkDaemonStatus(client, t);
    return true;
  } catch {
    return false;
  } finally {
    client.close();
  }
}

/** Requests daemon shutdown via RPC. */
export async function requestDaemonShutdown(client: Client, timeout?: number): Promise<void> {
  const resp = await client.requestResponse(
    "daemon_shutdown",
    {},
    "daemon_shutdown",
    timeout ?? 10_000,
  );
  if (resp.status !== "acknowledged") {
    throw new Error(`shutdown not acknowledged: ${JSON.stringify(resp)}`);
  }
}

/** Fetches the skills catalog via RPC. */
export async function fetchSkillsCatalog(
  client: Client,
  timeout?: number,
): Promise<Record<string, unknown>[]> {
  const resp = await client.requestResponse("skills_list", {}, "skills_list", timeout ?? 15_000);
  const skillsRaw = resp.skills;
  if (!skillsRaw || !Array.isArray(skillsRaw)) return [];
  return skillsRaw.filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null);
}

/** Fetches a daemon config section via RPC. */
export async function fetchConfigSection(
  client: Client,
  section: string,
  timeout?: number,
): Promise<Record<string, unknown>> {
  const resp = await client.requestResponse(
    "config_get",
    { section },
    "config_get",
    timeout ?? 5_000,
  );
  const sec = resp[section];
  if (sec && typeof sec === "object") {
    return sec as Record<string, unknown>;
  }
  return resp;
}

/** Requests daemon config reload via RPC. */
export async function requestDaemonConfigReload(
  client: Client,
  timeout?: number,
): Promise<Record<string, unknown>> {
  return client.requestResponse("config_reload", {}, "config_reload", timeout ?? 15_000);
}

/** Requests loop history and waits for the response. */
export async function fetchLoopHistory(
  client: Client,
  loopID: string,
  timeout?: number,
): Promise<Record<string, unknown>> {
  return client.requestResponse(
    "loop_history_fetch",
    { loop_id: loopID },
    "loop_history_fetch",
    timeout ?? 15_000,
  );
}

/** Submits credentials for daemon-side authentication and waits for the response. */
export async function authenticate(
  client: Client,
  accessKey: string,
  secretKey: string,
  timeout?: number,
): Promise<Record<string, unknown>> {
  return client.requestResponse(
    "auth",
    { access_key: accessKey, secret_key: secretKey },
    "auth",
    timeout ?? 15_000,
  );
}

/** Refreshes the daemon-side auth token and waits for the response. */
export async function refreshAuthToken(
  client: Client,
  refreshToken: string,
  timeout?: number,
): Promise<Record<string, unknown>> {
  return client.requestResponse(
    "auth_refresh",
    { refresh_token: refreshToken },
    "auth_refresh",
    timeout ?? 15_000,
  );
}

/** Fetch persisted conversation/activity rows for a loop. */
export async function fetchLoopMessages(
  client: Client,
  loopID: string,
  opts?: { limit?: number; offset?: number; includeEvents?: boolean; timeout?: number },
): Promise<Record<string, unknown>> {
  return client.getLoopMessages(
    loopID,
    opts?.limit,
    opts?.offset,
    opts?.includeEvents,
    opts?.timeout,
  );
}

/**
 * Connect, handshake, and yield a ready Client. Always closes in finally.
 */
export async function connectedWebsocket<T>(
  wsUrl: string,
  fn: (client: Client) => Promise<T>,
  timeoutMs = 30_000,
): Promise<T> {
  const { Client } = await import("./client.js");
  const client = new Client(wsUrl, defaultConfig());
  const deadline = Date.now() + timeoutMs;
  try {
    await client.connect();
    while (!client.isConnected() && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 25));
    }
    if (!client.isConnected()) {
      throw new Error("Timed out waiting for daemon handshake");
    }
    return await fn(client);
  } finally {
    client.close();
  }
}

/**
 * One-shot protocol-1 RPC / notify / subscribe with dict-style error contract.
 * Callers check `if ("error" in response)`.
 */
export async function protocol1Rpc(
  wsUrl: string,
  method: string,
  params: Record<string, unknown> | null = null,
  opts: { mode?: "request" | "notify" | "subscribe"; timeoutMs?: number } = {},
): Promise<Record<string, unknown>> {
  const mode = opts.mode ?? "request";
  const timeoutMs = opts.timeoutMs ?? 30_000;
  try {
    return await connectedWebsocket(
      wsUrl,
      async client => {
        if (mode === "notify") {
          await client.notify(method as import("./protocol.js").MethodName, params ?? {});
          return {};
        }
        if (mode === "subscribe") {
          const subId = await client.subscribe(
            method as "loop_events" | "autopilot_events",
            params ?? {},
            timeoutMs,
          );
          return { subscription_id: subId };
        }
        const result = await client.requestResponse(
          method as import("./protocol.js").MethodName,
          params ?? {},
          method,
          timeoutMs,
        );
        return result && typeof result === "object" ? result : { result };
      },
      timeoutMs,
    );
  } catch (exc) {
    const msg = exc instanceof Error ? exc.message : String(exc);
    if (msg.toLowerCase().includes("timed out") || msg.toLowerCase().includes("timeout")) {
      return { error: "Timed out waiting for daemon response" };
    }
    if (msg.toLowerCase().includes("connect") || msg.toLowerCase().includes("dial")) {
      return { error: `Connection error: ${msg}` };
    }
    return { error: msg };
  }
}

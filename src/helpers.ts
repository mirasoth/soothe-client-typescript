/**
 * Convenience RPC helper functions for the Soothe client (RFC-450 protocol-1).
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

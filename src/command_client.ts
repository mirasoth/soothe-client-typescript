/**
 * Ephemeral one-shot RPC client for jobs / cron.
 */

import { Client } from "./client.js";
import { defaultConfig, type Config } from "./config.js";
import type { MethodName } from "./protocol.js";
import { connectWithRetries } from "./session.js";

export class CommandClient {
  readonly url: string;
  readonly timeoutMs: number;
  private readonly config: Config;

  constructor(url: string, opts?: { timeoutMs?: number; config?: Config }) {
    this.url = url;
    this.timeoutMs = opts?.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : 30_000;
    this.config = opts?.config ?? defaultConfig();
  }

  private async withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client(this.url, this.config);
    try {
      await connectWithRetries(client, 5, 250);
      return await fn(client);
    } finally {
      client.close();
    }
  }

  /** Generic one-shot RPC. */
  async request(
    method: MethodName,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    return this.withClient(client =>
      client.requestResponse(method, params, undefined, this.timeoutMs),
    );
  }

  /** Creates a job (rail-pinned loop submission); the daemon requires rail_id. */
  async jobCreate(goal: string, railId: string, workspace = ""): Promise<Record<string, unknown>> {
    const params: Record<string, unknown> = { goal, rail_id: railId };
    if (workspace) params.workspace = workspace;
    return this.request("job_create", params);
  }

  async cronAdd(text: string, priority = 0): Promise<Record<string, unknown>> {
    const params: Record<string, unknown> = { text };
    if (priority > 0) params.priority = priority;
    return this.request("cron_add", params);
  }

  async cronList(status = ""): Promise<Record<string, unknown>> {
    const params: Record<string, unknown> = {};
    if (status) params.status = status;
    return this.request("cron_list", params);
  }

  async cronShow(jobId: string): Promise<Record<string, unknown>> {
    return this.request("cron_show", { job_id: jobId });
  }

  async cronCancel(jobId: string): Promise<Record<string, unknown>> {
    return this.request("cron_cancel", { job_id: jobId });
  }
}

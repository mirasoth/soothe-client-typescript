/**
 * Ephemeral one-shot RPC client for jobs / cron / autopilot.
 * Mirrors Python AsyncCommandClient / CommandClient (RFC-629 / IG-662).
 */

import { Client } from "./client.js";
import { defaultConfig, type Config } from "./config.js";
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
  async request(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return this.withClient(client =>
      client.requestResponse(method, params, undefined, this.timeoutMs),
    );
  }

  async jobCreate(goal: string, workspace = ""): Promise<Record<string, unknown>> {
    const params: Record<string, unknown> = { goal };
    if (workspace) params.workspace = workspace;
    return this.request("job_create", params);
  }

  async jobStatus(jobId: string): Promise<Record<string, unknown>> {
    return this.request("job_status", { job_id: jobId });
  }

  async jobCancel(jobId: string): Promise<Record<string, unknown>> {
    return this.request("job_cancel", { job_id: jobId });
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
}

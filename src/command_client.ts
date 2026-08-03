/**
 * Ephemeral one-shot RPC client for jobs / cron / autopilot.
 * Mirrors Python AsyncCommandClient / CommandClient.
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

  /** Return autopilot scheduler status (running / dreaming / pool). */
  async autopilotStatus(): Promise<Record<string, unknown>> {
    return this.request("autopilot_status");
  }

  /** Submit a new autopilot goal (returns goal_id). */
  async autopilotSubmit(
    description: string,
    opts?: { priority?: number; workspace?: string },
  ): Promise<Record<string, unknown>> {
    const params: Record<string, unknown> = {
      description,
      priority: opts?.priority ?? 50,
    };
    if (opts?.workspace) params.workspace = opts.workspace;
    return this.request("autopilot_submit", params);
  }

  /** List all goals (including non-root children). */
  async autopilotListGoals(): Promise<Record<string, unknown>> {
    return this.request("autopilot_list_goals");
  }

  /** Fetch one goal by id. */
  async autopilotGetGoal(goalId: string): Promise<Record<string, unknown>> {
    return this.request("autopilot_get_goal", { goal_id: goalId });
  }

  /** Cancel a goal and its non-terminal descendants. */
  async autopilotCancelGoal(goalId: string): Promise<Record<string, unknown>> {
    return this.request("autopilot_cancel_goal", { goal_id: goalId });
  }

  /** Cancel every open (non-terminal) goal. */
  async autopilotCancelAll(): Promise<Record<string, unknown>> {
    return this.request("autopilot_cancel_all");
  }

  /** Exit dreaming mode and resume scheduling. */
  async autopilotWake(): Promise<Record<string, unknown>> {
    return this.request("autopilot_wake");
  }

  /** Force dreaming mode. */
  async autopilotDream(): Promise<Record<string, unknown>> {
    return this.request("autopilot_dream");
  }

  /** Resume a suspended or blocked goal. */
  async autopilotResume(goalId: string): Promise<Record<string, unknown>> {
    return this.request("autopilot_resume", { goal_id: goalId });
  }

  /** List root goals only (jobs). Prefer job* for job control. */
  async autopilotListJobs(): Promise<Record<string, unknown>> {
    return this.request("autopilot_list_jobs");
  }

  /** Get a root job with DAG snapshot. Prefer jobStatus / getJobDag. */
  async autopilotGetJob(jobId: string): Promise<Record<string, unknown>> {
    return this.request("autopilot_get_job", { job_id: jobId });
  }

  /** Active-only jobs → goals → loops snapshot for CLI top. */
  async autopilotTop(): Promise<Record<string, unknown>> {
    return this.request("autopilot_top");
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

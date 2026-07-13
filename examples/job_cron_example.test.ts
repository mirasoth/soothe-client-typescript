/**
 * Job & Cron IPC examples (RFC-228, RFC-229): full job lifecycle
 * (create → status → pause → resume → cancel → DAG → guidance),
 * autopilot subscribe/unsubscribe, and cron add/list/show/cancel.
 *
 * Mirrors the Go client's `job_cron_example_test.go`.
 */

import { describe, it, expect } from "vitest";
import { Client } from "../src/index.js";
import { createMockDaemon } from "./helpers/mock-server.js";

describe("Example: job lifecycle (RFC-228)", () => {
  it("jobLifecycle: create → status → DAG → pause → resume → guidance → cancel", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      // 1. Create a job with a root goal and workspace.
      const createResp = await client.createJob(
        "Build a REST API with tests",
        undefined,
        "/tmp/workspace",
        15_000,
      );
      const jobId = createResp.job_id as string;
      console.log("Created job:", jobId);

      // 2. Query job status (goal status, counts, assigned workers).
      const status = await client.getJobStatus(jobId, 15_000);
      console.log("Job status:", status);

      // 3. Get the GoalEngine DAG snapshot for visualization.
      const dag = await client.getJobDag(jobId, 15_000);
      console.log("Job DAG:", dag);

      // 4. Pause goal execution.
      await client.pauseJob(jobId, 15_000);
      console.log("JobPause: ok");

      // 5. Resume paused goal execution.
      await client.resumeJob(jobId, 15_000);
      console.log("JobResume: ok");

      // 6. Send user guidance to the job's root goal.
      await client.sendJobGuidance(
        jobId,
        "Prioritize authentication and security",
        undefined,
        30_000,
      );
      console.log("JobGuidance: ok");

      // 7. Cancel the job.
      await client.cancelJob(jobId, 15_000);
      console.log("JobCancel: ok");

      client.close();

      expect(jobId).toMatch(/^job-\d+$/);
      expect(status).toMatchObject({ job_id: jobId, goal_status: "in_progress" });
      expect(dag).toMatchObject({ job_id: jobId });
    } finally {
      await md.close();
    }
  });
});

describe("Example: autopilot events", () => {
  it("autopilotSubscribe: subscribes to autopilot worker events", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      const subId = await client.autopilotSubscribe(15_000);
      console.log("Autopilot subscription:", subId);

      // Unsubscribe from autopilot events.
      await client.autopilotUnsubscribe(15_000);
      console.log("Autopilot unsubscribed");

      client.close();
      expect(subId).toBeTruthy();
    } finally {
      await md.close();
    }
  });
});

describe("Example: cron lifecycle (RFC-229)", () => {
  it("cronAdd: creates a scheduled job from natural language", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      const resp = await client.cronAdd("Send a daily summary at 9am", undefined, 30_000);
      console.log("Cron add:", resp);

      client.close();
      expect(resp).toMatchObject({ status: "scheduled" });
      expect(resp.job_id).toBeTruthy();
    } finally {
      await md.close();
    }
  });

  it("cronAddWithPriority: sets priority on scheduled job", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      const resp = await client.cronAdd("Weekly cleanup on Sundays", 5, 30_000);
      console.log("Cron add (priority):", resp);

      client.close();
      expect(resp).toMatchObject({ status: "scheduled" });
    } finally {
      await md.close();
    }
  });

  it("cronList: lists scheduled jobs", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      const list = await client.cronList(undefined, 15_000);
      console.log("Cron list:", list);

      client.close();
      expect(list).toMatchObject({ total: 2 });
      expect(list.jobs).toBeInstanceOf(Array);
    } finally {
      await md.close();
    }
  });

  it("cronListByStatus: filter by status", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      const list = await client.cronList("scheduled", 15_000);
      console.log("Cron list (scheduled):", list);

      client.close();
      expect(list.jobs).toBeInstanceOf(Array);
    } finally {
      await md.close();
    }
  });

  it("cronShow: shows a specific scheduled job", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      const job = await client.cronShow("cron-1", 15_000);
      console.log("Cron show:", job);

      client.close();
      expect(job).toMatchObject({ job_id: "cron-1" });
      expect(job.schedule).toBeDefined();
    } finally {
      await md.close();
    }
  });

  it("cronCancel: cancels a scheduled job", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      const resp = await client.cronCancel("cron-1", 15_000);
      console.log("Cron cancel:", resp);

      client.close();
      expect(resp).toMatchObject({ status: "cancelled" });
    } finally {
      await md.close();
    }
  });
});

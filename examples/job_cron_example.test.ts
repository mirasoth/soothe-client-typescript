/**
 * Job & Cron IPC examples: job create (rail-pinned submission)
 * and cron add/list/show/cancel.
 *
 * Mirrors the Go client's `job_cron_example_test.go`.
 */

import { describe, it, expect } from "vitest";
import { Client } from "../src/index.js";
import { createMockDaemon } from "./helpers/mock-server.js";

describe("Example: job lifecycle", () => {
  it("jobCreate: rail-pinned job submission", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      // Create a rail-pinned job; the daemon requires rail_id.
      const createResp = await client.createJob(
        "Build a REST API with tests",
        "rail-default",
        undefined,
        "/tmp/workspace",
        15_000,
      );
      const jobId = createResp.job_id as string;
      console.log("Created job:", jobId);

      client.close();

      expect(jobId).toMatch(/^job-\d+$/);
    } finally {
      await md.close();
    }
  });
});

describe("Example: cron lifecycle", () => {
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

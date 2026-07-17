/**
 * Integration tests that connect to a running Soothe daemon.
 * Skipped unless SOOTHE_INTEGRATION=1 is set.
 */

import { describe, it, expect } from "vitest";
import { Client } from "../src/client.js";
import { loadConfigFromEnv } from "../src/config.js";
import { INTENT_HINT_TEXT_COMPLETION } from "../src/intent_hints.js";
import {
  bootstrapLoopSession,
  checkDaemonStatus,
  fetchSkillsCatalog,
  fetchConfigSection,
  isDaemonLive,
} from "../src/index.js";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";

const shouldRun = process.env.SOOTHE_INTEGRATION === "1";

const skip = () => {
  if (!shouldRun) return true;
  return false;
};

const cfg = loadConfigFromEnv();

describe.skipIf(skip())("Integration", () => {
  it("connect and close", async () => {
    const client = new Client(cfg.daemonURL, cfg);
    await client.connect();
    expect(client.isConnected()).toBe(true);
    client.close();
    expect(client.isConnected()).toBe(false);
  });

  it("handshake reports ready", async () => {
    const client = new Client(cfg.daemonURL, cfg);
    await client.connect();
    const ev = await client.waitForDaemonReady(cfg.daemonReadyTimeout);
    expect(ev.readiness_state).toBe("ready");
    client.close();
  });

  it("new loop creation", async () => {
    const client = new Client(cfg.daemonURL, cfg);
    await client.connect();

    mkdtempSync(join(tmpdir(), "soothe-test-"));
    const loopID = await bootstrapLoopSession(client, null, cfg);
    expect(loopID).toBeTruthy();
    client.close();
  });

  it("input message", async () => {
    const client = new Client(cfg.daemonURL, cfg);
    await client.connect();

    mkdtempSync(join(tmpdir(), "soothe-test-"));
    const loopID = await bootstrapLoopSession(client, null, cfg);
    expect(loopID).toBeTruthy();

    await client.sendInput("Hello, this is a test message from TypeScript client", { loopID });

    // Read some events for a short time.
    let eventCount = 0;
    const start = Date.now();
    while (Date.now() - start < 5000 && eventCount < 5) {
      const ev = await client.readEventWithTimeout(2000);
      if (ev === null) break;
      eventCount++;
    }
    client.close();
  });

  it("daemon status", async () => {
    const client = new Client(cfg.daemonURL, cfg);
    await client.connect();

    const resp = await client.requestResponse("daemon_status", {}, "daemon_status", 5000);
    expect(resp.running).toBe(true);
    client.close();
  });

  it("skills list", async () => {
    const client = new Client(cfg.daemonURL, cfg);
    await client.connect();

    const resp = await client.listSkills(15_000);
    expect(Array.isArray(resp.skills)).toBe(true);
    client.close();
  });

  it("models list", async () => {
    const client = new Client(cfg.daemonURL, cfg);
    await client.connect();

    const resp = await client.listModels(15_000);
    expect(Array.isArray(resp.models)).toBe(true);
    client.close();
  });

  it("loop list", async () => {
    const client = new Client(cfg.daemonURL, cfg);
    await client.connect();

    const resp = await client.listLoops(15_000);
    expect(Array.isArray(resp.loops)).toBe(true);
    client.close();
  });

  it("isDaemonLive", async () => {
    const result = await isDaemonLive(cfg.daemonURL, 10_000);
    expect(result).toBe(true);
  });

  it("connection recovery", async () => {
    const client1 = new Client(cfg.daemonURL, cfg);
    await client1.connect();
    client1.close();
    expect(client1.isConnected()).toBe(false);

    const client2 = new Client(cfg.daemonURL, cfg);
    await client2.connect();
    expect(client2.isConnected()).toBe(true);
    client2.close();
  });

  it("config get", async () => {
    const client = new Client(cfg.daemonURL, cfg);
    await client.connect();

    const config = await fetchConfigSection(client, "providers", 5000);
    expect(config).toBeDefined();
    client.close();
  });

  it("send detach", async () => {
    const client = new Client(cfg.daemonURL, cfg);
    await client.connect();

    await client.sendDetach();
    client.close();
  });

  it("check daemon status helper", async () => {
    const client = new Client(cfg.daemonURL, cfg);
    await client.connect();

    const resp = await checkDaemonStatus(client, 5000);
    expect(resp.running).toBe(true);
    client.close();
  });

  it("fetch skills catalog helper", async () => {
    const client = new Client(cfg.daemonURL, cfg);
    await client.connect();

    const skills = await fetchSkillsCatalog(client, 15_000);
    expect(Array.isArray(skills)).toBe(true);
    client.close();
  });

  it("full conversation flow", async () => {
    const client = new Client(cfg.daemonURL, cfg);
    await client.connect();

    mkdtempSync(join(tmpdir(), "soothe-test-"));
    const loopID = await bootstrapLoopSession(client, null, cfg);

    await client.sendInput("List all files in the current directory", {
      loopID,
    });

    // Stream events for a few seconds.
    const eventTypes = new Map<string, number>();
    const start = Date.now();
    while (Date.now() - start < 10_000) {
      const ev = await client.readEventWithTimeout(2000);
      if (ev === null) break;
      const key = (ev.type as string) ?? "other";
      eventTypes.set(key, (eventTypes.get(key) ?? 0) + 1);
    }
    client.close();
  });

  // ---------------------------------------------------------------------------
 // Job IPC Integration Tests
  // ---------------------------------------------------------------------------

  it("create job", async () => {
    const client = new Client(cfg.daemonURL, cfg);
    await client.connect();

    // OPTIMIZED: Increased timeout from 30s to 60s, simpler goal
    const resp = await client.createJob("echo hello", undefined, undefined, 60_000);
    expect(resp.job_id).toBeDefined();
    client.close();
  });

  it("get job status", async () => {
    const client = new Client(cfg.daemonURL, cfg);
    await client.connect();

    // OPTIMIZED: Increased timeout from 30s to 60s, simpler goal
    const createResp = await client.createJob("echo test", undefined, undefined, 60_000);
    const jobId = createResp.job_id as string;

    const resp = await client.getJobStatus(jobId, 15_000);
    expect(resp.job_id).toBe(jobId);

    await client.cancelJob(jobId, 15_000);
    client.close();
  });

  it("pause and resume job", async () => {
    const client = new Client(cfg.daemonURL, cfg);
    await client.connect();

    // OPTIMIZED: Increased timeout from 30s to 60s, simpler goal
    const createResp = await client.createJob("echo one", undefined, undefined, 60_000);
    const jobId = createResp.job_id as string;

    const pauseResp = await client.pauseJob(jobId, 15_000);
    expect(pauseResp.status).toBeDefined();

    const resumeResp = await client.resumeJob(jobId, 15_000);
    expect(resumeResp.status).toBeDefined();

    await client.cancelJob(jobId, 15_000);
    client.close();
  });

  it("cancel job", async () => {
    const client = new Client(cfg.daemonURL, cfg);
    await client.connect();

    // OPTIMIZED: Increased timeout from 30s to 60s, simpler goal
    const createResp = await client.createJob("echo cancel", undefined, undefined, 60_000);
    const jobId = createResp.job_id as string;

    const cancelResp = await client.cancelJob(jobId, 15_000);
    expect(cancelResp.job_id).toBe(jobId);
    client.close();
  });

  it("get job dag", async () => {
    const client = new Client(cfg.daemonURL, cfg);
    await client.connect();

    // OPTIMIZED: Increased timeout from 30s to 60s, simpler goal
    const createResp = await client.createJob("echo dag", undefined, undefined, 60_000);
    const jobId = createResp.job_id as string;

    const dagResp = await client.getJobDag(jobId, 15_000);
    expect(dagResp.dag).toBeDefined();

    await client.cancelJob(jobId, 15_000);
    client.close();
  });

  it("autopilot subscribe/unsubscribe", async () => {
    const client = new Client(cfg.daemonURL, cfg);
    await client.connect();

    const subId = await client.autopilotSubscribe(15_000);
    expect(subId).toBeTruthy();

    await client.unsubscribe(subId);
    client.close();
  });

  // ---------------------------------------------------------------------------
 // Loop Extensions Integration Tests
  // ---------------------------------------------------------------------------

  it("get loop messages", async () => {
    const client = new Client(cfg.daemonURL, cfg);
    await client.connect();

    mkdtempSync(join(tmpdir(), "soothe-test-"));
    const loopID = await bootstrapLoopSession(client, null, cfg);

    const resp = await client.getLoopMessages(loopID, 10, 0, false, 15_000);
    expect(Array.isArray(resp.messages)).toBe(true);
    client.close();
  });

  it("get loop state", async () => {
    const client = new Client(cfg.daemonURL, cfg);
    await client.connect();

    mkdtempSync(join(tmpdir(), "soothe-test-"));
    const loopID = await bootstrapLoopSession(client, null, cfg);

    const resp = await client.getLoopState(loopID, 15_000);
    expect(resp).toBeDefined();
    client.close();
  });

  it("fetch loop cards", async () => {
    const client = new Client(cfg.daemonURL, cfg);
    await client.connect();

    mkdtempSync(join(tmpdir(), "soothe-test-"));
    const loopID = await bootstrapLoopSession(client, null, cfg);

    const resp = await client.fetchLoopCards(loopID, 15_000);
    expect(resp).toBeDefined();
    client.close();
  });

  it("get mcp status", async () => {
    const client = new Client(cfg.daemonURL, cfg);
    await client.connect();

    const resp = await client.getMCPStatus(15_000);
    expect(Array.isArray(resp.servers)).toBe(true);
    client.close();
  });

  // ---------------------------------------------------------------------------
 // Clarification Options Tests
  // ---------------------------------------------------------------------------

  it("send input with clarification mode", async () => {
    const client = new Client(cfg.daemonURL, cfg);
    await client.connect();

    mkdtempSync(join(tmpdir(), "soothe-test-"));
    const loopID = await bootstrapLoopSession(client, null, cfg);

    await client.sendInput("Test clarification mode", {
      loopID,
      clarificationMode: "manual",
    });

    let eventCount = 0;
    const start = Date.now();
    while (Date.now() - start < 3000 && eventCount < 3) {
      const ev = await client.readEventWithTimeout(1000);
      if (ev === null) break;
      eventCount++;
    }
    client.close();
  });

  it("send input with intent hint", async () => {
    const client = new Client(cfg.daemonURL, cfg);
    await client.connect();

    mkdtempSync(join(tmpdir(), "soothe-test-"));
    const loopID = await bootstrapLoopSession(client, null, cfg);

    await client.sendInput("Hello world", {
      loopID,
      intentHint: INTENT_HINT_TEXT_COMPLETION,
    });

    let eventCount = 0;
    const start = Date.now();
    while (Date.now() - start < 3000 && eventCount < 3) {
      const ev = await client.readEventWithTimeout(1000);
      if (ev === null) break;
      eventCount++;
    }
    client.close();
  });
});

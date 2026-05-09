/**
 * Integration tests that connect to a running Soothe daemon.
 * Skipped unless SOOTHE_INTEGRATION=1 is set.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Client } from '../src/client.js';
import { defaultConfig, loadConfigFromEnv } from '../src/config.js';
import {
  bootstrapLoopSession,
  checkDaemonStatus,
  fetchSkillsCatalog,
  fetchConfigSection,
  isDaemonLive,
} from '../src/index.js';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';

const shouldRun = process.env.SOOTHE_INTEGRATION === '1';

const skip = () => {
  if (!shouldRun) return true;
  return false;
};

const cfg = loadConfigFromEnv();

describe.skipIf(skip())('Integration', () => {
  it('connect and close', async () => {
    const client = new Client(cfg.daemonURL, cfg);
    await client.connect();
    expect(client.isConnected()).toBe(true);
    client.close();
    expect(client.isConnected()).toBe(false);
  });

  it('daemon ready', async () => {
    const client = new Client(cfg.daemonURL, cfg);
    await client.connect();
    await client.sendDaemonReady();
    const ev = await client.waitForDaemonReady(cfg.daemonReadyTimeout);
    expect(ev.state).toBe('ready');
    client.close();
  });

  it('new loop creation', async () => {
    const client = new Client(cfg.daemonURL, cfg);
    await client.connect();

    mkdtempSync(join(tmpdir(), 'soothe-test-'));
    const loopID = await bootstrapLoopSession(client, null, cfg);
    expect(loopID).toBeTruthy();
    client.close();
  });

  it('input message', async () => {
    const client = new Client(cfg.daemonURL, cfg);
    await client.connect();

    mkdtempSync(join(tmpdir(), 'soothe-test-'));
    const loopID = await bootstrapLoopSession(client, null, cfg);
    expect(loopID).toBeTruthy();

    await client.sendInput('Hello, this is a test message from TypeScript client', { loopID });

    // Read some events for a short time
    let eventCount = 0;
    const start = Date.now();
    while (Date.now() - start < 5000 && eventCount < 5) {
      const ev = await client.readEventWithTimeout(2000);
      if (ev === null) break;
      eventCount++;
    }
    client.close();
  });

  it('daemon status', async () => {
    const client = new Client(cfg.daemonURL, cfg);
    await client.connect();

    await client.sendDaemonReady();
    await client.waitForDaemonReady(cfg.daemonReadyTimeout);

    const resp = await client.requestResponse({ type: 'daemon_status' }, 'daemon_status_response', 5000);
    expect(resp.running).toBe(true);
    client.close();
  });

  it('skills list', async () => {
    const client = new Client(cfg.daemonURL, cfg);
    await client.connect();

    await client.sendDaemonReady();
    await client.waitForDaemonReady(cfg.daemonReadyTimeout);

    const resp = await client.listSkills(15_000);
    expect(resp.type).toBe('skills_list_response');
    client.close();
  });

  it('models list', async () => {
    const client = new Client(cfg.daemonURL, cfg);
    await client.connect();

    await client.sendDaemonReady();
    await client.waitForDaemonReady(cfg.daemonReadyTimeout);

    const resp = await client.listModels(15_000);
    expect(resp.type).toBe('models_list_response');
    client.close();
  });

  it('loop list', async () => {
    const client = new Client(cfg.daemonURL, cfg);
    await client.connect();

    await client.sendDaemonReady();
    await client.waitForDaemonReady(cfg.daemonReadyTimeout);

    const resp = await client.listLoops(15_000);
    expect(resp.type).toBe('loop_list_response');
    client.close();
  });

  it('isDaemonLive', async () => {
    const result = await isDaemonLive(cfg.daemonURL, 10_000);
    expect(result).toBe(true);
  });

  it('connection recovery', async () => {
    const client1 = new Client(cfg.daemonURL, cfg);
    await client1.connect();
    client1.close();
    expect(client1.isConnected()).toBe(false);

    const client2 = new Client(cfg.daemonURL, cfg);
    await client2.connect();
    expect(client2.isConnected()).toBe(true);
    client2.close();
  });

  it('config get', async () => {
    const client = new Client(cfg.daemonURL, cfg);
    await client.connect();

    await client.sendDaemonReady();
    await client.waitForDaemonReady(cfg.daemonReadyTimeout);

    const config = await fetchConfigSection(client, 'providers', 5000);
    expect(config).toBeDefined();
    client.close();
  });

  it('send detach', async () => {
    const client = new Client(cfg.daemonURL, cfg);
    await client.connect();

    await client.sendDaemonReady();
    await client.waitForDaemonReady(cfg.daemonReadyTimeout);

    await client.sendDetach();
    client.close();
  });

  it('check daemon status helper', async () => {
    const client = new Client(cfg.daemonURL, cfg);
    await client.connect();

    await client.sendDaemonReady();
    await client.waitForDaemonReady(cfg.daemonReadyTimeout);

    const resp = await checkDaemonStatus(client, 5000);
    expect(resp.running).toBe(true);
    client.close();
  });

  it('fetch skills catalog helper', async () => {
    const client = new Client(cfg.daemonURL, cfg);
    await client.connect();

    await client.sendDaemonReady();
    await client.waitForDaemonReady(cfg.daemonReadyTimeout);

    const skills = await fetchSkillsCatalog(client, 15_000);
    expect(Array.isArray(skills)).toBe(true);
    client.close();
  });

  it('full conversation flow', async () => {
    const client = new Client(cfg.daemonURL, cfg);
    await client.connect();

    mkdtempSync(join(tmpdir(), 'soothe-test-'));
    const loopID = await bootstrapLoopSession(client, null, cfg);

    await client.sendInput('List all files in the current directory', { loopID });

    // Stream events for a few seconds
    const eventTypes = new Map<string, number>();
    const start = Date.now();
    while (Date.now() - start < 10_000) {
      const ev = await client.readEventWithTimeout(2000);
      if (ev === null) break;
      const ns = (ev as Record<string, unknown>).namespace as string | undefined;
      const key = ns ?? 'other';
      eventTypes.set(key, (eventTypes.get(key) ?? 0) + 1);
    }
    client.close();
  });
});
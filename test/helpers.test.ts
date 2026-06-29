import { describe, it, expect } from 'vitest';
import { Client } from '../src/client.js';
import {
  checkDaemonStatus, isDaemonLive, requestDaemonShutdown,
  fetchSkillsCatalog, fetchConfigSection,
} from '../src/helpers.js';
import {
  createTestServer, requestResponseHandler,
} from './helpers/ws-server.js';
import type { WebSocket } from 'ws';

describe('checkDaemonStatus', () => {
  it('returns daemon status result', async () => {
    const server = createTestServer(requestResponseHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      const resp = await checkDaemonStatus(client, 3000);
      expect(resp.running).toBe(true);
      client.close();
    } finally {
      await server.close();
    }
  });
});

describe('isDaemonLive', () => {
  it('returns true when daemon is live', async () => {
    const server = createTestServer(requestResponseHandler);
    try {
      const result = await isDaemonLive(server.url, 3000);
      expect(result).toBe(true);
    } finally {
      await server.close();
    }
  });

  it('returns false when daemon is not reachable', async () => {
    const result = await isDaemonLive('ws://localhost:59999', 500);
    expect(result).toBe(false);
  });
});

describe('requestDaemonShutdown', () => {
  it('succeeds when acknowledged', async () => {
    const server = createTestServer(requestResponseHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      await expect(requestDaemonShutdown(client, 3000)).resolves.toBeUndefined();
      client.close();
    } finally {
      await server.close();
    }
  });

  it('fails when not acknowledged', async () => {
    const server = createTestServer((ws: WebSocket) => {
      ws.on('message', raw => {
        let m: Record<string, unknown>;
        try { m = JSON.parse(raw.toString()) as Record<string, unknown>; } catch { return; }
        if (m.type === 'connection_init') {
          ws.send(JSON.stringify({ proto: '1', type: 'status', state: 'idle', input_history: [] }));
          ws.send(JSON.stringify({
            proto: '1', type: 'connection_ack',
            result: { protocol_version: '1', readiness_state: 'ready', capabilities: [], heartbeat_interval_ms: 0 },
          }));
          return;
        }
        ws.send(JSON.stringify({ proto: '1', type: 'response', id: m.id, result: { status: 'denied' } }));
      });
    });
    try {
      const client = new Client(server.url);
      await client.connect();
      await expect(requestDaemonShutdown(client, 3000)).rejects.toThrow('not acknowledged');
      client.close();
    } finally {
      await server.close();
    }
  });
});

describe('fetchSkillsCatalog', () => {
  it('returns skills list', async () => {
    const server = createTestServer(requestResponseHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      const skills = await fetchSkillsCatalog(client, 3000);
      expect(skills).toHaveLength(2);
      expect(skills[0]!.name).toBe('research');
      client.close();
    } finally {
      await server.close();
    }
  });

  it('returns empty array when no skills', async () => {
    const server = createTestServer((ws: WebSocket) => {
      ws.on('message', raw => {
        let m: Record<string, unknown>;
        try { m = JSON.parse(raw.toString()) as Record<string, unknown>; } catch { return; }
        if (m.type === 'connection_init') {
          ws.send(JSON.stringify({ proto: '1', type: 'status', state: 'idle', input_history: [] }));
          ws.send(JSON.stringify({
            proto: '1', type: 'connection_ack',
            result: { protocol_version: '1', readiness_state: 'ready', capabilities: [], heartbeat_interval_ms: 0 },
          }));
          return;
        }
        ws.send(JSON.stringify({ proto: '1', type: 'response', id: m.id, result: {} }));
      });
    });
    try {
      const client = new Client(server.url);
      await client.connect();
      const skills = await fetchSkillsCatalog(client, 3000);
      expect(skills).toHaveLength(0);
      client.close();
    } finally {
      await server.close();
    }
  });
});

describe('fetchConfigSection', () => {
  it('returns config section', async () => {
    const server = createTestServer(requestResponseHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      const config = await fetchConfigSection(client, 'providers', 3000);
      expect(config.key).toBe('value');
      client.close();
    } finally {
      await server.close();
    }
  });
});

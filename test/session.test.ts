import { describe, it, expect } from 'vitest';
import { Client } from '../src/client.js';
import {
  bootstrapLoopSession,
  waitDaemonReady,
  waitThreadStatusWithID,
  waitSubscriptionConfirmed,
  connectWithRetries,
} from '../src/session.js';
import { defaultConfig } from '../src/config.js';
import {
  createTestServer, fullBootstrapHandler, echoHandler,
} from './helpers/ws-server.js';

describe('bootstrapLoopSession', () => {
  it('runs full 3-step handshake', async () => {
    const server = createTestServer(fullBootstrapHandler);
    try {
      const client = new Client(server.url, defaultConfig());
      await client.connect();

      const loopID = await bootstrapLoopSession(client, null, defaultConfig());
      expect(loopID).toBe('test-loop-123');
      client.close();
    } finally {
      await server.close();
    }
  });

  it('resumes with existing loop id', async () => {
    const server = createTestServer(fullBootstrapHandler);
    try {
      const client = new Client(server.url, defaultConfig());
      await client.connect();

      const loopID = await bootstrapLoopSession(client, 'existing-thread', defaultConfig());
      expect(loopID).toBe('existing-thread');
      client.close();
    } finally {
      await server.close();
    }
  });
});

describe('waitDaemonReady', () => {
  it('succeeds when daemon is ready', async () => {
    const server = createTestServer(fullBootstrapHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      await client.sendDaemonReady();
      await expect(waitDaemonReady(client, 3000)).resolves.toBeUndefined();
      client.close();
    } finally {
      await server.close();
    }
  });

  it('fails when daemon is not ready', async () => {
    const server = createTestServer((ws) => {
      ws.on('message', raw => {
        let m: Record<string, unknown>;
        try { m = JSON.parse(raw.toString()) as Record<string, unknown>; } catch { return; }
        if (m.type === 'daemon_ready') {
          ws.send(JSON.stringify({ type: 'daemon_ready', state: 'initializing' }));
        }
      });
    });
    try {
      const client = new Client(server.url);
      await client.connect();
      await client.sendDaemonReady();
      await expect(waitDaemonReady(client, 3000)).rejects.toThrow('not ready');
      client.close();
    } finally {
      await server.close();
    }
  });

  it('times out', async () => {
    const server = createTestServer((ws) => {
      ws.on('message', () => {
        // Never respond
      });
    });
    try {
      const client = new Client(server.url);
      await client.connect();
      await client.sendDaemonReady();
      await expect(waitDaemonReady(client, 500)).rejects.toThrow('timeout');
      client.close();
    } finally {
      await server.close();
    }
  });
});

describe('waitThreadStatusWithID', () => {
  it('returns status with loop_id', async () => {
    const server = createTestServer(fullBootstrapHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      await client.sendNewThread('/tmp/ws');
      const status = await waitThreadStatusWithID(client, 3000);
      expect(status.loop_id ?? status.thread_id).toBe('test-thread-123');
      client.close();
    } finally {
      await server.close();
    }
  });

  it('fails on error response', async () => {
    const server = createTestServer((ws) => {
      ws.on('message', raw => {
        ws.send(JSON.stringify({ type: 'error', code: 'not_found', message: 'thread not found' }));
      });
    });
    try {
      const client = new Client(server.url);
      await client.connect();
      await client.sendNewThread('/tmp/ws');
      await expect(waitThreadStatusWithID(client, 3000)).rejects.toThrow('daemon error');
      client.close();
    } finally {
      await server.close();
    }
  });
});

describe('waitSubscriptionConfirmed', () => {
  it('succeeds when loop_id matches (subscribe_thread handshake)', async () => {
    const server = createTestServer(fullBootstrapHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      await client.sendSubscribeThread('thread-abc', 'normal');
      await expect(waitSubscriptionConfirmed(client, 'thread-abc', 'normal', 3000)).resolves.toBeUndefined();
      client.close();
    } finally {
      await server.close();
    }
  });

  it('times out when loop_id mismatches (subscribe_thread handshake)', async () => {
    const server = createTestServer(fullBootstrapHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      // The server responds with thread_id from the message, so send for 'different'
      // but wait for 'thread-abc'
      await client.sendSubscribeThread('different', 'normal');
      await expect(waitSubscriptionConfirmed(client, 'thread-abc', 'normal', 500)).rejects.toThrow('timeout');
      client.close();
    } finally {
      await server.close();
    }
  });
});

describe('connectWithRetries', () => {
  it('succeeds with available server', async () => {
    const server = createTestServer(echoHandler);
    try {
      const client = new Client(server.url);
      await connectWithRetries(client, 3, 50);
      expect(client.isConnected()).toBe(true);
      client.close();
    } finally {
      await server.close();
    }
  });

  it('fails after max retries', async () => {
    const client = new Client('ws://localhost:59999');
    await expect(connectWithRetries(client, 3, 50)).rejects.toThrow('failed to connect');
  });

  it('uses defaults when zero values passed', async () => {
    const server = createTestServer(echoHandler);
    try {
      const client = new Client(server.url);
      await connectWithRetries(client, 0, 0);
      expect(client.isConnected()).toBe(true);
      client.close();
    } finally {
      await server.close();
    }
  });
});

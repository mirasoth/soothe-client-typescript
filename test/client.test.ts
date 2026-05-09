import { describe, it, expect } from 'vitest';
import { Client } from '../src/client.js';
import {
  createTestServer, echoHandler, fullBootstrapHandler,
  ndjsonHandler, requestResponseHandler,
} from './helpers/ws-server.js';
import type { WebSocket } from 'ws';

// ---------------------------------------------------------------------------
// Client unit tests
// ---------------------------------------------------------------------------

describe('Client', () => {
  it('connect and close', async () => {
    const server = createTestServer(echoHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      expect(client.isConnected()).toBe(true);
      client.close();
      expect(client.isConnected()).toBe(false);
    } finally {
      await server.close();
    }
  });

  it('send when not connected throws', async () => {
    const client = new Client('ws://localhost:9999');
    await expect(client.sendMessage({ type: 'test' })).rejects.toThrow('not connected');
  });

  it('send and receive echo', async () => {
    const server = createTestServer(echoHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      await client.sendMessage({ type: 'test', data: 'hello' });
      const ev = await client.readEvent();
      expect(ev).not.toBeNull();
      expect(ev!.type).toBe('test');
      expect(ev!.data).toBe('hello');
      client.close();
    } finally {
      await server.close();
    }
  });

  it('receiveMessages yields decoded messages', async () => {
    const server = createTestServer(echoHandler);
    try {
      const client = new Client(server.url);
      await client.connect();

      const msgs: unknown[] = [];
      const iter = client.receiveMessages();
      const p = (async () => {
        for await (const msg of iter) {
          msgs.push(msg);
          if (msgs.length >= 1) break;
        }
      })();

      await client.sendMessage({ type: 'test_echo', data: 'world' });
      await p;

      expect(msgs.length).toBeGreaterThanOrEqual(1);
      client.close();
    } finally {
      await server.close();
    }
  });

  it('NDJSON receive splits multiple messages', async () => {
    const server = createTestServer(ndjsonHandler);
    try {
      const client = new Client(server.url);
      await client.connect();

      const msgs: unknown[] = [];
      const iter = client.receiveMessages();
      const p = (async () => {
        for await (const msg of iter) {
          msgs.push(msg);
          if (msgs.length >= 2) break;
        }
      })();

      await client.sendMessage({ type: 'trigger' });
      await p;

      expect(msgs.length).toBeGreaterThanOrEqual(2);
      client.close();
    } finally {
      await server.close();
    }
  });

  it('requestResponse matches by request_id', async () => {
    const server = createTestServer(requestResponseHandler);
    try {
      const client = new Client(server.url);
      await client.connect();

      const resp = await client.requestResponse({ type: 'daemon_status' }, 'daemon_status_response', 3000);
      expect(resp.type).toBe('daemon_status_response');
      expect(resp.running).toBe(true);
      client.close();
    } finally {
      await server.close();
    }
  });

  it('requestResponse timeout', async () => {
    const server = createTestServer((ws: WebSocket) => {
      ws.once('message', () => {
        // Never respond
      });
    });
    try {
      const client = new Client(server.url);
      await client.connect();
      await expect(
        client.requestResponse({ type: 'daemon_status' }, 'daemon_status_response', 500),
      ).rejects.toThrow('timeout');
      client.close();
    } finally {
      await server.close();
    }
  });

  it('requestResponse daemon error', async () => {
    const server = createTestServer(requestResponseHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      await expect(
        client.requestResponse({ type: 'error_test' }, 'some_response', 3000),
      ).rejects.toThrow('daemon error');
      client.close();
    } finally {
      await server.close();
    }
  });

  // ---------------------------------------------------------------------------
  // High-level API method tests (Loop-first, RFC-503)
  // ---------------------------------------------------------------------------

  it('sendInput', async () => {
    const server = createTestServer(echoHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      await client.sendInput('hello', { loopID: 'l1', model: 'openai:gpt-4' });
      const ev = await client.readEvent();
      expect(ev!.type).toBe('loop_input');
      expect(ev!.content).toBe('hello');
      expect(ev!.loop_id).toBe('l1');
      expect(ev!.model).toBe('openai:gpt-4');
      client.close();
    } finally {
      await server.close();
    }
  });

  it('sendInput rejects without loop id', async () => {
    const server = createTestServer(echoHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      await expect(client.sendInput('hello')).rejects.toThrow('loopID');
      client.close();
    } finally {
      await server.close();
    }
  });

  it('sendInput autonomous', async () => {
    const server = createTestServer(echoHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      await client.sendInput('do stuff', { loopID: 'L1', autonomous: true, maxIterations: 5 });
      const ev = await client.readEvent();
      expect(ev!.autonomous).toBe(true);
      expect(ev!.max_iterations).toBe(5);
      client.close();
    } finally {
      await server.close();
    }
  });

  it('sendCommand', async () => {
    const server = createTestServer(echoHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      await client.sendCommand('/help');
      const ev = await client.readEvent();
      expect(ev!.type).toBe('command');
      expect(ev!.cmd).toBe('/help');
      client.close();
    } finally {
      await server.close();
    }
  });

  it('sendLoopNew', async () => {
    const server = createTestServer(fullBootstrapHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      await client.sendLoopNew('/tmp/workspace');
      const ev = await client.readEvent();
      expect(ev!.type).toBe('loop_new_response');
      expect(ev!.loop_id).toBe('test-loop-123');
      client.close();
    } finally {
      await server.close();
    }
  });

  it('sendLoopSubscribe', async () => {
    const server = createTestServer(fullBootstrapHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      await client.sendLoopSubscribe('loop-abc', 'normal');
      const ev = await client.readEvent();
      expect(ev!.type).toBe('loop_subscribe_response');
      client.close();
    } finally {
      await server.close();
    }
  });

  it('sendLoopDetach', async () => {
    const server = createTestServer(fullBootstrapHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      await client.sendLoopDetach('loop-abc');
      const ev = await client.readEvent();
      expect(ev!.type).toBe('loop_detach_response');
      expect(ev!.success).toBe(true);
      client.close();
    } finally {
      await server.close();
    }
  });

  it('sendDetach', async () => {
    const server = createTestServer(echoHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      await client.sendDetach();
      const ev = await client.readEvent();
      expect(ev!.type).toBe('detach');
      client.close();
    } finally {
      await server.close();
    }
  });

  // ---------------------------------------------------------------------------
  // Loop management RPC tests (RFC-504)
  // ---------------------------------------------------------------------------

  it('sendLoopList', async () => {
    const server = createTestServer(requestResponseHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      const resp = await client.requestResponse({ type: 'loop_list' }, 'loop_list_response', 3000);
      expect(resp.type).toBe('loop_list_response');
      expect(resp.loops).toHaveLength(2);
      client.close();
    } finally {
      await server.close();
    }
  });

  it('sendLoopGet', async () => {
    const server = createTestServer(requestResponseHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      const resp = await client.requestResponse({ type: 'loop_get', loop_id: 'l1' }, 'loop_get_response', 3000);
      expect(resp.type).toBe('loop_get_response');
      client.close();
    } finally {
      await server.close();
    }
  });

  it('sendLoopDelete', async () => {
    const server = createTestServer(requestResponseHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      const resp = await client.requestResponse({ type: 'loop_delete', loop_id: 'l1' }, 'loop_delete_response', 3000);
      expect(resp.type).toBe('loop_delete_response');
      expect(resp.success).toBe(true);
      client.close();
    } finally {
      await server.close();
    }
  });

  // ---------------------------------------------------------------------------
  // Convenience RPC method tests
  // ---------------------------------------------------------------------------

  it('listSkills', async () => {
    const server = createTestServer(requestResponseHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      const resp = await client.listSkills(3000);
      expect(resp.type).toBe('skills_list_response');
      client.close();
    } finally {
      await server.close();
    }
  });

  it('listModels', async () => {
    const server = createTestServer(requestResponseHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      const resp = await client.listModels(3000);
      expect(resp.type).toBe('models_list_response');
      client.close();
    } finally {
      await server.close();
    }
  });

  it('invokeSkill', async () => {
    const server = createTestServer(requestResponseHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      const resp = await client.invokeSkill('research', 'search for X', 3000);
      expect(resp.type).toBe('invoke_skill_response');
      client.close();
    } finally {
      await server.close();
    }
  });

  it('listLoops', async () => {
    const server = createTestServer(requestResponseHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      const resp = await client.listLoops(3000);
      expect(resp.type).toBe('loop_list_response');
      client.close();
    } finally {
      await server.close();
    }
  });

  it('getLoop', async () => {
    const server = createTestServer(requestResponseHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      const resp = await client.getLoop('l1', 3000);
      expect(resp.type).toBe('loop_get_response');
      client.close();
    } finally {
      await server.close();
    }
  });

  it('deleteLoop', async () => {
    const server = createTestServer(requestResponseHandler);
    try {
      const client = new Client(server.url);
      await client.connect();
      const resp = await client.deleteLoop('l1', 3000);
      expect(resp.type).toBe('loop_delete_response');
      expect(resp.success).toBe(true);
      client.close();
    } finally {
      await server.close();
    }
  });

  // ---------------------------------------------------------------------------
  // WaitForDaemonReady / WaitForSubscriptionConfirmed
  // ---------------------------------------------------------------------------

  it('waitForDaemonReady', async () => {
    const server = createTestServer((ws: WebSocket) => {
      ws.once('message', () => {
        ws.send(JSON.stringify({ type: 'daemon_ready', state: 'ready' }));
      });
    });
    try {
      const client = new Client(server.url);
      await client.connect();
      await client.sendDaemonReady();
      const ev = await client.waitForDaemonReady(3000);
      expect(ev.state).toBe('ready');
      client.close();
    } finally {
      await server.close();
    }
  });

  // ---------------------------------------------------------------------------
  // Connection recovery
  // ---------------------------------------------------------------------------

  it('connection recovery', async () => {
    const server = createTestServer(echoHandler);
    try {
      const client1 = new Client(server.url);
      await client1.connect();
      client1.close();
      expect(client1.isConnected()).toBe(false);

      const client2 = new Client(server.url);
      await client2.connect();
      expect(client2.isConnected()).toBe(true);
      client2.close();
    } finally {
      await server.close();
    }
  });
});
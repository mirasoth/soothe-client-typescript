/**
 * Test WebSocket server utilities for unit tests.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';

/** Creates a WebSocket server on a random port. Returns the URL and a close function. */
export function createTestServer(
  handler: (ws: WebSocket) => void,
): { url: string; close: () => Promise<void> } {
  const wss = new WebSocketServer({ port: 0 });
  wss.on('connection', handler);
  const port = (wss.address() as AddressInfo).port;
  return {
    url: `ws://localhost:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        wss.close(err => (err ? reject(err) : resolve()));
      }),
  };
}

/** Echo handler: sends back any message it receives. */
export function echoHandler(ws: WebSocket): void {
  ws.on('message', data => {
    ws.send(data);
  });
}

/** Full bootstrap handler: simulates the daemon handshake (loop-first, RFC-503). */
export function fullBootstrapHandler(ws: WebSocket): void {
  ws.on('message', raw => {
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(raw.toString()) as Record<string, unknown>;
    } catch {
      return;
    }
    const typ = m.type as string;

    switch (typ) {
      case 'daemon_ready':
        ws.send(JSON.stringify({ type: 'daemon_ready', state: 'ready' }));
        break;
      case 'loop_new': {
        const rid = m.request_id as string | undefined;
        ws.send(
          JSON.stringify({
            type: 'loop_new_response',
            request_id: rid,
            loop_id: 'test-loop-123',
            success: true,
          }),
        );
        break;
      }
      case 'loop_subscribe': {
        const rid = m.request_id as string | undefined;
        const loopId = m.loop_id as string | undefined;
        ws.send(
          JSON.stringify({
            type: 'loop_subscribe_response',
            request_id: rid,
            success: true,
            loop_id: loopId ?? '',
          }),
        );
        ws.send(
          JSON.stringify({
            type: 'subscription_confirmed',
            loop_id: loopId ?? '',
            client_id: 'c1',
            verbosity: 'normal',
          }),
        );
        break;
      }
      case 'loop_detach': {
        const rid = m.request_id as string | undefined;
        ws.send(
          JSON.stringify({
            type: 'loop_detach_response',
            request_id: rid,
            success: true,
            loop_id: m.loop_id,
          }),
        );
        break;
      }
      case 'loop_list': {
        const rid = m.request_id as string | undefined;
        ws.send(
          JSON.stringify({
            type: 'loop_list_response',
            request_id: rid,
            loops: [{ loop_id: 'loop-1', status: 'idle' }],
            total: 1,
          }),
        );
        break;
      }
      case 'loop_get': {
        const rid = m.request_id as string | undefined;
        ws.send(
          JSON.stringify({
            type: 'loop_get_response',
            request_id: rid,
            loop: { loop_id: m.loop_id, status: 'running' },
          }),
        );
        break;
      }
      case 'loop_delete': {
        const rid = m.request_id as string | undefined;
        ws.send(
          JSON.stringify({
            type: 'loop_delete_response',
            request_id: rid,
            success: true,
            message: 'deleted',
          }),
        );
        break;
      }
      case 'loop_input': {
        // Simulate input acceptance and send status
        ws.send(
          JSON.stringify({
            type: 'status',
            state: 'running',
            loop_id: m.loop_id,
            workspace: '/tmp',
          }),
        );
        break;
      }
      default:
        ws.send(raw);
    }
  });
}

/** NDJSON handler: sends multiple JSON objects in one frame. */
export function ndjsonHandler(ws: WebSocket): void {
  ws.once('message', () => {
    ws.send(
      `{"type":"event","namespace":"soothe.output.autonomous.final_report.reported","data":{"text":"hello"}}\n` +
        `{"type":"status","state":"idle","loop_id":"ndjson-loop-123"}`,
    );
  });
}

/** Request-response handler: simulates the request-response RPC pattern. */
export function requestResponseHandler(ws: WebSocket): void {
  ws.on('message', raw => {
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(raw.toString()) as Record<string, unknown>;
    } catch {
      return;
    }
    const typ = m.type as string;
    const rid = m.request_id as string | undefined;

    switch (typ) {
      case 'daemon_status':
        ws.send(
          JSON.stringify({
            type: 'daemon_status_response',
            request_id: rid,
            running: true,
            port_live: true,
            active_loops: 2,
          }),
        );
        break;
      case 'skills_list':
        ws.send(
          JSON.stringify({
            type: 'skills_list_response',
            request_id: rid,
            skills: [{ name: 'research' }, { name: 'browser' }],
          }),
        );
        break;
      case 'models_list':
        ws.send(
          JSON.stringify({
            type: 'models_list_response',
            request_id: rid,
            models: [{ id: 'gpt-4' }, { id: 'claude' }],
          }),
        );
        break;
      case 'config_get': {
        const section = m.section as string;
        ws.send(
          JSON.stringify({
            type: 'config_get_response',
            request_id: rid,
            [section]: { key: 'value' },
          }),
        );
        break;
      }
      case 'daemon_shutdown':
        ws.send(
          JSON.stringify({ type: 'shutdown_ack', request_id: rid, status: 'acknowledged' }),
        );
        break;
      case 'loop_list':
        ws.send(
          JSON.stringify({
            type: 'loop_list_response',
            request_id: rid,
            loops: [{ loop_id: 'l1' }, { loop_id: 'l2' }],
            total: 2,
          }),
        );
        break;
      case 'loop_get':
        ws.send(
          JSON.stringify({
            type: 'loop_get_response',
            request_id: rid,
            loop: { loop_id: m.loop_id, status: 'idle' },
          }),
        );
        break;
      case 'loop_delete':
        ws.send(
          JSON.stringify({
            type: 'loop_delete_response',
            request_id: rid,
            success: true,
            message: 'deleted',
          }),
        );
        break;
      case 'invoke_skill':
        ws.send(
          JSON.stringify({
            type: 'invoke_skill_response',
            request_id: rid,
            skill: 'test',
            status: 'ok',
          }),
        );
        break;
      case 'error_test':
        ws.send(
          JSON.stringify({
            type: 'error',
            request_id: rid,
            code: 'test_error',
            message: 'test error message',
          }),
        );
        break;
      default:
        ws.send(raw);
    }
  });
}
import { describe, it, expect } from 'vitest';
import {
  encodeMessage, decodeMessage, splitWirePayload, extractSootheLoopID,
  newLoopInputMessage, newLoopNewMessage, newLoopSubscribeMessage,
  newRequestID,
  type LoopInputMessage, type CommandMessage, type LoopSubscribeMessage,
  type LoopNewMessage, type EventMessage,
  type StatusResponse, type DaemonReadyResponse, type ErrorResponse,
  type DaemonStatusResponse, type ShutdownAckResponse, type LoopListResponse,
  type SkillsListResponse, type ModelsListResponse, type ResumeInterruptsMessage,
} from '../src/protocol.js';

// ---------------------------------------------------------------------------
// Encode / Decode round-trip tests
// ---------------------------------------------------------------------------

describe('encodeMessage', () => {
  it('appends newline', () => {
    const encoded = encodeMessage({ type: 'loop_input', content: 'hello' });
    expect(encoded.endsWith('\n')).toBe(true);
  });
});

describe('decodeMessage', () => {
  it('returns null for empty input', () => {
    expect(decodeMessage('')).toBeNull();
  });

  it('throws on invalid JSON', () => {
    expect(() => decodeMessage('not json')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Round-trip tests
// ---------------------------------------------------------------------------

describe('round-trip', () => {
  it('LoopInputMessage', () => {
    const msg: LoopInputMessage = {
      request_id: 'r2',
      type: 'loop_input',
      loop_id: 'loop-abc',
      content: 'hello loop',
      autonomous: false,
      model: 'openai:gpt-4',
    };
    const encoded = encodeMessage(msg);
    const decoded = decodeMessage(encoded.slice(0, -1));
    expect(decoded).toMatchObject({ type: 'loop_input', loop_id: 'loop-abc', content: 'hello loop', model: 'openai:gpt-4' });
  });

  it('CommandMessage', () => {
    const msg: CommandMessage = { type: 'command', cmd: '/help' };
    const encoded = encodeMessage(msg);
    const decoded = decodeMessage(encoded.slice(0, -1));
    expect(decoded).toMatchObject({ type: 'command', cmd: '/help' });
  });

  it('LoopSubscribeMessage (factory)', () => {
    const msg = newLoopSubscribeMessage('loop-1', 'debug');
    const encoded = encodeMessage(msg);
    const decoded = decodeMessage(encoded.slice(0, -1));
    expect(decoded).toMatchObject({ type: 'loop_subscribe', loop_id: 'loop-1', verbosity: 'debug' });
  });

  it('LoopNewMessage (factory)', () => {
    const msg = newLoopNewMessage('/tmp/workspace');
    const encoded = encodeMessage(msg);
    const decoded = decodeMessage(encoded.slice(0, -1));
    expect(decoded).toMatchObject({ type: 'loop_new', client_workspace: '/tmp/workspace' });
  });

  it('EventMessage', () => {
    const msg: EventMessage = { type: 'event', namespace: 'soothe.output.autonomous.final_report.reported', data: { text: 'Hello' } };
    const encoded = encodeMessage(msg);
    const decoded = decodeMessage(encoded.slice(0, -1));
    expect(decoded).toMatchObject({ type: 'event', namespace: 'soothe.output.autonomous.final_report.reported' });
  });

  it('StatusResponse', () => {
    const msg: StatusResponse = { type: 'status', state: 'idle', loop_id: 'loop-xyz', workspace: '/tmp/ws' };
    const encoded = encodeMessage(msg);
    const decoded = decodeMessage(encoded.slice(0, -1));
    expect(decoded).toMatchObject({ type: 'status', loop_id: 'loop-xyz' });
  });

  it('StatusResponse with camelCase loopId fallback', () => {
    const raw = `{"type":"status","state":"idle","loopId":"loop-camel"}`;
    const decoded = decodeMessage(raw) as StatusResponse;
    expect(decoded.loop_id).toBe('loop-camel');
  });

  it('DaemonReadyResponse', () => {
    const msg: DaemonReadyResponse = { type: 'daemon_ready', state: 'ready', message: 'daemon is ready' };
    const encoded = encodeMessage(msg);
    const decoded = decodeMessage(encoded.slice(0, -1));
    expect(decoded).toMatchObject({ type: 'daemon_ready', state: 'ready' });
  });

  it('ErrorResponse', () => {
    const msg: ErrorResponse = { type: 'error', code: 'internal_error', message: 'something went wrong' };
    const encoded = encodeMessage(msg);
    const decoded = decodeMessage(encoded.slice(0, -1));
    expect(decoded).toMatchObject({ type: 'error', code: 'internal_error' });
  });

  it('DaemonStatusResponse', () => {
    const raw = `{"type":"daemon_status_response","running":true,"port_live":true,"active_loops":3}`;
    const decoded = decodeMessage(raw) as DaemonStatusResponse;
    expect(decoded.running).toBe(true);
    expect(decoded.port_live).toBe(true);
    expect(decoded.active_loops).toBe(3);
  });

  it('ShutdownAckResponse', () => {
    const raw = `{"type":"shutdown_ack","status":"acknowledged"}`;
    const decoded = decodeMessage(raw) as ShutdownAckResponse;
    expect(decoded.status).toBe('acknowledged');
  });

  it('LoopListResponse', () => {
    const raw = `{"type":"loop_list_response","loops":[{"loop_id":"l1"},{"loop_id":"l2"}],"total":2}`;
    const decoded = decodeMessage(raw) as LoopListResponse;
    expect(decoded.loops).toHaveLength(2);
    expect(decoded.total).toBe(2);
  });

  it('SkillsListResponse', () => {
    const raw = `{"type":"skills_list_response","skills":[{"name":"skill1"},{"name":"skill2"}]}`;
    const decoded = decodeMessage(raw) as SkillsListResponse;
    expect(decoded.skills).toHaveLength(2);
  });

  it('ModelsListResponse', () => {
    const raw = `{"type":"models_list_response","models":[{"id":"gpt-4"}]}`;
    const decoded = decodeMessage(raw) as ModelsListResponse;
    expect(decoded.models).toHaveLength(1);
  });

  it('config_get_response as raw map', () => {
    const raw = `{"type":"config_get_response","providers":{"openai":{"api_key":"***"}}}`;
    const decoded = decodeMessage(raw) as Record<string, unknown>;
    expect(decoded.type).toBe('config_get_response');
  });

  it('invoke_skill_response as raw map', () => {
    const raw = `{"type":"invoke_skill_response","skill":"test","status":"ok"}`;
    const decoded = decodeMessage(raw) as Record<string, unknown>;
    expect(decoded.type).toBe('invoke_skill_response');
  });

  it('unknown type returns raw map', () => {
    const raw = `{"type":"future_type","data":"hello"}`;
    const decoded = decodeMessage(raw) as Record<string, unknown>;
    expect(decoded.type).toBe('future_type');
  });
});

// ---------------------------------------------------------------------------
// All client→daemon message type decode tests
// ---------------------------------------------------------------------------

describe('decode all client message types', () => {
  const tests = [
    {
      name: 'loop_input',
      json: `{"type":"loop_input","loop_id":"L1","content":"hi","autonomous":false}`,
      wantType: 'loop_input',
    },
    { name: 'command', json: `{"type":"command","cmd":"/help"}`, wantType: 'command' },
    { name: 'loop_subscribe', json: `{"type":"loop_subscribe","loop_id":"l1","verbosity":"normal"}`, wantType: 'loop_subscribe' },
    { name: 'loop_new', json: `{"type":"loop_new","workspace":"/tmp"}`, wantType: 'loop_new' },
    { name: 'loop_detach', json: `{"type":"loop_detach","loop_id":"l1"}`, wantType: 'loop_detach' },
    { name: 'loop_list', json: `{"type":"loop_list"}`, wantType: 'loop_list' },
    { name: 'loop_get', json: `{"type":"loop_get","loop_id":"l1"}`, wantType: 'loop_get' },
    { name: 'loop_tree', json: `{"type":"loop_tree","loop_id":"l1"}`, wantType: 'loop_tree' },
    { name: 'loop_prune', json: `{"type":"loop_prune","loop_id":"l1"}`, wantType: 'loop_prune' },
    { name: 'loop_delete', json: `{"type":"loop_delete","loop_id":"l1"}`, wantType: 'loop_delete' },
    { name: 'loop_reattach', json: `{"type":"loop_reattach","loop_id":"l1"}`, wantType: 'loop_reattach' },
    { name: 'daemon_status', json: `{"type":"daemon_status"}`, wantType: 'daemon_status' },
    { name: 'daemon_shutdown', json: `{"type":"daemon_shutdown"}`, wantType: 'daemon_shutdown' },
    { name: 'config_get', json: `{"type":"config_get","section":"providers"}`, wantType: 'config_get' },
    { name: 'resume_interrupts', json: `{"type":"resume_interrupts","loop_id":"L1","resume_payload":{}}`, wantType: 'resume_interrupts' },
    { name: 'skills_list', json: `{"type":"skills_list"}`, wantType: 'skills_list' },
    { name: 'models_list', json: `{"type":"models_list"}`, wantType: 'models_list' },
    { name: 'invoke_skill', json: `{"type":"invoke_skill","skill":"test","args":""}`, wantType: 'invoke_skill' },
    { name: 'detach', json: `{"type":"detach"}`, wantType: 'detach' },
  ];

  for (const tt of tests) {
    it(tt.name, () => {
      const decoded = decodeMessage(tt.json) as Record<string, unknown>;
      expect(decoded.type).toBe(tt.wantType);
    });
  }
});

// ---------------------------------------------------------------------------
// splitWirePayload tests
// ---------------------------------------------------------------------------

describe('splitWirePayload', () => {
  it('single JSON', () => {
    const lines = splitWirePayload(`{"type":"status","state":"idle"}`);
    expect(lines).toHaveLength(1);
  });

  it('NDJSON', () => {
    const lines = splitWirePayload(`{"type":"status","state":"idle"}\n{"type":"daemon_ready","state":"ready"}`);
    expect(lines).toHaveLength(2);
  });

  it('empty input', () => {
    expect(splitWirePayload('')).toHaveLength(0);
  });

  it('trailing newline', () => {
    const lines = splitWirePayload(`{"type":"status"}\n`);
    expect(lines).toHaveLength(1);
  });

  it('whitespace only', () => {
    expect(splitWirePayload('  \n  \n  ')).toHaveLength(0);
  });

  it('multiple newlines', () => {
    const lines = splitWirePayload(`{"a":1}\n\n{"b":2}\n{"c":3}`);
    expect(lines).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// extractSootheLoopID tests
// ---------------------------------------------------------------------------

describe('extractSootheLoopID', () => {
  it('from StatusResponse loop_id', () => {
    const [id, ok] = extractSootheLoopID({ type: 'status', loop_id: 'loop-1' });
    expect(ok).toBe(true);
    expect(id).toBe('loop-1');
  });

  it('from StatusResponse empty', () => {
    const [, ok] = extractSootheLoopID({ type: 'status' });
    expect(ok).toBe(false);
  });

  it('from EventMessage top-level loop_id', () => {
    const [id, ok] = extractSootheLoopID({ type: 'event', loop_id: 'evt-loop' });
    expect(ok).toBe(true);
    expect(id).toBe('evt-loop');
  });

  it('from EventMessage data.loop_id', () => {
    const [id, ok] = extractSootheLoopID({ type: 'event', data: { loop_id: 'data-loop' } });
    expect(ok).toBe(true);
    expect(id).toBe('data-loop');
  });

  it('from EventMessage data.loopId (camelCase)', () => {
    const [id, ok] = extractSootheLoopID({ type: 'event', data: { loopId: 'camel-loop' } });
    expect(ok).toBe(true);
    expect(id).toBe('camel-loop');
  });

  it('from generic map with loop_id', () => {
    const [id, ok] = extractSootheLoopID({ loop_id: 'map-loop' });
    expect(ok).toBe(true);
    expect(id).toBe('map-loop');
  });

  it('returns false for unsupported type', () => {
    const [, ok] = extractSootheLoopID('not a message');
    expect(ok).toBe(false);
  });
});

describe('resume_interrupts decode', () => {
  it('preserves loop_id', () => {
    const decoded = decodeMessage(
      `{"type":"resume_interrupts","loop_id":"L1","resume_payload":{}}`,
    ) as ResumeInterruptsMessage;
    expect(decoded.loop_id).toBe('L1');
  });
});

// ---------------------------------------------------------------------------
// Factory function tests
// ---------------------------------------------------------------------------

describe('factory functions', () => {
  it('newLoopInputMessage', () => {
    const msg = newLoopInputMessage('loop-1', 'hello');
    expect(msg.type).toBe('loop_input');
    expect(msg.content).toBe('hello');
    expect(msg.loop_id).toBe('loop-1');
    expect(msg.request_id).toBeTruthy();
  });

  it('newLoopSubscribeMessage', () => {
    const msg = newLoopSubscribeMessage('loop-1', 'debug');
    expect(msg.type).toBe('loop_subscribe');
    expect(msg.loop_id).toBe('loop-1');
    expect(msg.verbosity).toBe('debug');
  });

  it('newLoopNewMessage', () => {
    const msg = newLoopNewMessage('/tmp/ws');
    expect(msg.type).toBe('loop_new');
    expect(msg.client_workspace).toBe('/tmp/ws');
  });

  it('newLoopNewMessage with options', () => {
    const msg = newLoopNewMessage({
      client_workspace: '/tmp/proj',
      user_id: 'alice',
      client_workspace_id: 'app-1',
    });
    expect(msg.client_workspace).toBe('/tmp/proj');
    expect(msg.user_id).toBe('alice');
    expect(msg.client_workspace_id).toBe('app-1');
  });

  it('newLoopNewMessage without workspace', () => {
    const msg = newLoopNewMessage();
    expect(msg.type).toBe('loop_new');
    expect(msg.client_workspace).toBeUndefined();
  });

  it('newRequestID generates UUID', () => {
    const id = newRequestID();
    expect(id).toBeTruthy();
    expect(id).toMatch(/^[0-9a-f-]+$/);
  });

  it('newRequestID generates unique IDs', () => {
    const id1 = newRequestID();
    const id2 = newRequestID();
    expect(id1).not.toBe(id2);
  });
});
# Examples

Runnable Vitest examples that exercise the public API against an in-process mock
WebSocket server (no live `soothed` required).

```bash
# from client/typescript
npm test -- examples
npm test -- examples/progressive
npm test -- examples/appkit
```

| Path | What it shows |
|------|----------------|
| [`progressive/`](progressive/) | Ladder 01–06: hello → `DaemonSession` stream → multi-turn → pool → `CommandClient` jobs |
| [`appkit/`](appkit/) | Pool, `TurnRunner`, classifier, query gate, SSE |
| `connection_example.test.ts` | Raw `Client` connect / bootstrap / retries |
| `job_cron_example.test.ts` | Jobs and cron RPCs |
| `loop_management_example.test.ts` | Loop list / get / tree / prune / delete |
| `commands_example.test.ts` | Slash / structured commands |
| `skills_models_example.test.ts` | Skills and models discovery |
| `daemon_control_example.test.ts` | Daemon status / shutdown / config |
| `input_options_example.test.ts` | `loop_input` options and attachments |
| `auth_example.test.ts` | Auth handshake helpers |
| `verbosity_example.test.ts` | Verbosity filtering |
| `protocol_example.test.ts` | Envelope helpers |
| `errors_example.test.ts` | Typed errors |

For a live daemon, use the package integration suite against
`ws://127.0.0.1:8765` (or `SOOTHE_DAEMON_URL`).

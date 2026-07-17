# Progressive examples

Mirror the Python `examples/01`–`06` ladder. Vitest files below use the in-process
mock WebSocket server (offline).

| Script | What it shows |
|--------|----------------|
| `01_hello` | Connect + bootstrap loop |
| `02_stream_turn` | `DaemonSession` send + iterate chunks |
| `03_text_completion` | `intent_hint=text_completion` |
| `04_multi_turn` | Follow-ups on the same loop |
| `05_pool_service` | `ConnectionPool` stats |
| `06_jobs` | `CommandClient` job create/status/cancel |

```bash
cd client/typescript
npm test -- examples/progressive
```

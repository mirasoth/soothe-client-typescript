# @mirasoth/soothe-client

Talk to a running **soothe-daemon** over WebSocket — send prompts, stream agent
turns, run jobs.

```bash
npm install @mirasoth/soothe-client
# optional: real image downscale for CompactAttachmentsBeforeSend
npm install sharp
```

Requires Node.js `>=19` and a local daemon (default `ws://127.0.0.1:8765`).

## Quick start

```ts
import { DaemonSession } from '@mirasoth/soothe-client';

const session = new DaemonSession('ws://127.0.0.1:8765');
await session.connect();
await session.sendTurn('Summarize this in one sentence: agents need tools.');

for await (const [_namespace, mode, data] of session.iterTurnChunks()) {
  console.log(mode, data);
}

await session.close();
```

More patterns: [`examples/`](examples/) (hello → streaming → multi-turn → pool → jobs).

## What you get

| Need | Use |
|------|-----|
| One conversation, stream replies | `DaemonSession` |
| Jobs / cron one-shots | `CommandClient` |
| Raw WebSocket / custom RPCs | `Client` |
| Many users / HTTP backend | `ConnectionPool` + `TurnRunner` |

`iterTurnChunks` peels leftover prior-goal terminals at turn start, ignores
premature `soothe.stream.end` until the turn has real progress, drains a short
post-idle window, and sends `delivery_ack` on terminal frames for daemon drain
gating.

```ts
import { CommandClient } from '@mirasoth/soothe-client';

const cc = new CommandClient('ws://127.0.0.1:8765', { timeoutMs: 30_000 });
const created = await cc.jobCreate('Echo: smoke job', '/tmp/workspace');
await cc.jobStatus(String(created.job_id));
await cc.jobCancel(String(created.job_id));
```

## Appkit TurnRunner

Product backends that pool connections per chat session use `ConnectionPool` +
`QueryGate` + `TurnRunner` + `EventClassifier`.

| Knob | Default | Notes |
|------|---------|--------|
| `idleTimeout` | off (`0`) | Silence watchdog between events (ms) |
| `minIdleTimeoutWithAttachments` | off | Floor when attachments are present |
| `onIdleTimeout` / `onQueryTimeout` / `onStreamClose` | `Fail` | Or `SoftComplete` |
| `compactAttachmentsBeforeSend` | `false` | Needs optional `sharp` for real downscale |
| `treatStatusIdleAsComplete` (classifier) | `false` | Opt-in idle deliverable |

## Configuration

`defaultConfig()` / `loadConfigFromEnv()`:

| Variable | Default | Description |
|----------|---------|-------------|
| `SOOTHE_DAEMON_URL` | `ws://localhost:8765` | Daemon WebSocket URL |
| `SOOTHE_VERBOSITY` | `normal` | quiet / minimal / normal / detailed / debug |
| `SOOTHE_MAX_RETRIES` | `5` | Reconnect attempts |
| `SOOTHE_DAEMON_READY_TIMEOUT_SEC` | `20` | Handshake timeout |
| `SOOTHE_LOOP_STATUS_TIMEOUT_SEC` | `60` | Loop status wait |
| `SOOTHE_SUBSCRIPTION_TIMEOUT_SEC` | `10` | Subscription confirmation |

## API surface

- **`DaemonSession`** — dual-socket loop session + `iterTurnChunks` (preferred for chat)
- **`CommandClient`** — ephemeral connect → one RPC → close (jobs / cron)
- **`Client`** — long-lived WebSocket, RPC, reconnect/reattach, peel-stale helpers
- **`ConnectionPool` / `TurnRunner` / `QueryGate` / `EventClassifier` / `SSEBroadcaster`** — multi-user appkit
- **`connectedWebsocket` / `protocol1Rpc`** — oneshot CLI-style helpers
- **`bootstrapLoopSession` / `connectWithRetries`** — session helpers

See `dist/index.d.ts` or `src/index.ts` for the full export list.

## Limitations

Autopilot control is WebSocket-only (protocol-1 `autopilot_*` / `job_*`
request RPCs). Prefer `CommandClient` for job/cron/autopilot one-shots so they
do not share a streaming socket. Worker event streams use
`client.autopilotSubscribe()` on a long-lived `Client`.

## Develop

```bash
make help        # list targets
make install     # install dependencies
make build       # compile to dist/
make test        # unit tests
make verify      # full pre-publish verification
npm test -- examples/progressive   # 01–06 ladder (offline)
```

## Compatibility

Same protocol-1 WebSocket contract as `soothe-client-python` and
`soothe-client-go`.

## License

MIT — see [LICENSE](./LICENSE).

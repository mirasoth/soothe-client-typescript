# @mirasoth/soothe-client

TypeScript WebSocket client for the [Soothe](https://github.com/mirasoth/soothe) daemon.

Provides a typed protocol-1 message stack, session bootstrap, reconnect/reattach,
appkit (connection pool, turn runner, event classifier), and a dual-socket
`DaemonSession` for streamed turns — matching the production Go and Python clients.

## Install

```bash
npm install @mirasoth/soothe-client
# optional: real image downscale for CompactAttachmentsBeforeSend
npm install sharp
```

Requires Node.js `>=19`.

## Quick start

```ts
import { DaemonSession } from '@mirasoth/soothe-client';

const session = new DaemonSession('ws://127.0.0.1:8765');
await session.connect();
await session.sendTurn('summarize this repo');

for await (const [namespace, mode, data] of session.iterTurnChunks()) {
  console.log(mode, data);
}

await session.close();
```

## What you get

| Need | Use |
|------|-----|
| One conversation, stream replies | `DaemonSession` |
| Jobs / cron one-shots | `CommandClient` |
| Raw WebSocket / custom RPCs | `Client` |
| Many users / HTTP backend | `ConnectionPool` + `TurnRunner` |

`iterTurnChunks` peels leftover prior-goal terminals at turn start, ignores
premature `soothe.stream.end` until the turn has real progress, and drains a
short post-idle window before returning. Terminal stream frames send
`delivery_ack` (daemon drain gating).

## Appkit TurnRunner

Product backends that pool connections per chat session use `ConnectionPool` +
`QueryGate` + `TurnRunner` + `EventClassifier` (RFC-629 Layer 1).

Lifecycle knobs (all opt-in; defaults match historical fail-on-timeout behaviour):

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

- **`Client`** — WebSocket session, RPC, reconnect/reattach, peel stale pending frames
- **`DaemonSession`** — dual-socket loop session + `iterTurnChunks`
- **`TurnRunner` / `ConnectionPool` / `QueryGate` / `EventClassifier` / `SSEBroadcaster`** — appkit
- **`connectedWebsocket` / `protocol1Rpc`** — oneshot CLI-style helpers
- **`bootstrapLoopSession`**, **`connectWithRetries`** — session helpers

See `dist/index.d.ts` or `src/index.ts` for the full export list.

## Development

```bash
make help        # list targets
make install     # install dependencies
make build       # compile to dist/
make test        # unit tests
make verify      # full pre-publish verification
```

## License

MIT — see [LICENSE](./LICENSE).

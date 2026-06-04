# @mirasoth/soothe-client

TypeScript WebSocket client for the [Soothe](https://github.com/mirasoth/soothe) daemon.

Provides a typed message protocol, session bootstrap, event helpers, and convenience RPCs for
interacting with a running `soothe-daemon` from Node.js.

## Install

```bash
npm install @mirasoth/soothe-client
# or
pnpm add @mirasoth/soothe-client
# or
yarn add @mirasoth/soothe-client
```

Requires Node.js `>=19`.

## Quick start

```ts
import { Client, bootstrapLoopSession, defaultConfig } from '@mirasoth/soothe-client';

const config = defaultConfig();
const client = new Client(config.daemonURL, config);

await client.connect();
const loopId = await bootstrapLoopSession(client, null, config);

client.on('message', (msg) => {
  console.log('event:', msg);
});

await client.sendMessage({
  type: 'loop_input',
  loop_id: loopId,
  input: 'hello soothe',
});
```

## Configuration

`defaultConfig()` returns a `Config` object with sensible defaults. `loadConfigFromEnv()` reads
overrides from these environment variables:

| Variable                              | Default                  | Description                              |
| ------------------------------------- | ------------------------ | ---------------------------------------- |
| `SOOTHE_DAEMON_URL`                   | `ws://localhost:8765`    | Daemon WebSocket URL                     |
| `SOOTHE_VERBOSITY`                    | `normal`                 | `quiet` \| `minimal` \| `normal` \| `detailed` \| `debug` |
| `SOOTHE_MAX_RETRIES`                  | `5`                      | Reconnect attempts                       |
| `SOOTHE_DAEMON_READY_TIMEOUT_SEC`     | `20`                     | Daemon-ready handshake timeout (seconds) |
| `SOOTHE_LOOP_STATUS_TIMEOUT_SEC`      | `60`                     | Loop status wait timeout (seconds)       |
| `SOOTHE_SUBSCRIPTION_TIMEOUT_SEC`     | `10`                     | Subscription confirmation timeout (seconds) |

## API surface

- **`Client`** — WebSocket session, message I/O, request/response, RPC helpers
- **`bootstrapLoopSession`**, **`waitDaemonReady`**, **`connectWithRetries`** — session helpers
- **`checkDaemonStatus`**, **`fetchSkillsCatalog`**, **`fetchConfigSection`** — daemon RPCs
- **`encodeMessage` / `decodeMessage`** — protocol codec
- **`Event*` classes** — typed event payloads (plan, explore, tacitus, tool, agent-loop)
- **`VerbosityTier`**, **`classifyEventVerbosity`** — verbosity filtering
- **Errors** — `ConnectionError`, `DaemonError`, `TimeoutError`

See `dist/index.d.ts` (published) or `src/index.ts` (source) for the full export list.

## Development

```bash
make help        # list all targets
make install     # install dependencies
make build       # compile to dist/
make test        # run unit tests
make verify      # full pre-publish verification
make publish     # publish to npm (after verify)
```

See [`Makefile`](./Makefile) for the complete list of targets.

## License

MIT — see [LICENSE](./LICENSE).

# Changelog

All notable changes to `@mirasoth/soothe-client` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-07-17

### Added
- `CommandClient` for ephemeral jobs/cron one-shot RPCs
- Stream `delivery_ack` on terminal frames for daemon drain gating
- Priority-aware inbound backpressure with `inboundDropped` / `setStreamDegradedCallback`
- Public-API contract tests; progressive examples `01`–`06`

### Changed
- Slimmed root and appkit exports toward the four entry-point tiers (`DaemonSession`, `CommandClient`, `Client`, pool/TurnRunner)
- Connection pool enforces `maxIdleTime` on acquire
- Handshake `CLIENT_VERSION` aligned with package version (`0.4.0`)
- README leads with `DaemonSession` and the API tier table

## [0.3.0] - 2026-07-16

### Added
- TurnRunner lifecycle knobs: idle timeout, attachment idle floor, soft-complete policies for idle / query timeout / stream-close
- `ErrIdleTimeout`, `TimeoutPolicy`, `idleTimeoutForTurn`, attachment compaction helpers (`compactImageAttachment` / `compactAttachments`; optional `sharp`)
- `EventClassifier.treatStatusIdleAsComplete` (opt-in status=idle deliverable)
- `DaemonSession` dual-socket session with `iterTurnChunks`, post-idle drain, reconnect/reattach
- `stream_terminal` helpers: turn-end detection, stale-frame peel labels, turn-progress gating
- `Client.peelStalePendingControlEvents` and `isConnectionAlive`
- Oneshoot helpers `connectedWebsocket` / `protocol1Rpc`; `fetchLoopCards` / `fetchLoopMessages`
- Appkit `unwrapNext`, `shouldDropStreamChunkEarly`, `TurnEventStats`

### Changed
- Package version bumped to `0.3.0` for the production-facing appkit surface
- README documents appkit, DaemonSession, and optional `sharp`

## [0.2.1] - 2026-07-15

### Added
- RFC-629 Layer 0 Client upgrades and Layer 1 appkit (pool, gate, TurnRunner, classifier, SSE)

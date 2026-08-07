# Changelog

All notable changes to `@mirasoth/soothe-client` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.8] - 2026-08-07

### Changed
- Fix version bump for dependency sync

## [0.5.7] - 2026-08-05

### Added
- `autopilotTop` accepts `includeTerminal` (active-only forest by default)
- Prior unreleased: `autopilot_top` client method

## [0.5.6] - 2026-07-31

### Changed
- Display card wire types renamed to `soothe.card.*` (`created` / `updated` / `finalized` / `replay.begin` / `replay.end`)

### Added
- `CardProjection` / `parseCardCustomPayload` for applying live card frames
- `EventCardUpdated` / `EventCardFinalized`; card frames count as turn progress

## [0.5.3] - 2026-07-19

### Added
- Example `TurnBoundary` + expanded unit tests (stream.end gates, stopped, empty-content fail)

### Changed
- Handshake `CLIENT_VERSION` reports `0.5.3`

## [0.5.2] - 2026-07-19

### Changed
- `TurnRunner` always ends turns via `TurnBoundary` (DaemonSession contract; Go v0.4.4 parity)
- Handshake `CLIENT_VERSION` reports `0.5.2`

### Added
- `TurnBoundary`, `TurnLifecycleGate`, `isDaemonTurnEndEvent`

## [0.5.1] - 2026-07-19

### Removed
- Legacy `intent_hint` values `direct_llm`, `quiz`, and `direct_model` (rejected before send)
- Legacy loop phase `direct_model` from deliverable / loop-assistant phase sets
- Unphased `mode=messages` AI text no longer auto-completes a turn

### Changed
- Handshake `CLIENT_VERSION` aligned with package version (`0.5.1`)

## [0.5.0] - 2026-07-18

### Changed
- Align subagent wire event constants with daemon names: `EventExplorer*` (`soothe.subagent.explorer.*`) and `EventDeepResearch*` (`soothe.subagent.deep_research.*`)
- Handshake `CLIENT_VERSION` aligned with package version (`0.5.0`)
- Examples use `preferred_subagent` values `explorer` / `deep_research`

### Removed
- Legacy `EventExplore*` / `EventTacitus*` constants and `soothe.subagent.explore.*` / `soothe.subagent.tacitus.*` namespaces

## [0.4.1] - 2026-07-17

### Added
- Full protocol-1 `autopilot_*` WebSocket RPCs on `Client` and `CommandClient` (status, submit, goals, wake/dream/resume, list/get jobs)

### Changed
- Handshake `CLIENT_VERSION` aligned with package version (`0.4.1`)
- README documents WebSocket-only autopilot control (no HTTP REST)

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
- Oneshoot helpers `connectedWebsocket` / `protocol1Rpc`; `fetchLoopMessages`
- Appkit `unwrapNext`, `shouldDropStreamChunkEarly`, `TurnEventStats`

### Changed
- Package version bumped to `0.3.0` for the production-facing appkit surface
- README documents appkit, DaemonSession, and optional `sharp`

## [0.2.1] - 2026-07-15

### Added
- Client reconnect/reattach upgrades and appkit (pool, gate, TurnRunner, classifier, SSE)

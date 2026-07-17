/**
 * Public export surface contract (Python soothe_client.test_public_api parity).
 */
import { describe, it, expect } from "vitest";
import * as root from "../src/index.js";

describe("public API surface", () => {
  it("includes core happy-path exports", () => {
    for (const name of [
      "Client",
      "CommandClient",
      "DaemonSession",
      "ConnectionPool",
      "TurnRunner",
      "QueryGate",
      "DaemonError",
      "isDaemonLive",
      "INTENT_HINT_TEXT_COMPLETION",
      "inboundNeedsDeliveryAck",
    ] as const) {
      expect(root[name], name).toBeDefined();
    }
  });

  it("excludes demoted internals from root", () => {
    for (const name of [
      "Multiplexer",
      "ManagedClient",
      "unwrapNext",
      "shouldDropStreamChunkEarly",
      "stalePendingFrameLabel",
      "defaultClientFactory",
      "defaultBootstrapFunc",
    ] as const) {
      expect(Object.prototype.hasOwnProperty.call(root, name), name).toBe(false);
    }
  });
});

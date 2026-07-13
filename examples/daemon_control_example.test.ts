/**
 * Daemon control examples: checkDaemonStatus, isDaemonLive, waitForDaemonReady,
 * daemon shutdown, config reload, and MCP status.
 *
 * Mirrors the Go client's `daemon_control_example_test.go`.
 */

import { describe, it, expect } from "vitest";
import {
  Client,
  checkDaemonStatus,
  isDaemonLive,
  requestDaemonShutdown,
  requestDaemonConfigReload,
  waitDaemonReady,
} from "../src/index.js";
import { createMockDaemon } from "./helpers/mock-server.js";

describe("Example: daemon status", () => {
  it("checkDaemonStatus: blocking status RPC via helper", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      const status = await checkDaemonStatus(client, 5_000);
      console.log("Daemon status:", status);

      client.close();
      expect(status).toMatchObject({ running: true, port_live: true, active_loops: 2 });
    } finally {
      await md.close();
    }
  });

  it("isDaemonLive: composite health check (connect + status RPC)", async () => {
    const md = createMockDaemon();
    try {
      // This helper creates its own client, connects, checks status, and closes.
      const live = await isDaemonLive(md.url, 5_000);
      if (live) {
        console.log("Daemon is live");
      } else {
        console.log("Daemon is not reachable");
      }

      expect(live).toBe(true);
    } finally {
      await md.close();
    }
  });

  it("isDaemonLive: returns false for unreachable daemon", async () => {
    // Point at a port that definitely has no listener.
    const live = await isDaemonLive("ws://localhost:59999", 1_000);
    console.log("Daemon live (unreachable):", live);
    expect(live).toBe(false);
  });

  it("sendDaemonStatus: fire-and-forget status request", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      await client.sendDaemonStatus();
      console.log("Status request sent");

      client.close();
      expect(true).toBe(true);
    } finally {
      await md.close();
    }
  });
});

describe("Example: daemon readiness", () => {
  it("waitDaemonReady: resolves immediately after handshake", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      // WaitForDaemonReady returns immediately if handshake completed during connect.
      await waitDaemonReady(client, 10_000);
      console.log("Daemon ready");

      client.close();
      expect(client.isConnected()).toBe(false);
    } finally {
      await md.close();
    }
  });
});

describe("Example: daemon shutdown", () => {
  it("requestDaemonShutdown: graceful shutdown via RPC", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      // RequestDaemonShutdown sends daemon_shutdown and verifies "acknowledged".
      await requestDaemonShutdown(client, 10_000);
      console.log("Daemon shutdown acknowledged");

      client.close();
      expect(true).toBe(true);
    } finally {
      await md.close();
    }
  });

  it("sendDaemonShutdown: fire-and-forget shutdown request", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      await client.sendDaemonShutdown();
      console.log("Shutdown request sent");

      client.close();
      expect(true).toBe(true);
    } finally {
      await md.close();
    }
  });
});

describe("Example: config reload", () => {
  it("requestDaemonConfigReload: blocking config reload RPC", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      const result = await requestDaemonConfigReload(client, 15_000);
      console.log("Config reload:", result);

      client.close();
      expect(result).toMatchObject({ success: true, reloaded: true });
    } finally {
      await md.close();
    }
  });

  it("reloadConfig: client.reloadConfig blocking", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      const result = await client.reloadConfig(15_000);
      console.log("Reload config:", result);

      client.close();
      expect(result).toMatchObject({ success: true });
    } finally {
      await md.close();
    }
  });

  it("sendConfigReload: fire-and-forget reload request", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      await client.sendConfigReload();
      console.log("Config reload request sent");

      client.close();
      expect(true).toBe(true);
    } finally {
      await md.close();
    }
  });
});

describe("Example: MCP status", () => {
  it("getMCPStatus: blocking MCP server status request", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      const status = await client.getMCPStatus(15_000);
      console.log("MCP status:", status);

      client.close();
      const servers = status.servers as Array<Record<string, unknown>>;
      expect(servers).toBeInstanceOf(Array);
      expect(servers[0]).toMatchObject({ name: "filesystem", status: "connected" });
    } finally {
      await md.close();
    }
  });

  it("sendMCPStatus: fire-and-forget MCP status request", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      await client.sendMCPStatus();
      console.log("MCP status request sent");

      client.close();
      expect(true).toBe(true);
    } finally {
      await md.close();
    }
  });
});

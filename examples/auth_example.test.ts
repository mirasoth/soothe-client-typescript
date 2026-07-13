/**
 * Authentication examples: authenticate (access_key/secret_key),
 * refreshAuthToken (refresh_token), and low-level sendAuth/sendAuthRefresh.
 *
 * Mirrors the Go client's `auth_example_test.go`.
 */

import { describe, it, expect } from "vitest";
import { Client, authenticate, refreshAuthToken } from "../src/index.js";
import { createMockDaemon } from "./helpers/mock-server.js";

describe("Example: authentication (blocking RPC)", () => {
  it("authenticate: submits credentials via blocking helper", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      // authenticate sends auth request with credentials and blocks for response.
      const resp = await authenticate(client, "my-access-key", "my-secret-key", 15_000);
      console.log("Auth response:", resp);

      client.close();
      expect(resp).toMatchObject({
        success: true,
        access_token: "mock-access-token",
        refresh_token: "mock-refresh-token",
        expires_in: 3600,
      });
    } finally {
      await md.close();
    }
  });

  it("authenticate (method): client.authenticate blocking", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      const resp = await client.authenticate("my-access-key", "my-secret-key", 15_000);
      console.log("Auth response (method):", resp);

      client.close();
      expect(resp).toMatchObject({ success: true, access_token: "mock-access-token" });
    } finally {
      await md.close();
    }
  });

  it("refreshAuthToken: submits refresh_token for a new access token", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      // refreshAuthToken obtains a new token without re-sending credentials.
      const resp = await refreshAuthToken(client, "my-refresh-token", 15_000);
      console.log("Auth refresh response:", resp);

      client.close();
      expect(resp).toMatchObject({
        success: true,
        access_token: "mock-access-token-2",
        refresh_token: "mock-refresh-token-2",
        expires_in: 3600,
      });
    } finally {
      await md.close();
    }
  });

  it("refreshAuthToken (method): client.refreshAuthToken blocking", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      const resp = await client.refreshAuthToken("my-refresh-token", 15_000);
      console.log("Auth refresh (method):", resp);

      client.close();
      expect(resp).toMatchObject({ access_token: "mock-access-token-2" });
    } finally {
      await md.close();
    }
  });
});

describe("Example: authentication (fire-and-forget send)", () => {
  it("sendAuth: low-level fire-and-forget auth request", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      // Fire-and-forget: send auth request with credentials (response via event reader).
      await client.sendAuth("my-access-key", "my-secret-key");
      console.log("SendAuth: sent");

      client.close();
      expect(true).toBe(true);
    } finally {
      await md.close();
    }
  });

  it("sendAuthRefresh: low-level fire-and-forget token refresh", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      await client.sendAuthRefresh("my-refresh-token");
      console.log("SendAuthRefresh: sent");

      client.close();
      expect(true).toBe(true);
    } finally {
      await md.close();
    }
  });
});

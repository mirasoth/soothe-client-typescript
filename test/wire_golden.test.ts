/**
 * Golden wire contract test.
 *
 * Pins the host-generated wire_golden.json fixture (sha256) and asserts the
 * client decoder round-trips every case. Message/card payloads are treated
 * opaquely: decode-shape (envelope-level) assertions suffice.
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodeMessage, encodeMessage, splitWirePayload } from "../src/protocol.js";

const FIXTURE_SHA256 = "ba5a5a408fc2c259b768eae2915289de1820a931da37aad30fdd410d52b16627";

const fixturePath = fileURLToPath(new URL("../tests/fixtures/wire_golden.json", import.meta.url));
const fixtureRaw = readFileSync(fixturePath, "utf-8");
const fixture = JSON.parse(fixtureRaw) as {
  schema: string;
  cases: Record<string, unknown>;
  response_wire_text: string;
};

/** Envelope cases: legacy flat shapes decoded at the envelope level. */
const ENVELOPE_CASES = new Set(["connection_init", "error", "response"]);

describe("wire_golden contract", () => {
  it("fixture sha256 matches the pinned host digest", () => {
    const digest = createHash("sha256").update(fixtureRaw).digest("hex");
    expect(digest).toBe(FIXTURE_SHA256);
  });

  it("fixture declares the golden schema", () => {
    expect(fixture.schema).toBe("soothe.wire.golden/1");
  });

  it.each(Object.keys(fixture.cases))("case %s: encode → split → decode round-trip", name => {
    const value = fixture.cases[name];
    const frames = splitWirePayload(encodeMessage(value));
    expect(frames).toHaveLength(1);

    const decoded = decodeMessage(frames[0]);
    expect(decoded).not.toBeNull();
    expect(decoded).toEqual(value);
  });

  it("envelope cases decode with type and id intact", () => {
    for (const [name, value] of Object.entries(fixture.cases)) {
      if (!ENVELOPE_CASES.has(name)) continue;
      const env = value as { type: string; id: string };
      const decoded = decodeMessage(encodeMessage(value).trim()) as Record<string, unknown>;
      expect(decoded.type).toBe(env.type);
      expect(decoded.id).toBe(env.id);
    }
  });

  it("response_wire_text decodes as a response envelope", () => {
    const frames = splitWirePayload(fixture.response_wire_text);
    expect(frames).toHaveLength(1);
    const decoded = decodeMessage(frames[0]) as Record<string, unknown>;
    expect(decoded.type).toBe("response");
    expect(decoded.id).toBe("golden-resp");
  });
});

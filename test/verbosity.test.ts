import { describe, it, expect } from "vitest";
import {
  shouldShow,
  isValidVerbosityLevel,
  VerbosityTier,
} from "../src/verbosity.js";
import type { VerbosityLevel } from "../src/verbosity.js";

describe("isValidVerbosityLevel", () => {
  it("accepts valid levels", () => {
    const levels: VerbosityLevel[] = ["quiet", "normal", "debug"];
    for (const lvl of levels) {
      expect(isValidVerbosityLevel(lvl)).toBe(true);
    }
  });

  it("rejects invalid levels", () => {
    expect(isValidVerbosityLevel("verbose")).toBe(false);
    expect(isValidVerbosityLevel("")).toBe(false);
    expect(isValidVerbosityLevel("minimal")).toBe(false);
    expect(isValidVerbosityLevel("detailed")).toBe(false);
  });
});

describe("shouldShow", () => {
  it("TierQuiet is visible at all levels", () => {
    const levels: VerbosityLevel[] = ["quiet", "normal", "debug"];
    for (const lvl of levels) {
      expect(shouldShow(VerbosityTier.Quiet, lvl)).toBe(true);
    }
  });

  it("TierNormal visibility", () => {
    expect(shouldShow(VerbosityTier.Normal, "quiet")).toBe(false);
    expect(shouldShow(VerbosityTier.Normal, "normal")).toBe(true);
    expect(shouldShow(VerbosityTier.Normal, "debug")).toBe(true);
  });

  it("TierDetailed visibility", () => {
    expect(shouldShow(VerbosityTier.Detailed, "quiet")).toBe(false);
    expect(shouldShow(VerbosityTier.Detailed, "normal")).toBe(false);
    expect(shouldShow(VerbosityTier.Detailed, "debug")).toBe(true);
  });

  it("TierDebug visibility", () => {
    expect(shouldShow(VerbosityTier.Debug, "quiet")).toBe(false);
    expect(shouldShow(VerbosityTier.Debug, "normal")).toBe(false);
    expect(shouldShow(VerbosityTier.Debug, "debug")).toBe(true);
  });

  it("TierInternal is never shown", () => {
    const levels: VerbosityLevel[] = ["quiet", "normal", "debug"];
    for (const lvl of levels) {
      expect(shouldShow(VerbosityTier.Internal, lvl)).toBe(false);
    }
  });

  it("invalid verbosity defaults to normal", () => {
    expect(shouldShow(VerbosityTier.Quiet, "invalid" as VerbosityLevel)).toBe(
      true,
    );
    expect(
      shouldShow(VerbosityTier.Detailed, "invalid" as VerbosityLevel),
    ).toBe(false);
  });
});

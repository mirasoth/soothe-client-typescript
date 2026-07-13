/**
 * Verbosity examples: shouldShow (content visibility filtering),
 * isValidVerbosityLevel (string validation), and tier/level constants.
 *
 * Mirrors the Go client's `verbosity_example_test.go`.
 */

import { describe, it, expect } from "vitest";
import { VerbosityTier, shouldShow, isValidVerbosityLevel } from "../src/index.js";
import type { VerbosityLevel } from "../src/index.js";

describe("Example: shouldShow", () => {
  it("shouldShow: at quiet verbosity, only TierQuiet is visible", () => {
    console.log(shouldShow(VerbosityTier.Quiet, "quiet")); // true
    console.log(shouldShow(VerbosityTier.Normal, "quiet")); // false
    console.log(shouldShow(VerbosityTier.Detailed, "quiet")); // false

    expect(shouldShow(VerbosityTier.Quiet, "quiet")).toBe(true);
    expect(shouldShow(VerbosityTier.Normal, "quiet")).toBe(false);
    expect(shouldShow(VerbosityTier.Detailed, "quiet")).toBe(false);
  });

  it("shouldShow: at normal verbosity, quiet + normal tiers are visible", () => {
    console.log(shouldShow(VerbosityTier.Quiet, "normal")); // true
    console.log(shouldShow(VerbosityTier.Normal, "normal")); // true
    console.log(shouldShow(VerbosityTier.Detailed, "normal")); // false

    expect(shouldShow(VerbosityTier.Quiet, "normal")).toBe(true);
    expect(shouldShow(VerbosityTier.Normal, "normal")).toBe(true);
    expect(shouldShow(VerbosityTier.Detailed, "normal")).toBe(false);
  });

  it("shouldShow: at debug verbosity, everything except Internal is visible", () => {
    console.log(shouldShow(VerbosityTier.Debug, "debug")); // true
    console.log(shouldShow(VerbosityTier.Internal, "debug")); // false

    expect(shouldShow(VerbosityTier.Debug, "debug")).toBe(true);
    expect(shouldShow(VerbosityTier.Internal, "debug")).toBe(false);
  });

  it("shouldShow: TierInternal is never visible", () => {
    expect(shouldShow(VerbosityTier.Internal, "quiet")).toBe(false);
    expect(shouldShow(VerbosityTier.Internal, "normal")).toBe(false);
    expect(shouldShow(VerbosityTier.Internal, "debug")).toBe(false);
  });
});

describe("Example: isValidVerbosityLevel", () => {
  it("isValidVerbosityLevel: recognizes quiet, normal, debug", () => {
    console.log(isValidVerbosityLevel("quiet")); // true
    console.log(isValidVerbosityLevel("normal")); // true
    console.log(isValidVerbosityLevel("debug")); // true

    expect(isValidVerbosityLevel("quiet")).toBe(true);
    expect(isValidVerbosityLevel("normal")).toBe(true);
    expect(isValidVerbosityLevel("debug")).toBe(true);
  });

  it("isValidVerbosityLevel: rejects unknown values", () => {
    console.log(isValidVerbosityLevel("trace")); // false
    console.log(isValidVerbosityLevel("")); // false

    expect(isValidVerbosityLevel("trace")).toBe(false);
    expect(isValidVerbosityLevel("")).toBe(false);
    expect(isValidVerbosityLevel("verbose")).toBe(false);
  });

  it("isValidVerbosityLevel: type narrows to VerbosityLevel", () => {
    const s = "normal";
    if (isValidVerbosityLevel(s)) {
      // In this branch, s is narrowed to VerbosityLevel.
      const level: VerbosityLevel = s;
      console.log("Valid level:", level);
      expect(level).toBe("normal");
    } else {
      throw new Error("should be valid");
    }
  });
});

describe("Example: verbosity tier constants", () => {
  it("verbosityLevels: typed level and tier constants", () => {
    // VerbosityLevel is a string type.
    const level: VerbosityLevel = "debug";
    console.log(level); // debug

    // VerbosityTier is an enum.
    console.log("Quiet:", VerbosityTier.Quiet); // 0
    console.log("Normal:", VerbosityTier.Normal); // 1
    console.log("Detailed:", VerbosityTier.Detailed); // 2
    console.log("Debug:", VerbosityTier.Debug); // 3
    console.log("Internal:", VerbosityTier.Internal); // 99

    expect(VerbosityTier.Quiet).toBe(0);
    expect(VerbosityTier.Normal).toBe(1);
    expect(VerbosityTier.Detailed).toBe(2);
    expect(VerbosityTier.Debug).toBe(3);
    expect(VerbosityTier.Internal).toBe(99);
  });
});

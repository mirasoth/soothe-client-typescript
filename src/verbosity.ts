/**
 * Verbosity levels and tiers for event filtering.
 */

/** User-configurable verbosity setting. */
export type VerbosityLevel = "quiet" | "normal" | "debug";

/** Minimum verbosity level at which content is visible. */
export enum VerbosityTier {
  /** Always visible (errors, assistant text, final reports) */
  Quiet = 0,
  /** Standard progress (plan updates, milestones, agentic loop) */
  Normal = 1,
  /** Detailed internals (protocol events, tool calls, subagent activity) */
  Detailed = 2,
  /** Everything including internals (thinking, heartbeats) */
  Debug = 3,
  /** Never shown at any level (implementation details) */
  Internal = 99,
}

const verbosityLevelValues: Record<VerbosityLevel, number> = {
  quiet: 0,
  normal: 1,
  debug: 3,
};

/** Returns true if content at the given tier is visible at the given verbosity. */
export function shouldShow(tier: VerbosityTier, verbosity: VerbosityLevel): boolean {
  if (tier === VerbosityTier.Internal) {
    return false;
  }
  const level = verbosityLevelValues[verbosity] ?? 1; // default to normal
  return tier <= level;
}

/** Checks whether a string is a valid verbosity level. */
export function isValidVerbosityLevel(s: string): s is VerbosityLevel {
  return s in verbosityLevelValues;
}

/**
 * Daemon ``loop_input`` intent_hint values (direct model turns, no agent graph).
 */

/** Text-only chat completion via the configured ``default`` role. */
export const INTENT_HINT_TEXT_COMPLETION = "text_completion" as const;

/** Vision / image understanding via the configured ``image`` role (attachments required). */
export const INTENT_HINT_IMAGE_TO_TEXT = "image_to_text" as const;

/** OCR via the configured ``ocr`` role (attachments required). */
export const INTENT_HINT_OCR = "ocr" as const;

/** Embedding via the configured ``embedding`` role (text-only; JSON vector response). */
export const INTENT_HINT_EMBED = "embed" as const;

/** Supported daemon direct-model intent hints. */
export type IntentHint =
  | typeof INTENT_HINT_TEXT_COMPLETION
  | typeof INTENT_HINT_IMAGE_TO_TEXT
  | typeof INTENT_HINT_OCR
  | typeof INTENT_HINT_EMBED;

/** Legacy intent_hint values removed from the daemon wire contract. */
export const REMOVED_INTENT_HINTS = ["direct_llm", "quiz"] as const;

export type RemovedIntentHint = (typeof REMOVED_INTENT_HINTS)[number];

const REMOVED_INTENT_HINT_MESSAGES: Record<RemovedIntentHint, string> = {
  direct_llm:
    "intent_hint direct_llm is removed; use text_completion (text-only) or image_to_text (with attachments)",
  quiz: "intent_hint quiz is removed; omit intent_hint and let intake classify the turn",
};

/**
 * Wire ``loop_input.intent_hint``: direct model hints or agent-path pass-through
 * (e.g. ``resume_clarification``, ``skill:foo``). Legacy ``direct_llm`` and
 * ``quiz`` are rejected before send.
 */
export type LoopInputIntentHint = IntentHint | (string & {});

/** Returns an error message when ``hint`` is a removed legacy value; otherwise null. */
export function validateLoopInputIntentHint(hint: string): string | null {
  const key = hint.trim().toLowerCase();
  if (key === "direct_llm" || key === "quiz") {
    return REMOVED_INTENT_HINT_MESSAGES[key];
  }
  return null;
}

/** Phases emitted on ``mode=messages`` for user-visible loop assistant output. */
export const LOOP_ASSISTANT_OUTPUT_PHASES = [
  "goal_completion",
  "quiz",
  "autonomous_goal",
  "direct_model",
  "text_completion",
  "image_to_text",
  "ocr",
  "embed",
  "plan_direct",
] as const;

export type LoopAssistantOutputPhase = (typeof LOOP_ASSISTANT_OUTPUT_PHASES)[number];

/** Default deliverable phases for triarch-style apps (direct hints + agent outputs). */
export const DEFAULT_DELIVERABLE_PHASES: ReadonlySet<string> = new Set([
  "quiz",
  "goal_completion",
  "direct_model",
  "text_completion",
  "image_to_text",
  "ocr",
  "embed",
]);

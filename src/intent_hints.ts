/**
 * Daemon ``loop_input`` intent_hint values (non-agent turns).
 */

/** Text-only chat completion via the configured ``default`` role. */
export const INTENT_HINT_TEXT_COMPLETION = "text_completion" as const;

/** Vision / image understanding via the configured ``image`` role (attachments required). */
export const INTENT_HINT_IMAGE_TO_TEXT = "image_to_text" as const;

/** OCR via the configured ``ocr`` role (attachments required). */
export const INTENT_HINT_OCR = "ocr" as const;

/** Embedding via the configured ``embedding`` role (text-only; JSON vector response). */
export const INTENT_HINT_EMBED = "embed" as const;

/** Supported daemon intent_hint values for non-agent turns. */
export type IntentHint =
  | typeof INTENT_HINT_TEXT_COMPLETION
  | typeof INTENT_HINT_IMAGE_TO_TEXT
  | typeof INTENT_HINT_OCR
  | typeof INTENT_HINT_EMBED;

/**
 * Wire ``loop_input.intent_hint``: intent-hint values or agent-path pass-through
 * (e.g. ``resume_clarification``, ``skill:foo``).
 */
export type LoopInputIntentHint = IntentHint | (string & {});

/** Phases emitted on ``mode=messages`` for user-visible loop assistant output. */
export const LOOP_ASSISTANT_OUTPUT_PHASES = [
  "goal_completion",
  "quiz",
  "autonomous_goal",
  "chitchat",
  "text_completion",
  "image_to_text",
  "ocr",
  "embed",
  "plan_direct",
] as const;

export type LoopAssistantOutputPhase = (typeof LOOP_ASSISTANT_OUTPUT_PHASES)[number];

/** Default deliverable phases for triarch-style apps (intent hints + agent outputs). */
export const DEFAULT_DELIVERABLE_PHASES: ReadonlySet<string> = new Set([
  "quiz",
  "goal_completion",
  "chitchat",
  "text_completion",
  "image_to_text",
  "ocr",
  "embed",
]);

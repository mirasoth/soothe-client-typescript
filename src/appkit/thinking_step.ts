/**
 * Thinking-step extraction for appkit.
 *
 * Maps an allowlisted progress event to one structured UI line. Free-form
 * streams (tokens, reports, reasoning) are excluded. The allowlist is
 * configurable.
 */

const MAX_THINKING_STEP_RUNES = 280;

/** Default thinking-step event allowlist. */
export const DEFAULT_THINKING_STEP_EVENTS: ReadonlySet<string> = new Set([
  "soothe.cognition.strange_loop.step.started",
  "soothe.cognition.strange_loop.step.completed",
  "soothe.cognition.plan.created",
  "soothe.cognition.goal.created",
  "soothe.tool.invocation.started",
  "soothe.tool.invocation.completed",
]);

/**
 * Maps an allowlisted progress event to one structured UI line. Returns
 * [line, true] for a recognized event; ["", false] otherwise. `allow` may be
 * omitted to use the default allowlist.
 */
export function extractThinkingStep(
  eventType: string,
  data: Record<string, unknown> | null,
  allow?: ReadonlySet<string>,
): [string, boolean] {
  if (!eventType || !data) return ["", false];
  const et = eventType.trim();
  if (!et) return ["", false];

  const allowlist = allow ?? DEFAULT_THINKING_STEP_EVENTS;
  if (!allowlist.has(et)) return ["", false];

  let line = "";
  switch (et) {
    case "soothe.cognition.strange_loop.step.started":
      line = formatStepLine(data, strField(data, "description"));
      break;
    case "soothe.cognition.strange_loop.step.completed":
      line = formatStepLine(data, strField(data, "summary"));
      break;
    case "soothe.cognition.plan.created": {
      const g = strField(data, "goal");
      if (g) line = "Goal: " + g;
      break;
    }
    case "soothe.cognition.goal.created": {
      const g = strField(data, "friendly_message", "description");
      if (g) line = "Goal: " + g;
      break;
    }
    case "soothe.tool.invocation.started":
    case "soothe.tool.invocation.completed": {
      const name = strField(data, "tool_name", "name");
      if (name) line = "Tool: " + name;
      break;
    }
    default:
      return ["", false];
  }

  line = line.trim();
  if (!line) return ["", false];
  const runes = [...line];
  if (runes.length > MAX_THINKING_STEP_RUNES) {
    line = runes.slice(0, MAX_THINKING_STEP_RUNES).join("") + "…";
  }
  return [line, true];
}

function formatStepLine(data: Record<string, unknown>, desc: string): string {
  const stepID = strField(data, "step_id");
  if (stepID && desc) return `Step ${stepID}: ${desc}`;
  if (stepID) return `Step ${stepID}`;
  if (desc) return "Step: " + desc;
  return "";
}

/** Returns the first non-empty trimmed string field among `keys`. */
function strField(data: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = data[key];
    if (typeof v === "string") {
      const s = v.trim();
      if (s) return s;
    }
  }
  return "";
}

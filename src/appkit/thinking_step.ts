/**
 * Thinking-step extraction for appkit (RFC-629 Layer 1).
 *
 * Maps an allowlisted progress event to one structured UI line. Free-form
 * streams (tokens, reports, reasoning) are excluded. Ported from the Go
 * appkit's thinking_step with the allowlist made configurable.
 */

const MAX_THINKING_STEP_RUNES = 280;

/** Default thinking-step event allowlist (triarch's set). */
export const DEFAULT_THINKING_STEP_EVENTS: ReadonlySet<string> = new Set([
  "soothe.cognition.plan.step.started",
  "soothe.cognition.plan.step.completed",
  "soothe.cognition.plan.step.failed",
  "soothe.lifecycle.iteration.started",
  "soothe.agent.loop.step.started",
  "soothe.agent.loop.started",
  "soothe.cognition.plan.batch.started",
  "soothe.cognition.plan.created",
  "soothe.cognition.goal.created",
  "soothe.tool.execution.started",
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
    case "soothe.cognition.plan.step.started":
      line = formatPlanStepLine(data, "");
      break;
    case "soothe.cognition.plan.step.completed":
      line = formatPlanStepLine(data, "done");
      break;
    case "soothe.cognition.plan.step.failed": {
      const stepID = strField(data, "step_id");
      const errMsg = strField(data, "error");
      if (stepID && errMsg) line = `Step ${stepID} failed: ${errMsg}`;
      else if (stepID) line = `Step ${stepID} failed`;
      else if (errMsg) line = `Step failed: ${errMsg}`;
      break;
    }
    case "soothe.agent.loop.step.started":
      line = formatAgentStepLine(data, "");
      break;
    case "soothe.cognition.plan.batch.started": {
      const n = data["parallel_count"];
      if (typeof n === "number" && n > 0) line = `Running ${Math.floor(n)} steps in parallel`;
      break;
    }
    case "soothe.cognition.plan.created":
    case "soothe.agent.loop.started": {
      const g = strField(data, "goal");
      if (g) line = "Goal: " + g;
      break;
    }
    case "soothe.cognition.goal.created": {
      const g = strField(data, "friendly_message", "description");
      if (g) line = "Goal: " + g;
      break;
    }
    case "soothe.lifecycle.iteration.started": {
      const g = strField(data, "goal_description");
      if (g) line = "Iteration: " + g;
      break;
    }
    case "soothe.tool.execution.started": {
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

function formatPlanStepLine(data: Record<string, unknown>, suffix: string): string {
  const stepID = strField(data, "step_id");
  const desc = strField(data, "description");
  if (stepID && suffix) return `Step ${stepID}: ${suffix}`;
  if (stepID && desc) return `Step ${stepID}: ${desc}`;
  if (stepID) return `Step ${stepID}`;
  if (desc && suffix) return `Step: ${suffix}`;
  if (desc) return `Step: ${desc}`;
  if (suffix) return "Step: " + suffix;
  return "";
}

function formatAgentStepLine(data: Record<string, unknown>, suffix: string): string {
  const stepID = strField(data, "step_id");
  const desc = strField(data, "description");
  if (stepID && desc) return `Step ${stepID}: ${desc}`;
  if (desc) return suffix ? `Step: ${suffix}` : `Step: ${desc}`;
  if (stepID) return `Step ${stepID}`;
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

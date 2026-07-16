/**
 * Early filters for daemon stream chunks (wire / dict-shaped payloads).
 */

const MSG_PAIR_LEN = 2;

/** True when an updates chunk carries no LangGraph interrupt. */
export function updatesChunkIsNoop(data: unknown): boolean {
  if (!data || typeof data !== "object") return true;
  return !("__interrupt__" in (data as Record<string, unknown>));
}

function wireBody(msg: Record<string, unknown>): Record<string, unknown> {
  for (const key of ["kwargs", "data"] as const) {
    const nested = msg[key];
    if (nested && typeof nested === "object") return nested as Record<string, unknown>;
  }
  return msg;
}

function dictHasToolInvocation(msg: Record<string, unknown>): boolean {
  const body = wireBody(msg);
  if (body.tool_calls || body.tool_call_chunks) return true;
  for (const key of ["content", "content_blocks"] as const) {
    const raw = body[key];
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (
          item &&
          typeof item === "object" &&
          ["tool_call", "tool_call_chunk", "tool_use"].includes(
            String((item as Record<string, unknown>).type ?? ""),
          )
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

function plainText(msg: Record<string, unknown>): string {
  const body = wireBody(msg);
  const content = body.content ?? msg.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (typeof block === "string") parts.push(block);
      else if (block && typeof block === "object") {
        const text = (block as Record<string, unknown>).text;
        if (typeof text === "string") parts.push(text);
      }
    }
    return parts.join("");
  }
  return "";
}

/** True when a wire messages pair has no tool, text, or loop phase payload. */
export function messageChunkIsNonActionable(data: unknown): boolean {
  if (!Array.isArray(data) || data.length !== MSG_PAIR_LEN) return false;
  const msg = data[0];
  if (msg === null || msg === undefined) return true;
  if (!msg || typeof msg !== "object") return false;
  const m = msg as Record<string, unknown>;
  const body = wireBody(m);
  const raw = String(body.type ?? m.type ?? "");
  if (raw === "tool" || raw === "ToolMessage" || raw.endsWith("ToolMessage")) return false;
  if (dictHasToolInvocation(m)) return false;
  if (body.phase || m.phase) return false;
  return !plainText(m).trim();
}

/** Return true when the chunk can be skipped before the turn pipeline. */
export function shouldDropStreamChunkEarly(
  _namespace: unknown[],
  mode: string,
  data: unknown,
): boolean {
  if (mode === "updates") return updatesChunkIsNoop(data);
  if (mode === "messages") return messageChunkIsNonActionable(data);
  return false;
}

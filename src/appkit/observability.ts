/**
 * Per-turn observability counters for daemon stream consumption.
 */

export class TurnEventStats {
  total = 0;
  messages = 0;
  updates = 0;
  custom = 0;
  skipped = 0;
  filteredEarly = 0;
  toolCalls = 0;
  toolResults = 0;
  textChunks = 0;
  heartbeatsDropped = 0;
  postIdleDrained = 0;
  inboundDropped = 0;
}

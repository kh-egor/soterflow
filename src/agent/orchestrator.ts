/**
 * @module agent/orchestrator
 * Orchestrates syncing across all channels, applies priority heuristics, and returns a sorted inbox.
 */

import { BaseChannel, WorkItem } from "../channels/base";
import { updateSyncState } from "../store/sync";
import { upsert, getAll } from "../store/workitems";

/**
 * Run a full sync across all registered channels, store results, and return sorted items.
 * @param channels - Array of channel instances (already connected)
 * @returns Sorted work items, highest priority first
 */
export async function syncAll(channels: BaseChannel[]): Promise<WorkItem[]> {
  for (const channel of channels) {
    try {
      const items = await channel.sync();
      for (const item of items) {
        applyPriorityHeuristics(item);
        upsert(item);
      }
      updateSyncState(channel.name);
    } catch (err) {
      console.error(`[soterflow] Failed to sync ${channel.name}:`, err);
    }
  }

  return getInbox();
}

/**
 * Get the current inbox: all non-dismissed/done items, sorted by priority then recency.
 */
export function getInbox(): WorkItem[] {
  const items = getAll();
  return items
    .filter((i) => i.status !== "done" && i.status !== "dismissed")
    .toSorted((a, b) => {
      const pd = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (pd !== 0) {
        return pd;
      }
      return b.timestamp.getTime() - a.timestamp.getTime();
    });
}

const PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

/**
 * Apply heuristic rules to auto-assign priority.
 * - PR reviews → high
 * - Mentions → high
 * - DMs → high
 * - Notifications → normal
 */
function applyPriorityHeuristics(item: WorkItem): void {
  if (item.type === "pr") {
    item.priority = "high";
  }
  if (item.type === "mention") {
    item.priority = "high";
  }
  if (item.metadata?.isDM) {
    item.priority = "high";
  }

  // Jira blocker/highest already mapped by connector; leave as-is
  // Escalate if title contains urgent keywords
  const urgentKeywords = /\b(urgent|critical|hotfix|p0|sev[- ]?0|outage|down)\b/i;
  if (urgentKeywords.test(item.title) || urgentKeywords.test(item.body)) {
    item.priority = "urgent";
  }
}

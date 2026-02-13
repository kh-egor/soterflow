/**
 * @module agent/orchestrator
 * Orchestrates syncing across all channels, applies priority heuristics, and returns a sorted inbox.
 */

import { BaseChannel, WorkItem } from "../channels/base.js";
import { GitHubChannel } from "../channels/github.js";
import { JiraChannel } from "../channels/jira.js";
import { SlackChannel } from "../channels/slack.js";
import { env } from "../soterflow-env.js";
import { updateSyncState } from "../store/sync.js";
import { upsert, getAll } from "../store/workitems.js";
import { Director } from "./director.js";

/** Stats from a sync run. */
export interface SyncStats {
  totalItems: number;
  newItems: number;
  duplicatesSkipped: number;
  perSource: Record<string, { total: number; new: number }>;
}

/**
 * Create channel instances based on which env vars are configured.
 * Only instantiates connectors that have the required tokens set.
 */
export function createChannels(): BaseChannel[] {
  const channels: BaseChannel[] = [];

  if (env.GITHUB_TOKEN) {
    channels.push(new GitHubChannel());
  }
  if (env.JIRA_URL && env.JIRA_EMAIL && env.JIRA_TOKEN) {
    channels.push(new JiraChannel());
  }
  if (env.SLACK_TOKEN) {
    channels.push(new SlackChannel());
  }

  return channels;
}

/**
 * Get info about which channels are configured.
 */
export function getConfiguredChannels(): Array<{ name: string; configured: boolean }> {
  return [
    { name: "github", configured: !!env.GITHUB_TOKEN },
    { name: "jira", configured: !!(env.JIRA_URL && env.JIRA_EMAIL && env.JIRA_TOKEN) },
    { name: "slack", configured: !!env.SLACK_TOKEN },
  ];
}

const PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

/**
 * Run a full sync across all registered channels, store results, and return sorted items.
 * @param channels - Array of channel instances (already connected)
 * @returns Object with sorted work items and sync stats
 */
export async function syncAll(
  channels: BaseChannel[],
): Promise<{ items: WorkItem[]; stats: SyncStats }> {
  const stats: SyncStats = {
    totalItems: 0,
    newItems: 0,
    duplicatesSkipped: 0,
    perSource: {},
  };

  // Collect all items first for cross-channel dedup
  const allNewItems: WorkItem[] = [];

  for (const channel of channels) {
    const sourceStat = { total: 0, new: 0 };
    stats.perSource[channel.name] = sourceStat;

    try {
      // 30s timeout per channel to prevent hanging
      const syncWithTimeout = async () => {
        await channel.connect();
        const items = await channel.sync();
        await channel.disconnect();
        return items;
      };
      const items = await Promise.race([
        syncWithTimeout(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`${channel.name} sync timed out after 30s`)), 30000),
        ),
      ]);
      sourceStat.total = items.length;

      for (const item of items) {
        allNewItems.push(item);
      }

      updateSyncState(channel.name);
      try {
        Director.getInstance().log(
          "info",
          `Sync completed: ${items.length} items from ${channel.name}`,
        );
      } catch {}
    } catch (err) {
      console.error(`[soterflow] Failed to sync ${channel.name}:`, err);
      try {
        await channel.disconnect();
      } catch {
        /* ignore */
      }
    }
  }

  // Deduplicate by URL across channels (same URL = same item, keep highest priority)
  const deduped = deduplicateItems(allNewItems);
  stats.duplicatesSkipped = allNewItems.length - deduped.length;
  stats.totalItems = deduped.length;

  // Get existing IDs to count new items
  const existingItems = new Set(getAll().map((i) => i.id));

  for (const item of deduped) {
    applyPriorityHeuristics(item);
    upsert(item);

    if (!existingItems.has(item.id)) {
      stats.newItems++;
      const sourceStat = stats.perSource[item.source];
      if (sourceStat) {
        sourceStat.new++;
      }
    }
  }

  return { items: getInbox(), stats };
}

/**
 * Deduplicate items by URL. When multiple items share the same URL,
 * keep the one with the highest priority (lowest PRIORITY_ORDER value).
 */
export function deduplicateItems(items: WorkItem[]): WorkItem[] {
  const byUrl = new Map<string, WorkItem>();
  const noUrl: WorkItem[] = [];

  for (const item of items) {
    if (!item.url) {
      noUrl.push(item);
      continue;
    }

    const existing = byUrl.get(item.url);
    if (!existing) {
      byUrl.set(item.url, item);
    } else {
      // Keep the one with higher priority
      const existingOrder = PRIORITY_ORDER[existing.priority] ?? 2;
      const newOrder = PRIORITY_ORDER[item.priority] ?? 2;
      if (newOrder < existingOrder) {
        byUrl.set(item.url, item);
      }
    }
  }

  return [...byUrl.values(), ...noUrl];
}

/**
 * Get the current inbox: all non-dismissed/done items, sorted by priority then recency.
 */
export function getInbox(filters?: {
  source?: string;
  type?: string;
  status?: string;
  since?: string;
}): WorkItem[] {
  const items = getAll(filters);
  return items
    .filter((i) => {
      if (filters?.status) {
        return true;
      } // already filtered by DB
      return i.status !== "done" && i.status !== "dismissed";
    })
    .map((item) => {
      // Apply age-based escalation for display (don't persist)
      const escalated = { ...item };
      applyAgeEscalation(escalated);
      return escalated;
    })
    .toSorted((a, b) => {
      const pd = (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2);
      if (pd !== 0) {
        return pd;
      }
      return b.timestamp.getTime() - a.timestamp.getTime();
    });
}

/**
 * Apply heuristic rules to auto-assign priority.
 */
export function applyPriorityHeuristics(item: WorkItem): void {
  if (item.type === "pr") {
    item.priority = "high";
  }
  if (item.type === "mention") {
    item.priority = "high";
  }
  if (item.metadata?.isDM) {
    item.priority = "high";
  }

  const urgentKeywords = /\b(urgent|critical|hotfix|p0|sev[- ]?0|outage|down)\b/i;
  if (urgentKeywords.test(item.title) || urgentKeywords.test(item.body)) {
    item.priority = "urgent";
  }

  // Age-based escalation on ingest too
  applyAgeEscalation(item);
}

/**
 * Escalate priority for items older than 24 hours.
 * normal → high after 24h, high → urgent after 48h
 */
export function applyAgeEscalation(item: WorkItem): void {
  const ageMs = Date.now() - item.timestamp.getTime();
  const ageHours = ageMs / (1000 * 60 * 60);

  if (ageHours > 48 && item.priority === "high") {
    item.priority = "urgent";
  } else if (ageHours > 24 && item.priority === "normal") {
    item.priority = "high";
  }
}

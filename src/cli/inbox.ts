/**
 * @module cli/inbox
 * CLI helpers for displaying the SoterFlow inbox.
 */

import type { WorkItem } from "../channels/base";
import { getInbox } from "../agent/orchestrator";
import { search, updateStatus } from "../store/workitems";

const PRIORITY_ICONS: Record<string, string> = {
  urgent: "🔴",
  high: "🟠",
  normal: "🔵",
  low: "⚪",
};

const SOURCE_ICONS: Record<string, string> = {
  github: "🐙",
  jira: "📋",
  slack: "💬",
  telegram: "✈️",
};

/** Format a single work item as a one-line summary. */
export function formatItem(item: WorkItem): string {
  const p = PRIORITY_ICONS[item.priority] ?? "⚪";
  const s = SOURCE_ICONS[item.source] ?? "📌";
  const age = formatAge(item.timestamp);
  return `${p} ${s} [${item.source}/${item.type}] ${item.title}  (${age}, by ${item.author})`;
}

/** Show the full inbox as a formatted string. */
export function showInbox(): string {
  const items = getInbox();
  if (items.length === 0) {
    return "✅ Inbox zero — nothing to do!";
  }

  const lines = [`📥 SoterFlow Inbox (${items.length} items)\n`];
  let lastPriority = "";

  for (const item of items) {
    if (item.priority !== lastPriority) {
      lastPriority = item.priority;
      lines.push(`\n── ${item.priority.toUpperCase()} ──`);
    }
    lines.push(formatItem(item));
  }

  return lines.join("\n");
}

/** Search items and display results. */
export function searchInbox(query: string): string {
  const items = search(query);
  if (items.length === 0) {
    return `No results for "${query}"`;
  }
  return items.map(formatItem).join("\n");
}

/** Dismiss an item by ID. */
export function dismissItem(id: string): void {
  updateStatus(id, "dismissed");
}

/** Mark an item as done. */
export function completeItem(id: string): void {
  updateStatus(id, "done");
}

function formatAge(date: Date): string {
  const ms = Date.now() - date.getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) {
    return `${mins}m ago`;
  }
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

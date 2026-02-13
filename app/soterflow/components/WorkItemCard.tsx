"use client";

import type { WorkItem } from "../lib/api";
import { PriorityBadge } from "./PriorityBadge";
import { SourceIcon } from "./SourceIcon";

function timeAgo(date: string): string {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) {
    return "just now";
  }
  if (s < 3600) {
    return `${Math.floor(s / 60)}m ago`;
  }
  if (s < 86400) {
    return `${Math.floor(s / 3600)}h ago`;
  }
  return `${Math.floor(s / 86400)}d ago`;
}

interface Props {
  item: WorkItem;
  onClick: () => void;
}

export function WorkItemCard({ item, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-start gap-3 p-3 rounded-xl bg-white dark:bg-gray-800 active:bg-gray-50 dark:active:bg-gray-750 transition-colors text-left"
    >
      <div className="mt-0.5">
        <SourceIcon source={item.source} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate flex-1">
            {item.title}
          </span>
          <PriorityBadge priority={item.priority} />
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          <span>{item.author}</span>
          <span>·</span>
          <span>{timeAgo(item.createdAt)}</span>
          <span>·</span>
          <span className="capitalize">{item.type}</span>
        </div>
      </div>
      <span className="text-gray-400 mt-1">›</span>
    </button>
  );
}

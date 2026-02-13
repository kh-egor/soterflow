"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { ActionButton } from "../../components/ActionButton";
import { LoadingState } from "../../components/LoadingState";
import { PriorityBadge } from "../../components/PriorityBadge";
import { SourceIcon } from "../../components/SourceIcon";
import { api, type WorkItem } from "../../lib/api";
import { showBackButton, haptic, hapticNotify } from "../../lib/telegram";

const sourceActions: Record<
  string,
  { type: string; label: string; variant?: "primary" | "secondary" | "danger" }[]
> = {
  github: [
    { type: "approve", label: "Approve", variant: "primary" },
    { type: "merge", label: "Merge", variant: "primary" },
    { type: "comment", label: "Comment" },
    { type: "close", label: "Close", variant: "danger" },
  ],
  jira: [
    { type: "transition", label: "Transition", variant: "primary" },
    { type: "comment", label: "Comment" },
    { type: "assign", label: "Assign" },
  ],
  slack: [
    { type: "reply", label: "Reply", variant: "primary" },
    { type: "react", label: "React" },
  ],
};

// GitHub issues get a subset
function getActions(item: WorkItem) {
  const base = sourceActions[item.source] ?? [];
  if (item.source === "github" && item.type === "issue") {
    return base.filter((a) => ["comment", "close"].includes(a.type));
  }
  return base;
}

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

export default function ItemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [item, setItem] = useState<WorkItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    return showBackButton(() => router.back());
  }, [router]);

  useEffect(() => {
    api
      .getItem(id)
      .then(setItem)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  const doAction = useCallback(
    async (action: string) => {
      if (!item) {
        return;
      }
      setActionLoading(action);
      haptic("medium");
      try {
        await api.performAction(item.id, action);
        hapticNotify("success");
        // Refresh item
        const updated = await api.getItem(item.id);
        setItem(updated);
      } catch (e) {
        hapticNotify("error");
        console.error("Action failed:", e);
      } finally {
        setActionLoading(null);
      }
    },
    [item],
  );

  const setStatus = useCallback(
    async (status: string) => {
      if (!item) {
        return;
      }
      haptic("light");
      try {
        await api.performAction(item.id, "set_status", { status });
        hapticNotify("success");
        setItem({ ...item, status: status as WorkItem["status"] });
      } catch {
        hapticNotify("error");
      }
    },
    [item],
  );

  if (loading) {
    return <LoadingState />;
  }
  if (!item) {
    return <div className="p-4 text-center text-gray-500">Item not found</div>;
  }

  const actions = getActions(item);

  return (
    <div className="min-h-screen pb-6">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-2 mb-2">
          <SourceIcon source={item.source} />
          <span className="text-xs uppercase font-semibold text-gray-500 dark:text-gray-400">
            {item.source} · {item.type}
          </span>
          <PriorityBadge priority={item.priority} />
        </div>
        <h1 className="text-lg font-bold leading-tight">{item.title}</h1>
        <div className="flex items-center gap-2 mt-1 text-xs text-gray-500 dark:text-gray-400">
          <span>{item.author}</span>
          <span>·</span>
          <span>{timeAgo(item.createdAt)}</span>
        </div>
      </div>

      {/* Body */}
      {item.body && (
        <div className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap border-b border-gray-200 dark:border-gray-800">
          {item.body}
        </div>
      )}

      {/* External link */}
      {item.url && (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block px-4 py-3 text-sm text-blue-500 hover:underline border-b border-gray-200 dark:border-gray-800"
        >
          Open in {item.source} ↗
        </a>
      )}

      {/* Quick actions */}
      <div className="px-4 pt-4">
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">
          Actions
        </p>
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <ActionButton
              key={a.type}
              label={a.label}
              variant={a.variant}
              onClick={() => doAction(a.type)}
              loading={actionLoading === a.type}
            />
          ))}
        </div>
      </div>

      {/* Status */}
      <div className="px-4 pt-5">
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">
          Status
        </p>
        <div className="flex gap-2">
          {["in_progress", "done", "dismissed"].map((s) => (
            <ActionButton
              key={s}
              label={s === "in_progress" ? "In Progress" : s === "done" ? "Done" : "Dismiss"}
              variant={item.status === s ? "primary" : "secondary"}
              onClick={() => setStatus(s)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

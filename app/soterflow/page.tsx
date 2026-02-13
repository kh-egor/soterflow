"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback, useRef } from "react";
import { EmptyState } from "./components/EmptyState";
import { FilterBar } from "./components/FilterBar";
import { LoadingState } from "./components/LoadingState";
import { WorkItemCard } from "./components/WorkItemCard";
import { api, connectWS, type WorkItem } from "./lib/api";
import { initApp, haptic, hapticNotify } from "./lib/telegram";

const sourceTabs = [
  { label: "All", value: "all" },
  { label: "GitHub", value: "github" },
  { label: "Jira", value: "jira" },
  { label: "Slack", value: "slack" },
];

const typeTabs = [
  { label: "All", value: "all" },
  { label: "PRs", value: "pr" },
  { label: "Issues", value: "issue" },
  { label: "Mentions", value: "mention" },
  { label: "Messages", value: "message" },
];

export default function InboxPage() {
  const router = useRouter();
  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState("all");
  const [type, setType] = useState("all");
  const [refreshing, setRefreshing] = useState(false);
  const touchStartY = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchItems = useCallback(async () => {
    try {
      const data = await api.getInbox({ source, type });
      setItems(data);
    } catch (e) {
      console.error("Failed to fetch inbox:", e);
    } finally {
      setLoading(false);
    }
  }, [source, type]);

  useEffect(() => {
    initApp();
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchItems();
  }, [fetchItems]);

  // WebSocket real-time updates
  useEffect(() => {
    return connectWS(() => {
      hapticNotify("success");
      fetchItems();
    });
  }, [fetchItems]);

  // Pull-to-refresh
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = async (e: React.TouchEvent) => {
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    if (dy > 80 && containerRef.current?.scrollTop === 0 && !refreshing) {
      setRefreshing(true);
      haptic("medium");
      try {
        await api.triggerSync();
        await fetchItems();
      } finally {
        setRefreshing(false);
      }
    }
  };

  return (
    <div
      ref={containerRef}
      className="min-h-screen flex flex-col"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Header */}
      <header className="sticky top-0 z-10 bg-gray-50/80 dark:bg-gray-900/80 backdrop-blur-lg border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <h1 className="text-xl font-bold">SoterFlow</h1>
          <button onClick={() => router.push("/soterflow/settings")} className="text-xl p-1">
            ⚙️
          </button>
        </div>
        <FilterBar tabs={sourceTabs} active={source} onChange={setSource} />
        <FilterBar tabs={typeTabs} active={type} onChange={setType} />
      </header>

      {/* Refresh indicator */}
      {refreshing && (
        <div className="flex justify-center py-2">
          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Content */}
      <main className="flex-1 px-3 py-2 space-y-1.5">
        {loading ? (
          <LoadingState />
        ) : items.length === 0 ? (
          <EmptyState message="Your inbox is empty — pull down to sync" />
        ) : (
          items.map((item) => (
            <WorkItemCard
              key={item.id}
              item={item}
              onClick={() => {
                haptic("light");
                router.push(`/soterflow/item/${item.id}`);
              }}
            />
          ))
        )}
      </main>
    </div>
  );
}

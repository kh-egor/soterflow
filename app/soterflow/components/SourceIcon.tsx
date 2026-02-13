"use client";

const icons: Record<string, { emoji: string; color: string }> = {
  github: { emoji: "🐙", color: "text-gray-200" },
  jira: { emoji: "🔷", color: "text-blue-500" },
  slack: { emoji: "💬", color: "text-purple-500" },
};

export function SourceIcon({ source }: { source: string }) {
  const { emoji } = icons[source] ?? { emoji: "📋", color: "text-gray-400" };
  return <span className="text-lg">{emoji}</span>;
}

"use client";

const colors: Record<string, string> = {
  critical: "bg-red-500 text-white",
  high: "bg-orange-500 text-white",
  medium: "bg-yellow-500 text-black",
  low: "bg-blue-400 text-white",
  none: "bg-gray-400 text-white",
};

export function PriorityBadge({ priority }: { priority: string }) {
  if (priority === "none") {
    return null;
  }
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${colors[priority] ?? colors.none}`}
    >
      {priority}
    </span>
  );
}

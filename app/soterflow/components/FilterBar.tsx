"use client";

import { haptic } from "../lib/telegram";

interface Tab {
  label: string;
  value: string;
}

interface Props {
  tabs: Tab[];
  active: string;
  onChange: (value: string) => void;
}

export function FilterBar({ tabs, active, onChange }: Props) {
  return (
    <div className="flex gap-1 overflow-x-auto px-4 py-2 no-scrollbar">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => {
            haptic("light");
            onChange(t.value);
          }}
          className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
            active === t.value
              ? "bg-blue-500 text-white"
              : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

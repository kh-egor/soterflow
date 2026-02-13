"use client";

import { haptic } from "../lib/telegram";

interface Props {
  label: string;
  variant?: "primary" | "secondary" | "danger";
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}

const variants: Record<string, string> = {
  primary: "bg-blue-500 text-white active:bg-blue-600",
  secondary: "bg-gray-200 text-gray-800 active:bg-gray-300 dark:bg-gray-700 dark:text-gray-200",
  danger: "bg-red-500 text-white active:bg-red-600",
};

export function ActionButton({ label, variant = "secondary", onClick, disabled, loading }: Props) {
  return (
    <button
      className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${variants[variant]}`}
      onClick={() => {
        haptic("light");
        onClick();
      }}
      disabled={disabled || loading}
    >
      {loading ? "..." : label}
    </button>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { ActionButton } from "../components/ActionButton";
import { LoadingState } from "../components/LoadingState";
import { api, type ChannelConfig, type SyncState } from "../lib/api";
import { showBackButton, haptic, hapticNotify } from "../lib/telegram";

const channelFields: Record<string, { label: string; key: string; placeholder: string }[]> = {
  github: [{ label: "Personal Access Token", key: "token", placeholder: "ghp_..." }],
  jira: [
    { label: "Base URL", key: "baseUrl", placeholder: "https://yourco.atlassian.net" },
    { label: "Email", key: "email", placeholder: "you@company.com" },
    { label: "API Token", key: "apiToken", placeholder: "ATATT..." },
  ],
  slack: [{ label: "Bot Token", key: "token", placeholder: "xoxb-..." }],
};

function timeAgo(date: string | null): string {
  if (!date) {
    return "Never";
  }
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) {
    return "just now";
  }
  if (s < 3600) {
    return `${Math.floor(s / 60)}m ago`;
  }
  return `${Math.floor(s / 3600)}h ago`;
}

export default function SettingsPage() {
  const router = useRouter();
  const [channels, setChannels] = useState<ChannelConfig[]>([]);
  const [syncStates, setSyncStates] = useState<SyncState[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncingChannel, setSyncingChannel] = useState<string | null>(null);

  useEffect(() => {
    return showBackButton(() => router.back());
  }, [router]);

  useEffect(() => {
    Promise.all([api.getChannelConfig(), api.getSyncStatus()])
      .then(([ch, ss]) => {
        setChannels(ch);
        setSyncStates(ss);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const updateField = useCallback((channelName: string, key: string, value: string) => {
    setChannels((prev) =>
      prev.map((ch) =>
        ch.name === channelName ? { ...ch, config: { ...ch.config, [key]: value } } : ch,
      ),
    );
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    haptic("medium");
    try {
      await api.saveChannelConfig(channels);
      hapticNotify("success");
    } catch {
      hapticNotify("error");
    } finally {
      setSaving(false);
    }
  }, [channels]);

  const syncChannel = useCallback(async (name: string) => {
    setSyncingChannel(name);
    haptic("light");
    try {
      await api.triggerSync(name);
      const ss = await api.getSyncStatus();
      setSyncStates(ss);
      hapticNotify("success");
    } catch {
      hapticNotify("error");
    } finally {
      setSyncingChannel(null);
    }
  }, []);

  if (loading) {
    return <LoadingState />;
  }

  return (
    <div className="min-h-screen pb-8">
      <header className="px-4 pt-4 pb-3 border-b border-gray-200 dark:border-gray-800">
        <h1 className="text-xl font-bold">Settings</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Configure your channels</p>
      </header>

      <div className="px-4 space-y-5 mt-4">
        {channels.map((ch) => {
          const fields = channelFields[ch.name] ?? [];
          const sync = syncStates.find((s) => s.channel === ch.name);
          return (
            <div key={ch.name} className="bg-white dark:bg-gray-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="font-semibold capitalize">{ch.name}</span>
                  <span
                    className={`w-2 h-2 rounded-full ${ch.connected ? "bg-green-500" : "bg-gray-400"}`}
                  />
                </div>
                <ActionButton
                  label={syncingChannel === ch.name ? "..." : "Sync"}
                  onClick={() => syncChannel(ch.name)}
                  loading={syncingChannel === ch.name}
                />
              </div>

              {fields.map((f) => (
                <div key={f.key} className="mb-2">
                  <label className="text-xs text-gray-500 dark:text-gray-400">{f.label}</label>
                  <input
                    type={
                      f.key.toLowerCase().includes("token") ||
                      f.key.toLowerCase().includes("password")
                        ? "password"
                        : "text"
                    }
                    value={ch.config[f.key] ?? ""}
                    onChange={(e) => updateField(ch.name, f.key, e.target.value)}
                    placeholder={f.placeholder}
                    className="w-full mt-0.5 px-3 py-2 bg-gray-50 dark:bg-gray-700 rounded-lg text-sm border border-gray-200 dark:border-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              ))}

              {sync && (
                <p className="text-xs text-gray-400 mt-2">
                  Last sync: {timeAgo(sync.lastSync)}
                  {sync.status === "error" && (
                    <span className="text-red-400 ml-1">· Error: {sync.error}</span>
                  )}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="px-4 mt-5">
        <button
          onClick={save}
          disabled={saving}
          className="w-full py-3 bg-blue-500 text-white font-semibold rounded-xl active:bg-blue-600 disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving..." : "Save Configuration"}
        </button>
      </div>
    </div>
  );
}

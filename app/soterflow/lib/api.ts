/**
 * SoterFlow API client with Telegram initData auth.
 */

import { getInitData } from "./telegram";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3847";

export interface WorkItem {
  id: string;
  source: "github" | "jira" | "slack";
  type: "pr" | "issue" | "mention" | "message" | "task";
  title: string;
  body?: string;
  author: string;
  url?: string;
  priority: "critical" | "high" | "medium" | "low" | "none";
  status: "new" | "in_progress" | "done" | "dismissed";
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, any>;
}

export interface SyncState {
  channel: string;
  lastSync: string | null;
  status: "idle" | "syncing" | "error";
  error?: string;
}

export interface ChannelConfig {
  name: string;
  enabled: boolean;
  connected: boolean;
  config: Record<string, string>;
}

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const initData = getInitData();
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(initData ? { Authorization: `tma ${initData}` } : {}),
      ...opts?.headers,
    },
  });
  const json: ApiResponse<T> = await res.json();
  if (!json.ok) {
    throw new Error(json.error ?? "API error");
  }
  return json.data as T;
}

export const api = {
  getInbox(params?: { source?: string; type?: string; status?: string }) {
    const qs = new URLSearchParams();
    if (params?.source && params.source !== "all") {
      qs.set("source", params.source);
    }
    if (params?.type && params.type !== "all") {
      qs.set("type", params.type);
    }
    if (params?.status) {
      qs.set("status", params.status);
    }
    const q = qs.toString();
    return request<WorkItem[]>(`/api/inbox${q ? `?${q}` : ""}`);
  },

  getItem(id: string) {
    return request<WorkItem>(`/api/inbox/${id}`);
  },

  performAction(id: string, action: string, params?: Record<string, any>) {
    return request<any>(`/api/inbox/${id}/action`, {
      method: "POST",
      body: JSON.stringify({ action, params }),
    });
  },

  triggerSync(channel?: string) {
    return request<any>("/api/sync", {
      method: "POST",
      body: JSON.stringify({ channel }),
    });
  },

  getSyncStatus() {
    return request<SyncState[]>("/api/sync/status");
  },

  getChannelConfig() {
    return request<ChannelConfig[]>("/api/config/channels");
  },

  saveChannelConfig(channels: ChannelConfig[]) {
    return request<any>("/api/config/channels", {
      method: "POST",
      body: JSON.stringify({ channels }),
    });
  },
};

// WebSocket for real-time updates
export function connectWS(onSyncComplete: () => void): () => void {
  const wsUrl = BASE.replace(/^http/, "ws") + "/ws";
  let ws: WebSocket | null = null;
  let closed = false;

  function connect() {
    if (closed) {
      return;
    }
    ws = new WebSocket(wsUrl);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string);
        if (msg.type === "sync_complete") {
          onSyncComplete();
        }
      } catch {}
    };
    ws.onclose = () => {
      if (!closed) {
        setTimeout(connect, 3000);
      }
    };
  }

  connect();
  return () => {
    closed = true;
    ws?.close();
  };
}

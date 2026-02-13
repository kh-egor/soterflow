/**
 * @module channels/slack
 * Slack channel connector using Socket Mode for real-time events.
 * Uses User Token (xoxp-) to act on behalf of the user, not as a bot.
 * Features: Socket Mode for events, cursor-based pagination, rate limit handling.
 */

import { SocketModeClient } from "@slack/socket-mode";
import { WebClient } from "@slack/web-api";
import { BaseChannel, WorkItem } from "./base";
import { withRetry } from "./retry";

export class SlackChannel extends BaseChannel {
  name = "slack";
  private client: WebClient | null = null;
  private socketClient: SocketModeClient | null = null;
  private userId = "";
  private eventListeners: Array<(item: WorkItem) => void> = [];

  async connect(): Promise<void> {
    const token = process.env.SLACK_TOKEN;
    const appToken = process.env.SLACK_APP_TOKEN;
    if (!token) {
      throw new Error("SLACK_TOKEN is not set");
    }
    this.client = new WebClient(token);
    const auth = await this.slackRetry(() => this.client!.auth.test());
    this.userId = auth.user_id as string;

    // Start Socket Mode for real-time events (requires xapp- app-level token)
    if (appToken) {
      this.socketClient = new SocketModeClient({ appToken });
      this.setupSocketListeners();
      await this.socketClient.start();
      console.log("[soterflow] Slack Socket Mode connected");
    }
  }

  async disconnect(): Promise<void> {
    if (this.socketClient) {
      await this.socketClient.disconnect();
      this.socketClient = null;
    }
    this.client = null;
    this.userId = "";
    this.eventListeners = [];
  }

  /** Register a callback for real-time incoming work items */
  onNewItem(listener: (item: WorkItem) => void): void {
    this.eventListeners.push(listener);
  }

  private setupSocketListeners(): void {
    if (!this.socketClient) {
      return;
    }

    // Listen for messages
    this.socketClient.on("message", async ({ event, ack }) => {
      await ack();
      if (event.user === this.userId) {
        return;
      } // ignore own messages

      const item = mapSlackEvent(event, "message");
      this.eventListeners.forEach((fn) => fn(item));
    });

    // Listen for mentions (app_mention or messages containing @user)
    this.socketClient.on("app_mention", async ({ event, ack }) => {
      await ack();
      const item = mapSlackEvent(event, "mention");
      this.eventListeners.forEach((fn) => fn(item));
    });

    // Listen for reactions
    this.socketClient.on("reaction_added", async ({ event, ack }) => {
      await ack();
      if (event.user === this.userId) {
        return;
      }
      const item: WorkItem = {
        id: `slack-reaction-${event.item?.channel}-${event.item?.ts}-${event.reaction}`,
        source: "slack",
        type: "notification",
        title: `${event.user} reacted with :${event.reaction}:`,
        body: "",
        author: event.user ?? "unknown",
        timestamp: new Date(parseFloat(event.event_ts ?? "0") * 1000),
        priority: "low",
        url: event.item?.channel
          ? `https://slack.com/archives/${event.item.channel}/p${(event.item.ts ?? "").replace(".", "")}`
          : "",
        metadata: { channel: event.item?.channel, ts: event.item?.ts, reaction: event.reaction },
        status: "new",
      };
      this.eventListeners.forEach((fn) => fn(item));
    });
  }

  /** Retry wrapper handling Slack rate limits (429 + Retry-After) */
  private slackRetry<T>(fn: () => Promise<T>): Promise<T> {
    return withRetry(fn, {
      isRetryable: (err: unknown) => {
        const e = err as Record<string, unknown>;
        const code = e?.code;
        const status = (e?.status ?? e?.statusCode) as number | undefined;
        if (code === "slack_webapi_rate_limited") {
          return true;
        }
        if (status === 429) {
          return true;
        }
        if (status && status >= 500) {
          return true;
        }
        return false;
      },
      getWaitMs: (attempt: number, err: unknown) => {
        const e = err as Record<string, unknown>;
        const retryAfter = (e?.retryAfter ??
          (e?.headers as Record<string, string>)?.["retry-after"]) as string | number | undefined;
        if (retryAfter) {
          return Math.min(Number(retryAfter) * 1000 + 500, 120_000);
        }
        return Math.min(1000 * 2 ** attempt, 120_000);
      },
    });
  }

  async sync(): Promise<WorkItem[]> {
    if (!this.client) {
      throw new Error("Not connected — call connect() first");
    }
    const items: WorkItem[] = [];

    // DMs — fetch last 3 conversations, 5 messages each. Skip on any error.
    try {
      const ims = await this.client.conversations.list({ types: "im", limit: 3 });
      for (const im of ims.channels ?? []) {
        try {
          const history = await this.client.conversations.history({ channel: im.id!, limit: 5 });
          for (const msg of history.messages ?? []) {
            if (msg.user === this.userId) {
              continue;
            }
            items.push(mapSlackDM(msg, im.id!));
          }
        } catch {
          /* skip */
        }
      }
    } catch {
      /* skip DMs entirely if rate limited */
    }

    // Channel history, mentions, starred skipped — Socket Mode handles real-time.
    // Sync only fetches recent DMs to stay within rate limits.

    return items;
  }

  async performAction(
    itemId: string,
    action: string,
    params?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.client) {
      throw new Error("Not connected");
    }
    const channel = params?.channel as string;
    const ts = params?.ts as string;

    await this.slackRetry(async () => {
      switch (action) {
        case "reply":
          await this.client!.chat.postMessage({ channel, text: params?.text as string });
          break;
        case "react":
          await this.client!.reactions.add({
            channel,
            timestamp: ts,
            name: params?.emoji as string,
          });
          break;
        case "thread-reply":
          await this.client!.chat.postMessage({
            channel,
            text: params?.text as string,
            thread_ts: ts,
          });
          break;
        default:
          throw new Error(`Unsupported Slack action: ${action}`);
      }
    });
  }
}

// --- Exported mappers for testability ---

/** Map a real-time Slack event to WorkItem */
export function mapSlackEvent(
  event: Record<string, unknown>,
  type: "message" | "mention",
): WorkItem {
  const channel = event.channel as string;
  const ts = event.ts as string;
  return {
    id: `slack-${type}-${channel}-${ts}`,
    source: "slack",
    type: type === "mention" ? "mention" : "message",
    title: type === "mention" ? `Mention in ${channel}` : `Message in ${channel}`,
    body: (event.text as string) ?? "",
    author: (event.user as string) ?? "unknown",
    timestamp: new Date(parseFloat(ts ?? "0") * 1000),
    priority: type === "mention" ? "high" : "normal",
    url: `https://slack.com/archives/${channel}/p${(ts ?? "").replace(".", "")}`,
    metadata: { channel, ts },
    status: "new",
  };
}

/** Map a Slack DM message to WorkItem */
export function mapSlackDM(msg: Record<string, unknown>, channelId: string): WorkItem {
  const ts = msg.ts as string;
  return {
    id: `slack-dm-${channelId}-${ts}`,
    source: "slack",
    type: "message",
    title: `DM from ${(msg.user as string) ?? "unknown"}`,
    body: (msg.text as string) ?? "",
    author: (msg.user as string) ?? "unknown",
    timestamp: new Date(parseFloat(ts ?? "0") * 1000),
    priority: "normal",
    url: `https://slack.com/archives/${channelId}/p${(ts ?? "").replace(".", "")}`,
    metadata: { channel: channelId, ts, isDM: true },
    status: "new",
  };
}

/** Map a Slack mention search result to WorkItem */
export function mapSlackMention(match: Record<string, unknown>): WorkItem {
  const channel = match.channel as Record<string, unknown> | undefined;
  const ts = match.ts as string;
  return {
    id: `slack-mention-${channel?.id}-${ts}`,
    source: "slack",
    type: "mention",
    title: `Mention in #${(channel?.name as string) ?? "unknown"}`,
    body: (match.text as string) ?? "",
    author: (match.user as string) ?? (match.username as string) ?? "unknown",
    timestamp: new Date(parseFloat(ts ?? "0") * 1000),
    priority: "high",
    url: (match.permalink as string) ?? "",
    metadata: { channel: channel?.id, ts },
    status: "new",
  };
}

/** Map a Slack starred message to WorkItem */
export function mapSlackStar(star: Record<string, unknown>): WorkItem {
  const msg = star.message as Record<string, unknown> | undefined;
  const ts = msg?.ts as string;
  return {
    id: `slack-star-${star.channel}-${ts}`,
    source: "slack",
    type: "message",
    title: `Starred message in ${star.channel}`,
    body: (msg?.text as string) ?? "",
    author: (msg?.user as string) ?? "unknown",
    timestamp: new Date(parseFloat(ts ?? "0") * 1000),
    priority: "normal",
    url: (msg?.permalink as string) ?? "",
    metadata: { channel: star.channel, ts, starred: true },
    status: "new",
  };
}

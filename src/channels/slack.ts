/**
 * @module channels/slack
 * Slack channel connector — fetches DMs, mentions, and starred messages.
 * Features: cursor-based pagination, rate limit handling with Retry-After, exponential backoff.
 */

import { WebClient } from "@slack/web-api";
import { BaseChannel, WorkItem } from "./base";
import { withRetry, sleep } from "./retry";

export class SlackChannel extends BaseChannel {
  name = "slack";
  private client: WebClient | null = null;
  private userId = "";

  async connect(): Promise<void> {
    const token = process.env.SLACK_TOKEN;
    if (!token) {
      throw new Error("SLACK_TOKEN is not set");
    }
    this.client = new WebClient(token);
    const auth = await this.slackRetry(() => this.client!.auth.test());
    this.userId = auth.user_id as string;
  }

  async disconnect(): Promise<void> {
    this.client = null;
    this.userId = "";
  }

  /** Retry wrapper handling Slack rate limits (429 + Retry-After) */
  private slackRetry<T>(fn: () => Promise<T>): Promise<T> {
    return withRetry(fn, {
      isRetryable: (err: any) => {
        const code = err?.code;
        const status = err?.status ?? err?.statusCode;
        // Slack WebClient throws with code: 'slack_webapi_rate_limited'
        if (code === "slack_webapi_rate_limited") {
          return true;
        }
        if (status === 429) {
          return true;
        }
        if (status >= 500) {
          return true;
        }
        return false;
      },
      getWaitMs: (attempt: number, err: any) => {
        // Slack provides retryAfter in seconds on rate limit errors
        const retryAfter = err?.retryAfter ?? err?.headers?.["retry-after"];
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

    // 1. DMs (IM conversations) with cursor pagination
    let cursor: string | undefined;
    do {
      const ims = await this.slackRetry(() =>
        this.client!.conversations.list({ types: "im", limit: 100, cursor }),
      );
      for (const im of ims.channels ?? []) {
        const history = await this.slackRetry(() =>
          this.client!.conversations.history({ channel: im.id!, limit: 10 }),
        );
        for (const msg of history.messages ?? []) {
          if (msg.user === this.userId) {
            continue;
          }
          items.push(mapSlackDM(msg, im.id!));
        }
      }
      cursor = ims.response_metadata?.next_cursor || undefined;
    } while (cursor);

    // 2. Mentions (search)
    const mentions = await this.slackRetry(() =>
      this.client!.search.messages({
        query: `<@${this.userId}>`,
        count: 50,
        sort: "timestamp",
        sort_dir: "desc",
      }),
    );
    for (const match of mentions.messages?.matches ?? []) {
      items.push(mapSlackMention(match));
    }

    // 3. Starred messages with cursor pagination
    let starCursor: string | undefined;
    do {
      const stars = await this.slackRetry(() =>
        this.client!.stars.list({ limit: 100, cursor: starCursor }),
      );
      for (const star of stars.items ?? []) {
        if (star.type !== "message") {
          continue;
        }
        items.push(mapSlackStar(star));
      }
      starCursor = (stars as any).response_metadata?.next_cursor || undefined;
    } while (starCursor);

    return items;
  }

  async performAction(itemId: string, action: string, params?: Record<string, any>): Promise<void> {
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

/** Map a Slack DM message to WorkItem */
export function mapSlackDM(msg: any, channelId: string): WorkItem {
  return {
    id: `slack-dm-${channelId}-${msg.ts}`,
    source: "slack",
    type: "message",
    title: `DM from ${msg.user ?? "unknown"}`,
    body: msg.text ?? "",
    author: msg.user ?? "unknown",
    timestamp: new Date(parseFloat(msg.ts ?? "0") * 1000),
    priority: "normal",
    url: `https://slack.com/archives/${channelId}/p${(msg.ts ?? "").replace(".", "")}`,
    metadata: { channel: channelId, ts: msg.ts, isDM: true },
    status: "new",
  };
}

/** Map a Slack mention search result to WorkItem */
export function mapSlackMention(match: any): WorkItem {
  return {
    id: `slack-mention-${match.channel?.id}-${match.ts}`,
    source: "slack",
    type: "mention",
    title: `Mention in #${match.channel?.name ?? "unknown"}`,
    body: match.text ?? "",
    author: match.user ?? match.username ?? "unknown",
    timestamp: new Date(parseFloat(match.ts ?? "0") * 1000),
    priority: "high",
    url: match.permalink ?? "",
    metadata: { channel: match.channel?.id, ts: match.ts },
    status: "new",
  };
}

/** Map a Slack starred message to WorkItem */
export function mapSlackStar(star: any): WorkItem {
  const msg = star.message;
  return {
    id: `slack-star-${star.channel}-${msg?.ts}`,
    source: "slack",
    type: "message",
    title: `Starred message in ${star.channel}`,
    body: msg?.text ?? "",
    author: msg?.user ?? "unknown",
    timestamp: new Date(parseFloat(msg?.ts ?? "0") * 1000),
    priority: "normal",
    url: msg?.permalink ?? "",
    metadata: { channel: star.channel, ts: msg?.ts, starred: true },
    status: "new",
  };
}

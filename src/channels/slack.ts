/**
 * @module channels/slack
 * Slack channel connector — fetches DMs, mentions, and starred messages.
 */

import { WebClient } from "@slack/web-api";
import { BaseChannel, WorkItem } from "./base";

export class SlackChannel extends BaseChannel {
  name = "slack";
  private client: WebClient | null = null;
  private userId = "";

  /** Connect using SLACK_TOKEN from environment. */
  async connect(): Promise<void> {
    const token = process.env.SLACK_TOKEN;
    if (!token) {
      throw new Error("SLACK_TOKEN is not set");
    }
    this.client = new WebClient(token);
    const auth = await this.client.auth.test();
    this.userId = auth.user_id as string;
  }

  async disconnect(): Promise<void> {
    this.client = null;
    this.userId = "";
  }

  /** Fetch DMs, mentions, and starred messages. */
  async sync(): Promise<WorkItem[]> {
    if (!this.client) {
      throw new Error("Not connected");
    }
    const items: WorkItem[] = [];

    // 1. DMs (IM conversations)
    const ims = await this.client.conversations.list({ types: "im", limit: 20 });
    for (const im of ims.channels ?? []) {
      const history = await this.client.conversations.history({ channel: im.id!, limit: 10 });
      for (const msg of history.messages ?? []) {
        if (msg.user === this.userId) {
          continue;
        } // skip own messages
        items.push({
          id: `slack-dm-${im.id}-${msg.ts}`,
          source: "slack",
          type: "message",
          title: `DM from ${msg.user}`,
          body: msg.text ?? "",
          author: msg.user ?? "unknown",
          timestamp: new Date(parseFloat(msg.ts!) * 1000),
          priority: "normal",
          url: `https://slack.com/archives/${im.id}/p${msg.ts!.replace(".", "")}`,
          metadata: { channel: im.id, ts: msg.ts, isDM: true },
          status: "new",
        });
      }
    }

    // 2. Mentions (search for @user)
    const mentions = await this.client.search.messages({
      query: `<@${this.userId}>`,
      count: 30,
      sort: "timestamp",
      sort_dir: "desc",
    });
    for (const match of mentions.messages?.matches ?? []) {
      items.push({
        id: `slack-mention-${match.channel?.id}-${match.ts}`,
        source: "slack",
        type: "mention",
        title: `Mention in #${match.channel?.name ?? "unknown"}`,
        body: match.text ?? "",
        author: match.user ?? match.username ?? "unknown",
        timestamp: new Date(parseFloat(match.ts!) * 1000),
        priority: "high",
        url: match.permalink ?? "",
        metadata: { channel: match.channel?.id, ts: match.ts },
        status: "new",
      });
    }

    // 3. Starred messages
    const stars = await this.client.stars.list({ limit: 20 });
    for (const star of stars.items ?? []) {
      if (star.type !== "message") {
        continue;
      }
      const msg = star.message as any;
      items.push({
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
      });
    }

    return items;
  }

  /**
   * Perform an action on a Slack work item.
   * Supported actions: reply, react, thread-reply.
   */
  async performAction(itemId: string, action: string, params?: Record<string, any>): Promise<void> {
    if (!this.client) {
      throw new Error("Not connected");
    }
    const channel = params?.channel as string;
    const ts = params?.ts as string;

    switch (action) {
      case "reply":
        await this.client.chat.postMessage({ channel, text: params?.text as string });
        break;
      case "react":
        await this.client.reactions.add({ channel, timestamp: ts, name: params?.emoji as string });
        break;
      case "thread-reply":
        await this.client.chat.postMessage({
          channel,
          text: params?.text as string,
          thread_ts: ts,
        });
        break;
      default:
        throw new Error(`Unsupported Slack action: ${action}`);
    }
  }
}

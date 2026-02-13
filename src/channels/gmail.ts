/**
 * @module channels/gmail
 * Gmail channel connector via IMAP — fetches recent emails from inbox.
 * Uses imapflow for modern Promise-based IMAP access.
 */

import { ImapFlow } from "imapflow";
import { simpleParser, ParsedMail } from "mailparser";
import { BaseChannel, WorkItem } from "./base.js";

const MAX_EMAILS = 20;

/** Typed subset of imapflow FetchMessageObject we actually use */
interface ImapMessage {
  uid: number;
  source?: Buffer;
  flags?: Set<string>;
  labels?: Set<string>;
  threadId?: string;
}

/** Helper to extract .text from parsed address fields */
function addressText(field: ParsedMail["to"]): string {
  if (!field) {
    return "";
  }
  if (Array.isArray(field)) {
    return field.map((a) => a.text).join(", ");
  }
  return field.text || "";
}

export class GmailChannel extends BaseChannel {
  name = "gmail";
  private client: ImapFlow | null = null;

  isConfigured(): boolean {
    return !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
  }

  async connect(): Promise<void> {
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;
    if (!user || !pass) {
      throw new Error("GMAIL_USER and GMAIL_APP_PASSWORD must be set");
    }

    this.client = new ImapFlow({
      host: process.env.GMAIL_IMAP_HOST || "imap.gmail.com",
      port: parseInt(process.env.GMAIL_IMAP_PORT || "993", 10),
      secure: true,
      auth: { user, pass },
      logger: false as unknown as Record<string, never>,
    });

    await this.client.connect();
    this._connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        this.client.close();
      } catch {
        /* ignore */
      }
      this.client = null;
    }
    this._connected = false;
  }

  async sync(): Promise<WorkItem[]> {
    if (!this.client) {
      throw new Error("Not connected — call connect() first");
    }

    const syncDays = parseInt(process.env.SOTERFLOW_SYNC_WINDOW_DAYS ?? "7", 10);
    const since = new Date(Date.now() - syncDays * 24 * 60 * 60 * 1000);

    const items: WorkItem[] = [];
    const seenUids = new Set<number>();

    const lock = await this.client.getMailboxLock("INBOX");
    try {
      // Fetch UNSEEN first, then recent — dedup by uid
      for (const query of [{ seen: false, since }, { since }] as const) {
        try {
          for await (const msg of this.client.fetch(query, {
            envelope: true,
            source: true,
            flags: true,
            uid: true,
            labels: true,
            threadId: true,
          }) as AsyncIterable<ImapMessage>) {
            if (seenUids.has(msg.uid)) {
              continue;
            }
            seenUids.add(msg.uid);
            if (items.length >= MAX_EMAILS) {
              break;
            }

            try {
              const source = msg.source;
              if (!source) {
                continue;
              }
              const parsed = await simpleParser(source);
              items.push(this.mapEmail(msg, parsed));
            } catch {
              // skip unparseable emails
            }
          }
        } catch {
          // query may return no results
        }
        if (items.length >= MAX_EMAILS) {
          break;
        }
      }
    } finally {
      lock.release();
    }

    return items;
  }

  private mapEmail(msg: ImapMessage, parsed: ParsedMail): WorkItem {
    const subject = parsed.subject || "(no subject)";
    const fromAddr = parsed.from?.value?.[0];
    const author = fromAddr?.name || fromAddr?.address || "unknown";
    const textBody = (parsed.text || "").slice(0, 500);
    const messageId = parsed.messageId || "";
    const hexId = Buffer.from(messageId).toString("hex");
    const isUnread = !msg.flags?.has("\\Seen");
    const isFlagged = msg.flags?.has("\\Flagged");

    const importantSenders = (process.env.GMAIL_IMPORTANT_SENDERS || "")
      .split(",")
      .map((s: string) => s.trim().toLowerCase())
      .filter(Boolean);
    const fromEmail = (fromAddr?.address || "").toLowerCase();

    let priority: WorkItem["priority"] = "normal";
    if (isFlagged) {
      priority = "urgent";
    } else if (importantSenders.some((s) => fromEmail.includes(s))) {
      priority = "high";
    }

    return {
      id: `gmail-${msg.uid}`,
      source: "gmail",
      type: "notification",
      title: subject,
      body: textBody,
      author,
      timestamp: parsed.date || new Date(),
      priority,
      url: `https://mail.google.com/mail/u/0/#inbox/${hexId}`,
      metadata: {
        from: fromAddr?.address || "",
        to: addressText(parsed.to),
        cc: addressText(parsed.cc),
        unread: isUnread,
        labels: msg.labels ? [...msg.labels] : [],
        messageId,
        threadId: msg.threadId || "",
      },
      status: "new",
    };
  }

  async performAction(
    itemId: string,
    action: string,
    _params?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.client) {
      throw new Error("Not connected");
    }

    // Extract uid from itemId (gmail-{uid})
    const uid = parseInt(itemId.replace("gmail-", ""), 10);
    if (isNaN(uid)) {
      throw new Error(`Invalid gmail item ID: ${itemId}`);
    }

    const lock = await this.client.getMailboxLock("INBOX");
    try {
      switch (action) {
        case "read":
          await this.client.messageFlagsAdd({ uid }, ["\\Seen"], { uid: true } as Record<
            string,
            unknown
          >);
          break;
        case "archive":
          await this.client.messageMove({ uid }, "[Gmail]/All Mail", { uid: true } as Record<
            string,
            unknown
          >);
          break;
        case "star":
          await this.client.messageFlagsAdd({ uid }, ["\\Flagged"], { uid: true } as Record<
            string,
            unknown
          >);
          break;
        case "reply":
          console.warn("[gmail] Reply action not supported via IMAP; use SMTP instead");
          break;
        default:
          throw new Error(`Unsupported Gmail action: ${action}`);
      }
    } finally {
      lock.release();
    }
  }
}

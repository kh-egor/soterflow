/**
 * @module channels/jira
 * Jira channel connector — fetches assigned, mentioned, watched, and recently updated issues via REST API v3.
 * Features: pagination via startAt/maxResults, exponential backoff retries, priority mapping.
 */

import { BaseChannel, WorkItem } from "./base";
import { withRetry } from "./retry";

export interface JiraIssue {
  id: string;
  key: string;
  self: string;
  fields: {
    summary: string;
    description: string | null;
    assignee: { displayName: string; emailAddress: string } | null;
    reporter: { displayName: string } | null;
    status: { name: string };
    priority: { name: string } | null;
    updated: string;
    created: string;
    issuetype: { name: string };
    comment?: { comments: Array<{ author: { displayName: string }; body: string }> };
    [key: string]: unknown;
  };
}

const SEARCH_FIELDS =
  "summary,description,assignee,reporter,status,priority,updated,created,issuetype";
const PAGE_SIZE = 50;

export class JiraChannel extends BaseChannel {
  name = "jira";
  private baseUrl = "";
  private auth = "";

  async connect(): Promise<void> {
    const url = process.env.JIRA_URL;
    const email = process.env.JIRA_EMAIL;
    const token = process.env.JIRA_TOKEN;
    if (!url || !email || !token) {
      throw new Error("JIRA_URL, JIRA_EMAIL, and JIRA_TOKEN must be set");
    }
    this.baseUrl = url.replace(/\/$/, "");
    this.auth = Buffer.from(`${email}:${token}`).toString("base64");

    // Verify connectivity
    await this.request("/rest/api/3/myself");
    this._connected = true;
  }

  async disconnect(): Promise<void> {
    this.baseUrl = "";
    this.auth = "";
    this._connected = false;
  }

  private async request(path: string, options?: RequestInit): Promise<unknown> {
    return withRetry(async () => {
      const headers: Record<string, string> = {
        Authorization: `Basic ${this.auth}`,
        "Content-Type": "application/json",
      };
      // Merge custom headers
      if (options?.headers) {
        const h = options.headers as Record<string, string>;
        Object.assign(headers, h);
      }
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers,
      });
      if (!res.ok) {
        const err = new Error(`Jira API error: ${res.status} ${res.statusText}`) as Error & {
          status: number;
          response: { headers: Headers };
        };
        err.status = res.status;
        err.response = { headers: res.headers };
        throw err;
      }
      return res.json();
    });
  }

  /** Paginated JQL search returning all matching issues (uses v3 search/jql endpoint). */
  private async searchAll(jql: string): Promise<JiraIssue[]> {
    const issues: JiraIssue[] = [];
    let nextPageToken: string | undefined;
    while (true) {
      const params = new URLSearchParams({
        jql,
        maxResults: String(PAGE_SIZE),
        fields: SEARCH_FIELDS,
      });
      if (nextPageToken) {
        params.set("nextPageToken", nextPageToken);
      }
      const data = (await this.request(`/rest/api/3/search/jql?${params.toString()}`)) as {
        issues: JiraIssue[];
        isLast?: boolean;
        nextPageToken?: string;
      };
      issues.push(...data.issues);
      if (data.isLast || !data.nextPageToken || data.issues.length === 0) {
        break;
      }
      nextPageToken = data.nextPageToken;
    }
    return issues;
  }

  async sync(): Promise<WorkItem[]> {
    const seen = new Set<string>();
    const items: WorkItem[] = [];
    const days = parseInt(process.env.SOTERFLOW_SYNC_WINDOW_DAYS ?? "7", 10);

    const addIssues = (issues: JiraIssue[]) => {
      for (const issue of issues) {
        if (seen.has(issue.key)) {
          continue;
        }
        seen.add(issue.key);
        items.push(mapJiraIssue(issue, this.baseUrl));
      }
    };

    // 1. Assigned issues
    addIssues(await this.searchAll(buildJql("assigned", days)));
    // 2. Watched issues
    addIssues(await this.searchAll(buildJql("watched", days)));
    // 3. Mentioned (text search — current user's email in text)
    addIssues(await this.searchAll(buildJql("mentioned", days)));
    // 4. Recently updated
    addIssues(await this.searchAll(buildJql("recent", days)));

    return items;
  }

  /** Get available transitions for a Jira issue. */
  async getTransitions(issueKey: string): Promise<Array<{ id: string; name: string }>> {
    const data = (await this.request(`/rest/api/3/issue/${issueKey}/transitions`)) as {
      transitions: Array<{ id: string; name: string }>;
    };
    return data.transitions.map((t) => ({ id: t.id, name: t.name }));
  }

  async performAction(
    itemId: string,
    action: string,
    params?: Record<string, unknown>,
  ): Promise<void> {
    const key = (params?.key as string) ?? itemId.replace("jira-", "");

    switch (action) {
      case "transition": {
        await this.request(`/rest/api/3/issue/${key}/transitions`, {
          method: "POST",
          body: JSON.stringify({ transition: { id: params?.transitionId } }),
        });
        // Auto-assign to owner on transition
        const ownerAccountId = (params?.assignTo as string) || process.env.JIRA_OWNER_ACCOUNT_ID;
        if (ownerAccountId) {
          await this.request(`/rest/api/3/issue/${key}/assignee`, {
            method: "PUT",
            body: JSON.stringify({ accountId: ownerAccountId }),
          });
        }
        break;
      }
      case "comment":
        await this.request(`/rest/api/3/issue/${key}/comment`, {
          method: "POST",
          body: JSON.stringify({
            body: {
              type: "doc",
              version: 1,
              content: [
                { type: "paragraph", content: [{ type: "text", text: params?.body ?? "" }] },
              ],
            },
          }),
        });
        break;
      case "assign":
        await this.request(`/rest/api/3/issue/${key}/assignee`, {
          method: "PUT",
          body: JSON.stringify({ accountId: params?.accountId }),
        });
        break;
      default:
        throw new Error(`Unsupported Jira action: ${action}`);
    }
  }
}

// --- Exported helpers for testability ---

/** Extract plain text from Jira's Atlassian Document Format (ADF) or return string as-is. */
function extractAdfText(desc: unknown): string {
  if (!desc) {
    return "";
  }
  if (typeof desc === "string") {
    return desc;
  }
  if (typeof desc !== "object") {
    return JSON.stringify(desc);
  }

  const extract = (node: unknown): string => {
    if (!node || typeof node !== "object") {
      return "";
    }
    const n = node as Record<string, unknown>;
    if (n.type === "text" && typeof n.text === "string") {
      return n.text;
    }
    if (Array.isArray(n.content)) {
      return (n.content as unknown[]).map(extract).join("");
    }
    return "";
  };

  const doc = desc as Record<string, unknown>;
  if (Array.isArray(doc.content)) {
    return (doc.content as unknown[])
      .map((block) => extract(block))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/** Build JQL for different query types */
export function buildJql(type: "assigned" | "watched" | "mentioned" | "recent", days = 7): string {
  const timeFilter = `updated >= -${days}d`;
  switch (type) {
    case "assigned":
      return `assignee = currentUser() AND resolution = Unresolved AND ${timeFilter} ORDER BY updated DESC`;
    case "watched":
      return `watcher = currentUser() AND resolution = Unresolved AND ${timeFilter} ORDER BY updated DESC`;
    case "mentioned":
      return `text ~ "currentUser()" AND resolution = Unresolved AND ${timeFilter} ORDER BY updated DESC`;
    case "recent":
      return `${timeFilter} AND (assignee = currentUser() OR watcher = currentUser()) ORDER BY updated DESC`;
  }
}

/** Map Jira priority name to WorkItem priority */
export function mapJiraPriority(jiraPriority?: string): WorkItem["priority"] {
  switch (jiraPriority?.toLowerCase()) {
    case "highest":
    case "blocker":
    case "critical":
      return "urgent";
    case "high":
    case "major":
      return "high";
    case "low":
    case "lowest":
    case "trivial":
      return "low";
    default:
      return "normal";
  }
}

/** Map a Jira issue to a WorkItem */
export function mapJiraIssue(issue: JiraIssue, baseUrl: string): WorkItem {
  return {
    id: `jira-${issue.key}`,
    source: "jira",
    type: issue.fields.issuetype.name.toLowerCase() === "task" ? "task" : "issue",
    title: `[${issue.key}] ${issue.fields.summary}`,
    body: extractAdfText(issue.fields.description),
    author: issue.fields.reporter?.displayName ?? "unknown",
    timestamp: new Date(issue.fields.updated),
    priority: mapJiraPriority(issue.fields.priority?.name),
    url: `${baseUrl}/browse/${issue.key}`,
    metadata: {
      key: issue.key,
      status: issue.fields.status.name,
      assignee: issue.fields.assignee?.displayName,
      issueType: issue.fields.issuetype.name,
    },
    status: "new",
  };
}

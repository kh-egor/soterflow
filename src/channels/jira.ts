/**
 * @module channels/jira
 * Jira channel connector — fetches assigned/mentioned issues via REST API.
 */

import { BaseChannel, WorkItem } from "./base";

interface JiraIssue {
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
    [key: string]: any;
  };
}

export class JiraChannel extends BaseChannel {
  name = "jira";
  private baseUrl = "";
  private auth = "";

  /** Connect using JIRA_URL, JIRA_EMAIL, JIRA_TOKEN from environment. */
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
  }

  async disconnect(): Promise<void> {
    this.baseUrl = "";
    this.auth = "";
  }

  private async request(path: string, options?: RequestInit): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Basic ${this.auth}`,
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });
    if (!res.ok) {
      throw new Error(`Jira API error: ${res.status} ${res.statusText}`);
    }
    return res.json();
  }

  /** Fetch assigned issues and recently updated issues mentioning the user. */
  async sync(): Promise<WorkItem[]> {
    const myself = await this.request("/rest/api/3/myself");
    const jql = `assignee = currentUser() OR watcher = currentUser() ORDER BY updated DESC`;
    const data = await this.request(
      `/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=50&fields=summary,description,assignee,reporter,status,priority,updated,created,issuetype`,
    );

    return (data.issues as JiraIssue[]).map(
      (issue): WorkItem => ({
        id: `jira-${issue.key}`,
        source: "jira",
        type: issue.fields.issuetype.name.toLowerCase() === "task" ? "task" : "issue",
        title: `[${issue.key}] ${issue.fields.summary}`,
        body: issue.fields.description ?? "",
        author: issue.fields.reporter?.displayName ?? "unknown",
        timestamp: new Date(issue.fields.updated),
        priority: this.mapPriority(issue.fields.priority?.name),
        url: `${this.baseUrl}/browse/${issue.key}`,
        metadata: {
          key: issue.key,
          status: issue.fields.status.name,
          assignee: issue.fields.assignee?.displayName,
          issueType: issue.fields.issuetype.name,
        },
        status: "new",
      }),
    );
  }

  private mapPriority(jiraPriority?: string): WorkItem["priority"] {
    switch (jiraPriority?.toLowerCase()) {
      case "highest":
      case "blocker":
        return "urgent";
      case "high":
        return "high";
      case "low":
      case "lowest":
        return "low";
      default:
        return "normal";
    }
  }

  /**
   * Perform an action on a Jira issue.
   * Supported actions: transition, comment, assign.
   */
  async performAction(itemId: string, action: string, params?: Record<string, any>): Promise<void> {
    const key = (params?.key as string) ?? itemId.replace("jira-", "");

    switch (action) {
      case "transition":
        await this.request(`/rest/api/3/issue/${key}/transitions`, {
          method: "POST",
          body: JSON.stringify({ transition: { id: params?.transitionId } }),
        });
        break;
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

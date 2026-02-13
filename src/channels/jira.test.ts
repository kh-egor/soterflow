import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mapJiraPriority, mapJiraIssue, buildJql, JiraIssue, JiraChannel } from "./jira";

// --- Priority mapping ---

describe("mapJiraPriority", () => {
  it("maps Highest/Blocker/Critical to urgent", () => {
    expect(mapJiraPriority("Highest")).toBe("urgent");
    expect(mapJiraPriority("Blocker")).toBe("urgent");
    expect(mapJiraPriority("Critical")).toBe("urgent");
  });

  it("maps High/Major to high", () => {
    expect(mapJiraPriority("High")).toBe("high");
    expect(mapJiraPriority("Major")).toBe("high");
  });

  it("maps Low/Lowest/Trivial to low", () => {
    expect(mapJiraPriority("Low")).toBe("low");
    expect(mapJiraPriority("Lowest")).toBe("low");
    expect(mapJiraPriority("Trivial")).toBe("low");
  });

  it("maps Medium and unknown to normal", () => {
    expect(mapJiraPriority("Medium")).toBe("normal");
    expect(mapJiraPriority(undefined)).toBe("normal");
    expect(mapJiraPriority("Something")).toBe("normal");
  });
});

// --- JQL construction ---

describe("buildJql", () => {
  it("builds assigned JQL", () => {
    const jql = buildJql("assigned");
    expect(jql).toContain("assignee = currentUser()");
    expect(jql).toContain("resolution = Unresolved");
  });

  it("builds watched JQL", () => {
    expect(buildJql("watched")).toContain("watcher = currentUser()");
  });

  it("builds mentioned JQL with text search", () => {
    expect(buildJql("mentioned")).toContain("text ~");
  });

  it("builds recent JQL with date filter", () => {
    expect(buildJql("recent")).toContain("updated >= -7d");
  });
});

// --- Issue mapping ---

const fakeIssue: JiraIssue = {
  id: "10001",
  key: "PROJ-42",
  self: "https://jira.example.com/rest/api/3/issue/10001",
  fields: {
    summary: "Fix the widget",
    description: "Widget is broken",
    assignee: { displayName: "Alice", emailAddress: "alice@test.com" },
    reporter: { displayName: "Bob" },
    status: { name: "In Progress" },
    priority: { name: "High" },
    updated: "2026-01-15T10:00:00.000Z",
    created: "2026-01-10T08:00:00.000Z",
    issuetype: { name: "Task" },
  },
};

describe("mapJiraIssue", () => {
  it("maps fields correctly", () => {
    const item = mapJiraIssue(fakeIssue, "https://jira.example.com");
    expect(item.id).toBe("jira-PROJ-42");
    expect(item.source).toBe("jira");
    expect(item.type).toBe("task");
    expect(item.title).toBe("[PROJ-42] Fix the widget");
    expect(item.body).toBe("Widget is broken");
    expect(item.author).toBe("Bob");
    expect(item.priority).toBe("high");
    expect(item.url).toBe("https://jira.example.com/browse/PROJ-42");
    expect(item.metadata.key).toBe("PROJ-42");
    expect(item.metadata.status).toBe("In Progress");
    expect(item.status).toBe("new");
  });

  it("maps Bug type as issue", () => {
    const bug = { ...fakeIssue, fields: { ...fakeIssue.fields, issuetype: { name: "Bug" } } };
    expect(mapJiraIssue(bug, "https://j.com").type).toBe("issue");
  });

  it("handles null description and reporter", () => {
    const minimal = {
      ...fakeIssue,
      fields: { ...fakeIssue.fields, description: null, reporter: null },
    };
    const item = mapJiraIssue(minimal, "https://j.com");
    expect(item.body).toBe("");
    expect(item.author).toBe("unknown");
  });
});

// --- Error handling ---

describe("JiraChannel", () => {
  it("throws on missing env vars", async () => {
    const channel = new JiraChannel();
    delete process.env.JIRA_URL;
    await expect(channel.connect()).rejects.toThrow(
      "JIRA_URL, JIRA_EMAIL, and JIRA_TOKEN must be set",
    );
  });

  it("throws on unsupported action", async () => {
    const channel = new JiraChannel();
    // Access private field via any
    (channel as any).baseUrl = "https://jira.example.com";
    (channel as any).auth = "dGVzdDp0ZXN0";

    await expect(channel.performAction("jira-X-1", "delete")).rejects.toThrow(
      "Unsupported Jira action: delete",
    );
  });
});

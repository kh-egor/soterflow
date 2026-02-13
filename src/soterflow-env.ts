import "dotenv/config";

export const env = {
  GITHUB_TOKEN: process.env.GITHUB_TOKEN ?? "",
  JIRA_URL: process.env.JIRA_URL ?? "",
  JIRA_EMAIL: process.env.JIRA_EMAIL ?? "",
  JIRA_TOKEN: process.env.JIRA_TOKEN ?? "",
  SLACK_TOKEN: process.env.SLACK_TOKEN ?? "",
  SOTERFLOW_DB_PATH: process.env.SOTERFLOW_DB_PATH ?? "./data/soterflow.db",
};

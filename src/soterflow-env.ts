import "dotenv/config";

export const env = {
  GITHUB_TOKEN: process.env.GITHUB_TOKEN ?? "",
  JIRA_URL: process.env.JIRA_URL ?? "",
  JIRA_EMAIL: process.env.JIRA_EMAIL ?? "",
  JIRA_TOKEN: process.env.JIRA_TOKEN ?? "",
  SLACK_TOKEN: process.env.SLACK_TOKEN ?? "",
  SLACK_APP_TOKEN: process.env.SLACK_APP_TOKEN ?? "",
  SOTERFLOW_DB_PATH: process.env.SOTERFLOW_DB_PATH ?? "./data/soterflow.db",
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN ?? "",
  SOTERFLOW_API_PORT: parseInt(process.env.SOTERFLOW_API_PORT ?? "3847", 10),
  SOTERFLOW_SYNC_WINDOW_DAYS: parseInt(process.env.SOTERFLOW_SYNC_WINDOW_DAYS ?? "7", 10),
  GMAIL_USER: process.env.GMAIL_USER ?? "",
  GMAIL_APP_PASSWORD: process.env.GMAIL_APP_PASSWORD ?? "",
  GMAIL_IMAP_HOST: process.env.GMAIL_IMAP_HOST ?? "imap.gmail.com",
  GMAIL_IMAP_PORT: parseInt(process.env.GMAIL_IMAP_PORT ?? "993", 10),
  SOTERFLOW_OWNER_CHAT_ID: process.env.SOTERFLOW_OWNER_CHAT_ID ?? "",
};

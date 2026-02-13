/**
 * Manual integration test for GitHub connector.
 * Run: npx tsx src/channels/github-integration.ts
 * Requires GITHUB_TOKEN in environment or .env file.
 */

import "dotenv/config";
import { GitHubChannel } from "./github";

async function main() {
  const channel = new GitHubChannel();

  console.log("🔗 Connecting to GitHub...");
  await channel.connect();
  console.log("✅ Connected!\n");

  console.log("🔄 Syncing work items...\n");
  const items = await channel.sync();

  if (items.length === 0) {
    console.log("📭 No work items found.");
  } else {
    console.log(`📬 Found ${items.length} work items:\n`);
    for (const item of items) {
      const icon =
        item.type === "pr"
          ? "🔀"
          : item.type === "issue"
            ? "🐛"
            : item.type === "notification"
              ? "🔔"
              : "💬";
      const pri =
        item.priority === "urgent"
          ? "🔴"
          : item.priority === "high"
            ? "🟠"
            : item.priority === "low"
              ? "⚪"
              : "🟡";
      console.log(`  ${icon} ${pri} [${item.type}] ${item.title}`);
      console.log(`     Author: ${item.author} | Priority: ${item.priority}`);
      console.log(`     URL: ${item.url}`);
      console.log();
    }
  }

  // Summary by type
  const byType = items.reduce(
    (acc, i) => {
      acc[i.type] = (acc[i.type] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  console.log("📊 Summary:", byType);

  await channel.disconnect();
  console.log("\n🔌 Disconnected.");
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});

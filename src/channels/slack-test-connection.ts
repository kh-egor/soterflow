import "dotenv/config";
import { WebClient } from "@slack/web-api";

async function test() {
  const client = new WebClient(process.env.SLACK_TOKEN);

  // 1. Auth test
  const auth = await client.auth.test();
  console.log("✅ Authenticated as:", auth.user, `(${auth.user_id})`);
  console.log("   Team:", auth.team);

  // 2. List channels (read-only)
  const channels = await client.conversations.list({
    types: "public_channel,private_channel",
    limit: 10,
  });
  console.log("\n📋 Channels (first 10):");
  for (const ch of channels.channels ?? []) {
    console.log(`   #${ch.name} (${ch.id}) — ${ch.num_members} members`);
  }

  // 3. List DMs
  const ims = await client.conversations.list({ types: "im", limit: 5 });
  console.log(`\n💬 DMs: ${ims.channels?.length ?? 0} conversations`);

  // 4. Recent mentions
  try {
    const mentions = await client.search.messages({
      query: `<@${auth.user_id}>`,
      count: 3,
      sort: "timestamp",
      sort_dir: "desc",
    });
    console.log(`\n🔔 Recent mentions: ${mentions.messages?.total ?? 0} total`);
    for (const m of mentions.messages?.matches?.slice(0, 3) ?? []) {
      console.log(`   "${(m as any).text?.slice(0, 80)}..." in #${(m as any).channel?.name}`);
    }
  } catch (e: any) {
    console.log("\n🔔 Mentions search:", e.data?.error ?? e.message);
  }

  console.log("\n✅ Read-only connection test complete");
}

test().catch((e) => {
  console.error("❌ Failed:", e.data?.error ?? e.message);
  process.exit(1);
});

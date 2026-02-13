import "dotenv/config";
import { SlackChannel } from "./slack.js";

async function main() {
  const timer = setTimeout(() => {
    console.log("TIMEOUT after 30s");
    process.exit(1);
  }, 30000);
  const s = new SlackChannel();
  await s.connect();
  console.log("Slack connected!");
  const items = await s.sync();
  console.log("Slack items:", items.length);
  items.slice(0, 5).forEach((i) => console.log(" ", i.title.slice(0, 70)));
  clearTimeout(timer);
  process.exit(0);
}
main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});

import "dotenv/config";
import { JiraChannel } from "./jira.js";

async function main() {
  const timer = setTimeout(() => {
    console.log("TIMEOUT after 30s");
    process.exit(1);
  }, 30000);
  const j = new JiraChannel();
  await j.connect();
  console.log("Jira connected!");
  const items = await j.sync();
  console.log("Jira items:", items.length);
  items.slice(0, 5).forEach((i) => console.log(" ", i.title.slice(0, 70)));
  clearTimeout(timer);
  process.exit(0);
}
main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});

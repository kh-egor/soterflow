import "dotenv/config";
import { GmailChannel } from "./gmail.js";
async function main() {
  const g = new GmailChannel();
  console.log("configured:", g.isConfigured());
  await g.connect();
  console.log("connected!");
  const items = await g.sync();
  console.log("items:", items.length);
  items.slice(0, 3).forEach((i) => console.log(i.author?.slice(0, 30), "-", i.title?.slice(0, 50)));
  await g.disconnect();
}
main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});

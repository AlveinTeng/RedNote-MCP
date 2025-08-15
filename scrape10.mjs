// scrape10.mjs
import fs from "fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
// import { StdioClientTransport } from "@modelcontextprotocol/sdk/transports/stdio.js"; // 注意：有的版本是 transports/stdio
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const keyword = process.argv[2] || "美食";
const limit = Number(process.argv[3] || 10);

async function main() {
  // ✅ 用源码的 dev 脚本启动（等同你能常驻的那条命令）
  const transport = new StdioClientTransport({
    command: "npm",
    args: ["run", "dev", "--", "--stdio"],
  });

  const client = new Client(
    { name: "rednote-client", version: "1.0.0" },
    { capabilities: {} },
    transport
  );

  await client.connect();

  const res = await client.callTool({
    name: "search_notes", // 工具名以你本地为准，若不对见“第3步”
    arguments: { keywords: keyword, limit },
  });

  const data = res?.content ?? res?.data ?? res ?? [];
  const items = Array.isArray(data) ? data : data.items || data.results || [];

  fs.writeFileSync("results.json", JSON.stringify(items, null, 2), "utf-8");
  console.log(`✅ Saved ${Math.min(items.length, limit)} items to results.json`);

  await client.close();
}

main().catch((e) => {
  console.error("❌ Error:", e);
  process.exit(1);
});
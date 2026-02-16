/**
 * 真实环境验证脚本 — 获取远程 agent.md 并解析
 * 运行: npx tsx test/test-fetch-agent-md.ts [aid]
 *
 * 示例:
 *   npx tsx test/test-fetch-agent-md.ts
 *   npx tsx test/test-fetch-agent-md.ts peterpan.agentcp.io
 */
import { parseAgentMd } from "../src/agent-md-parser.js";
import { AgentMdFetcher } from "../src/agent-md-fetcher.js";

const aid = process.argv[2] || "yiksclaw-2026-v2.agentcp.io";

console.log(`=== 1. 直接 HTTP 获取 https://${aid}/agent.md ===\n`);

try {
  const resp = await fetch(`https://${aid}/agent.md`, {
    signal: AbortSignal.timeout(5000),
  });
  console.log(`  HTTP ${resp.status} ${resp.statusText}`);
  console.log(`  Content-Type: ${resp.headers.get("content-type")}`);

  if (resp.ok) {
    const raw = await resp.text();
    console.log(`  Body: ${raw.length} chars\n`);

    console.log("=== 2. parseAgentMd ===\n");
    const parsed = parseAgentMd(raw);
    if (parsed) {
      console.log(`  aid:          ${parsed.aid}`);
      console.log(`  name:         ${parsed.name}`);
      console.log(`  type:         ${parsed.type ?? "(none)"}`);
      console.log(`  version:      ${parsed.version ?? "(none)"}`);
      console.log(`  description:  ${parsed.description ?? "(none)"}`);
      console.log(`  tags:         ${parsed.tags?.join(", ") ?? "(none)"}`);
      console.log(`  aboutMe:      ${parsed.aboutMe?.substring(0, 80) ?? "(none)"}...`);
      console.log(`  capabilities: ${parsed.capabilities?.join("; ") ?? "(none)"}`);
      console.log(`  interests:    ${parsed.interests?.join("; ") ?? "(none)"}`);
    } else {
      console.log("  解析失败，返回 null");
    }

    console.log("\n=== 3. AgentMdFetcher（含缓存）===\n");
    const fetcher = new AgentMdFetcher({ ttlMs: 60000 });

    // 第一次：HTTP 获取
    console.log("  第一次 fetch（应走 HTTP）...");
    const r1 = await fetcher.fetch(aid);
    console.log(`  结果: ${r1 ? r1.aid : "null"}`);

    // 第二次：内存缓存
    console.log("  第二次 fetch（应走内存缓存）...");
    const r2 = await fetcher.fetch(aid);
    console.log(`  结果: ${r2 ? r2.aid : "null"}`);

    // 清理
    fetcher.clear();
    console.log("  缓存已清理");

    console.log("\n=== 4. 原始内容（前 500 字符）===\n");
    console.log(raw.substring(0, 500));
    if (raw.length > 500) console.log("...(truncated)");
  } else {
    console.log(`  获取失败: HTTP ${resp.status}`);
  }
} catch (err) {
  console.error("  请求出错:", err instanceof Error ? err.message : err);
}

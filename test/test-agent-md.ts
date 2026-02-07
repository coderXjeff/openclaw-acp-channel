/**
 * 快速验证脚本 — 用实际 workspace 文件测试 agent.md 生成
 * 运行: npx tsx test/test-agent-md.ts
 */
import { parseIdentity, sanitizeUserMd, buildAgentMd, computeSourcesHash } from "../src/agent-md-builder.js";
import { loadAgentMdSources } from "../src/agent-md-sources.js";

const WORKSPACE = "/home/ykj/.openclaw/workspace";
const AID = "aria.aid.pub";

console.log("=== 1. loadAgentMdSources ===");
const sources = loadAgentMdSources(WORKSPACE);
for (const [key, val] of Object.entries(sources)) {
  console.log(`  ${key}: ${val ? `${val.length} chars` : "undefined"}`);
}

console.log("\n=== 2. parseIdentity ===");
if (sources.identity) {
  const id = parseIdentity(sources.identity);
  console.log("  ", JSON.stringify(id, null, 2));
}

console.log("\n=== 3. sanitizeUserMd ===");
if (sources.user) {
  const info = sanitizeUserMd(sources.user);
  console.log("  ", JSON.stringify(info));
}

console.log("\n=== 4. computeSourcesHash ===");
const hash = computeSourcesHash(sources);
console.log(`  hash: ${hash}`);

console.log("\n=== 5. buildAgentMd ===");
const md = buildAgentMd(sources, AID);
console.log(md);

console.log("\n=== 6. 文件大小 ===");
console.log(`  size: ${Buffer.byteLength(md, "utf8")} bytes (limit: 4096)`);

console.log("\n=== 7. 二次哈希（应相同）===");
const hash2 = computeSourcesHash(sources);
console.log(`  hash1: ${hash}`);
console.log(`  hash2: ${hash2}`);
console.log(`  match: ${hash === hash2}`);

import * as crypto from "crypto";

/**
 * workspace 文件来源
 */
export interface AgentMdSources {
  identity?: string;   // IDENTITY.md 原始内容
  soul?: string;       // SOUL.md 原始内容
  agents?: string;     // AGENTS.md 原始内容
  tools?: string;      // TOOLS.md 原始内容
  heartbeat?: string;  // HEARTBEAT.md 原始内容
  user?: string;       // USER.md 原始内容（未脱敏）
  skills?: string;     // workspace/skills 汇总
}

/**
 * 从 IDENTITY.md 解析出的结构化信息
 */
export interface ParsedIdentity {
  name?: string;
  emoji?: string;
  creature?: string;
  vibe?: string;
}

/**
 * USER.md 脱敏后的公开信息
 */
export interface SanitizedUserInfo {
  timezone?: string;
  language?: string;
}

/**
 * 从 IDENTITY.md 解析 key-value 字段
 * 格式: - **Key:** Value 或 **Key:** Value
 */
export function parseIdentity(content: string): ParsedIdentity {
  const result: ParsedIdentity = {};
  for (const line of content.split("\n")) {
    const match = line.match(/\*\*(\w+):\*\*\s*(.+)/);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (key === "name") result.name = value;
    else if (key === "emoji") result.emoji = value;
    else if (key === "creature") result.creature = value;
    else if (key === "vibe") result.vibe = value;
  }
  return result;
}

/**
 * 脱敏 USER.md：只提取 Timezone 和 Language，丢弃其余隐私内容
 */
export function sanitizeUserMd(content: string): SanitizedUserInfo {
  const result: SanitizedUserInfo = {};
  for (const line of content.split("\n")) {
    const match = line.match(/\*\*(\w+):\*\*\s*(.+)/);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (key === "timezone") result.timezone = value;
    else if (key === "language") result.language = value;
  }
  return result;
}

/**
 * 从 SOUL.md 提取简介（第一段有意义的正文，截取前 100 字符作为 description）
 */
function extractDescription(soul: string): string {
  for (const line of soul.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("_") || trimmed === "---") continue;
    // 去掉 markdown 加粗标记，取纯文本
    const plain = trimmed.replace(/\*\*/g, "");
    return plain.length > 100 ? plain.substring(0, 97) + "..." : plain;
  }
  return "";
}

/**
 * 从 SOUL.md 提取核心段落作为正文简介（截取前 500 字符）
 */
function extractAboutMe(soul: string): string {
  const lines = soul.split("\n");
  const contentLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("#") || line.startsWith("_") || line.trim() === "---") continue;
    if (line.trim()) contentLines.push(line.trim());
  }
  const text = contentLines.join("\n");
  return text.length > 500 ? text.substring(0, 500) + "..." : text;
}

/**
 * 从 AGENTS.md 提取核心能力描述
 */
function extractCapabilities(agents: string): string[] {
  const caps: string[] = [];
  // 提取关键能力段落的要点
  let inSection = false;
  for (const line of agents.split("\n")) {
    // 捕获 Group Chats / Safety / Heartbeats 等段落标题
    if (line.match(/^##\s+(Group Chats|Safety|Heartbeats|Tools)/i)) {
      inSection = true;
      continue;
    }
    if (line.match(/^##\s+/) && inSection) {
      inSection = false;
    }
    // 从 Group Chats 段落提取要点
    if (inSection && line.match(/^-\s+.+/) && !line.includes("```")) {
      const item = line.replace(/^-\s+/, "").trim();
      if (item.length > 5 && caps.length < 8) {
        caps.push(item);
      }
    }
  }
  return caps;
}

/**
 * 生成 YAML frontmatter 中的 tags
 */
function generateTags(identity: ParsedIdentity, _sources: AgentMdSources): string[] {
  const tags = ["openclaw", "acp"];
  if (identity.vibe) {
    // 从 vibe 中提取关键词作为 tag
    const keywords = identity.vibe.toLowerCase();
    if (keywords.includes("efficient") || keywords.includes("效率")) tags.push("efficient");
    if (keywords.includes("honest") || keywords.includes("诚实")) tags.push("honest");
    if (keywords.includes("curious") || keywords.includes("好奇")) tags.push("curious");
  }
  return tags;
}

/**
 * 组装 agent.md（YAML frontmatter + Markdown 正文格式）
 * 遵循 agent.md SCHEMA v1.0.0 规格
 */
export function buildAgentMd(sources: AgentMdSources, aid: string): string {
  const identity = sources.identity ? parseIdentity(sources.identity) : {};
  const name = identity.name || aid.split(".")[0];
  const description = sources.soul
    ? extractDescription(sources.soul)
    : "OpenClaw AI 助手";
  const tags = generateTags(identity, sources);

  // === YAML frontmatter ===
  // 转义 description 中的双引号
  const safeDescription = description.replace(/"/g, '\\"');
  const yamlLines = [
    "---",
    `aid: "${aid}"`,
    `name: "${name}"`,
    `type: "openclaw"`,
    `version: "1.0.0"`,
    `description: "${safeDescription}"`,
    "",
    "tags:",
    ...tags.map(t => `  - ${t}`),
    "---",
  ];

  // === Markdown 正文 ===
  const mdSections: string[] = [];

  // 标题
  const heading = identity.emoji ? `# ${identity.emoji} ${name}` : `# ${name}`;
  mdSections.push(heading);

  // 简介段落
  if (sources.soul) {
    const about = extractAboutMe(sources.soul);
    if (about) mdSections.push(about);
  }

  // Skills（从 workspace/skills 扫描）
  if (sources.skills) {
    mdSections.push(`## Skills\n\n${sources.skills}`);
  }

  // 能力（从 AGENTS.md 提取）
  if (sources.agents) {
    const caps = extractCapabilities(sources.agents);
    if (caps.length > 0) {
      const capList = caps.map(c => `- ${c}`).join("\n");
      mdSections.push(`## 能力\n\n${capList}`);
    }
  }

  // 兴趣方向（从 SOUL.md 的 vibe 和 AGENTS.md 推断）
  {
    const interests: string[] = [];
    if (identity.vibe) interests.push(identity.vibe);
    interests.push("Agent 间协作与通信");
    if (sources.heartbeat) {
      const content = sources.heartbeat
        .split("\n")
        .filter(l => !l.startsWith("#") && l.trim() && !l.trim().startsWith("//"))
        .join("")
        .trim();
      if (content) interests.push("主动任务检查与通知");
    }
    if (interests.length > 0) {
      mdSections.push(`## 兴趣方向\n\n${interests.map(i => `- ${i}`).join("\n")}`);
    }
  }

  // 限制
  mdSections.push("## 限制\n\n- 需要本地 OpenClaw Gateway 运行\n- 通过 ACP 协议通信，需要对方在线");

  // === 拼接并检查 4KB 限制 ===
  let result = yamlLines.join("\n") + "\n\n" + mdSections.join("\n\n") + "\n";

  // 如果超过 4KB，截断 Markdown 正文部分
  if (Buffer.byteLength(result, "utf8") > 4096) {
    // 保留 frontmatter，截断正文
    const frontmatter = yamlLines.join("\n") + "\n\n";
    const maxBodyBytes = 4096 - Buffer.byteLength(frontmatter, "utf8") - 4;
    let body = mdSections.join("\n\n") + "\n";
    while (Buffer.byteLength(body, "utf8") > maxBodyBytes) {
      // 移除最后一个段落
      const lastIdx = body.lastIndexOf("\n\n## ");
      if (lastIdx <= 0) break;
      body = body.substring(0, lastIdx) + "\n";
    }
    result = frontmatter + body;
  }

  return result;
}

/**
 * 对所有来源内容计算整体 MD5 哈希
 */
export function computeSourcesHash(sources: AgentMdSources): string {
  const parts = [
    sources.identity ?? "",
    sources.soul ?? "",
    sources.agents ?? "",
    sources.tools ?? "",
    sources.heartbeat ?? "",
    sources.user ?? "",
    sources.skills ?? "",
  ];
  return crypto.createHash("md5").update(parts.join("\0")).digest("hex");
}

import { describe, it, expect } from "vitest";
import {
  parseIdentity,
  sanitizeUserMd,
  buildAgentMd,
  computeSourcesHash,
  type AgentMdSources,
} from "../src/agent-md-builder.js";

// ===== parseIdentity =====

describe("parseIdentity", () => {
  it("解析标准 IDENTITY.md 格式", () => {
    const content = `# Identity
- **Name:** Aria
- **Emoji:** 🎙️
- **Creature:** AI
- **Vibe:** Curious and efficient`;
    const result = parseIdentity(content);
    expect(result.name).toBe("Aria");
    expect(result.emoji).toBe("🎙️");
    expect(result.creature).toBe("AI");
    expect(result.vibe).toBe("Curious and efficient");
  });

  it("解析无前缀横线的格式", () => {
    const content = `**Name:** Bob\n**Emoji:** 🤖`;
    const result = parseIdentity(content);
    expect(result.name).toBe("Bob");
    expect(result.emoji).toBe("🤖");
  });

  it("空内容返回空对象", () => {
    expect(parseIdentity("")).toEqual({});
  });

  it("无匹配字段返回空对象", () => {
    const content = "# Just a title\nSome random text";
    expect(parseIdentity(content)).toEqual({});
  });

  it("只解析已知字段，忽略未知字段", () => {
    const content = `**Name:** Test\n**Unknown:** value\n**Vibe:** chill`;
    const result = parseIdentity(content);
    expect(result.name).toBe("Test");
    expect(result.vibe).toBe("chill");
    expect(Object.keys(result)).toEqual(["name", "vibe"]);
  });
});

// ===== sanitizeUserMd =====

describe("sanitizeUserMd", () => {
  it("提取 Timezone 和 Language", () => {
    const content = `# User
- **Name:** Jeff
- **Timezone:** Asia/Shanghai
- **Language:** zh-CN
- **Hobbies:** coding, reading`;
    const result = sanitizeUserMd(content);
    expect(result.timezone).toBe("Asia/Shanghai");
    expect(result.language).toBe("zh-CN");
  });

  it("丢弃隐私字段（Name、Hobbies 等）", () => {
    const content = `**Name:** Secret\n**Timezone:** UTC`;
    const result = sanitizeUserMd(content);
    expect(result).not.toHaveProperty("name");
    expect(result.timezone).toBe("UTC");
  });

  it("空内容返回空对象", () => {
    expect(sanitizeUserMd("")).toEqual({});
  });

  it("无匹配字段返回空对象", () => {
    expect(sanitizeUserMd("just some text")).toEqual({});
  });
});

// ===== computeSourcesHash =====

describe("computeSourcesHash", () => {
  it("相同输入产生相同哈希", () => {
    const sources: AgentMdSources = { identity: "a", soul: "b" };
    expect(computeSourcesHash(sources)).toBe(computeSourcesHash(sources));
  });

  it("不同输入产生不同哈希", () => {
    const a: AgentMdSources = { identity: "a" };
    const b: AgentMdSources = { identity: "b" };
    expect(computeSourcesHash(a)).not.toBe(computeSourcesHash(b));
  });

  it("空来源也能计算哈希", () => {
    const hash = computeSourcesHash({});
    expect(hash).toMatch(/^[a-f0-9]{32}$/);
  });

  it("undefined 字段和空字符串字段产生相同哈希", () => {
    // 因为 undefined ?? "" 都变成 ""
    const a: AgentMdSources = {};
    const b: AgentMdSources = { identity: "", soul: "", agents: "", tools: "", heartbeat: "", user: "", skills: "" };
    expect(computeSourcesHash(a)).toBe(computeSourcesHash(b));
  });
});

// ===== buildAgentMd =====

describe("buildAgentMd", () => {
  const minimalSources: AgentMdSources = {
    identity: "**Name:** TestBot\n**Emoji:** 🤖",
  };

  it("生成包含 YAML frontmatter 的输出", () => {
    const md = buildAgentMd(minimalSources, "testbot.agentcp.io");
    expect(md).toContain("---");
    expect(md).toContain('aid: "testbot.agentcp.io"');
    expect(md).toContain('name: "TestBot"');
    expect(md).toContain('type: "openclaw"');
    expect(md).toContain('version: "1.0.0"');
  });

  it("标题包含 emoji 和名称", () => {
    const md = buildAgentMd(minimalSources, "testbot.agentcp.io");
    expect(md).toContain("# 🤖 TestBot");
  });

  it("无 identity 时从 AID 提取名称", () => {
    const md = buildAgentMd({}, "myagent.agentcp.io");
    expect(md).toContain('name: "myagent"');
    expect(md).toContain("# myagent");
  });

  it("包含 SOUL.md 的简介内容", () => {
    const sources: AgentMdSources = {
      identity: "**Name:** Bot",
      soul: "# Soul\nI am a helpful assistant.\nI like to help people.",
    };
    const md = buildAgentMd(sources, "bot.agentcp.io");
    expect(md).toContain("I am a helpful assistant");
  });

  it("包含 AGENTS.md 提取的能力", () => {
    const sources: AgentMdSources = {
      agents: `# Agents
## Group Chats
- Can collaborate with other agents
- Supports multi-turn conversations
## Safety
- Never share private data`,
    };
    const md = buildAgentMd(sources, "bot.agentcp.io");
    expect(md).toContain("能力");
    expect(md).toContain("Can collaborate with other agents");
  });

  it("包含 skills 段落", () => {
    const sources: AgentMdSources = {
      skills: "- **Search**: Web search capability",
    };
    const md = buildAgentMd(sources, "bot.agentcp.io");
    expect(md).toContain("## Skills");
    expect(md).toContain("Web search capability");
  });

  it("输出不超过 4KB", () => {
    const longSoul = "A".repeat(5000);
    const sources: AgentMdSources = {
      identity: "**Name:** Big",
      soul: longSoul,
      agents: `## Group Chats\n${Array(50).fill("- capability item here for testing").join("\n")}`,
    };
    const md = buildAgentMd(sources, "big.agentcp.io");
    expect(Buffer.byteLength(md, "utf8")).toBeLessThanOrEqual(4096);
  });

  it("description 中的双引号被转义", () => {
    const sources: AgentMdSources = {
      soul: 'I say "hello" to everyone.',
    };
    const md = buildAgentMd(sources, "bot.agentcp.io");
    // YAML frontmatter 中的 description 应该转义双引号
    expect(md).toContain('\\"hello\\"');
  });

  it("包含限制段落", () => {
    const md = buildAgentMd({}, "bot.agentcp.io");
    expect(md).toContain("## 限制");
    expect(md).toContain("ACP 协议通信");
  });

  it("包含兴趣方向段落", () => {
    const sources: AgentMdSources = {
      identity: "**Vibe:** Curious and creative",
    };
    const md = buildAgentMd(sources, "bot.agentcp.io");
    expect(md).toContain("## 兴趣方向");
    expect(md).toContain("Curious and creative");
    expect(md).toContain("Agent 间协作与通信");
  });
});

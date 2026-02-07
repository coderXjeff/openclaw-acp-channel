import { describe, it, expect } from "vitest";
import { parseAgentMd } from "../src/agent-md-parser.js";

describe("parseAgentMd", () => {
  const standardMd = `---
aid: "aria.aid.pub"
name: "Aria"
type: "openclaw"
version: "1.0.0"
description: "A helpful AI assistant"

tags:
  - openclaw
  - acp
  - curious
---

# 🎙️ Aria

I am a helpful AI assistant who loves to chat.

## 能力

- Can collaborate with other agents
- Supports multi-turn conversations

## 兴趣方向

- Agent 间协作与通信
- Curious and creative
`;

  it("解析标准 YAML frontmatter + Markdown", () => {
    const result = parseAgentMd(standardMd);
    expect(result).not.toBeNull();
    expect(result!.aid).toBe("aria.aid.pub");
    expect(result!.name).toBe("Aria");
    expect(result!.type).toBe("openclaw");
    expect(result!.version).toBe("1.0.0");
    expect(result!.description).toBe("A helpful AI assistant");
    expect(result!.raw).toBe(standardMd);
    expect(result!.fetchedAt).toBeGreaterThan(0);
  });

  it("解析 tags 列表", () => {
    const result = parseAgentMd(standardMd);
    expect(result).not.toBeNull();
    expect(result!.tags).toEqual(["openclaw", "acp", "curious"]);
  });

  it("提取能力列表", () => {
    const result = parseAgentMd(standardMd);
    expect(result).not.toBeNull();
    expect(result!.capabilities).toEqual([
      "Can collaborate with other agents",
      "Supports multi-turn conversations",
    ]);
  });

  it("提取兴趣方向列表", () => {
    const result = parseAgentMd(standardMd);
    expect(result).not.toBeNull();
    expect(result!.interests).toEqual([
      "Agent 间协作与通信",
      "Curious and creative",
    ]);
  });

  it("提取简介段落", () => {
    const result = parseAgentMd(standardMd);
    expect(result).not.toBeNull();
    expect(result!.aboutMe).toContain("I am a helpful AI assistant");
  });

  it("解析只有 frontmatter 无正文", () => {
    const md = `---
aid: "test.aid.pub"
name: "Test"
---
`;
    const result = parseAgentMd(md);
    expect(result).not.toBeNull();
    expect(result!.aid).toBe("test.aid.pub");
    expect(result!.name).toBe("Test");
    expect(result!.capabilities).toBeUndefined();
    expect(result!.aboutMe).toBeUndefined();
  });

  it("解析只有正文无 frontmatter", () => {
    const md = `# Bot

I am a bot.

## 能力

- Chat with users
`;
    const result = parseAgentMd(md);
    expect(result).not.toBeNull();
    expect(result!.aid).toBe("");
    expect(result!.aboutMe).toContain("I am a bot");
    expect(result!.capabilities).toEqual(["Chat with users"]);
  });

  it("解析空内容返回 null", () => {
    expect(parseAgentMd("")).toBeNull();
    expect(parseAgentMd("   ")).toBeNull();
  });

  it("使用自定义 fetchedAt 时间戳", () => {
    const ts = 1700000000000;
    const result = parseAgentMd(standardMd, ts);
    expect(result).not.toBeNull();
    expect(result!.fetchedAt).toBe(ts);
  });

  it("frontmatter 中带引号的值正确去引号", () => {
    const md = `---
aid: 'single.aid.pub'
name: "Double"
---
`;
    const result = parseAgentMd(md);
    expect(result).not.toBeNull();
    expect(result!.aid).toBe("single.aid.pub");
    expect(result!.name).toBe("Double");
  });
});

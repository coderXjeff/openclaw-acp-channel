import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadAgentMdSources } from "../src/agent-md-sources.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadAgentMdSources", () => {
  it("读取所有 6 个来源文件", () => {
    fs.writeFileSync(path.join(tmpDir, "IDENTITY.md"), "**Name:** Test");
    fs.writeFileSync(path.join(tmpDir, "SOUL.md"), "I am a soul");
    fs.writeFileSync(path.join(tmpDir, "AGENTS.md"), "# Agents");
    fs.writeFileSync(path.join(tmpDir, "TOOLS.md"), "# Tools");
    fs.writeFileSync(path.join(tmpDir, "HEARTBEAT.md"), "# Heartbeat");
    fs.writeFileSync(path.join(tmpDir, "USER.md"), "**Timezone:** UTC");

    const sources = loadAgentMdSources(tmpDir);
    expect(sources.identity).toBe("**Name:** Test");
    expect(sources.soul).toBe("I am a soul");
    expect(sources.agents).toBe("# Agents");
    expect(sources.tools).toBe("# Tools");
    expect(sources.heartbeat).toBe("# Heartbeat");
    expect(sources.user).toBe("**Timezone:** UTC");
  });

  it("文件不存在时返回 undefined", () => {
    const sources = loadAgentMdSources(tmpDir);
    expect(sources.identity).toBeUndefined();
    expect(sources.soul).toBeUndefined();
    expect(sources.agents).toBeUndefined();
    expect(sources.tools).toBeUndefined();
    expect(sources.heartbeat).toBeUndefined();
    expect(sources.user).toBeUndefined();
    expect(sources.skills).toBeUndefined();
  });
  it("部分文件存在时只返回存在的", () => {
    fs.writeFileSync(path.join(tmpDir, "IDENTITY.md"), "**Name:** Partial");
    const sources = loadAgentMdSources(tmpDir);
    expect(sources.identity).toBe("**Name:** Partial");
    expect(sources.soul).toBeUndefined();
  });

  it("扫描 skills 目录中的 SKILL.md", () => {
    const skillDir = path.join(tmpDir, "skills", "search");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "# Web Search\nSearch the web for information"
    );

    const sources = loadAgentMdSources(tmpDir);
    expect(sources.skills).toContain("Web Search");
    expect(sources.skills).toContain("Search the web for information");
  });

  it("skills 目录不存在时返回 undefined", () => {
    const sources = loadAgentMdSources(tmpDir);
    expect(sources.skills).toBeUndefined();
  });

  it("skills 目录为空时返回 undefined", () => {
    fs.mkdirSync(path.join(tmpDir, "skills"));
    const sources = loadAgentMdSources(tmpDir);
    expect(sources.skills).toBeUndefined();
  });

  it("skills 子目录无 SKILL.md 时跳过", () => {
    const skillDir = path.join(tmpDir, "skills", "empty-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "README.md"), "not a skill file");

    const sources = loadAgentMdSources(tmpDir);
    expect(sources.skills).toBeUndefined();
  });

  it("多个 skills 都被扫描", () => {
    const skill1 = path.join(tmpDir, "skills", "search");
    const skill2 = path.join(tmpDir, "skills", "calc");
    fs.mkdirSync(skill1, { recursive: true });
    fs.mkdirSync(skill2, { recursive: true });
    fs.writeFileSync(path.join(skill1, "SKILL.md"), "# Search\nFind things");
    fs.writeFileSync(path.join(skill2, "SKILL.md"), "# Calculator\nDo math");

    const sources = loadAgentMdSources(tmpDir);
    expect(sources.skills).toContain("Search");
    expect(sources.skills).toContain("Calculator");
  });
});

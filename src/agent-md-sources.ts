import * as fs from "fs";
import * as path from "path";
import type { AgentMdSources } from "./agent-md-builder.js";

/**
 * 从 workspace 目录读取所有来源文件
 * 如果提供 identityId，优先从 identities/{identityId}/ 目录读取，fallback 到 workspace 根目录
 */
export function loadAgentMdSources(workspaceDir: string, identityId?: string): AgentMdSources {
  const identityDir = identityId ? path.join(workspaceDir, "identities", identityId) : null;

  const read = (name: string): string | undefined => {
    // 优先从 per-identity 目录读取
    if (identityDir) {
      const ip = path.join(identityDir, name);
      try {
        if (fs.existsSync(ip)) return fs.readFileSync(ip, "utf8");
      } catch {}
    }
    // fallback 到 workspace 根目录
    const p = path.join(workspaceDir, name);
    try {
      if (!fs.existsSync(p)) return undefined;
      return fs.readFileSync(p, "utf8");
    } catch {
      return undefined;
    }
  };

  return {
    identity: read("IDENTITY.md"),
    soul: read("SOUL.md"),
    agents: read("AGENTS.md"),
    tools: read("TOOLS.md"),
    heartbeat: read("HEARTBEAT.md"),
    user: read("USER.md"),
    skills: loadSkillSummaries(workspaceDir, identityId),
  };
}

/**
 * 扫描 workspace/skills/ 目录，读取每个子目录的 SKILL.md
 * 提取技能名称和描述
 */
function loadSkillSummaries(workspaceDir: string, identityId?: string): string | undefined {
  // 优先从 per-identity skills 目录读取
  if (identityId) {
    const identitySkillsDir = path.join(workspaceDir, "identities", identityId, "skills");
    try {
      if (fs.existsSync(identitySkillsDir) && fs.statSync(identitySkillsDir).isDirectory()) {
        const result = loadSkillsFromDir(identitySkillsDir);
        if (result) return result;
      }
    } catch {}
  }
  return loadSkillsFromDir(path.join(workspaceDir, "skills"));
}

function loadSkillsFromDir(skillsDir: string): string | undefined {
  try {
    if (!fs.existsSync(skillsDir) || !fs.statSync(skillsDir).isDirectory()) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  const summaries: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillMdPath = path.join(skillsDir, entry.name, "SKILL.md");
    try {
      if (!fs.existsSync(skillMdPath)) continue;
      const content = fs.readFileSync(skillMdPath, "utf8");
      const name = extractSkillName(content, entry.name);
      const desc = extractSkillDescription(content);
      summaries.push(desc ? `- **${name}**: ${desc}` : `- **${name}**`);
    } catch {
      // skip unreadable skill files
    }
  }

  return summaries.length > 0 ? summaries.join("\n") : undefined;
}

/**
 * 从 SKILL.md 提取技能名称（优先从 frontmatter 或标题，回退到目录名）
 */
function extractSkillName(content: string, dirName: string): string {
  // 尝试从 # 标题提取
  const h1 = content.match(/^#\s+(.+)/m);
  if (h1) return h1[1].trim();
  // 尝试从 frontmatter name 字段提取
  const fm = content.match(/^name:\s*(.+)/m);
  if (fm) return fm[1].trim();
  return dirName;
}

/**
 * 从 SKILL.md 提取描述（第一段非标题非空行）
 */
function extractSkillDescription(content: string): string {
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("---")) continue;
    // 截取前 100 字符
    return trimmed.length > 100 ? trimmed.substring(0, 100) + "..." : trimmed;
  }
  return "";
}

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
    // symlink 指向目录也要扫描（如共享 skill）
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const skillMdPath = path.join(skillsDir, entry.name, "SKILL.md");
    try {
      if (!fs.existsSync(skillMdPath)) continue;
      const content = fs.readFileSync(skillMdPath, "utf8");
      const name = extractSkillName(content, entry.name);
      const desc = extractSkillDescription(content);
      const usage = extractSkillUsage(content);
      let summary = desc ? `- **${name}**: ${desc}` : `- **${name}**`;
      if (usage) summary += `\n${usage}`;
      summaries.push(summary);
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
  // 优先从 frontmatter description 字段提取
  const fmMatch = content.match(/^---\n[\s\S]*?^description:\s*(.+)/m);
  if (fmMatch) {
    const desc = fmMatch[1].trim();
    return desc.length > 100 ? desc.substring(0, 100) + "..." : desc;
  }
  // fallback: 跳过 frontmatter，取第一段正文
  let inFrontmatter = false;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "---") { inFrontmatter = !inFrontmatter; continue; }
    if (inFrontmatter) continue;
    if (!trimmed || trimmed.startsWith("#")) continue;
    return trimmed.length > 100 ? trimmed.substring(0, 100) + "..." : trimmed;
  }
  return "";
}

/**
 * 从 SKILL.md 提取关键命令用法
 * 扫描 bash 代码块中的注释行（# 开头），作为功能要点
 */
function extractSkillUsage(content: string): string {
  const lines = content.split("\n");
  const features: string[] = [];
  let inBash = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.match(/^```bash/)) { inBash = true; continue; }
    if (trimmed === "```") { inBash = false; continue; }
    if (inBash && trimmed.startsWith("# ")) {
      const feature = trimmed.replace(/^#\s+/, "");
      if (feature.length > 1 && features.length < 6) {
        features.push(`  - ${feature}`);
      }
    }
  }

  return features.length > 0 ? features.join("\n") : "";
}

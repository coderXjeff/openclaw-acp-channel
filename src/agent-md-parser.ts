import type { ParsedAgentMd } from "./types.js";

/**
 * 解析远程 agent.md（YAML frontmatter + Markdown 正文）
 * 不引入外部 YAML 库，手写简单解析
 */
export function parseAgentMd(raw: string, fetchedAt?: number): ParsedAgentMd | null {
  if (!raw || !raw.trim()) return null;

  const ts = fetchedAt ?? Date.now();

  // 提取 YAML frontmatter
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
  const frontmatter = fmMatch ? parseFrontmatter(fmMatch[1]) : null;

  // 提取 Markdown 正文（frontmatter 之后的部分）
  const body = fmMatch ? raw.slice(fmMatch[0].length).trim() : raw.trim();

  // 至少需要 frontmatter 中有 aid，或者正文非空
  const aid = frontmatter?.aid;
  const name = frontmatter?.name;
  if (!aid && !body) return null;

  // 从正文提取段落
  const sections = parseSections(body);

  return {
    aid: aid ?? "",
    name: name ?? "",
    type: frontmatter?.type,
    version: frontmatter?.version,
    description: frontmatter?.description,
    tags: frontmatter?.tags,
    aboutMe: sections.aboutMe,
    capabilities: sections.capabilities,
    interests: sections.interests,
    raw,
    fetchedAt: ts,
  };
}

interface FrontmatterData {
  aid?: string;
  name?: string;
  type?: string;
  version?: string;
  description?: string;
  tags?: string[];
}

/**
 * 解析 YAML frontmatter 键值对
 */
function parseFrontmatter(yaml: string): FrontmatterData {
  const data: FrontmatterData = {};
  const lines = yaml.split("\n");
  let currentKey: string | null = null;
  let tags: string[] = [];
  let collectingTags = false;

  for (const line of lines) {
    // 检查是否是 tags 列表项: "  - xxx"
    const listMatch = line.match(/^\s+-\s+(.+)/);
    if (listMatch && collectingTags) {
      tags.push(listMatch[1].trim());
      continue;
    }

    // 检查是否是 key: value 行
    const kvMatch = line.match(/^(\w+):\s*(.*)/);
    if (kvMatch) {
      const key = kvMatch[1];
      const value = kvMatch[2].trim();

      // 结束之前的 tags 收集
      if (collectingTags && key !== "tags") {
        collectingTags = false;
      }

      currentKey = key;

      if (key === "tags") {
        collectingTags = true;
        tags = [];
        continue;
      }

      // 去掉引号
      const unquoted = value.replace(/^["']|["']$/g, "");

      switch (key) {
        case "aid": data.aid = unquoted; break;
        case "name": data.name = unquoted; break;
        case "type": data.type = unquoted; break;
        case "version": data.version = unquoted; break;
        case "description": data.description = unquoted; break;
      }
    } else {
      // 非 key-value 行，如果不是 tags 列表项则停止收集
      if (!listMatch) {
        collectingTags = false;
      }
    }
  }

  if (tags.length > 0) {
    data.tags = tags;
  }

  return data;
}

interface ParsedSections {
  aboutMe?: string;
  capabilities?: string[];
  interests?: string[];
}

/**
 * 按 ## 标题分段解析 Markdown 正文
 */
function parseSections(body: string): ParsedSections {
  if (!body) return {};

  const result: ParsedSections = {};
  const sections = splitSections(body);

  // 提取简介：标题行之后、第一个 ## 之前的正文
  if (sections.intro) {
    result.aboutMe = sections.intro;
  }

  // 提取能力列表
  for (const [heading, content] of sections.named) {
    const h = heading.toLowerCase();
    if (h.includes("能力") || h.includes("capabilities") || h.includes("skills")) {
      result.capabilities = extractListItems(content);
    } else if (h.includes("兴趣") || h.includes("interests")) {
      result.interests = extractListItems(content);
    }
  }

  return result;
}

/**
 * 将正文按 ## 分段
 */
function splitSections(body: string): { intro: string; named: [string, string][] } {
  const lines = body.split("\n");
  let intro = "";
  const named: [string, string][] = [];
  let currentHeading: string | null = null;
  let currentContent: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)/);
    if (headingMatch) {
      // 保存之前的段落
      if (currentHeading !== null) {
        named.push([currentHeading, currentContent.join("\n").trim()]);
      }
      currentHeading = headingMatch[1].trim();
      currentContent = [];
    } else if (currentHeading !== null) {
      currentContent.push(line);
    } else {
      // 标题行（# xxx）之后、第一个 ## 之前的内容
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        intro += (intro ? "\n" : "") + trimmed;
      }
    }
  }

  // 保存最后一个段落
  if (currentHeading !== null) {
    named.push([currentHeading, currentContent.join("\n").trim()]);
  }

  return { intro, named };
}

/**
 * 从段落内容中提取列表项
 */
function extractListItems(content: string): string[] {
  const items: string[] = [];
  for (const line of content.split("\n")) {
    const match = line.match(/^-\s+(.+)/);
    if (match) {
      items.push(match[1].trim());
    }
  }
  return items;
}

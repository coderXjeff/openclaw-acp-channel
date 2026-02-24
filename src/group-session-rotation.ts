/**
 * 群聊会话自动轮转
 * 当群消息累计达到阈值时，自动轮转到新会话，
 * 并将旧会话的 compaction 摘要 + 最后 N 条消息作为上下文注入新会话。
 */
import * as fs from "fs";
import * as path from "path";

const ACP_STORAGE_DIR = path.join(process.env.HOME || "~", ".acp-storage");
const CARRYOVER_RECENT_COUNT = 10;
const TAIL_READ_BYTES = 64 * 1024; // 从 JSONL 尾部读取 64KB

interface GroupRotationEntry {
  sessionSeq: number;
  cumulativeMsgCount: number;
}

type GroupRotationState = Record<string, GroupRotationEntry>;

// ===== 轮转判断 =====

export function shouldRotateGroupSession(
  cumulativeMsgCount: number,
  limit: number | undefined,
): boolean {
  const threshold = (typeof limit === "number" && limit > 0) ? limit : 200;
  return cumulativeMsgCount >= threshold;
}

// ===== 持久化 =====

function rotationStatePath(aid: string): string {
  return path.join(ACP_STORAGE_DIR, "AIDs", aid, "group-session-state.json");
}

export function loadGroupRotationState(aid: string): GroupRotationState {
  try {
    const fp = rotationStatePath(aid);
    if (fs.existsSync(fp)) {
      return JSON.parse(fs.readFileSync(fp, "utf8"));
    }
  } catch {}
  return {};
}

export function saveGroupRotationState(aid: string, state: GroupRotationState): void {
  try {
    const fp = rotationStatePath(aid);
    const dir = path.dirname(fp);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(state, null, 2), "utf8");
  } catch (err) {
    console.error(`[ACP] saveGroupRotationState error:`, err);
  }
}

// ===== Carryover 上下文读取 =====

interface CarryoverParams {
  storePath: string;
  sessionKey: string;
  agentId: string;
}

/**
 * 从龙虾 session store 读取旧会话的 carryover 上下文。
 * 返回格式化的上下文字符串，或 null（读取失败/无内容）。
 */
export function readCarryoverContext(params: CarryoverParams): string | null {
  try {
    const { storePath, sessionKey } = params;

    // 1. 读取 sessions.json 找到对应 sessionKey 的 entry
    const sessionsJsonPath = path.join(storePath, "sessions.json");
    if (!fs.existsSync(sessionsJsonPath)) return null;

    const sessionsData = JSON.parse(fs.readFileSync(sessionsJsonPath, "utf8"));
    const entry = sessionsData[sessionKey];
    if (!entry) return null;

    // 2. 定位 JSONL 文件
    let jsonlPath: string | null = null;
    if (entry.sessionFile) {
      jsonlPath = path.isAbsolute(entry.sessionFile)
        ? entry.sessionFile
        : path.join(storePath, entry.sessionFile);
    } else if (entry.id) {
      // 常见命名: {storePath}/{id}.jsonl
      jsonlPath = path.join(storePath, `${entry.id}.jsonl`);
    }
    if (!jsonlPath || !fs.existsSync(jsonlPath)) return null;

    // 3. 从 JSONL 尾部读取
    const lines = readJsonlTail(jsonlPath);
    if (lines.length === 0) return null;

    // 4. 解析消息，找 compaction 摘要和最近消息
    const { summary, recentMessages } = extractCarryoverFromLines(lines);

    return buildCarryoverPrompt(summary, recentMessages);
  } catch (err) {
    console.error(`[ACP] readCarryoverContext error:`, err);
    return null;
  }
}

/**
 * 从 JSONL 文件尾部读取最后 TAIL_READ_BYTES 字节，解析为 JSON 行。
 */
function readJsonlTail(filePath: string): any[] {
  try {
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    if (fileSize === 0) return [];

    const readSize = Math.min(fileSize, TAIL_READ_BYTES);
    const fd = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(readSize);
    fs.readSync(fd, buffer, 0, readSize, fileSize - readSize);
    fs.closeSync(fd);

    const text = buffer.toString("utf8");
    const rawLines = text.split("\n").filter(l => l.trim());

    // 如果从文件中间开始读，第一行可能不完整，跳过
    const startIdx = (fileSize > readSize) ? 1 : 0;
    const lines: any[] = [];
    for (let i = startIdx; i < rawLines.length; i++) {
      try {
        lines.push(JSON.parse(rawLines[i]));
      } catch {}
    }
    return lines;
  } catch {
    return [];
  }
}

interface ParsedMessage {
  role: string;
  content: string;
}

/**
 * 从解析后的 JSONL 行中提取 compaction 摘要和最近消息。
 */
function extractCarryoverFromLines(lines: any[]): {
  summary: string | null;
  recentMessages: ParsedMessage[];
} {
  // 收集所有 user/assistant 消息
  const messages: ParsedMessage[] = [];
  let lastCompactionIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 跳过 session header
    if (line.type === "session") continue;

    const msg = line.message ?? line;
    const role = msg.role ?? "";
    const content = extractTextContent(msg.content);

    if (!role || !content) continue;

    // 检测 compaction 摘要
    if (isCompactionMessage(line, msg, role, content)) {
      lastCompactionIdx = messages.length;
    }

    messages.push({ role, content });
  }

  let summary: string | null = null;
  let recentStart = Math.max(0, messages.length - CARRYOVER_RECENT_COUNT);

  if (lastCompactionIdx >= 0) {
    summary = messages[lastCompactionIdx].content;
    // 取 compaction 之后的最后 N 条 user/assistant 消息
    const afterCompaction = messages.slice(lastCompactionIdx + 1);
    const recent = afterCompaction.slice(-CARRYOVER_RECENT_COUNT);
    return { summary, recentMessages: recent };
  }

  // 没有 compaction，只取最后 N 条
  return {
    summary: null,
    recentMessages: messages.slice(recentStart),
  };
}

/**
 * 判断是否为 compaction 摘要消息。
 */
function isCompactionMessage(line: any, msg: any, role: string, content: string): boolean {
  // 显式 type 标记
  if (line.type === "compaction" || msg.type === "compaction") return true;

  // role=system 且内容包含 summary 特征词
  if (role === "system" && (
    content.includes("summary of the conversation") ||
    content.includes("conversation summary") ||
    content.includes("Here is a summary")
  )) return true;

  // 龙虾 compaction 通常在 assistant 消息中，带有特定前缀
  if (role === "assistant" && content.startsWith("<summary>")) return true;

  return false;
}

/**
 * 从消息 content 中提取纯文本。
 * content 可能是 string 或 array of content blocks。
 */
function extractTextContent(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === "text" && b.text)
      .map((b: any) => b.text)
      .join("\n");
  }
  return "";
}

// ===== Carryover Prompt 构建 =====

export function buildCarryoverPrompt(
  summary: string | null,
  recentMessages: ParsedMessage[],
): string | null {
  if (!summary && recentMessages.length === 0) return null;

  const parts: string[] = ["[Session Continuation]"];

  if (summary) {
    parts.push(`[Previous conversation summary]:\n${summary}`);
  }

  if (recentMessages.length > 0) {
    const formatted = recentMessages
      .map(m => `[${m.role}]: ${m.content}`)
      .join("\n\n");
    parts.push(`[Recent messages from previous session]:\n${formatted}`);
  }

  return parts.join("\n\n");
}

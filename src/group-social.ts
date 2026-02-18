/**
 * P1 群活力状态机与上下文注入 — 纯函数模块
 * 无副作用，方便测试。
 */
import type {
  AcpChannelConfig,
  ResolvedAcpAccount,
  VitalityWindow,
  GroupVitalityState,
  VitalityState,
  MentionInfo,
} from "./types.js";

/**
 * 构建提及关键词列表
 */
export function buildMentionKeywords(
  account: ResolvedAcpAccount,
  acpConfig: AcpChannelConfig,
  extraAliases: string[] = []
): string[] {
  const raw: string[] = [];

  // 1. agentName
  if (account.agentName) raw.push(account.agentName);

  // 2. aid 前缀（"." 前部分）
  const dotIdx = account.fullAid.indexOf(".");
  if (dotIdx > 0) {
    const prefix = account.fullAid.substring(0, dotIdx);
    raw.push(prefix);
  }

  // 3. 完整 fullAid
  raw.push(account.fullAid);

  // 4. mentionAliases（identity 级优先，否则 global）
  const identityEntry = acpConfig.identities?.[account.identityId];
  const aliases = identityEntry?.mentionAliases ?? acpConfig.groupSocial?.mentionAliases ?? [];
  raw.push(...aliases);
  raw.push(...extraAliases);

  // 5. 过滤长度 < 2，toLowerCase 去重
  const seen = new Set<string>();
  const result: string[] = [];
  for (const kw of raw) {
    if (!kw || kw.length < 2) continue;
    const lower = kw.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    result.push(lower);
  }
  return result;
}

/**
 * 检测消息内容是否包含提及关键词
 */
export function checkMention(content: string, keywords: string[]): boolean {
  if (keywords.length === 0) return false;
  const lower = content.toLowerCase();
  for (const kw of keywords) {
    if (lower.includes(kw)) return true;
  }
  return false;
}

/**
 * 清理过期的滑窗事件（原地修改）
 */
export function pruneVitalityWindow(window: VitalityWindow, now: number): void {
  const cutoff = now - window.windowMs;
  window.events = window.events.filter(e => e.ts >= cutoff);
  // 防止极端情况内存膨胀
  if (window.events.length > 200) {
    window.events = window.events.slice(-200);
  }
}

/**
 * 清理自己发言事件滑窗（原地修改）
 */
export function pruneSelfSendEvents(
  selfSendEvents: { ts: number }[],
  windowMs: number,
  now: number
): void {
  const cutoff = now - windowMs;
  let firstValid = 0;
  while (firstValid < selfSendEvents.length && selfSendEvents[firstValid].ts < cutoff) {
    firstValid++;
  }
  if (firstValid > 0) {
    selfSendEvents.splice(0, firstValid);
  }
  if (selfSendEvents.length > 200) {
    selfSendEvents.splice(0, selfSendEvents.length - 200);
  }
}

/**
 * 计算群活力状态
 */
export function computeVitality(
  window: VitalityWindow,
  selfSendEvents: { ts: number }[],
  now: number = Date.now()
): GroupVitalityState {
  // 清理过期事件
  pruneVitalityWindow(window, now);
  pruneSelfSendEvents(selfSendEvents, window.windowMs, now);
  const cutoff = now - window.windowMs;

  const messagesIn5m = window.events.length;
  const uniqueSpeakersIn5m = new Set(window.events.map(e => e.sender)).size;
  const myMessagesIn5m = selfSendEvents.filter(e => e.ts >= cutoff).length;

  let state: VitalityState;
  if (messagesIn5m === 0) {
    state = "DORMANT";
  } else if (messagesIn5m <= 5 && uniqueSpeakersIn5m <= 2) {
    state = "COOLING";
  } else if (messagesIn5m <= 15) {
    state = "ACTIVE";
  } else {
    state = "HEATED";
  }

  return { state, messagesIn5m, uniqueSpeakersIn5m, myMessagesIn5m, updatedAt: now };
}

/**
 * 根据活力状态和提及情况决定回复类型
 */
export function determineReplyType(
  vitality: GroupVitalityState,
  mentioned: boolean
): "reaction" | "short" | "normal" | "long" {
  switch (vitality.state) {
    case "HEATED":
      return mentioned ? "short" : "reaction";
    case "ACTIVE":
      return "normal";
    case "COOLING":
      return "short";
    case "DORMANT":
      return "short";
  }
}

/**
 * 回复后处理裁剪
 */
export function postProcessReply(text: string, replyType: string, maxChars: number): string {
  if (!text.trim()) return text;

  let result = text;

  // reaction 类型截断到 8 字符
  if (replyType === "reaction") {
    result = result.substring(0, 8).trim();
    return result;
  }

  // short 类型保留前 1-2 句
  if (replyType === "short") {
    const sentences = result.match(/[^。！？.!?\n]+[。！？.!?\n]?/g);
    if (sentences && sentences.length > 2) {
      result = sentences.slice(0, 2).join("").trim();
    }
  }

  // 超过 maxChars 截断到最近句子边界
  if (result.length > maxChars) {
    const truncated = result.substring(0, maxChars);
    // 尝试在句子边界截断
    const lastSentenceEnd = Math.max(
      truncated.lastIndexOf("。"),
      truncated.lastIndexOf("！"),
      truncated.lastIndexOf("？"),
      truncated.lastIndexOf("."),
      truncated.lastIndexOf("!"),
      truncated.lastIndexOf("?"),
    );
    if (lastSentenceEnd > maxChars * 0.5) {
      result = truncated.substring(0, lastSentenceEnd + 1).trim();
    } else {
      result = truncated.trim();
    }
  }

  return result;
}

/**
 * 构建群态势上下文 prompt
 */
export function buildGroupSituationPrompt(
  vitality: GroupVitalityState,
  mentionInfo: MentionInfo,
  replyType: string,
  myMessagesIn5m: number,
  lastSpeakAgoSec: number,
): string {
  const lastSpeakStr = lastSpeakAgoSec < 0 ? "never" : `${lastSpeakAgoSec}s`;

  return [
    "## Group Situation Context",
    "",
    "[Group Vitality]",
    `state=${vitality.state}`,
    `messages_in_5m=${vitality.messagesIn5m}`,
    `unique_speakers_in_5m=${vitality.uniqueSpeakersIn5m}`,
    "",
    "[My Status]",
    `last_speak_ago=${lastSpeakStr}`,
    `my_messages_in_5m=${myMessagesIn5m}`,
    "",
    "[Mentions]",
    `mentioned_in_context=${mentionInfo.mentioned}`,
    `mention_count=${mentionInfo.mentionCount}`,
    `pending_batches_merged=${mentionInfo.batchesMerged}`,
    "",
    "[Decision Goal]",
    "You are in a group chat with other agents. Decide whether to reply based on the situation above.",
    "Default to silence unless your response is necessary and additive.",
    "If you are mentioned, you should reply unless the mention is clearly not directed at you.",
    "",
    "[Reply Policy]",
    `reply_type=${replyType}`,
    "avoid_repetition=true",
    "no_markdown=true",
    "human_chat_style=true",
  ].join("\n");
}

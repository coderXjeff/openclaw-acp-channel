import type { AcpSessionState } from "./types.js";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { getAcpRuntime, hasAcpRuntime } from "./runtime.js";
import { getContactManager } from "./contacts.js";
import { buildDmSessionKey } from "./acp-session-key.js";

/** AI 评价结果 */
export interface AiSessionRating {
  relevance: number;   // 0-100 话题相关性
  cooperation: number; // 0-100 合作度
  value: number;       // 0-100 对话价值
  summary: string;     // 简短摘要
}

/** 规则评分明细 */
export interface RuleScoreBreakdown {
  completion: number;  // 0-40
  engagement: number;  // 0-30
  efficiency: number;  // 0-30
  total: number;       // 0-100
}

// --- 1.1 规则基础分 ---

export function calculateSessionScore(state: AcpSessionState): RuleScoreBreakdown {
  // 完成度 (0-40)
  let completion = 0;
  const reason = state.closeReason ?? "";
  if (reason === "received_end_marker" || reason === "ai_sent_end_marker") {
    completion = 40;
  } else if (reason.startsWith("idle_timeout")) {
    completion = 25;
  } else if (reason.startsWith("max_turns")) {
    completion = 15;
  } else if (reason === "lru_evicted") {
    completion = 10;
  } else if (reason === "manual_close") {
    completion = 30;
  } else if (reason.startsWith("consecutive_empty")) {
    completion = 10;
  } else if (reason === "superseded") {
    completion = 15;
  } else {
    // 未知原因给中间值
    completion = 20;
  }

  // 参与度 (0-30): 基于轮次，>=2 才算有效对话
  let engagement = 0;
  if (state.turns >= 2) {
    // 线性增长: 2轮=6, 5轮=15, 10轮=30(满分)
    engagement = Math.min(Math.floor(state.turns * 3), 30);
  }

  // 效率 (0-30): 基于每轮平均耗时
  let efficiency = 0;
  const durationMs = (state.closedAt ?? Date.now()) - state.createdAt;
  if (state.turns >= 1) {
    const avgMs = durationMs / state.turns;
    const avgSec = avgMs / 1000;
    if (avgSec >= 5 && avgSec <= 60) {
      // 理想区间，满分
      efficiency = 30;
    } else if (avgSec < 5) {
      // 太快，可能刷消息
      efficiency = Math.max(Math.floor(avgSec * 6), 5);
    } else if (avgSec <= 120) {
      // 稍慢，线性衰减 30→15
      efficiency = Math.round(30 - ((avgSec - 60) / 60) * 15);
    } else {
      // 很慢 (>120s)
      efficiency = Math.max(Math.round(15 - ((avgSec - 120) / 120) * 10), 5);
    }
  }

  const total = Math.max(0, Math.min(completion + engagement + efficiency, 100));
  return { completion, engagement, efficiency, total };
}

// --- 1.2 AI 评价 ---

export async function requestAiSessionRating(
  state: AcpSessionState,
  sessionKey: string,
  cfg: OpenClawConfig,
  identityId?: string,
): Promise<AiSessionRating | null> {
  // 不足 2 轮不值得 AI 评价
  if (state.turns < 2) return null;
  if (!hasAcpRuntime()) return null;

  const runtime = getAcpRuntime();

  const prompt = [
    "You are evaluating the quality of an ACP (Agent Communication Protocol) session that just ended.",
    `Session ID: ${state.sessionId}`,
    `Peer: ${state.targetAid}`,
    `Turns: ${state.turns}`,
    `Close reason: ${state.closeReason ?? "unknown"}`,
    "",
    "Based on the conversation history in this session, evaluate the peer agent and respond with ONLY a JSON object (no markdown, no extra text):",
    '{"relevance": <0-100>, "cooperation": <0-100>, "value": <0-100>, "summary": "<one sentence>"}',
    "",
    "- relevance: How relevant and on-topic was the conversation?",
    "- cooperation: How cooperative and responsive was the peer?",
    "- value: How much value did the conversation produce?",
    "- summary: A brief one-sentence summary of the conversation quality.",
  ].join("\n");

  try {
    // 使用 AbortController 实现 15 秒超时
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    let replyText = "";

    const { dispatcher, replyOptions, markDispatchIdle } =
      runtime.channel.reply.createReplyDispatcherWithTyping({
        deliver: async (payload) => {
          replyText = payload.text ?? "";
        },
        onError: (err) => {
          console.error("[ACP] AI rating reply error:", err);
        },
      });

    const ctx = runtime.channel.reply.finalizeInboundContext({
      Body: prompt,
      RawBody: prompt,
      CommandBody: prompt,
      From: "acp:system:rating",
      To: "acp:self",
      SessionKey: sessionKey,
      AccountId: identityId ?? "default",
      ChatType: "direct",
      SenderName: "system",
      SenderId: "system",
      Provider: "acp",
      Surface: "acp",
      MessageSid: `acp-rating-${Date.now()}`,
      Timestamp: Date.now(),
      OriginatingChannel: "acp",
      OriginatingTo: "acp:self",
      CommandAuthorized: false,
      ConversationLabel: `rating:${state.sessionId.substring(0, 8)}`,
    });

    await runtime.channel.reply.dispatchReplyFromConfig({
      ctx,
      cfg,
      dispatcher,
      replyOptions: {
        ...replyOptions,
        disableBlockStreaming: true,
      },
    });

    markDispatchIdle();
    clearTimeout(timeout);

    // 解析 AI 返回的 JSON
    if (!replyText.trim()) return null;

    // 尝试从回复中提取 JSON（AI 可能包裹在 markdown code block 中）
    let jsonStr = replyText.trim();
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    const parsed = JSON.parse(jsonStr);
    const rating: AiSessionRating = {
      relevance: clamp(Number(parsed.relevance) || 0, 0, 100),
      cooperation: clamp(Number(parsed.cooperation) || 0, 0, 100),
      value: clamp(Number(parsed.value) || 0, 0, 100),
      summary: typeof parsed.summary === "string" ? parsed.summary.substring(0, 500) : "",
    };

    return rating;
  } catch (err) {
    console.error("[ACP] AI session rating failed:", err);
    return null;
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(v, max));
}

// --- 1.3 加权合并 ---

export function mergeSessionScore(ruleScore: number, aiRating: AiSessionRating | null): number {
  if (!aiRating) {
    return ruleScore;
  }
  const aiScore = Math.round((aiRating.relevance + aiRating.cooperation + aiRating.value) / 3);
  const merged = Math.round(ruleScore * 0.6 + aiScore * 0.4);
  return clamp(merged, 0, 100);
}

// --- 1.4 入口函数 ---

export async function rateSession(state: AcpSessionState, cfg: OpenClawConfig, identityId?: string): Promise<void> {
  try {
    const ruleBreakdown = calculateSessionScore(state);
    const agentId = "main";
    const sessionKey = buildDmSessionKey({ agentId, identityId: identityId ?? "default", peerAid: state.targetAid });

    console.log(
      `[ACP] Session ${state.sessionId} rule score: ${ruleBreakdown.total} ` +
      `(completion=${ruleBreakdown.completion}, engagement=${ruleBreakdown.engagement}, efficiency=${ruleBreakdown.efficiency})`,
    );

    const aiRating = await requestAiSessionRating(state, sessionKey, cfg, identityId);

    if (aiRating) {
      const aiAvg = Math.round((aiRating.relevance + aiRating.cooperation + aiRating.value) / 3);
      console.log(`[ACP] Session ${state.sessionId} AI rating: ${aiAvg} (${aiRating.summary})`);
    } else {
      console.log(`[ACP] Session ${state.sessionId} AI rating: skipped`);
    }

    const finalScore = mergeSessionScore(ruleBreakdown.total, aiRating);
    console.log(
      `[ACP] Session ${state.sessionId} final score: ${finalScore} (${aiRating ? "merged" : "rule-only"})`,
    );

    const contacts = getContactManager(identityId);
    contacts.recordSessionRating(state.targetAid, finalScore, aiRating?.summary);
  } catch (err) {
    console.error(`[ACP] Session rating failed for ${state.sessionId}:`, err);
  }
}

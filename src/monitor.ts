import type { AcpChannelConfig, ResolvedAcpAccount, AcpSessionState, AcpSessionConfig } from "./types.js";
import { DEFAULT_SESSION_CONFIG } from "./types.js";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { AcpClient, type ConnectionStatus } from "./acp-client.js";
import { getAcpRuntime, hasAcpRuntime } from "./runtime.js";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// 状态
let acpClient: AcpClient | null = null;
let isRunning = false;
let currentAccount: ResolvedAcpAccount | null = null;
let currentConfig: OpenClawConfig | null = null;
let currentAcpConfig: AcpChannelConfig | null = null;

// 会话状态管理
const sessionStates = new Map<string, AcpSessionState>();
let idleCheckInterval: ReturnType<typeof setInterval> | null = null;

// agent.md MD5 存储路径
const AGENT_MD_HASH_FILE = path.join(process.env.HOME || "~", ".acp-storage", "agent-md-hash.json");

/**
 * 计算文件 MD5
 */
function calculateFileMd5(filePath: string): string | null {
  try {
    const resolvedPath = filePath.replace(/^~/, process.env.HOME || "");
    if (!fs.existsSync(resolvedPath)) {
      return null;
    }
    const content = fs.readFileSync(resolvedPath, "utf8");
    return crypto.createHash("md5").update(content).digest("hex");
  } catch (error) {
    console.error("[ACP] Failed to calculate MD5:", error);
    return null;
  }
}

/**
 * 获取存储的 agent.md MD5
 */
function getStoredAgentMdHash(aid: string): string | null {
  try {
    if (!fs.existsSync(AGENT_MD_HASH_FILE)) {
      return null;
    }
    const data = JSON.parse(fs.readFileSync(AGENT_MD_HASH_FILE, "utf8"));
    return data[aid] || null;
  } catch (error) {
    return null;
  }
}

/**
 * 存储 agent.md MD5
 */
function saveAgentMdHash(aid: string, hash: string): void {
  try {
    const dir = path.dirname(AGENT_MD_HASH_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    let data: Record<string, string> = {};
    if (fs.existsSync(AGENT_MD_HASH_FILE)) {
      data = JSON.parse(fs.readFileSync(AGENT_MD_HASH_FILE, "utf8"));
    }
    data[aid] = hash;
    fs.writeFileSync(AGENT_MD_HASH_FILE, JSON.stringify(data, null, 2));
    console.log(`[ACP] Saved agent.md hash for ${aid}: ${hash}`);
  } catch (error) {
    console.error("[ACP] Failed to save agent.md hash:", error);
  }
}

/**
 * 检查并上传 agent.md（如果有变化）
 */
async function checkAndUploadAgentMd(): Promise<void> {
  if (!acpClient || !currentAcpConfig?.agentMdPath || !currentAccount) {
    return;
  }

  const aid = currentAccount.fullAid;
  const currentHash = calculateFileMd5(currentAcpConfig.agentMdPath);

  if (!currentHash) {
    console.log("[ACP] agent.md file not found, skipping upload check");
    return;
  }

  const storedHash = getStoredAgentMdHash(aid);

  if (currentHash === storedHash) {
    console.log("[ACP] agent.md unchanged (hash match), skipping upload");
    return;
  }

  console.log(`[ACP] agent.md changed (${storedHash?.substring(0, 8) || 'none'} -> ${currentHash.substring(0, 8)}), uploading...`);

  try {
    const result = await acpClient.uploadAgentMdFromFile(currentAcpConfig.agentMdPath);
    if (result.success) {
      saveAgentMdHash(aid, currentHash);
      console.log(`[ACP] agent.md uploaded successfully: ${result.url}`);
    } else {
      console.error(`[ACP] Failed to upload agent.md: ${result.error}`);
    }
  } catch (error) {
    console.error("[ACP] Error uploading agent.md:", error);
  }
}

/**
 * 获取会话配置（合并默认值并校验）
 */
function getSessionConfig(): Required<AcpSessionConfig> {
  const userConfig = currentAcpConfig?.session ?? {};

  // 合并配置
  const config = {
    ...DEFAULT_SESSION_CONFIG,
    ...userConfig,
    // 确保 endMarkers 不会被 undefined 或空数组覆盖
    endMarkers: userConfig.endMarkers?.length ? userConfig.endMarkers : DEFAULT_SESSION_CONFIG.endMarkers,
  };

  // 校验并修正配置值
  // 1. 过滤空字符串和过短的标记（至少 3 个字符，避免误触发）
  config.endMarkers = config.endMarkers.filter(marker =>
    typeof marker === 'string' && marker.trim().length >= 3
  );
  if (config.endMarkers.length === 0) {
    config.endMarkers = DEFAULT_SESSION_CONFIG.endMarkers;
  }

  // 2. 确保数值配置为正数
  if (typeof config.consecutiveEmptyThreshold !== 'number' || config.consecutiveEmptyThreshold < 1) {
    config.consecutiveEmptyThreshold = DEFAULT_SESSION_CONFIG.consecutiveEmptyThreshold;
  }
  if (typeof config.maxTurns !== 'number' || config.maxTurns < 1) {
    config.maxTurns = DEFAULT_SESSION_CONFIG.maxTurns;
  }
  if (typeof config.maxDurationMs !== 'number' || config.maxDurationMs < 1000) {
    config.maxDurationMs = DEFAULT_SESSION_CONFIG.maxDurationMs;
  }
  if (typeof config.idleTimeoutMs !== 'number' || config.idleTimeoutMs < 1000) {
    config.idleTimeoutMs = DEFAULT_SESSION_CONFIG.idleTimeoutMs;
  }
  if (typeof config.maxConcurrentSessions !== 'number' || config.maxConcurrentSessions < 1) {
    config.maxConcurrentSessions = DEFAULT_SESSION_CONFIG.maxConcurrentSessions;
  }

  return config;
}

/**
 * 获取活跃会话数量
 */
function getActiveSessionCount(): number {
  let count = 0;
  for (const state of sessionStates.values()) {
    if (state.status === 'active') {
      count++;
    }
  }
  return count;
}

/**
 * 执行 LRU 淘汰 - 关闭最久未活动的会话
 * @param maxSessions 最大允许的会话数
 * @returns 被淘汰的会话数量
 */
async function evictLruSessions(maxSessions: number): Promise<number> {
  const activeSessions: AcpSessionState[] = [];

  // 收集所有活跃会话
  for (const state of sessionStates.values()) {
    if (state.status === 'active') {
      activeSessions.push(state);
    }
  }

  // 如果未超限，无需淘汰
  if (activeSessions.length < maxSessions) {
    return 0;
  }

  // 按 lastActivityAt 升序排序（最久未活动的在前）
  activeSessions.sort((a, b) => a.lastActivityAt - b.lastActivityAt);

  // 计算需要淘汰的数量（为新会话腾出 1 个位置）
  const evictCount = activeSessions.length - maxSessions + 1;
  let evicted = 0;

  for (let i = 0; i < evictCount && i < activeSessions.length; i++) {
    const state = activeSessions[i];
    console.log(`[ACP] LRU evicting session ${state.sessionId} (last active: ${new Date(state.lastActivityAt).toISOString()})`);
    await closeSession(state, 'lru_evicted', true);
    evicted++;
  }

  console.log(`[ACP] LRU evicted ${evicted} sessions (max: ${maxSessions})`);
  return evicted;
}

/**
 * 获取或创建会话状态（带 LRU 淘汰）
 */
async function getOrCreateSessionState(sessionId: string, targetAid: string): Promise<AcpSessionState> {
  let state = sessionStates.get(sessionId);
  if (!state) {
    // 新会话：先关闭同一 targetAid 的旧 session（静默关闭，不发 [END]）
    for (const [oldId, oldState] of sessionStates) {
      if (oldState.targetAid === targetAid && oldState.status === 'active') {
        oldState.status = 'closed';
        oldState.closedAt = Date.now();
        oldState.closeReason = 'superseded';
        console.log(`[ACP] Session ${oldId} superseded by new session ${sessionId} from ${targetAid}`);
      }
    }

    // LRU 淘汰检查
    const config = getSessionConfig();
    await evictLruSessions(config.maxConcurrentSessions);

    const now = Date.now();
    state = {
      sessionId,
      targetAid,
      status: 'active',
      turns: 0,
      consecutiveEmptyReplies: 0,
      createdAt: now,
      lastActivityAt: now,
    };
    sessionStates.set(sessionId, state);
    const activeCount = getActiveSessionCount();
    console.log(`[ACP] Created new session state for ${sessionId} (active: ${activeCount}/${config.maxConcurrentSessions})`);
  }
  return state;
}

/**
 * 检查消息是否包含结束标记
 */
function hasEndMarker(content: string, markers: string[]): boolean {
  const trimmed = content.trim();
  // includes 已经涵盖了 startsWith 和 endsWith 的情况
  return markers.some(marker => trimmed.includes(marker));
}

/**
 * 检查会话是否应该终止（第三层硬限制）
 */
function checkHardLimits(state: AcpSessionState, config: Required<AcpSessionConfig>): { terminate: boolean; reason?: string } {
  const now = Date.now();

  // 1. 轮次限制
  if (state.turns >= config.maxTurns) {
    return { terminate: true, reason: `max_turns_${config.maxTurns}` };
  }

  // 2. 总时长限制
  const duration = now - state.createdAt;
  if (duration >= config.maxDurationMs) {
    return { terminate: true, reason: `max_duration_${config.maxDurationMs}ms` };
  }

  // 3. 空闲超时（在定时器中检查，这里不检查）

  return { terminate: false };
}

/**
 * 关闭会话
 */
async function closeSession(state: AcpSessionState, reason: string, sendEndMarker: boolean = false): Promise<void> {
  state.status = 'closed';
  state.closedAt = Date.now();
  state.closeReason = reason;
  console.log(`[ACP] Session ${state.sessionId} closed: ${reason}`);

  // 发送结束标记（如果配置了）
  if (sendEndMarker && acpClient?.connected) {
    const config = getSessionConfig();
    if (config.sendEndMarkerOnClose) {
      try {
        // 使用配置的第一个结束标记
        const endMarker = config.endMarkers[0] || '[END]';
        const endMessage = `${endMarker} Session closed.`;
        await acpClient.sendReply(state.sessionId, endMessage);
        console.log(`[ACP] Sent end marker to ${state.targetAid}: ${endMarker}`);
      } catch (err) {
        console.error(`[ACP] Failed to send end marker:`, err);
      }
    }
  }
}

/**
 * 启动空闲超时检查定时器
 */
function startIdleChecker(): void {
  if (idleCheckInterval) return;

  idleCheckInterval = setInterval(() => {
    const config = getSessionConfig();
    const now = Date.now();

    for (const [sessionId, state] of sessionStates) {
      if (state.status !== 'active') continue;

      const idleTime = now - state.lastActivityAt;
      if (idleTime >= config.idleTimeoutMs) {
        console.log(`[ACP] Session ${sessionId} idle timeout (${idleTime}ms)`);
        // 使用 void 明确表示不等待，避免 unhandled promise
        void closeSession(state, `idle_timeout_${config.idleTimeoutMs}ms`, true);
      }
    }

    // 清理已关闭超过 5 分钟的会话
    const cleanupThreshold = 5 * 60 * 1000;
    for (const [sessionId, state] of sessionStates) {
      if (state.status === 'closed' && state.closedAt && (now - state.closedAt) > cleanupThreshold) {
        sessionStates.delete(sessionId);
        console.log(`[ACP] Cleaned up closed session ${sessionId}`);
      }
    }
  }, 5000); // 每 5 秒检查一次

  console.log("[ACP] Idle checker started");
}

/**
 * 停止空闲超时检查定时器
 */
function stopIdleChecker(): void {
  if (idleCheckInterval) {
    clearInterval(idleCheckInterval);
    idleCheckInterval = null;
    console.log("[ACP] Idle checker stopped");
  }
}

/**
 * 启动 ACP 监听（直接连接 ACP 网络，无需 Python Bridge）
 */
export async function startAcpMonitor(
  cfg: OpenClawConfig,
  acpConfig: AcpChannelConfig,
  account: ResolvedAcpAccount
): Promise<void> {
  if (isRunning) {
    console.log("[ACP] Monitor already running");
    return;
  }

  currentAccount = account;
  currentConfig = cfg;
  currentAcpConfig = acpConfig;

  console.log(`[ACP] Starting ACP monitor for ${account.fullAid}`);
  console.log(`[ACP] Session config:`, getSessionConfig());

  acpClient = new AcpClient({
    agentName: acpConfig.agentName,
    domain: acpConfig.domain ?? "aid.pub",
    seedPassword: acpConfig.seedPassword,
    agentMdPath: acpConfig.agentMdPath,
    onMessage: (sender, sessionId, identifyingCode, content) => {
      handleInboundMessage(sender, sessionId, identifyingCode, content);
    },
    onStatusChange: (status: ConnectionStatus) => {
      console.log(`[ACP] Connection status changed: ${status}`);
      if (status === "connected") {
        isRunning = true;
        startIdleChecker();
      } else if (status === "disconnected" || status === "error") {
        isRunning = false;
        stopIdleChecker();
      }
    },
    onError: (error) => {
      console.error("[ACP] Client error:", error);
    },
  });

  try {
    await acpClient.connect();
    isRunning = true;
    // 注意：startIdleChecker 可能已在 onStatusChange 中被调用，
    // 但函数内部有防重复检查，所以这里调用是安全的
    startIdleChecker();
    console.log(`[ACP] Monitor started for ${account.fullAid}`);

    // 检查并上传 agent.md（如果有变化）
    await checkAndUploadAgentMd();
  } catch (error) {
    console.error("[ACP] Failed to start monitor:", error);
    throw error;
  }
}

/**
 * 处理入站消息
 */
async function handleInboundMessage(
  sender: string,
  sessionId: string,
  identifyingCode: string,
  content: string
): Promise<void> {
  console.log(`[ACP] Processing inbound message from ${sender}`);

  if (!currentAccount || !currentConfig) {
    console.warn("[ACP] No account or config configured");
    return;
  }

  if (!hasAcpRuntime()) {
    console.warn("[ACP] Runtime not initialized");
    return;
  }

  // ===== 首先检查 allowlist（在任何其他操作之前）=====
  if (currentAccount.allowFrom.length > 0) {
    const allowed = currentAccount.allowFrom.some(
      (pattern) => pattern === "*" || pattern === sender
    );
    if (!allowed) {
      console.log(`[ACP] Rejected message from ${sender} (not in allowlist)`);
      return;
    }
  }

  const config = getSessionConfig();

  // ===== 获取或创建会话状态（allowlist 检查通过后，含 LRU 淘汰）=====
  const sessionState = await getOrCreateSessionState(sessionId, sender);

  // ===== 第二层：检查会话是否已关闭或正在关闭 =====
  if (sessionState.status === 'closed' || sessionState.status === 'closing') {
    console.log(`[ACP] Session ${sessionId} is ${sessionState.status} (${sessionState.closeReason}), ignoring message`);
    // 可选：发送 ACK（包含结束标记，避免对方继续回复）
    if (config.sendAckOnReceiveEnd && acpClient?.connected) {
      const endMarker = config.endMarkers[0] || '[END]';
      await acpClient.sendReply(sessionId, `${endMarker} [ACK] Session already closed.`);
    }
    return;
  }

  // ===== 第三层：硬限制检查 =====
  const hardLimitCheck = checkHardLimits(sessionState, config);
  if (hardLimitCheck.terminate) {
    console.log(`[ACP] Session ${sessionId} hit hard limit: ${hardLimitCheck.reason}`);
    await closeSession(sessionState, hardLimitCheck.reason!, true);
    return;
  }

  // ===== 第二层：检查入站消息是否包含结束标记 =====
  if (hasEndMarker(content, config.endMarkers)) {
    console.log(`[ACP] Received end marker from ${sender}, closing session`);
    await closeSession(sessionState, 'received_end_marker', false);
    // 发送 ACK（如果配置了，包含结束标记避免对方继续回复）
    if (config.sendAckOnReceiveEnd && acpClient?.connected) {
      const endMarker = config.endMarkers[0] || '[END]';
      await acpClient.sendReply(sessionId, `${endMarker} [ACK] Session ended. Goodbye!`);
    }
    return;
  }

  // ===== 更新会话状态 =====
  sessionState.turns++;
  sessionState.lastActivityAt = Date.now();
  // 注意：turns 统计的是入站消息次数，不是对话轮次（一轮 = 一问一答）
  console.log(`[ACP] Session ${sessionId} inbound message ${sessionState.turns}/${config.maxTurns}`);
  const senderName = sender.split(".")[0];

  // 判断是否是主人发送的消息
  const isOwner = currentAccount.ownerAid ? sender === currentAccount.ownerAid : false;
  console.log(`[ACP] Received from ${sender} (isOwner: ${isOwner}): ${content.substring(0, 50)}...`);

  try {
    const runtime = getAcpRuntime();
    const cfg = currentConfig;

    // ACP 入站消息：按 ACP sessionId 区分 OpenClaw session
    // 格式：agent:main:acp:session:{sender}:{sessionId前8位}
    // 这样每个 ACP session 都有独立的对话上下文
    const sessionIdShort = sessionId.substring(0, 8);
    const sessionKey = `agent:main:acp:session:${sender}:${sessionIdShort}`;
    const agentId = "main"; // 使用默认 agent
    const senderName = sender.split(".")[0];

    const storePath = runtime.channel.session.resolveStorePath(cfg.session?.store, {
      agentId,
    });

    console.log(`[ACP] Session key: ${sessionKey}, agentId: ${agentId}`);

    // 构建会话标签，包含 ACP session ID
    const conversationLabel = `${senderName}:${sessionIdShort}`;

    // 在消息前面加上双方的 AID
    let messageWithAid = `[From: ${sender}]\n[To: ${currentAccount.fullAid}]\n\n${content}`;

    // 根据身份添加不同的标识（使用 UntrustedContext 格式，让 AI 知道这是系统验证的）
    if (isOwner) {
      // 主人消息，简单标识即可
      messageWithAid = `[ACP System Verified: sender=${sender}, role=owner]\n\n${messageWithAid}`;
    } else {
      // 非主人消息，添加安全限制
      messageWithAid = `[ACP System Verified: sender=${sender}, role=external_agent, restrictions=no_file_ops,no_config_changes,no_commands,conversation_only]\n\n${messageWithAid}`;
    }

    // 使用 runtime 的 finalizeInboundContext 构建消息上下文
    // CommandAuthorized: 只有主人才能执行命令（如 /help, /clear 等）
    const ctx = runtime.channel.reply.finalizeInboundContext({
      Body: messageWithAid,
      RawBody: content,
      CommandBody: content,
      From: `acp:${sender}`,
      To: `acp:${currentAccount.fullAid}`,
      SessionKey: sessionKey,
      AccountId: "default",
      ChatType: "direct",
      SenderName: senderName,
      SenderId: sender,
      Provider: "acp",
      Surface: "acp",
      MessageSid: `acp-${Date.now()}`,
      Timestamp: Date.now(),
      OriginatingChannel: "acp",
      OriginatingTo: `acp:${currentAccount.fullAid}`,
      CommandAuthorized: isOwner,
      ConversationLabel: conversationLabel,
    });

    console.log("[ACP] Context created, dispatching to AI...");

    // 记录会话到 session store，这样前端可以看到
    await runtime.channel.session.recordInboundSession({
      storePath,
      sessionKey,
      ctx,
      onRecordError: (err) => {
        console.error(`[ACP] Failed to record session: ${String(err)}`);
      },
    });

    // 用于追踪回复内容
    let replyText = "";

    // 创建回复分发器
    const { dispatcher, replyOptions, markDispatchIdle } = runtime.channel.reply.createReplyDispatcherWithTyping({
      deliver: async (payload) => {
        const text = payload.text ?? "";
        replyText = text;
        console.log(`[ACP] Delivering reply: ${text.substring(0, 50)}`);

        // ===== 第一层：检查 AI 回复是否包含结束标记 =====
        if (hasEndMarker(text, config.endMarkers)) {
          console.log(`[ACP] AI sent end marker, closing session after this reply`);
          sessionState.status = 'closing';
        }

        // 通过 ACP 客户端发送回复
        if (acpClient?.connected) {
          await acpClient.sendReply(sessionId, text);
          console.log("[ACP] Reply sent");
        } else {
          console.error("[ACP] Cannot send reply: client not connected");
        }
      },
      onError: (err, info) => {
        console.error(`[ACP] Reply error (${info.kind}):`, err);
      },
    });

    // 分发消息到 AI
    const result = await runtime.channel.reply.dispatchReplyFromConfig({
      ctx,
      cfg,
      dispatcher,
      replyOptions: {
        ...replyOptions,
        disableBlockStreaming: true,
      },
    });

    markDispatchIdle();
    console.log("[ACP] Dispatch result:", result);

    // ===== 第一层：检查空回复 =====
    if (!replyText?.trim()) {
      sessionState.consecutiveEmptyReplies++;
      console.log(`[ACP] Empty reply (${sessionState.consecutiveEmptyReplies}/${config.consecutiveEmptyThreshold})`);

      if (sessionState.consecutiveEmptyReplies >= config.consecutiveEmptyThreshold) {
        console.log(`[ACP] ${config.consecutiveEmptyThreshold} consecutive empty replies, closing session`);
        await closeSession(sessionState, `consecutive_empty_${config.consecutiveEmptyThreshold}`, true);
      }
    } else {
      // 重置空回复计数
      sessionState.consecutiveEmptyReplies = 0;
    }

    // 如果状态是 closing，正式关闭（状态可能在 deliver 回调中被修改）
    if ((sessionState.status as string) === 'closing') {
      await closeSession(sessionState, 'ai_sent_end_marker', false);
    }

    // 更新最后活动时间
    sessionState.lastActivityAt = Date.now();

  } catch (error) {
    console.error("[ACP] Error processing inbound message:", error);
  }
}

/**
 * 发送消息到 ACP
 */
export async function sendAcpMessage(params: {
  to: string;
  sessionId: string;
  content: string;
}): Promise<void> {
  if (!acpClient?.connected) {
    throw new Error("ACP client not connected");
  }

  await acpClient.sendMessage(params.to, params.content);
}

/**
 * 停止监听
 */
export async function stopAcpMonitor(): Promise<void> {
  if (!isRunning || !acpClient) {
    return;
  }

  console.log("[ACP] Stopping monitor");
  stopIdleChecker();
  acpClient.disconnect();
  acpClient = null;
  isRunning = false;
  currentAccount = null;
  currentConfig = null;
  currentAcpConfig = null;
  sessionStates.clear();
}

/**
 * 获取 ACP 客户端
 */
export function getAcpClient(): AcpClient | null {
  return acpClient;
}

/**
 * 获取当前账号信息
 */
export function getCurrentAccount(): ResolvedAcpAccount | null {
  return currentAccount;
}

/**
 * 检查是否运行中
 */
export function isMonitorRunning(): boolean {
  return isRunning;
}

/**
 * 获取会话状态（用于调试）
 */
export function getSessionState(sessionId: string): AcpSessionState | undefined {
  return sessionStates.get(sessionId);
}

/**
 * 获取所有会话状态（用于调试）
 */
export function getAllSessionStates(): Map<string, AcpSessionState> {
  return new Map(sessionStates);
}

/**
 * 手动关闭会话
 */
export async function closeSessionManually(sessionId: string, reason: string = 'manual_close'): Promise<boolean> {
  const state = sessionStates.get(sessionId);
  if (!state) {
    console.log(`[ACP] Session ${sessionId} not found`);
    return false;
  }
  if (state.status === 'closed') {
    console.log(`[ACP] Session ${sessionId} already closed`);
    return false;
  }
  await closeSession(state, reason, true);
  return true;
}

/**
 * 手动同步 agent.md 到 ACP 网络
 * 用于在修改 agent.md 后强制重新上传
 */
export async function syncAgentMd(): Promise<{ success: boolean; url?: string; error?: string }> {
  if (!acpClient) {
    return { success: false, error: "ACP client not initialized" };
  }

  if (!currentAcpConfig?.agentMdPath) {
    return { success: false, error: "agentMdPath not configured" };
  }

  console.log(`[ACP] Manually syncing agent.md from ${currentAcpConfig.agentMdPath}`);

  try {
    const result = await acpClient.uploadAgentMdFromFile(currentAcpConfig.agentMdPath);
    if (result.success) {
      console.log(`[ACP] agent.md synced successfully: ${result.url}`);
    } else {
      console.error(`[ACP] Failed to sync agent.md: ${result.error}`);
    }
    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[ACP] Error syncing agent.md: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

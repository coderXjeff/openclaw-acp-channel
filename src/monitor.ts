import type { AcpChannelConfig, ResolvedAcpAccount } from "./types.js";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { AcpClient, type ConnectionStatus } from "./acp-client.js";
import { getAcpRuntime, hasAcpRuntime } from "./runtime.js";

// 状态
let acpClient: AcpClient | null = null;
let isRunning = false;
let currentAccount: ResolvedAcpAccount | null = null;
let currentConfig: OpenClawConfig | null = null;

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

  console.log(`[ACP] Starting ACP monitor for ${account.fullAid}`);

  acpClient = new AcpClient({
    agentName: acpConfig.agentName,
    domain: acpConfig.domain ?? "aid.pub",
    seedPassword: acpConfig.seedPassword,
    onMessage: (sender, sessionId, identifyingCode, content) => {
      handleInboundMessage(sender, sessionId, identifyingCode, content);
    },
    onStatusChange: (status: ConnectionStatus) => {
      console.log(`[ACP] Connection status changed: ${status}`);
      if (status === "connected") {
        isRunning = true;
      } else if (status === "disconnected" || status === "error") {
        isRunning = false;
      }
    },
    onError: (error) => {
      console.error("[ACP] Client error:", error);
    },
  });

  try {
    await acpClient.connect();
    isRunning = true;
    console.log(`[ACP] Monitor started for ${account.fullAid}`);
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

  // 检查 allowlist
  if (currentAccount.allowFrom.length > 0) {
    const allowed = currentAccount.allowFrom.some(
      (pattern) => pattern === "*" || pattern === sender
    );
    if (!allowed) {
      console.log(`[ACP] Rejected message from ${sender} (not in allowlist)`);
      return;
    }
  }

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

    // 创建回复分发器
    const { dispatcher, replyOptions, markDispatchIdle } = runtime.channel.reply.createReplyDispatcherWithTyping({
      deliver: async (payload) => {
        console.log(`[ACP] Delivering reply: ${payload.text?.substring(0, 50)}`);

        // 通过 ACP 客户端发送回复
        if (acpClient?.connected) {
          await acpClient.sendReply(sessionId, payload.text ?? "");
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
  acpClient.disconnect();
  acpClient = null;
  isRunning = false;
  currentAccount = null;
  currentConfig = null;
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

import { getCurrentAccount, recordOutbound } from "./monitor.js";
import { getRouter } from "./identity-router.js";

/**
 * 解析 to 格式: "acp:{targetAid}:{sessionId}" 或直接是 AID
 */
export function parseTarget(to: string): { targetAid: string; sessionId: string } {
  const parts = to.split(":");
  if (parts[0] === "acp" && parts.length >= 3) {
    return { targetAid: parts[1], sessionId: parts.slice(2).join(":") };
  }
  return { targetAid: to, sessionId: "default" };
}

/**
 * 发送消息到 ACP 网络（单身份版）
 */
export async function sendAcpMessage(params: {
  to: string;
  sessionId: string;
  content: string;
  accountId?: string | null;
}): Promise<void> {
  const router = getRouter();
  const normalizedAccountId = params.accountId?.trim() || undefined;

  if (router) {
    const state = normalizedAccountId
      ? router.getState(normalizedAccountId)
      : router.getDefaultState();

    if (!state) {
      throw new Error(`Identity not found${normalizedAccountId ? `: ${normalizedAccountId}` : ""}`);
    }

    if (!router.multiClient.isConnected(state.aidKey)) {
      throw new Error(`AID ${state.aidKey} not connected`);
    }

    const fromAid = state.aidKey;
    const messageWithAid = `[From: ${fromAid}]\n[To: ${params.to}]\n\n${params.content}`;
    await router.multiClient.sendMessage(fromAid, params.to, messageWithAid);
    recordOutbound(state.identityId);
    return;
  }

  // 向后兼容：旧的单客户端模式
  const { getAcpClient } = await import("./monitor.js");
  const client = getAcpClient();

  if (!client?.connected) {
    throw new Error("ACP client not connected");
  }

  const account = getCurrentAccount(normalizedAccountId);
  const fromAid = account?.fullAid || "unknown";
  const messageWithAid = `[From: ${fromAid}]\n[To: ${params.to}]\n\n${params.content}`;
  await client.sendMessage(params.to, messageWithAid);
  recordOutbound(normalizedAccountId);
}

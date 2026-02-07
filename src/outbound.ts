import { getAcpClient, getCurrentAccount, recordOutbound } from "./monitor.js";

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
 * 发送消息到 ACP 网络
 */
export async function sendAcpMessage(params: {
  to: string;
  sessionId: string;
  content: string;
}): Promise<void> {
  const client = getAcpClient();

  if (!client?.connected) {
    throw new Error("ACP client not connected");
  }

  // 获取当前账号信息
  const account = getCurrentAccount();
  const fromAid = account?.fullAid || "unknown";

  // 在消息前面加上双方的 AID
  const messageWithAid = `[From: ${fromAid}]\n[To: ${params.to}]\n\n${params.content}`;

  await client.sendMessage(params.to, messageWithAid);
  recordOutbound();
}

import { getAcpClient, getCurrentAccount } from "./monitor.js";

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
}

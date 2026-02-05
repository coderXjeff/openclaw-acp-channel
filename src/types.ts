// ACP Channel 配置类型 (acp-ws 版本)
export interface AcpChannelConfig {
  enabled: boolean;
  agentName: string;        // Agent 名称 (不含域名)
  domain: string;           // ACP 域名，如 aid.pub
  seedPassword?: string;    // 种子密码
  ownerAid?: string;        // 主人的 AID
  allowFrom?: string[];     // 允许接收消息的 AID 列表
  profile?: {
    displayName?: string;
    description?: string;
    capabilities?: string[];
  };
}

// 解析后的账户信息
export interface ResolvedAcpAccount {
  accountId: string;
  agentName: string;
  domain: string;
  fullAid: string;          // 完整 AID: agentName.domain
  enabled: boolean;
  ownerAid: string;
  allowFrom: string[];
  seedPassword: string;
}

// ACP 消息内容类型
export interface AcpMessageContent {
  type: "text" | "image" | "file";
  text?: string;
  url?: string;
  mimeType?: string;
}

// ACP 入站消息
export interface AcpInboundMessage {
  sender: string;
  sessionId: string;
  identifyingCode: string;
  content: string;
  timestamp: number;
}

// 会话信息
export interface AcpSession {
  sessionId: string;
  identifyingCode: string;
  targetAid: string;
  createdAt: number;
}

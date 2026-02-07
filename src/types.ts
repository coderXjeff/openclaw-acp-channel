// ACP Channel 配置类型 (acp-ws 版本)
export interface AcpChannelConfig {
  enabled: boolean;
  agentName: string;        // Agent 名称 (不含域名)
  domain: string;           // ACP 域名，如 aid.pub
  seedPassword?: string;    // 种子密码
  ownerAid?: string;        // 主人的 AID
  allowFrom?: string[];     // 允许接收消息的 AID 列表
  agentMdPath?: string;     // agent.md 文件路径，登录后自动上传
  workspaceDir?: string;    // workspace 目录路径，用于自动生成 agent.md
  profile?: {
    displayName?: string;
    description?: string;
    capabilities?: string[];
  };
  // 会话终止控制配置
  session?: AcpSessionConfig;
}

// 会话终止控制配置
export interface AcpSessionConfig {
  // 第一层：软控制 - AI 智能决策
  endMarkers?: string[];              // 结束标记，默认 ['[END]', '[GOODBYE]']，至少 3 字符
  consecutiveEmptyThreshold?: number; // 连续空回复阈值，默认 2

  // 第二层：协议层 - 双向终止标记
  sendEndMarkerOnClose?: boolean;     // 关闭时发送结束标记，默认 true
  sendAckOnReceiveEnd?: boolean;      // 收到结束标记时发送 ACK，默认 false

  // 第三层：硬限制 - 三件套
  maxTurns?: number;                  // 最大入站消息次数（非对话轮次），默认 15，最小 1
  maxDurationMs?: number;             // 最大持续时间(ms)，默认 180000 (3分钟)，最小 1000
  idleTimeoutMs?: number;             // 空闲超时(ms)，默认 60000 (60秒)，最小 1000

  // 第四层：并发控制 - LRU 淘汰
  maxConcurrentSessions?: number;     // 最大并发会话数，默认 10，超出时淘汰最久未活动的会话
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

// 会话状态（用于终止控制）
export interface AcpSessionState {
  sessionId: string;
  targetAid: string;
  status: 'active' | 'closing' | 'closed';
  turns: number;                    // 入站消息次数
  consecutiveEmptyReplies: number;  // 连续空回复计数
  createdAt: number;                // 创建时间
  lastActivityAt: number;           // 最后活动时间
  closedAt?: number;                // 关闭时间
  closeReason?: string;             // 关闭原因
}

// 默认会话配置
export const DEFAULT_SESSION_CONFIG: Required<AcpSessionConfig> = {
  // 第一层
  endMarkers: ['[END]', '[GOODBYE]', '[NO_REPLY]'],
  consecutiveEmptyThreshold: 2,
  // 第二层
  sendEndMarkerOnClose: true,
  sendAckOnReceiveEnd: false,
  // 第三层
  maxTurns: 15,
  maxDurationMs: 600000,    // 10 分钟（匹配 maxTurns 15 轮 × ~30s/轮 + 余量）
  idleTimeoutMs: 120000,    // 120 秒（agent 间对话 tool call 延迟较大）
  // 第四层
  maxConcurrentSessions: 10, // 最大 10 个并发会话
};

/** 解析后的远程 agent.md */
export interface ParsedAgentMd {
  // YAML frontmatter 字段
  aid: string;
  name: string;
  type?: string;
  version?: string;
  description?: string;
  tags?: string[];

  // Markdown 正文提取
  aboutMe?: string;
  capabilities?: string[];
  interests?: string[];

  // 元数据
  raw: string;
  fetchedAt: number;
}

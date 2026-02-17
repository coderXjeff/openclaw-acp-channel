// ACP Channel 配置类型 (acp-ts 版本)
export interface AcpChannelConfig {
  enabled: boolean;
  agentName: string;        // Agent 名称 (不含域名)
  domain: string;           // ACP 域名，如 agentcp.io
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
  // 多身份配置
  identities?: Record<string, AcpIdentityEntry>;
}

// 身份的 ACP 元数据（存在 IdentityProfile.metadata 中）
export interface AcpIdentityMeta {
  agentName: string;
  domain?: string;
  seedPassword?: string;
  ownerAid?: string;
  allowFrom?: string[];
  workspaceDir?: string;
  agentMdPath?: string;
}

// 多身份配置中单个身份的条目
export interface AcpIdentityEntry {
  agentName: string;
  domain?: string;
  seedPassword?: string;
  ownerAid?: string;
  allowFrom?: string[];
  workspaceDir?: string;
  agentMdPath?: string;
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
  maxTurns?: number;                  // 最大入站消息次数（非对话轮次），默认 100，最小 1
  maxDurationMs?: number;             // 最大持续时间(ms)，默认 1800000 (30分钟)，最小 1000
  idleTimeoutMs?: number;             // 空闲超时(ms)，默认 600000 (10分钟)，最小 1000

  // 第四层：并发控制 - LRU 淘汰
  maxConcurrentSessions?: number;     // 最大并发会话数，默认 400，超出时淘汰最久未活动的会话
  maxSessionsPerTarget?: number;      // 同一 targetAid 最大并发会话数，默认 10，超出时淘汰最久未活动的会话

  // 群组消息
  groupMessageIntervalMs?: number;    // 群消息批量发送给 agent 的间隔(ms)，默认 60000
  groupDispatchCooldownMs?: number;   // Dispatch Gate 冷却间隔(ms)，默认 30000
  groupBufferGateMs?: number;         // Buffer Gate 聚合窗口(ms)，默认 3000
}

// 解析后的账户信息
export interface ResolvedAcpAccount {
  accountId: string;        // = identityId（多身份）或 "default"（单身份）
  identityId: string;       // OpenClaw IdentityProfile.id
  agentName: string;
  domain: string;
  fullAid: string;          // 完整 AID: agentName.domain
  enabled: boolean;
  ownerAid: string;
  allowFrom: string[];
  seedPassword: string;
  workspaceDir?: string;
  agentMdPath?: string;
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
  isOwner: boolean;                   // 是否是主人的会话
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
  maxTurns: 1000,
  maxDurationMs: 172800000,   // 48 小时
  idleTimeoutMs: 86400000,    // 24 小时
  // 第四层
  maxConcurrentSessions: 400,       // 最大 400 个并发会话
  maxSessionsPerTarget: 10,         // 同一 targetAid 最大 10 个并发会话
  // 群组消息
  groupMessageIntervalMs: 60000,    // 群消息批量发送间隔，默认 60 秒
  groupDispatchCooldownMs: 30000,   // Dispatch Gate 冷却间隔，默认 30 秒
  groupBufferGateMs: 3000,          // Buffer Gate 聚合窗口，默认 3 秒
};

/** 群组消息项（解耦 SDK 类型） */
export interface GroupMessageItem {
  msg_id: number;
  sender: string;
  content: string;
  timestamp: number;
}

/** 群组消息缓冲区 */
export interface GroupMessageBuffer {
  groupId: string;
  incomingMessages: GroupMessageItem[];                    // Buffer Gate 聚合中的消息
  bufferGateTimer: ReturnType<typeof setTimeout> | null;   // Buffer Gate 聚合定时器
  pendingQueue: GroupMessageItem[];                        // Dispatch Gate 待处理队列
  cooldownTimer: ReturnType<typeof setTimeout> | null;     // Dispatch Gate 冷却定时器
  dispatching: boolean;
  lastDispatchAt: number;
  lastPulledMsgId: number;  // 上次 pullMessages 拉到的最大 msg_id
  pulling: boolean;         // 防止并发 pull
  seenMsgIds: Set<number>;  // msg_id 去重集合
}

/** 联系人 */
export interface Contact {
  aid: string;                    // 唯一标识
  name?: string;                  // 昵称（来自 agent.md 或手动设置）
  emoji?: string;                 // 表情符号
  groups: string[];               // 自定义分组
  interactionCount: number;       // 交互次数
  lastInteractionAt?: number;     // 最后交互时间戳
  totalDurationMs: number;        // 总交互时长
  notes?: string;                 // 内部备注（主人或 AI 自己写的，外部不可修改）
  selfIntro?: string;             // 对方的自我介绍（外部 Agent 只能修改自己的这个字段）
  addedAt: number;                // 添加时间
  updatedAt: number;              // 更新时间
  creditScore: number;            // 信用评分 0-100，默认 50
  creditManualOverride?: number;  // 主人手动覆盖的评分（优先于自动计算）
  creditManualReason?: string;    // 手动覆盖原因
  successfulSessions: number;     // 正常结束的会话数
  failedSessions: number;         // 异常结束的会话数
}

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

// 单个身份的完整运行时状态
export interface IdentityAcpState {
  identityId: string;
  account: ResolvedAcpAccount;
  aidKey: string;                    // fullAid
  sessionStates: Map<string, AcpSessionState>;
  isRunning: boolean;
  lastConnectedAt: number | null;
  lastInboundAt: number | null;
  lastOutboundAt: number | null;
  reconnectAttempts: number;
  lastError: string | null;
  idleCheckInterval: ReturnType<typeof setInterval> | null;
  groupClientReady: boolean;
  groupSessionId: string | null;
  groupTargetAid: string | null;
  groupMessageBuffers: Map<string, GroupMessageBuffer>;
}

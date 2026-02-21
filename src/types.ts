// P1 群活力状态机与上下文注入
export interface GroupSocialConfig {
  enabled?: boolean;                // 总开关，默认 false
  mentionAliases?: string[];        // 全局提及别名
  mentionMinIntervalMs?: number;    // 提及最小节流 ms，默认 3000
  maxCharsPerMessage?: number;      // 回复最大字符数，默认 500
  vitalityWindowMs?: number;        // 活力滑窗 ms，默认 300000
  maxJoinedGroups?: number;         // 同时加入群上限，默认 10
}

export const DEFAULT_GROUP_SOCIAL_CONFIG: Required<GroupSocialConfig> = {
  enabled: false,
  mentionAliases: [],
  mentionMinIntervalMs: 3000,
  maxCharsPerMessage: 500,
  vitalityWindowMs: 300_000,
  maxJoinedGroups: 10,
};

export type VitalityState = "DORMANT" | "COOLING" | "ACTIVE" | "HEATED";

export interface VitalityWindow {
  events: { ts: number; sender: string }[];
  windowMs: number;
}

export interface GroupVitalityState {
  state: VitalityState;
  messagesIn5m: number;
  uniqueSpeakersIn5m: number;
  myMessagesIn5m: number;
  updatedAt: number;
}

export interface MentionInfo {
  mentioned: boolean;
  mentionCount: number;
  batchesMerged: number;
  triggerType: "normal" | "mention";
}

// ACP 单个身份配置（多身份模式）
export interface AcpIdentityEntry {
  agentName: string;        // Agent 名称 (不含域名)
  domain?: string;          // ACP 域名，如 agentcp.io
  seedPassword?: string;    // 种子密码
  ownerAid?: string | string[];  // 主人的 AID（支持单个或多个）
  allowFrom?: string[];     // 允许接收消息的 AID 列表
  agentMdPath?: string;     // agent.md 文件路径，登录后自动上传
  workspaceDir?: string;    // workspace 目录路径，用于自动生成 agent.md
  mentionAliases?: string[];  // P1: 提及别名列表
  profile?: {
    displayName?: string;
    description?: string;
    capabilities?: string[];
  };
}

// ACP Channel 配置类型 (acp-ts 版本)
export interface AcpChannelConfig {
  enabled: boolean;
  // 绑定策略：
  // strict: 强制一 Agent 一 AID（agentId/accountId 1:1）
  // flex:   保持当前灵活映射能力
  agentAidBindingMode?: "strict" | "flex";
  // 单身份配置（向后兼容）
  agentName?: string;       // Agent 名称 (不含域名)
  domain?: string;          // ACP 域名，如 agentcp.io
  seedPassword?: string;    // 种子密码
  ownerAid?: string | string[];  // 主人的 AID（支持单个或多个）
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
  // 多身份配置：key 为 accountId
  identities?: Record<string, AcpIdentityEntry>;
  // P1 群社交行为配置
  groupSocial?: GroupSocialConfig;
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

// 解析后的账户信息（每个 accountId 一份）
export interface ResolvedAcpAccount {
  accountId: string;
  identityId: string;
  agentAidBindingMode: "strict" | "flex";
  agentName: string;
  domain: string;
  fullAid: string;          // 完整 AID: agentName.domain
  enabled: boolean;
  ownerAid: string[];       // 主人的 AID 列表（解析后统一为数组）
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
  isMention?: boolean;  // P1: 是否命中提及检测
}

/** 群组消息缓冲区 */
export interface GroupMessageBuffer {
  groupId: string;
  incomingMessages: GroupMessageItem[];                    // Buffer Gate 聚合中的消息
  bufferGateTimer: ReturnType<typeof setTimeout> | null;   // Buffer Gate 聚合定时器
  incomingBatchCount: number;                              // incomingMessages 中累计的批次数
  pendingQueue: GroupMessageItem[];                        // Dispatch Gate 待处理队列
  pendingBatchCount: number;                               // pendingQueue 中累计的批次数
  cooldownTimer: ReturnType<typeof setTimeout> | null;     // Dispatch Gate 冷却定时器
  dispatching: boolean;
  lastDispatchAt: number;
  lastPulledMsgId: number;  // 上次 pullMessages 拉到的最大 msg_id
  pulling: boolean;         // 防止并发 pull
  seenMsgIds: Set<number>;  // msg_id 去重集合
  // P1 群活力 & 提及
  vitalityWindow: VitalityWindow;
  mentionKeywords: string[];
  selfSendEvents: { ts: number }[];
  lastSelfSpeakAt: number;
  hasPendingMention: boolean;
  lastNReplyHashes: string[];
  mentionDelayTimer: ReturnType<typeof setTimeout> | null;
}

// ===== 值班 Agent (Duty) 类型 =====

/** 值班配置（per-group，通过 API 管理）— v2 优先窗口模式，snake_case 与 SDK 对齐 */
export interface DutyConfig {
  mode: "none" | "fixed" | "rotation";
  rotation_strategy?: "round_robin" | "random";
  shift_duration_ms?: number;
  max_messages_per_shift?: number;
  duty_priority_window_ms?: number;
  enable_rule_prelude?: boolean;
  agents?: string[];
}

/** 值班状态 */
export interface DutyState {
  current_duty_agent?: string;
  shift_start_time?: number;
  messages_in_shift?: number;
  [key: string]: any;
}

/** 值班状态查询响应 */
export interface DutyStatusResp {
  config: DutyConfig;
  state: DutyState;
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

// 运行时状态（按 accountId 隔离）
export interface AcpRuntimeState {
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

/** @deprecated 使用 AcpRuntimeState */
export type IdentityAcpState = AcpRuntimeState;

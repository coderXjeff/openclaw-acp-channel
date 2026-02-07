// 简化的插件类型定义，避免直接依赖 openclaw 内部类型

export type ChannelId = string;

export type ChannelMeta = {
  id: ChannelId;
  label: string;
  selectionLabel: string;
  docsPath: string;
  blurb: string;
  detailLabel?: string;
  systemImage?: string;
  order?: number;
};

export type ChannelCapabilities = {
  chatTypes: Array<"direct" | "group" | "thread">;
  media?: boolean;
  threads?: boolean;
  blockStreaming?: boolean;
  reactions?: boolean;
  edit?: boolean;
  unsend?: boolean;
  reply?: boolean;
};

export type ChannelConfigUiHint = {
  label?: string;
  help?: string;
  advanced?: boolean;
  sensitive?: boolean;
  placeholder?: string;
};

export type ChannelConfigSchema = {
  schema: Record<string, unknown>;
  uiHints?: Record<string, ChannelConfigUiHint>;
};

export type ChannelConfigAdapter<ResolvedAccount> = {
  listAccountIds: (cfg: any) => string[];
  resolveAccount: (cfg: any, accountId?: string | null) => ResolvedAccount;
  defaultAccountId?: (cfg: any) => string;
  isEnabled?: (account: ResolvedAccount, cfg: any) => boolean;
  isConfigured?: (account: ResolvedAccount, cfg: any) => boolean;
  describeAccount?: (account: ResolvedAccount, cfg: any) => Record<string, unknown>;
  resolveAllowFrom?: (params: { cfg: any; accountId?: string | null }) => string[] | undefined;
};

export type ChannelOutboundAdapter = {
  deliveryMode: "direct" | "gateway" | "hybrid";
  textChunkLimit?: number;
  resolveTarget?: (params: {
    cfg?: any;
    to?: string;
    allowFrom?: string[];
    accountId?: string | null;
    mode?: string;
  }) => { ok: true; to: string } | { ok: false; error: Error };
  sendText?: (ctx: {
    cfg: any;
    to: string;
    text: string;
    accountId?: string | null;
  }) => Promise<{ ok: true; messageId?: string } | { ok: false; error: Error }>;
};

export type ChannelMessagingAdapter = {
  targetResolver?: {
    looksLikeId?: (raw: string, normalized: string) => boolean;
    hint?: string;
  };
};

// Message action types
export type ChannelMessageActionName = "send" | "react" | "reactions" | "read" | "sync-agent-md" | "manage-contacts";

export type ChannelMessageActionAdapter = {
  listActions: (ctx: { cfg: any; accountId?: string | null }) => ChannelMessageActionName[];
  supportsButtons?: () => boolean;
  extractToolSend?: (ctx: { args: Record<string, unknown> }) => { to: string; accountId?: string } | null;
  handleAction: (ctx: {
    action: ChannelMessageActionName;
    params: Record<string, unknown>;
    cfg: any;
    accountId?: string | null;
  }) => Promise<{ type: "json"; value: unknown }>;
};

// ===== 账户状态快照 =====
export type ChannelAccountSnapshot = {
  accountId: string;
  name?: string;
  enabled?: boolean;
  configured?: boolean;
  linked?: boolean;
  running?: boolean;
  connected?: boolean;
  reconnectAttempts?: number;
  lastConnectedAt?: number | null;
  lastDisconnect?: string | { at: number; status?: number; error?: string; loggedOut?: boolean } | null;
  lastMessageAt?: number | null;
  lastEventAt?: number | null;
  lastError?: string | null;
  lastStartAt?: number | null;
  lastStopAt?: number | null;
  lastInboundAt?: number | null;
  lastOutboundAt?: number | null;
  mode?: string;
  allowFrom?: string[];
  probe?: unknown;
  lastProbeAt?: number | null;
  [key: string]: unknown;
};

// ===== 日志接口 =====
export type ChannelLogSink = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  debug?: (msg: string) => void;
};

// ===== Gateway 相关类型 =====
export type ChannelGatewayContext<ResolvedAccount = unknown> = {
  cfg: any;
  accountId: string;
  account: ResolvedAccount;
  runtime: any;
  abortSignal: AbortSignal;
  log?: ChannelLogSink;
  getStatus: () => ChannelAccountSnapshot;
  setStatus: (next: ChannelAccountSnapshot) => void;
};

export type ChannelGatewayAdapter<ResolvedAccount = unknown> = {
  startAccount?: (ctx: ChannelGatewayContext<ResolvedAccount>) => Promise<unknown>;
  stopAccount?: (ctx: ChannelGatewayContext<ResolvedAccount>) => Promise<void>;
};

// ===== Status 相关类型 =====
export type ChannelAccountState = "linked" | "not linked" | "configured" | "not configured" | "enabled" | "disabled";

export type ChannelStatusIssue = {
  channel: ChannelId;
  accountId: string;
  kind: "intent" | "permissions" | "config" | "auth" | "runtime";
  message: string;
  fix?: string;
};

export type ChannelStatusAdapter<ResolvedAccount, Probe = unknown, Audit = unknown> = {
  defaultRuntime?: ChannelAccountSnapshot;
  buildChannelSummary?: (params: {
    account: ResolvedAccount;
    cfg: any;
    defaultAccountId: string;
    snapshot: ChannelAccountSnapshot;
  }) => Record<string, unknown> | Promise<Record<string, unknown>>;
  probeAccount?: (params: {
    account: ResolvedAccount;
    timeoutMs: number;
    cfg: any;
  }) => Promise<Probe>;
  auditAccount?: (params: {
    account: ResolvedAccount;
    timeoutMs: number;
    cfg: any;
    probe?: Probe;
  }) => Promise<Audit>;
  buildAccountSnapshot?: (params: {
    account: ResolvedAccount;
    cfg: any;
    runtime?: ChannelAccountSnapshot;
    probe?: Probe;
    audit?: Audit;
  }) => ChannelAccountSnapshot | Promise<ChannelAccountSnapshot>;
  logSelfId?: (params: {
    account: ResolvedAccount;
    cfg: any;
    runtime: any;
    includeChannelPrefix?: boolean;
  }) => void;
  resolveAccountState?: (params: {
    account: ResolvedAccount;
    cfg: any;
    configured: boolean;
    enabled: boolean;
  }) => ChannelAccountState;
  collectStatusIssues?: (accounts: ChannelAccountSnapshot[]) => ChannelStatusIssue[];
};

// ===== Channel Plugin =====
export type ChannelPlugin<ResolvedAccount = any, Probe = unknown, Audit = unknown> = {
  id: ChannelId;
  meta: ChannelMeta;
  capabilities: ChannelCapabilities;
  config: ChannelConfigAdapter<ResolvedAccount>;
  configSchema?: ChannelConfigSchema;
  outbound?: ChannelOutboundAdapter;
  messaging?: ChannelMessagingAdapter;
  actions?: ChannelMessageActionAdapter;
  status?: ChannelStatusAdapter<ResolvedAccount, Probe, Audit>;
  gateway?: ChannelGatewayAdapter<ResolvedAccount>;
  defaults?: {
    queue?: {
      debounceMs?: number;
    };
  };
};

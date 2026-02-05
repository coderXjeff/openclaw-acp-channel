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
export type ChannelMessageActionName = "send" | "react" | "reactions" | "read";

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

export type ChannelPlugin<ResolvedAccount = any> = {
  id: ChannelId;
  meta: ChannelMeta;
  capabilities: ChannelCapabilities;
  config: ChannelConfigAdapter<ResolvedAccount>;
  configSchema?: ChannelConfigSchema;
  outbound?: ChannelOutboundAdapter;
  messaging?: ChannelMessagingAdapter;
  actions?: ChannelMessageActionAdapter;
  defaults?: {
    queue?: {
      debounceMs?: number;
    };
  };
};

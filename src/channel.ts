import type { ChannelPlugin, ChannelConfigSchema } from "./plugin-types.js";
import type { ResolvedAcpAccount, AcpChannelConfig } from "./types.js";
import { acpConfigSchema } from "./config-schema.js";
import { acpMessageActions } from "./actions.js";

// Channel 元数据
const acpMeta = {
  id: "acp" as const,
  label: "ACP",
  selectionLabel: "ACP (Agent Communication Protocol)",
  docsPath: "/channels/acp",
  blurb: "Connect to ACP network for agent-to-agent communication (no Python bridge needed)",
  detailLabel: "ACP Network",
  systemImage: "network",
  order: 100,
};

// Channel 能力声明
const acpCapabilities = {
  chatTypes: ["direct" as const],
  media: false,
  threads: false,
  blockStreaming: true,
  reactions: false,
  edit: false,
  unsend: false,
  reply: false,
};

// 配置适配器
const acpConfigAdapter = {
  listAccountIds: (cfg: any): string[] => {
    const acpConfig = cfg.channels?.acp as AcpChannelConfig | undefined;
    if (!acpConfig?.enabled || !acpConfig?.agentName) {
      return [];
    }
    return ["default"];
  },

  resolveAccount: (cfg: any, accountId?: string | null): ResolvedAcpAccount => {
    const acpConfig = cfg.channels?.acp as AcpChannelConfig | undefined;
    const domain = acpConfig?.domain ?? "aid.pub";
    const agentName = acpConfig?.agentName ?? "";

    return {
      accountId: accountId ?? "default",
      agentName,
      domain,
      fullAid: agentName ? `${agentName}.${domain}` : "",
      enabled: acpConfig?.enabled ?? false,
      ownerAid: acpConfig?.ownerAid ?? "",
      allowFrom: acpConfig?.allowFrom ?? [],
      seedPassword: acpConfig?.seedPassword ?? "",
    };
  },

  defaultAccountId: (_cfg: any): string => "default",

  isEnabled: (account: ResolvedAcpAccount, _cfg: any): boolean => {
    return account.enabled && !!account.agentName;
  },

  isConfigured: (account: ResolvedAcpAccount, _cfg: any): boolean => {
    return !!account.agentName;
  },

  describeAccount: (account: ResolvedAcpAccount, _cfg: any) => ({
    accountId: account.accountId,
    name: account.fullAid,
    enabled: account.enabled,
    configured: !!account.agentName,
    allowFrom: account.allowFrom,
  }),

  resolveAllowFrom: (params: { cfg: any; accountId?: string | null }): string[] | undefined => {
    const acpConfig = params.cfg.channels?.acp as AcpChannelConfig | undefined;
    return acpConfig?.allowFrom;
  },
};

// 配置 Schema
const acpConfigSchemaAdapter: ChannelConfigSchema = {
  schema: acpConfigSchema as Record<string, unknown>,
  uiHints: {
    agentName: {
      label: "Agent Name",
      help: "Your agent name (without domain, e.g., 'my-agent')",
      placeholder: "my-agent",
    },
    domain: {
      label: "Domain",
      help: "ACP domain (default: aid.pub)",
      placeholder: "aid.pub",
    },
    seedPassword: {
      label: "Seed Password",
      help: "Password for ACP identity seed (optional)",
      sensitive: true,
    },
    ownerAid: {
      label: "Owner AID",
      help: "Owner's AID for privileged access (e.g., 'owner-name.aid.pub')",
      placeholder: "owner-name.aid.pub",
    },
    allowFrom: {
      label: "Allow From",
      help: "List of AIDs allowed to send messages (use * for all)",
    },
  },
};

// 出站消息适配器
const acpOutboundAdapter = {
  deliveryMode: "direct" as const,
  textChunkLimit: 4000,

  resolveTarget: (params: {
    cfg?: any;
    to?: string;
    allowFrom?: string[];
    accountId?: string | null;
    mode?: string;
  }) => {
    if (!params.to) {
      return { ok: false as const, error: new Error("No target specified") };
    }
    return { ok: true as const, to: params.to };
  },

  sendText: async (ctx: {
    cfg: any;
    to: string;
    text: string;
    accountId?: string | null;
  }) => {
    try {
      const { sendAcpMessage } = await import("./outbound.js");

      // 解析 to 格式: "acp:{targetAid}:{sessionId}" 或直接是 AID
      const parts = ctx.to.split(":");
      let targetAid: string;
      let sessionId: string;

      if (parts[0] === "acp" && parts.length >= 3) {
        targetAid = parts[1];
        sessionId = parts.slice(2).join(":");
      } else {
        targetAid = ctx.to;
        sessionId = "default";
      }

      await sendAcpMessage({
        to: targetAid,
        sessionId,
        content: ctx.text,
      });

      return {
        ok: true as const,
        messageId: `acp-${Date.now()}`,
      };
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  },

  sendMedia: async (_ctx: {
    cfg: any;
    to: string;
    media: any;
    caption?: string;
    accountId?: string | null;
  }) => {
    // ACP 目前不支持媒体文件
    return {
      ok: false as const,
      error: new Error("Media not supported by ACP channel"),
    };
  },
};

// Messaging 适配器 - 帮助 OpenClaw 识别 AID 格式
const acpMessagingAdapter = {
  targetResolver: {
    // 识别 AID 格式: name.domain 或 acp:name.domain:session
    looksLikeId: (raw: string, _normalized: string): boolean => {
      const trimmed = raw.trim();
      // 匹配 AID 格式: xxx.aid.pub 或 xxx.其他域名
      if (/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_.-]+$/.test(trimmed)) {
        return true;
      }
      // 匹配完整格式: acp:xxx.domain:session
      if (trimmed.startsWith("acp:") && trimmed.includes(".")) {
        return true;
      }
      return false;
    },
    hint: "Use AID format: agent-name.aid.pub",
  },
};

// 导出 Channel 插件
export const acpChannelPlugin: ChannelPlugin<ResolvedAcpAccount> = {
  id: "acp",
  meta: acpMeta,
  capabilities: acpCapabilities,
  config: acpConfigAdapter,
  configSchema: acpConfigSchemaAdapter,
  outbound: acpOutboundAdapter,
  messaging: acpMessagingAdapter,
  actions: acpMessageActions,
  defaults: {
    queue: {
      debounceMs: 500,
    },
  },
};

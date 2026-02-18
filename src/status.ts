import type {
  ChannelStatusAdapter,
  ChannelAccountSnapshot,
  ChannelAccountState,
  ChannelStatusIssue,
} from "./plugin-types.js";
import type { ResolvedAcpAccount } from "./types.js";
import { getConnectionSnapshot } from "./monitor.js";
import { AgentCP } from "acp-ts/dist/agentcp.js";
import * as path from "path";

const ACP_STORAGE_DIR = path.join(process.env.HOME || "~", ".acp-storage");

// 探测结果类型
export interface AcpProbeResult {
  ok: boolean;
  aid: string;
  heartbeatServer?: string;
  messageServer?: string;
  error?: string;
}

export const acpStatusAdapter: ChannelStatusAdapter<ResolvedAcpAccount, AcpProbeResult> = {
  defaultRuntime: {
    accountId: "default",
    running: false,
    connected: false,
  },

  probeAccount: async ({ account, timeoutMs }): Promise<AcpProbeResult> => {
    const aid = account.fullAid;
    if (!aid || !account.agentName) {
      return { ok: false, aid: "", error: "Agent name not configured" };
    }

    try {
      const acp = new AgentCP(account.domain, account.seedPassword || "", ACP_STORAGE_DIR);

      // 尝试加载 AID
      let loadedAid = await acp.loadAid(aid);
      if (!loadedAid) {
        loadedAid = await acp.createAid(aid);
      }

      // 尝试上线获取服务器配置（带超时）
      const onlinePromise = acp.online();
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Probe timeout")), timeoutMs)
      );

      const config = await Promise.race([onlinePromise, timeoutPromise]);

      return {
        ok: true,
        aid: loadedAid,
        heartbeatServer: config.heartbeatServer,
        messageServer: config.messageServer,
      };
    } catch (err) {
      return {
        ok: false,
        aid,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  buildAccountSnapshot: ({ account, cfg, runtime, probe }): ChannelAccountSnapshot => {
    const configured = Boolean(account.agentName?.trim());
    const connectionSnapshot = getConnectionSnapshot(account.accountId);

    return {
      accountId: account.accountId,
      name: account.fullAid,
      enabled: account.enabled,
      configured,
      running: connectionSnapshot.running ?? runtime?.running ?? false,
      connected: connectionSnapshot.connected ?? false,
      reconnectAttempts: connectionSnapshot.reconnectAttempts ?? 0,
      lastConnectedAt: connectionSnapshot.lastConnectedAt ?? runtime?.lastConnectedAt ?? null,
      lastDisconnect: connectionSnapshot.lastDisconnect ?? runtime?.lastDisconnect ?? null,
      lastError: connectionSnapshot.lastError ?? runtime?.lastError ?? null,
      lastStartAt: connectionSnapshot.lastStartAt ?? runtime?.lastStartAt ?? null,
      lastStopAt: connectionSnapshot.lastStopAt ?? runtime?.lastStopAt ?? null,
      lastInboundAt: connectionSnapshot.lastInboundAt ?? runtime?.lastInboundAt ?? null,
      lastOutboundAt: connectionSnapshot.lastOutboundAt ?? runtime?.lastOutboundAt ?? null,
      mode: "websocket",
      allowFrom: account.allowFrom,
      probe,
    };
  },

  resolveAccountState: ({ account, configured, enabled }): ChannelAccountState => {
    if (!configured) return "not configured";
    if (!enabled) return "disabled";
    return "configured";
  },

  logSelfId: ({ account, runtime, includeChannelPrefix }) => {
    const prefix = includeChannelPrefix ? "[ACP] " : "";
    const log = runtime?.log ?? console.log;
    log(`${prefix}${account.fullAid}`);
  },

  collectStatusIssues: (accounts: ChannelAccountSnapshot[]): ChannelStatusIssue[] => {
    const issues: ChannelStatusIssue[] = [];

    for (const snap of accounts) {
      if (!snap.configured) {
        const fix = snap.accountId === "default"
          ? "Set channels.acp.agentName or channels.acp.identities"
          : `Set channels.acp.identities.${snap.accountId}.agentName`;
        issues.push({
          channel: "acp",
          accountId: snap.accountId,
          kind: "config",
          message: "Agent name not configured",
          fix,
        });
      }

      if (snap.configured && !snap.enabled) {
        issues.push({
          channel: "acp",
          accountId: snap.accountId,
          kind: "config",
          message: "ACP channel is configured but not enabled",
          fix: "Set channels.acp.enabled to true",
        });
      }

      if (snap.enabled && snap.running && !snap.connected && snap.lastError) {
        issues.push({
          channel: "acp",
          accountId: snap.accountId,
          kind: "runtime",
          message: `Connection error: ${snap.lastError}`,
        });
      }
    }

    return issues;
  },
};

import type { ReplyPayload } from "openclaw/plugin-sdk";
import { syncAgentMd, getConnectionSnapshot, getAllSessionStates } from "./monitor.js";
import { getContactManager } from "./contacts.js";
import { getRouter } from "./identity-router.js";

/** 命令定义类型（openclaw 未导出 OpenClawPluginCommandDefinition，本地定义兼容类型） */
type PluginCommandDefinition = {
  name: string;
  description: string;
  acceptsArgs?: boolean;
  requireAuth?: boolean;
  handler: (ctx: any) => ReplyPayload | Promise<ReplyPayload>;
};

/**
 * /acp-sync 命令：手动同步 agent.md 到 ACP 网络
 */
export function createSyncCommand(): PluginCommandDefinition {
  return {
    name: "acp-sync",
    description: "Manually sync agent.md to the ACP network",
    acceptsArgs: true,
    requireAuth: true,
    handler: async (ctx) => {
      try {
        const identityId = (ctx.args ?? "").trim() || undefined;
        const result = await syncAgentMd(identityId);
        if (result.success) {
          return { text: `agent.md synced successfully.${result.url ? ` URL: ${result.url}` : ""}` };
        }
        return { text: `Sync failed: ${result.error ?? "unknown error"}` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { text: `Sync error: ${msg}` };
      }
    },
  };
}

/**
 * /acp-status 命令：查看 ACP 连接状态和联系人概况
 */
export function createStatusCommand(): PluginCommandDefinition {
  return {
    name: "acp-status",
    description: "Show ACP connection status, contacts summary, and active sessions",
    acceptsArgs: true,
    requireAuth: true,
    handler: (ctx) => {
      const targetIdentityId = (ctx.args ?? "").trim() || undefined;
      const router = getRouter();
      const allIdentityIds = router?.listIdentityIds() ?? [];
      const identityIds = targetIdentityId ? [targetIdentityId] : allIdentityIds;

      if (identityIds.length === 0) {
        const snapshot = getConnectionSnapshot();
        return {
          text: [
            "## ACP Status",
            "",
            `**Account:** ${snapshot.name ?? snapshot.accountId}`,
            `**Running:** ${snapshot.running ? "yes" : "no"}`,
            `**Connected:** ${snapshot.connected ? "yes" : "no"}`,
          ].join("\n"),
        };
      }

      const lines: string[] = ["## ACP Status"];

      for (const identityId of identityIds) {
        const snapshot = getConnectionSnapshot(identityId);
        const contacts = getContactManager(identityId).list();
        const sessions = getAllSessionStates(identityId);
        let activeSessions = 0;
        for (const s of sessions.values()) {
          if (s.status === "active") activeSessions++;
        }

        lines.push("");
        lines.push(`### ${snapshot.name ?? identityId}`);
        lines.push(`- Account: ${snapshot.accountId}`);
        lines.push(`- Running: ${snapshot.running ? "yes" : "no"}`);
        lines.push(`- Connected: ${snapshot.connected ? "yes" : "no"}`);
        lines.push(`- Reconnect attempts: ${snapshot.reconnectAttempts ?? 0}`);
        if (snapshot.lastConnectedAt) {
          lines.push(`- Last connected: ${new Date(snapshot.lastConnectedAt).toISOString()}`);
        }
        if (snapshot.lastError) {
          lines.push(`- Last error: ${snapshot.lastError}`);
        }
        lines.push(`- Contacts: ${contacts.length}`);
        lines.push(`- Active sessions: ${activeSessions}`);
        lines.push(`- Total sessions (incl. closed): ${sessions.size}`);
      }

      return { text: lines.join("\n") };
    },
  };
}

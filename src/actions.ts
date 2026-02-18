import type { ChannelMessageActionAdapter, ChannelMessageActionName } from "./plugin-types.js";
import type { AcpChannelConfig } from "./types.js";
import { sendAcpMessage, parseTarget } from "./outbound.js";

const providerId = "acp";

function isAcpEnabled(cfg: any): boolean {
  const acpConfig = cfg.channels?.acp as AcpChannelConfig | undefined;
  if (!acpConfig?.enabled) return false;
  const hasLegacy = !!acpConfig.agentName?.trim();
  const hasIdentities = !!acpConfig.identities && Object.keys(acpConfig.identities).length > 0;
  return hasLegacy || hasIdentities;
}

function jsonResult(value: unknown): { type: "json"; value: unknown } {
  return { type: "json", value };
}

function readStringParam(
  params: Record<string, unknown>,
  key: string,
  options?: { required?: boolean; allowEmpty?: boolean; trim?: boolean }
): string | null {
  const value = params[key];
  if (typeof value !== "string") {
    if (options?.required) {
      throw new Error(`Parameter "${key}" is required`);
    }
    return null;
  }
  const trimmed = options?.trim !== false ? value.trim() : value;
  if (!trimmed && !options?.allowEmpty) {
    if (options?.required) {
      throw new Error(`Parameter "${key}" cannot be empty`);
    }
    return null;
  }
  return trimmed;
}

export const acpMessageActions: ChannelMessageActionAdapter = {
  listActions: ({ cfg }) => {
    if (!isAcpEnabled(cfg)) {
      return [];
    }
    // 仅保留 send，sync-agent-md 走 command，manage-contacts 走 tool
    return ["send"];
  },

  supportsButtons: () => false,

  extractToolSend: ({ args }) => {
    const action = typeof args.action === "string" ? args.action.trim() : "";
    if (action !== "sendMessage") {
      return null;
    }
    const to = typeof args.to === "string" ? args.to : undefined;
    if (!to) {
      return null;
    }
    const accountId = typeof args.accountId === "string" ? args.accountId.trim() : undefined;
    return { to, accountId };
  },

  handleAction: async ({ action, params, cfg, accountId }) => {
    if (!isAcpEnabled(cfg)) {
      throw new Error("ACP channel is not enabled");
    }

    if (action === "send") {
      const to = readStringParam(params, "to", { required: true });
      const content = readStringParam(params, "message", {
        required: true,
        allowEmpty: true,
      });

      if (!to) {
        return jsonResult({ ok: false, error: "Target AID is required" });
      }

      try {
        const { targetAid, sessionId } = parseTarget(to);

        await sendAcpMessage({
          to: targetAid,
          sessionId,
          content: content ?? "",
          accountId: accountId ?? undefined,
        });

        return jsonResult({
          ok: true,
          to: targetAid,
          messageId: `acp-${Date.now()}`,
        });
      } catch (error) {
        return jsonResult({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    throw new Error(`Action ${action} is not supported for provider ${providerId}. Only "send" is supported.`);
  },
};

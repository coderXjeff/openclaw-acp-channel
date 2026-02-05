import type { ChannelMessageActionAdapter, ChannelMessageActionName } from "./plugin-types.js";
import type { AcpChannelConfig } from "./types.js";
import { sendAcpMessage } from "./outbound.js";
import { syncAgentMd } from "./monitor.js";

const providerId = "acp";

function isAcpEnabled(cfg: any): boolean {
  const acpConfig = cfg.channels?.acp as AcpChannelConfig | undefined;
  return !!(acpConfig?.enabled && acpConfig?.agentName);
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
    const actions = new Set<ChannelMessageActionName>(["send"]);
    // 添加 sync-agent-md action
    actions.add("sync-agent-md" as ChannelMessageActionName);
    return Array.from(actions);
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

    // 处理 sync-agent-md action
    if (action === "sync-agent-md") {
      try {
        const result = await syncAgentMd();
        return jsonResult(result);
      } catch (error) {
        return jsonResult({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
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
        // Parse to format: "acp:{targetAid}:{sessionId}" or direct AID
        const parts = to.split(":");
        let targetAid: string;
        let sessionId: string;

        if (parts[0] === "acp" && parts.length >= 3) {
          targetAid = parts[1];
          sessionId = parts.slice(2).join(":");
        } else {
          targetAid = to;
          sessionId = "default";
        }

        await sendAcpMessage({
          to: targetAid,
          sessionId,
          content: content ?? "",
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

    throw new Error(`Action ${action} is not supported for provider ${providerId}.`);
  },
};

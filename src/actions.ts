import type { ChannelMessageActionAdapter, ChannelMessageActionName } from "./plugin-types.js";
import type { AcpChannelConfig } from "./types.js";
import { sendAcpMessage, parseTarget } from "./outbound.js";
import { syncAgentMdForIdentity } from "./monitor.js";
import { getContactManager } from "./contacts.js";
import { getCreditLevel } from "./credit.js";

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
    actions.add("sync-agent-md");
    // 添加 manage-contacts action
    actions.add("manage-contacts");
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
        const result = await syncAgentMdForIdentity(accountId ?? undefined);
        return jsonResult(result);
      } catch (error) {
        return jsonResult({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // 处理 manage-contacts action
    if (action === "manage-contacts") {
      const subAction = readStringParam(params, "action", { required: true });
      const contacts = getContactManager(accountId ?? undefined);

      switch (subAction) {
        case "list": {
          const group = readStringParam(params, "group");
          return jsonResult({ contacts: contacts.list(group ?? undefined) });
        }
        case "get": {
          const aid = readStringParam(params, "aid", { required: true })!;
          const contact = contacts.get(aid);
          return jsonResult(contact ? { contact } : { error: "Contact not found" });
        }
        case "add": {
          const aid = readStringParam(params, "aid", { required: true })!;
          const name = readStringParam(params, "name");
          const emoji = readStringParam(params, "emoji");
          const notes = readStringParam(params, "notes");
          const now = Date.now();
          contacts.add({
            aid,
            name: name ?? undefined,
            emoji: emoji ?? undefined,
            notes: notes ?? undefined,
            groups: [],
            interactionCount: 0,
            totalDurationMs: 0,
            addedAt: now,
            updatedAt: now,
            creditScore: 50,
            successfulSessions: 0,
            failedSessions: 0,
          });
          return jsonResult({ ok: true, contact: contacts.get(aid) });
        }
        case "remove": {
          const aid = readStringParam(params, "aid", { required: true })!;
          const removed = contacts.remove(aid);
          return jsonResult({ ok: removed });
        }
        case "update": {
          const aid = readStringParam(params, "aid", { required: true })!;
          const updates: Record<string, unknown> = {};
          const name = readStringParam(params, "name");
          const emoji = readStringParam(params, "emoji");
          const notes = readStringParam(params, "notes");
          if (name !== null) updates.name = name;
          if (emoji !== null) updates.emoji = emoji;
          if (notes !== null) updates.notes = notes;
          const updated = contacts.update(aid, updates);
          return jsonResult(updated ? { ok: true, contact: updated } : { error: "Contact not found" });
        }
        case "addToGroup": {
          const aid = readStringParam(params, "aid", { required: true })!;
          const group = readStringParam(params, "group", { required: true })!;
          return jsonResult({ ok: contacts.addToGroup(aid, group) });
        }
        case "removeFromGroup": {
          const aid = readStringParam(params, "aid", { required: true })!;
          const group = readStringParam(params, "group", { required: true })!;
          return jsonResult({ ok: contacts.removeFromGroup(aid, group) });
        }
        case "listGroups": {
          return jsonResult({ groups: contacts.listGroups() });
        }
        case "setCreditScore": {
          const aid = readStringParam(params, "aid", { required: true })!;
          const score = Number(params.score);
          if (isNaN(score)) throw new Error('Parameter "score" must be a number');
          const reason = readStringParam(params, "reason");
          const result = contacts.setCreditScore(aid, score, reason ?? undefined);
          return jsonResult(result ? { ok: true, contact: result } : { error: "Contact not found" });
        }
        case "clearCreditOverride": {
          const aid = readStringParam(params, "aid", { required: true })!;
          const result = contacts.clearCreditOverride(aid);
          return jsonResult(result ? { ok: true, contact: result } : { error: "Contact not found" });
        }
        case "getCreditInfo": {
          const aid = readStringParam(params, "aid", { required: true })!;
          const contact = contacts.get(aid);
          if (!contact) return jsonResult({ error: "Contact not found" });
          return jsonResult({
            score: contact.creditScore,
            level: getCreditLevel(contact.creditScore),
            isManual: contact.creditManualOverride != null,
            successfulSessions: contact.successfulSessions,
            failedSessions: contact.failedSessions,
          });
        }
        default:
          throw new Error(`Unknown manage-contacts sub-action: ${subAction}`);
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
        const { targetAid, sessionId } = parseTarget(to);

        await sendAcpMessage({
          to: targetAid,
          sessionId,
          content: content ?? "",
          identityId: accountId ?? undefined,
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

import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { getAgentMdFetcher } from "./agent-md-fetcher.js";
import { getContactManager } from "./contacts.js";
import { getCreditLevel } from "./credit.js";
import { getRouter } from "./identity-router.js";

function resolveIdentityIdByAid(selfAid?: string): string | undefined {
  if (!selfAid) return undefined;
  const router = getRouter();
  if (!router) return undefined;
  const state = router.getStateByAid(selfAid);
  return state?.identityId;
}

// ===== 工具 1: acp_fetch_agent_md =====

const FetchAgentMdParams = Type.Object({
  target_aid: Type.String({ description: "The AID (Agent ID) to fetch agent.md for, e.g. 'alice.agentcp.io'" }),
  aid: Type.Optional(Type.String({ description: "Your AID (e.g. guard.agentcp.io). Pass your own AID from the session context." })),
  refresh: Type.Optional(Type.Boolean({ description: "Force refresh from remote, bypassing cache. Default: false" })),
});

type FetchAgentMdInput = Static<typeof FetchAgentMdParams>;

const fetchAgentMdTool: AgentTool<typeof FetchAgentMdParams, unknown> = {
  name: "acp_fetch_agent_md",
  label: "Fetch Agent Card",
  description:
    "Fetch the agent.md profile card for a given AID on the ACP network. " +
    "Returns structured metadata including name, description, capabilities, and interests. " +
    "Use this to learn about another agent before interacting with them.",
  parameters: FetchAgentMdParams,
  async execute(_toolCallId, params: FetchAgentMdInput): Promise<AgentToolResult<unknown>> {
    const { target_aid, refresh } = params;
    const fetcher = getAgentMdFetcher();

    try {
      const result = refresh ? await fetcher.refresh(target_aid) : await fetcher.fetch(target_aid);
      if (!result) {
        return {
          content: [{ type: "text", text: `No agent.md found for ${target_aid}` }],
          details: { aid: target_aid, found: false },
        };
      }
      const summary = [
        `# ${result.name}`,
        result.description ? `> ${result.description}` : null,
        result.type ? `Type: ${result.type}` : null,
        result.version ? `Version: ${result.version}` : null,
        result.tags?.length ? `Tags: ${result.tags.join(", ")}` : null,
        result.aboutMe ? `\n## About\n${result.aboutMe}` : null,
        result.capabilities?.length ? `\n## Capabilities\n${result.capabilities.map((c) => `- ${c}`).join("\n")}` : null,
        result.interests?.length ? `\n## Interests\n${result.interests.map((i) => `- ${i}`).join("\n")}` : null,
      ]
        .filter(Boolean)
        .join("\n");
      return {
        content: [{ type: "text", text: summary }],
        details: { aid: target_aid, found: true, parsed: result },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error fetching agent.md for ${target_aid}: ${msg}` }],
        details: { aid: target_aid, error: msg },
      };
    }
  },
};

export function createFetchAgentMdTool(): () => AgentTool<typeof FetchAgentMdParams, unknown> {
  return () => fetchAgentMdTool;
}

// ===== 工具 2: acp_manage_contacts =====

const ManageContactsParams = Type.Object({
  action: Type.String({
    description:
      "The sub-action to perform. One of: list, get, add, remove, update, " +
      "addToGroup, removeFromGroup, listGroups, setCreditScore, clearCreditOverride, getCreditInfo, " +
      "setSelfIntro (allows an external agent to set their own self-introduction only)",
  }),
  self_aid: Type.Optional(Type.String({ description: "Your AID (e.g. guard.agentcp.io). Pass your own AID from the session context." })),
  aid: Type.Optional(Type.String({ description: "Agent ID (required for most actions except list/listGroups)" })),
  name: Type.Optional(Type.String({ description: "Contact display name (for add/update)" })),
  emoji: Type.Optional(Type.String({ description: "Contact emoji (for add/update)" })),
  notes: Type.Optional(Type.String({ description: "Internal notes — only owner or your own judgment may set this (for add/update)" })),
  selfIntro: Type.Optional(Type.String({ description: "Self-introduction text from the external agent themselves (for setSelfIntro, max 200 chars)" })),
  group: Type.Optional(Type.String({ description: "Group name (for list/addToGroup/removeFromGroup)" })),
  score: Type.Optional(Type.Number({ description: "Credit score 0-100 (for setCreditScore)" })),
  reason: Type.Optional(Type.String({ description: "Reason for manual credit override (for setCreditScore)" })),
});

type ManageContactsInput = Static<typeof ManageContactsParams>;

function textResult(text: string, details: unknown): AgentToolResult<unknown> {
  return { content: [{ type: "text", text }], details };
}

const manageContactsTool: AgentTool<typeof ManageContactsParams, unknown> = {
  name: "acp_manage_contacts",
  label: "Manage Contacts",
  description:
    "Manage ACP contacts: list, get, add, remove, update contacts; " +
    "manage groups (addToGroup, removeFromGroup, listGroups); " +
    "manage credit scores (setCreditScore, clearCreditOverride, getCreditInfo). " +
    "Use this to view and manage the agent's contact list and trust relationships.",
  parameters: ManageContactsParams,
  async execute(_toolCallId, params: ManageContactsInput): Promise<AgentToolResult<unknown>> {
    const identityId = resolveIdentityIdByAid(params.self_aid);
    const contacts = getContactManager(identityId);
    const { action, aid } = params;

    try {
      switch (action) {
        case "list": {
          const list = contacts.list(params.group ?? undefined);
          const text = list.length === 0
            ? "No contacts found."
            : list.map((c) => `- ${c.aid}${c.name ? ` (${c.name})` : ""} [credit: ${c.creditScore}]`).join("\n");
          return textResult(text, { contacts: list });
        }
        case "get": {
          if (!aid) return textResult("Error: aid is required", { error: "aid required" });
          const c = contacts.get(aid);
          if (!c) return textResult(`Contact ${aid} not found.`, { error: "not found" });
          return textResult(JSON.stringify(c, null, 2), { contact: c });
        }
        case "add": {
          if (!aid) return textResult("Error: aid is required", { error: "aid required" });
          const now = Date.now();
          contacts.add({
            aid,
            name: params.name ?? undefined,
            emoji: params.emoji ?? undefined,
            notes: params.notes ?? undefined,
            groups: [],
            interactionCount: 0,
            totalDurationMs: 0,
            addedAt: now,
            updatedAt: now,
            creditScore: 50,
            successfulSessions: 0,
            failedSessions: 0,
          });
          return textResult(`Contact ${aid} added.`, { ok: true, contact: contacts.get(aid) });
        }
        case "remove": {
          if (!aid) return textResult("Error: aid is required", { error: "aid required" });
          const removed = contacts.remove(aid);
          return textResult(removed ? `Contact ${aid} removed.` : `Contact ${aid} not found.`, { ok: removed });
        }
        case "update": {
          if (!aid) return textResult("Error: aid is required", { error: "aid required" });
          const updates: Record<string, unknown> = {};
          if (params.name != null) updates.name = params.name;
          if (params.emoji != null) updates.emoji = params.emoji;
          if (params.notes != null) updates.notes = params.notes;
          const updated = contacts.update(aid, updates);
          if (!updated) return textResult(`Contact ${aid} not found.`, { error: "not found" });
          return textResult(`Contact ${aid} updated.`, { ok: true, contact: updated });
        }
        case "addToGroup": {
          if (!aid) return textResult("Error: aid is required", { error: "aid required" });
          if (!params.group) return textResult("Error: group is required", { error: "group required" });
          const ok = contacts.addToGroup(aid, params.group);
          return textResult(ok ? `Added ${aid} to group "${params.group}".` : `Contact ${aid} not found.`, { ok });
        }
        case "removeFromGroup": {
          if (!aid) return textResult("Error: aid is required", { error: "aid required" });
          if (!params.group) return textResult("Error: group is required", { error: "group required" });
          const ok2 = contacts.removeFromGroup(aid, params.group);
          return textResult(ok2 ? `Removed ${aid} from group "${params.group}".` : `Contact ${aid} not found or not in group.`, { ok: ok2 });
        }
        case "listGroups": {
          const groups = contacts.listGroups();
          const text = groups.length === 0 ? "No groups found." : groups.map((g) => `- ${g}`).join("\n");
          return textResult(text, { groups });
        }
        case "setCreditScore": {
          if (!aid) return textResult("Error: aid is required", { error: "aid required" });
          if (params.score == null || isNaN(params.score)) return textResult("Error: score is required and must be a number", { error: "score required" });
          const result = contacts.setCreditScore(aid, params.score, params.reason ?? undefined);
          if (!result) return textResult(`Contact ${aid} not found.`, { error: "not found" });
          return textResult(`Credit score for ${aid} set to ${result.creditScore}.`, { ok: true, contact: result });
        }
        case "clearCreditOverride": {
          if (!aid) return textResult("Error: aid is required", { error: "aid required" });
          const cleared = contacts.clearCreditOverride(aid);
          if (!cleared) return textResult(`Contact ${aid} not found.`, { error: "not found" });
          return textResult(`Credit override cleared for ${aid}. Auto score: ${cleared.creditScore}.`, { ok: true, contact: cleared });
        }
        case "getCreditInfo": {
          if (!aid) return textResult("Error: aid is required", { error: "aid required" });
          const contact = contacts.get(aid);
          if (!contact) return textResult(`Contact ${aid} not found.`, { error: "not found" });
          const level = getCreditLevel(contact.creditScore);
          const info = {
            score: contact.creditScore,
            level,
            isManual: contact.creditManualOverride != null,
            successfulSessions: contact.successfulSessions,
            failedSessions: contact.failedSessions,
          };
          const text = `Credit for ${aid}: score=${info.score}, level=${info.level}, manual=${info.isManual}, sessions=${info.successfulSessions}ok/${info.failedSessions}fail`;
          return textResult(text, info);
        }
        case "setSelfIntro": {
          if (!aid) return textResult("Error: aid is required", { error: "aid required" });
          const introText = (params.selfIntro ?? "").substring(0, 200);
          if (!introText) return textResult("Error: selfIntro is required", { error: "selfIntro required" });
          const c = contacts.get(aid);
          if (!c) return textResult(`Contact ${aid} not found. They must be in your contact list first.`, { error: "not found" });
          const updated = contacts.update(aid, { selfIntro: introText });
          if (!updated) return textResult(`Failed to update ${aid}.`, { error: "update failed" });
          return textResult(`Self-introduction for ${aid} updated.`, { ok: true });
        }
        default:
          return textResult(`Unknown action: ${action}`, { error: `unknown action: ${action}` });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return textResult(`Error: ${msg}`, { error: msg });
    }
  },
};

export function createManageContactsTool(): () => AgentTool<typeof ManageContactsParams, unknown> {
  return () => manageContactsTool;
}

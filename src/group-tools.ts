/**
 * acp_group 聚合工具 — 通过单一工具完成所有群组操作
 */
import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { GroupOperations } from "acp-ts";
import { getRouter } from "./identity-router.js";
import { getGroupOps, getGroupAcp } from "./group-client.js";
import type { IdentityAcpState } from "./types.js";
import * as fs from "fs";

const DEBUG_LOG = "/tmp/acp-group-debug.log";
function debugLog(msg: string): void {
  const line = `[${new Date().toISOString()}] [group-tools] ${msg}\n`;
  try { fs.appendFileSync(DEBUG_LOG, line); } catch {}
}

const AcpGroupParams = Type.Object({
  action: Type.String({
    description:
      "The group action to perform. One of: list_groups (retrieve all groups the specified AID has joined; use sync=true to fetch from server), " +
      "create_group, get_group_info, get_members, " +
      "send_message, pull_messages, join_by_url, leave_group, add_member, remove_member, dissolve_group, " +
      "search_groups, get_announcement, update_announcement, create_invite_code, update_group_meta, " +
      "get_public_info, ban_agent, unban_agent, review_join_request, get_pending_requests",
  }),
  aid: Type.String({ description: "REQUIRED. Your full AID identity (e.g. seer.agentcp.io, guard.agentcp.io). You MUST always pass your own AID. Without this parameter, the tool cannot identify which agent's groups to operate on." }),
  group_id: Type.Optional(Type.String({ description: "Group ID (required for most group-specific actions)" })),
  group_url: Type.Optional(Type.String({ description: "Group URL for join_by_url, e.g. https://group.agentcp.io/<id>" })),
  name: Type.Optional(Type.String({ description: "Group name (for create_group)" })),
  alias: Type.Optional(Type.String({ description: "Group alias (for create_group / update_group_meta)" })),
  subject: Type.Optional(Type.String({ description: "Group subject (for create_group / update_group_meta)" })),
  visibility: Type.Optional(Type.String({ description: "Group visibility: public or private" })),
  tags: Type.Optional(Type.String({ description: "Comma-separated tags (for create_group / update_group_meta)" })),
  content: Type.Optional(Type.String({ description: "Message content or announcement content" })),
  content_type: Type.Optional(Type.String({ description: "Content type for send_message" })),
  agent_id: Type.Optional(Type.String({ description: "Agent AID (for add_member, remove_member, ban, etc.)" })),
  role: Type.Optional(Type.String({ description: "Member role (for add_member)" })),
  invite_code: Type.Optional(Type.String({ description: "Invite code (for join_by_url)" })),
  message: Type.Optional(Type.String({ description: "Join request message (for join_by_url)" })),
  keyword: Type.Optional(Type.String({ description: "Search keyword (for search_groups)" })),
  limit: Type.Optional(Type.Number({ description: "Limit for pull_messages / search_groups" })),
  offset: Type.Optional(Type.Number({ description: "Offset for search_groups" })),
  reason: Type.Optional(Type.String({ description: "Reason (for ban_agent / review_join_request)" })),
  review_action: Type.Optional(Type.String({ description: "Review action: approve or reject (for review_join_request)" })),
  label: Type.Optional(Type.String({ description: "Label for invite code" })),
  max_uses: Type.Optional(Type.Number({ description: "Max uses for invite code" })),
  expires_at: Type.Optional(Type.Number({ description: "Expiry timestamp for invite code" })),
  sync: Type.Optional(Type.Boolean({ description: "For list_groups: when true, fetches the full list of joined groups from the server and merges with local cache. Recommended to set true to get accurate results." })),
  metadata: Type.Optional(Type.String({ description: "JSON string of metadata (for send_message)" })),
});

type AcpGroupInput = Static<typeof AcpGroupParams>;

function textResult(text: string, details: unknown): AgentToolResult<unknown> {
  return { content: [{ type: "text", text }], details };
}

function resolveStateByAid(aid?: string): { state: IdentityAcpState; error?: undefined } | { state?: undefined; error: string } {
  const router = getRouter();
  if (!router) {
    debugLog(`resolveStateByAid FAIL: router is null`);
    return { error: "ACP router not initialized. Is ACP connected?" };
  }

  let state: IdentityAcpState | undefined;

  if (aid) {
    // 1. 精确匹配完整 AID（如 "guard.agentcp.io"）
    state = router.getStateByAid(aid);

    // 2. 如果没找到，尝试模糊匹配：agent 可能只传了 agentName（如 "guard"）
    //    遍历所有已注册身份，找 aidKey 以 "{aid}." 开头的
    if (!state) {
      debugLog(`resolveStateByAid: exact match failed for "${aid}", trying fuzzy match...`);
      const allIds = router.listIdentityIds();
      for (const identityId of allIds) {
        const candidate = router.getState(identityId);
        if (candidate && (
          candidate.aidKey.startsWith(`${aid}.`) ||
          candidate.account.agentName === aid ||
          candidate.identityId === aid
        )) {
          state = candidate;
          debugLog(`resolveStateByAid: fuzzy matched "${aid}" → ${candidate.aidKey} (identity=${identityId})`);
          break;
        }
      }
    }
  } else {
    state = router.getDefaultState();
  }

  if (!state) {
    const allIds = router.listIdentityIds();
    const registered = allIds.map(id => router.getState(id)?.aidKey).filter(Boolean).join(", ");
    debugLog(`resolveStateByAid FAIL: state not found for aid=${aid ?? "default"}, registered AIDs: [${registered}]`);
    return { error: `Identity for AID ${aid ?? "default"} not found. Registered AIDs: [${registered}]` };
  }
  if (!state.groupClientReady) {
    debugLog(`resolveStateByAid FAIL: groupClientReady=false for aid=${state.aidKey}, groupSessionId=${state.groupSessionId}, groupTargetAid=${state.groupTargetAid}`);
    return { error: `Group client not ready for ${state.aidKey}. ACP may still be connecting.` };
  }

  debugLog(`resolveStateByAid OK: aid=${state.aidKey}, identity=${state.identityId}, groupClientReady=${state.groupClientReady}`);
  return { state };
}

function parseTags(tags?: string): string[] | undefined {
  if (!tags) return undefined;
  return tags.split(",").map((t) => t.trim()).filter(Boolean);
}

function parseMetadata(metadata?: string): Record<string, any> | undefined | "invalid" {
  if (!metadata) return undefined;
  try {
    return JSON.parse(metadata);
  } catch {
    return "invalid";
  }
}

const acpGroupTool: AgentTool<typeof AcpGroupParams, unknown> = {
  name: "acp_group",
  label: "Group Chat",
  description:
    "Manage ACP group chats: create/join/leave groups, send/pull messages, manage members, " +
    "announcements, invite codes, search groups, and more. Use the 'action' parameter to specify the operation. " +
    "Use 'list_groups' with sync=true to retrieve all groups that a specified AID (including yourself) has joined from the server. " +
    "IMPORTANT: You MUST always pass your own AID (e.g. seer.agentcp.io) in the 'aid' parameter for EVERY call. " +
    "Without 'aid', the tool cannot determine which agent's groups to operate on and will return an error.",
  parameters: AcpGroupParams,

  async execute(_toolCallId, params: AcpGroupInput): Promise<AgentToolResult<unknown>> {
    const { action } = params;
    debugLog(`=== Tool execute START === action=${action}, params=${JSON.stringify(params)}`);
    console.log(`[ACP-Group] Tool called: action=${action}, params=${JSON.stringify(params)}`);

    try {
      // aid 是必传参数，没传直接报错
      if (!params.aid) {
        const errMsg = "Error: 'aid' parameter is REQUIRED. You must pass your own AID (e.g. seer.agentcp.io) in every acp_group call.";
        debugLog(`FAIL: aid not provided`);
        return textResult(errMsg, { error: "aid is required" });
      }

      const resolved = resolveStateByAid(params.aid);
      if (resolved.error) {
        debugLog(`resolveState FAILED: ${resolved.error}`);
        console.log(`[ACP-Group] resolveState failed: ${resolved.error}`);
        return textResult(`Error: ${resolved.error}`, { error: resolved.error });
      }

      const state = resolved.state!;
      debugLog(`Resolved OK: identity=${state.identityId}, groupClientReady=${state.groupClientReady}, targetAid=${state.groupTargetAid}, sessionId=${state.groupSessionId}`);
      console.log(`[ACP-Group] Resolved identity=${state.identityId}, groupClientReady=${state.groupClientReady}, groupTargetAid=${state.groupTargetAid}, groupSessionId=${state.groupSessionId}`);
      const groupOps = getGroupOps(state);
      const acp = getGroupAcp(state);
      const targetAid = state.groupTargetAid!;

      if (!groupOps || !acp) {
        debugLog(`FAIL: groupOps=${!!groupOps}, acp=${!!acp} — not initialized`);
        console.log(`[ACP-Group] groupOps=${!!groupOps}, acp=${!!acp} — not initialized`);
        return textResult("Error: Group operations not available", { error: "groupOps not initialized" });
      }
      debugLog(`groupOps OK, acp OK, targetAid=${targetAid}, executing action=${action}...`);

      switch (action) {
        case "list_groups": {
          debugLog(`list_groups: sync=${params.sync ?? false}, aid=${state.aidKey}, targetAid=${targetAid}`);

          // 始终先读取本地缓存（SDK 在加群时会主动保存群信息到本地）
          const localGroups = acp.getLocalGroupList();
          debugLog(`list_groups: local cache has ${localGroups.length} groups`);
          for (let i = 0; i < localGroups.length; i++) {
            debugLog(`list_groups: local[${i}] id=${localGroups[i].group_id}, name=${localGroups[i].name}`);
          }

          if (params.sync) {
            // 尝试从服务器同步
            let serverGroups: typeof localGroups = [];
            try {
              debugLog(`list_groups: calling acp.syncGroupList()...`);
              serverGroups = await acp.syncGroupList();
              debugLog(`list_groups: syncGroupList returned ${serverGroups.length} groups`);
              for (let i = 0; i < serverGroups.length; i++) {
                debugLog(`list_groups: server[${i}] id=${serverGroups[i].group_id}, name=${serverGroups[i].name}, members=${serverGroups[i].member_count ?? "?"}`);
              }
            } catch (err) {
              debugLog(`list_groups: syncGroupList ERROR: ${err instanceof Error ? err.message : String(err)}, falling back to local`);
            }

            // 合并：以服务器为基础，补充本地独有的群（如通过邀请码加入但服务器尚未同步的）
            const mergedMap = new Map<string, typeof localGroups[number]>();
            // 先放本地数据
            for (const g of localGroups) {
              mergedMap.set(g.group_id, g);
            }
            // 服务器数据覆盖（信息更完整，有 member_count 等）
            for (const g of serverGroups) {
              mergedMap.set(g.group_id, g);
            }
            const merged = Array.from(mergedMap.values());
            debugLog(`list_groups: merged result: ${merged.length} groups (local=${localGroups.length}, server=${serverGroups.length})`);

            const text = merged.length === 0
              ? "No groups found."
              : merged.map((g) => `- ${g.name} (${g.group_id})${g.member_count != null ? ` [${g.member_count} members]` : ""}`).join("\n");
            return textResult(text, { groups: merged });
          }

          // 非 sync 模式：直接返回本地缓存
          const text = localGroups.length === 0
            ? "No groups in local cache. Try with sync=true to fetch from server."
            : localGroups.map((g) => `- ${g.name} (${g.group_id})`).join("\n");
          return textResult(text, { groups: localGroups });
        }

        case "create_group": {
          if (!params.name) return textResult("Error: name is required for create_group", { error: "name required" });
          console.log(`[ACP-Group] create_group: name=${params.name}, targetAid=${targetAid}`);
          const result = await groupOps.createGroup(targetAid, params.name, {
            alias: params.alias,
            subject: params.subject,
            visibility: params.visibility,
            tags: parseTags(params.tags),
          });
          acp.addGroupToStore(result.group_id, params.name);
          return textResult(
            `Group created: ${params.name}\nID: ${result.group_id}\nURL: ${result.group_url}`,
            result
          );
        }

        case "get_group_info": {
          if (!params.group_id) return textResult("Error: group_id is required", { error: "group_id required" });
          const info = await groupOps.getGroupInfo(targetAid, params.group_id);
          const lines = [
            `Name: ${info.name}`,
            `ID: ${info.group_id}`,
            `Creator: ${info.creator}`,
            `Members: ${info.member_count}`,
            `Visibility: ${info.visibility}`,
            `Status: ${info.status}`,
            info.subject ? `Subject: ${info.subject}` : null,
            info.alias ? `Alias: ${info.alias}` : null,
            info.tags?.length ? `Tags: ${info.tags.join(", ")}` : null,
          ].filter(Boolean).join("\n");
          return textResult(lines, info);
        }

        case "get_members": {
          if (!params.group_id) return textResult("Error: group_id is required", { error: "group_id required" });
          const result = await groupOps.getMembers(targetAid, params.group_id);
          const text = result.members.length === 0
            ? "No members found."
            : result.members.map((m: any) => `- ${m.agent_id ?? m.aid ?? JSON.stringify(m)}`).join("\n");
          return textResult(text, result);
        }

        case "send_message": {
          if (!params.group_id) return textResult("Error: group_id is required", { error: "group_id required" });
          if (!params.content) return textResult("Error: content is required", { error: "content required" });
          console.log(`[ACP-Group] send_message: group_id=${params.group_id}, content_length=${params.content.length}`);
          const meta = parseMetadata(params.metadata);
          if (meta === "invalid") return textResult("Error: metadata is not valid JSON", { error: "invalid metadata JSON" });
          const result = await groupOps.sendGroupMessage(
            targetAid, params.group_id, params.content,
            params.content_type, meta
          );
          return textResult(`Message sent (msg_id: ${result.msg_id})`, result);
        }

        case "pull_messages": {
          if (!params.group_id) return textResult("Error: group_id is required", { error: "group_id required" });
          const limit = typeof params.limit === "number" && params.limit > 0 ? Math.floor(params.limit) : 20;
          debugLog(`pull_messages(local): group_id=${params.group_id}, limit=${limit}, aid=${state.aidKey}`);
          const messages = acp.getLocalGroupMessages(params.group_id);
          debugLog(`pull_messages(local): local store has ${messages.length} messages for group=${params.group_id}`);
          if (messages.length === 0) {
            debugLog(`pull_messages(local): no local messages for group=${params.group_id}`);
            return textResult("No local messages.", { messages: [], total: 0, source: "local_cache" });
          }
          const display = messages.slice(-limit);
          debugLog(`pull_messages(local): displaying ${display.length} of ${messages.length} local messages`);
          for (let i = 0; i < Math.min(display.length, 5); i++) {
            const m = display[i];
            debugLog(`pull_messages(local): msg[${i}] sender=${m.sender}, ts=${m.timestamp}, content="${String(m.content).substring(0, 80)}"`);
          }
          const text = display.map((m) => {
            // timestamp 可能是秒级或毫秒级，根据数值大小判断
            const ts = m.timestamp > 1e12 ? m.timestamp : m.timestamp * 1000;
            return `[${new Date(ts).toLocaleString()}] ${m.sender}: ${m.content}`;
          }).join("\n");
          return textResult(text, { messages: display, total: messages.length, source: "local_cache" });
        }

        case "join_by_url": {
          if (!params.group_url) return textResult("Error: group_url is required", { error: "group_url required" });
          debugLog(`join_by_url: group_url=${params.group_url}, invite_code=${params.invite_code ?? "none"}, aid=${state.aidKey}`);
          // 自动从 URL 中提取 ?code= 参数作为 invite_code
          let groupUrl = params.group_url;
          let inviteCode = params.invite_code;
          if (!inviteCode) {
            try {
              const urlObj = new URL(groupUrl);
              const codeParam = urlObj.searchParams.get("code");
              if (codeParam) {
                inviteCode = codeParam;
                urlObj.searchParams.delete("code");
                groupUrl = urlObj.toString();
                debugLog(`join_by_url: extracted invite_code=${inviteCode} from URL, cleaned URL=${groupUrl}`);
              }
            } catch {}
          }

          const { groupId } = GroupOperations.parseGroupUrl(groupUrl);
          debugLog(`join_by_url: parsed groupId=${groupId}, calling joinByUrl with identity=${state.aidKey}, targetAid=${targetAid}`);

          console.log(`[ACP-Group] join_by_url: url=${groupUrl}, inviteCode=${inviteCode ?? "none"}, identity=${state.aidKey}`);
          const requestId = await groupOps.joinByUrl(groupUrl, {
            inviteCode,
            message: params.message,
          });
          if (requestId) {
            debugLog(`join_by_url: request submitted, requestId=${requestId}, groupId=${groupId}`);
            console.log(`[ACP-Group] join_by_url: request submitted, requestId=${requestId}, groupId=${groupId}`);
            return textResult(`Join request submitted (request_id: ${requestId}). Waiting for approval.`, { request_id: requestId, group_id: groupId });
          }
          // 免审核加入成功，同步到本地存储
          acp.addGroupToStore(groupId, groupId);
          debugLog(`join_by_url: joined group ${groupId} (auto-approved), added to store`);
          console.log(`[ACP-Group] join_by_url: joined group ${groupId} (auto-approved)`);
          return textResult(`Successfully joined group ${groupId}`, { group_id: groupId });
        }

        case "leave_group": {
          if (!params.group_id) return textResult("Error: group_id is required", { error: "group_id required" });
          await groupOps.leaveGroup(targetAid, params.group_id);
          await acp.removeGroupFromStore(params.group_id);
          return textResult(`Left group ${params.group_id}`, { ok: true });
        }

        case "add_member": {
          if (!params.group_id) return textResult("Error: group_id is required", { error: "group_id required" });
          if (!params.agent_id) return textResult("Error: agent_id is required", { error: "agent_id required" });
          await groupOps.addMember(targetAid, params.group_id, params.agent_id, params.role);
          return textResult(`Added ${params.agent_id} to group ${params.group_id}`, { ok: true });
        }

        case "remove_member": {
          if (!params.group_id) return textResult("Error: group_id is required", { error: "group_id required" });
          if (!params.agent_id) return textResult("Error: agent_id is required", { error: "agent_id required" });
          await groupOps.removeMember(targetAid, params.group_id, params.agent_id);
          return textResult(`Removed ${params.agent_id} from group ${params.group_id}`, { ok: true });
        }

        case "dissolve_group": {
          if (!params.group_id) return textResult("Error: group_id is required", { error: "group_id required" });
          await groupOps.dissolveGroup(targetAid, params.group_id);
          await acp.removeGroupFromStore(params.group_id);
          return textResult(`Group ${params.group_id} dissolved`, { ok: true });
        }

        case "search_groups": {
          if (!params.keyword) return textResult("Error: keyword is required", { error: "keyword required" });
          const result = await groupOps.searchGroups(targetAid, params.keyword, {
            tags: parseTags(params.tags),
            limit: params.limit,
            offset: params.offset,
          });
          if (result.groups.length === 0) {
            return textResult("No groups found.", { total: 0, groups: [] });
          }
          const text = result.groups.map((g: any) =>
            `- ${g.name} (${g.group_id}) [${g.member_count} members, ${g.visibility}]`
          ).join("\n") + `\n\nTotal: ${result.total}`;
          return textResult(text, result);
        }

        case "get_announcement": {
          if (!params.group_id) return textResult("Error: group_id is required", { error: "group_id required" });
          const result = await groupOps.getAnnouncement(targetAid, params.group_id);
          if (!result.content) {
            return textResult("No announcement set.", result);
          }
          return textResult(`Announcement:\n${result.content}\n\nUpdated by: ${result.updated_by}`, result);
        }

        case "update_announcement": {
          if (!params.group_id) return textResult("Error: group_id is required", { error: "group_id required" });
          if (!params.content) return textResult("Error: content is required", { error: "content required" });
          await groupOps.updateAnnouncement(targetAid, params.group_id, params.content);
          return textResult("Announcement updated.", { ok: true });
        }

        case "create_invite_code": {
          if (!params.group_id) return textResult("Error: group_id is required", { error: "group_id required" });
          const result = await groupOps.createInviteCode(targetAid, params.group_id, {
            label: params.label,
            max_uses: params.max_uses,
            expires_at: params.expires_at,
          });
          return textResult(`Invite code: ${result.code}\nGroup: ${result.group_id}`, result);
        }

        case "update_group_meta": {
          if (!params.group_id) return textResult("Error: group_id is required", { error: "group_id required" });
          const meta: Record<string, any> = {};
          if (params.name != null) meta.name = params.name;
          if (params.alias != null) meta.alias = params.alias;
          if (params.subject != null) meta.subject = params.subject;
          if (params.visibility != null) meta.visibility = params.visibility;
          if (params.tags != null) meta.tags = parseTags(params.tags);
          await groupOps.updateGroupMeta(targetAid, params.group_id, meta);
          return textResult("Group metadata updated.", { ok: true });
        }

        case "get_public_info": {
          if (!params.group_id) return textResult("Error: group_id is required", { error: "group_id required" });
          const info = await groupOps.getPublicInfo(targetAid, params.group_id);
          const lines = [
            `Name: ${info.name}`,
            `ID: ${info.group_id}`,
            `Members: ${info.member_count}`,
            `Visibility: ${info.visibility}`,
            info.subject ? `Subject: ${info.subject}` : null,
            info.tags?.length ? `Tags: ${info.tags.join(", ")}` : null,
            `Join mode: ${info.join_mode}`,
          ].filter(Boolean).join("\n");
          return textResult(lines, info);
        }

        case "ban_agent": {
          if (!params.group_id) return textResult("Error: group_id is required", { error: "group_id required" });
          if (!params.agent_id) return textResult("Error: agent_id is required", { error: "agent_id required" });
          await groupOps.banAgent(targetAid, params.group_id, params.agent_id, params.reason);
          return textResult(`Banned ${params.agent_id} from group ${params.group_id}`, { ok: true });
        }

        case "unban_agent": {
          if (!params.group_id) return textResult("Error: group_id is required", { error: "group_id required" });
          if (!params.agent_id) return textResult("Error: agent_id is required", { error: "agent_id required" });
          await groupOps.unbanAgent(targetAid, params.group_id, params.agent_id);
          return textResult(`Unbanned ${params.agent_id} from group ${params.group_id}`, { ok: true });
        }

        case "review_join_request": {
          if (!params.group_id) return textResult("Error: group_id is required", { error: "group_id required" });
          if (!params.agent_id) return textResult("Error: agent_id is required", { error: "agent_id required" });
          if (!params.review_action) return textResult("Error: review_action is required (approve/reject)", { error: "review_action required" });
          await groupOps.reviewJoinRequest(targetAid, params.group_id, params.agent_id, params.review_action, params.reason);
          return textResult(`Join request from ${params.agent_id} ${params.review_action}d.`, { ok: true });
        }

        case "get_pending_requests": {
          if (!params.group_id) return textResult("Error: group_id is required", { error: "group_id required" });
          const result = await groupOps.getPendingRequests(targetAid, params.group_id);
          if (result.requests.length === 0) {
            return textResult("No pending requests.", result);
          }
          const text = result.requests.map((r: any) =>
            `- ${r.agent_id ?? JSON.stringify(r)}`
          ).join("\n");
          return textResult(text, result);
        }

        default: {
          const validActions = [
            "list_groups", "create_group", "get_group_info", "get_members",
            "send_message", "pull_messages", "join_by_url", "leave_group",
            "add_member", "remove_member", "dissolve_group", "search_groups",
            "get_announcement", "update_announcement", "create_invite_code",
            "update_group_meta", "get_public_info", "ban_agent", "unban_agent",
            "review_join_request", "get_pending_requests",
          ];
          debugLog(`Unknown action: ${action}. Valid actions: ${validActions.join(", ")}`);
          return textResult(
            `Unknown action: "${action}". Valid actions are: ${validActions.join(", ")}`,
            { error: `unknown action: ${action}`, valid_actions: validActions }
          );
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      debugLog(`=== Tool execute ERROR === action=${action}, error=${msg}\n${stack ?? ""}`);
      console.error(`[ACP-Group] Tool error: action=${action}, error=${msg}`, stack ? `\n${stack}` : "");
      return textResult(`Error: ${msg}`, { error: msg });
    }
  },
};

export function createGroupTool(): () => AgentTool<typeof AcpGroupParams, unknown> {
  return () => acpGroupTool;
}

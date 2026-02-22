/**
 * ACP Session Key 生成与 AID 规范化
 * DM 会话 key 不再包含 transport sessionId，确保跨 session 稳定。
 */

export function normalizeAid(aid: string): string {
  return aid.trim().toLowerCase();
}

export function normalizeGroupId(groupId: string): string {
  return groupId.trim().toLowerCase();
}

export function buildDmSessionKey(params: {
  agentId: string;
  identityId: string;
  peerAid: string;
}): string {
  const { agentId, identityId, peerAid } = params;
  const peerLower = normalizeAid(peerAid);
  return identityId === "default"
    ? `agent:${agentId}:acp:peer:${peerLower}`
    : `agent:${agentId}:acp:${identityId}:peer:${peerLower}`;
}

export function buildGroupSessionKey(params: {
  agentId: string;
  identityId: string;
  groupId: string;
}): string {
  const { agentId, identityId, groupId } = params;
  const gidLower = normalizeGroupId(groupId);
  return identityId === "default"
    ? `agent:${agentId}:acp:group:${gidLower}`
    : `agent:${agentId}:acp:${identityId}:group:${gidLower}`;
}

/**
 * ACP Context Tool — TypeBox 参数 schema + section 白名单
 */

import { Type, type Static } from "@sinclair/typebox";

export const AcpContextParams = Type.Object({
  action: Type.String({
    description:
      "Action to perform. Read: read_peer, read_peer_memory, read_group, read_group_role, read_group_memory, " +
      "read_identity_memory, read_global_memory. " +
      "Write: update_peer, update_group, append_memory, promote_memory. " +
      "Search: search_memory (scope required).",
  }),
  aid: Type.String({ description: "Your AID (mandatory for identity resolution)" }),
  peer_aid: Type.Optional(Type.String({ description: "Peer AID (for peer-related actions)" })),
  group_id: Type.Optional(Type.String({ description: "Group ID (for group-related actions)" })),
  section: Type.Optional(Type.String({ description: "Section name to update (must be in whitelist)" })),
  content: Type.Optional(Type.String({ description: "Content to write or append" })),
  scope: Type.Optional(Type.String({ description: "Memory scope: peer, group, identity, global (for search_memory)" })),
  query: Type.Optional(Type.String({ description: "Search query (for search_memory)" })),
});

export type AcpContextInput = Static<typeof AcpContextParams>;

// 读操作
export const READ_ACTIONS = new Set([
  "read_peer", "read_peer_memory",
  "read_group", "read_group_role", "read_group_memory",
  "read_identity_memory", "read_global_memory",
]);

// 写操作
export const WRITE_ACTIONS = new Set([
  "update_peer", "update_group",
  "append_memory", "promote_memory",
]);

// 搜索操作
export const SEARCH_ACTIONS = new Set(["search_memory"]);

// Section 白名单（update_peer / update_group 可写的 section）
export const PEER_SECTION_WHITELIST = new Set(["Notes", "Preferences", "Basic Info"]);
export const GROUP_SECTION_WHITELIST = new Set(["Purpose", "Rules", "Basic Info"]);

// 限流常量
export const RATE_LIMITS = {
  maxOpsPerTurn: 3,
  maxOpsPerMinute: 10,
  maxContentBytes: 2048,
};

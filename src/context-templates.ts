/**
 * ACP 上下文文件默认模板
 * peer/group/identity/memory 文件的初始内容
 */

export function peerProfileTemplate(peerAid: string): string {
  return `# Peer Profile: ${peerAid}

## Basic Info
- AID: ${peerAid}
- First seen: ${new Date().toISOString()}
- Trust level: neutral

## Notes
<!-- Agent 可在此记录对该 peer 的观察与备注 -->

## Preferences
<!-- 该 peer 的偏好、沟通风格等 -->
`;
}

export function peerMemoryTemplate(peerAid: string): string {
  return `# Memory: ${peerAid}

<!-- 与该 peer 的重要记忆条目，按时间倒序 -->
<!-- 格式: - [YYYY-MM-DD] 内容 -->
`;
}

export function groupProfileTemplate(groupId: string, groupName?: string): string {
  const title = groupName ? `${groupName} (${groupId})` : groupId;
  return `# Group Profile: ${title}

## Basic Info
- Group ID: ${groupId}
${groupName ? `- Name: ${groupName}` : ""}
- Joined: ${new Date().toISOString()}

## Purpose
<!-- 群组的目的与主题 -->

## Rules
<!-- 群组规则与约定 -->
`;
}

export function groupMemoryTemplate(groupId: string): string {
  return `# Group Memory: ${groupId}

<!-- 群组中的重要记忆条目，按时间倒序 -->
<!-- 格式: - [YYYY-MM-DD] 内容 -->
`;
}

export function myRoleTemplate(groupId: string): string {
  return `# My Role: ${groupId}

## Role
- Type: member
- Joined: ${new Date().toISOString()}

## Responsibilities
<!-- 我在该群组中的职责 -->
`;
}

export function identityOverlayTemplate(identityId: string, aid: string): string {
  return `# Identity: ${identityId}

## Basic Info
- Identity ID: ${identityId}
- AID: ${aid}
- Created: ${new Date().toISOString()}

## Personality
<!-- 该身份的个性化设定 -->

## Guidelines
<!-- 该身份的行为准则 -->
`;
}

export function identityMemoryTemplate(identityId: string): string {
  return `# Identity Memory: ${identityId}

<!-- 该身份的全局记忆条目，按时间倒序 -->
<!-- 格式: - [YYYY-MM-DD] 内容 -->
`;
}

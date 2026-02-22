/**
 * ACP 上下文文件路径解析与安全校验
 * 所有上下文文件存放在 workspace/acp/identities/{identityId}/... 下
 */

import * as path from "path";

const ACP_DIR = "acp";
const IDENTITIES_DIR = "identities";
const PEERS_DIR = "peers";
const GROUPS_DIR = "groups";
const RUNTIME_DIR = "runtime";

/** 规范化 identityId，空值或空串统一为 "default"，并校验安全性 */
function normalizeId(id?: string): string {
  const trimmed = id?.trim();
  const result = trimmed && trimmed.length > 0 ? trimmed : "default";
  validatePathSegment(result, "identityId");
  return result;
}

/** 规范化 AID 为小写，用作目录名，并校验安全性 */
function normalizeAidForPath(aid: string): string {
  const normalized = aid.trim().toLowerCase();
  validatePathSegment(normalized, "AID");
  return normalized;
}

/** 校验路径片段不含目录遍历字符 */
function validatePathSegment(segment: string, label: string): void {
  if (!segment || segment.includes("..") || segment.includes("/") || segment.includes("\\") || segment.includes("\0")) {
    throw new Error(`Invalid ${label} for path: "${segment}"`);
  }
}

// ===== 基础路径 =====

export function acpRoot(workspaceDir: string): string {
  return path.join(workspaceDir, ACP_DIR);
}

export function identityDir(workspaceDir: string, identityId: string): string {
  return path.join(acpRoot(workspaceDir), IDENTITIES_DIR, normalizeId(identityId));
}

export function peerDir(workspaceDir: string, identityId: string, peerAid: string): string {
  return path.join(identityDir(workspaceDir, identityId), PEERS_DIR, normalizeAidForPath(peerAid));
}

export function groupDir(workspaceDir: string, identityId: string, groupId: string): string {
  const normalized = groupId.trim().toLowerCase();
  validatePathSegment(normalized, "groupId");
  return path.join(identityDir(workspaceDir, identityId), GROUPS_DIR, normalized);
}

export function runtimeDir(workspaceDir: string): string {
  return path.join(acpRoot(workspaceDir), RUNTIME_DIR);
}

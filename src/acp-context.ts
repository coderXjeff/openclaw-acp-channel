/**
 * ACP 上下文文件管理 — 幂等创建 + 按序加载
 * ensure*() 幂等创建目录与默认文件
 * load*() 按序加载拼接上下文字符串
 */

import * as fs from "fs";
import * as path from "path";
import { identityDir, peerDir, groupDir } from "./context-paths.js";
import {
  peerProfileTemplate,
  peerMemoryTemplate,
  groupProfileTemplate,
  groupMemoryTemplate,
  myRoleTemplate,
  identityOverlayTemplate,
  identityMemoryTemplate,
} from "./context-templates.js";

// ===== 内部工具 =====

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function ensureFile(filePath: string, defaultContent: string): void {
  ensureDir(path.dirname(filePath));
  try {
    // wx = write exclusive — fails if file already exists (atomic check+create)
    fs.writeFileSync(filePath, defaultContent, { encoding: "utf-8", flag: "wx" });
  } catch (err: any) {
    // EEXIST is expected (file already exists) — any other error should propagate
    if (err?.code !== "EEXIST") throw err;
  }
}

function readFileSafe(filePath: string): string | null {
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, "utf-8");
    }
  } catch {}
  return null;
}

// ===== ensure 函数 =====

export function ensureIdentityContext(workspaceDir: string, identityId: string, aid: string): void {
  const dir = identityDir(workspaceDir, identityId);
  ensureFile(path.join(dir, "IDENTITY.md"), identityOverlayTemplate(identityId, aid));
  ensureFile(path.join(dir, "MEMORY.md"), identityMemoryTemplate(identityId));
}

export function ensurePeerContext(workspaceDir: string, identityId: string, peerAid: string): void {
  const dir = peerDir(workspaceDir, identityId, peerAid);
  ensureFile(path.join(dir, "PEER.md"), peerProfileTemplate(peerAid));
  ensureFile(path.join(dir, "MEMORY.md"), peerMemoryTemplate(peerAid));
}

export function ensureGroupContext(workspaceDir: string, identityId: string, groupId: string, groupName?: string): void {
  const dir = groupDir(workspaceDir, identityId, groupId);
  ensureFile(path.join(dir, "GROUP.md"), groupProfileTemplate(groupId, groupName));
  ensureFile(path.join(dir, "MY_ROLE.md"), myRoleTemplate(groupId));
  ensureFile(path.join(dir, "MEMORY.md"), groupMemoryTemplate(groupId));
}

// ===== load 函数 =====

/**
 * DM 加载顺序: identity overlay + identity memory → peer profile + peer memory
 */
export function loadContextForDM(params: {
  workspaceDir: string;
  identityId: string;
  peerAid: string;
  tokenBudget?: number;
}): string {
  const { workspaceDir, identityId, peerAid } = params;
  const idDir = identityDir(workspaceDir, identityId);
  const pDir = peerDir(workspaceDir, identityId, peerAid);

  const parts: string[] = [];

  const identityOverlay = readFileSafe(path.join(idDir, "IDENTITY.md"));
  if (identityOverlay) parts.push(identityOverlay);

  const identityMemory = readFileSafe(path.join(idDir, "MEMORY.md"));
  if (identityMemory) parts.push(identityMemory);

  const peerProfile = readFileSafe(path.join(pDir, "PEER.md"));
  if (peerProfile) parts.push(peerProfile);

  const peerMemory = readFileSafe(path.join(pDir, "MEMORY.md"));
  if (peerMemory) parts.push(peerMemory);

  let result = parts.join("\n\n---\n\n");

  if (params.tokenBudget && result.length > params.tokenBudget) {
    result = result.substring(0, params.tokenBudget);
  }

  return result;
}

/**
 * Group 加载顺序: identity overlay + identity memory → my_role + group profile + group memory
 */
export function loadContextForGroup(params: {
  workspaceDir: string;
  identityId: string;
  groupId: string;
  tokenBudget?: number;
}): string {
  const { workspaceDir, identityId, groupId } = params;
  const idDir = identityDir(workspaceDir, identityId);
  const gDir = groupDir(workspaceDir, identityId, groupId);

  const parts: string[] = [];

  const identityOverlay = readFileSafe(path.join(idDir, "IDENTITY.md"));
  if (identityOverlay) parts.push(identityOverlay);

  const identityMemory = readFileSafe(path.join(idDir, "MEMORY.md"));
  if (identityMemory) parts.push(identityMemory);

  const myRole = readFileSafe(path.join(gDir, "MY_ROLE.md"));
  if (myRole) parts.push(myRole);

  const groupProfile = readFileSafe(path.join(gDir, "GROUP.md"));
  if (groupProfile) parts.push(groupProfile);

  const groupMemory = readFileSafe(path.join(gDir, "MEMORY.md"));
  if (groupMemory) parts.push(groupMemory);

  let result = parts.join("\n\n---\n\n");

  if (params.tokenBudget && result.length > params.tokenBudget) {
    result = result.substring(0, params.tokenBudget);
  }

  return result;
}

/**
 * acp_context 工具 — action router + validator + permission guard + rate limiter
 * Phase C: Owner-only 写入
 */

import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import * as fs from "fs";
import * as path from "path";
import { getRouter } from "./identity-router.js";
import { getWorkspaceDir } from "./workspace.js";
import {
  AcpContextParams,
  type AcpContextInput,
  READ_ACTIONS,
  WRITE_ACTIONS,
  SEARCH_ACTIONS,
  PEER_SECTION_WHITELIST,
  GROUP_SECTION_WHITELIST,
  RATE_LIMITS,
} from "./context-schemas.js";
import { peerDir, groupDir, identityDir, runtimeDir } from "./context-paths.js";

// ===== Session Context (权限传递) =====

interface SessionCtx {
  chatType: "direct" | "group";
  isOwner: boolean;
}

const sessionContextMap = new Map<string, SessionCtx>();

export function setSessionContext(turnKey: string, ctx: SessionCtx): void {
  sessionContextMap.set(turnKey, ctx);
  // Safety net: auto-expire after 10 minutes to prevent leaks
  setTimeout(() => sessionContextMap.delete(turnKey), 600_000).unref?.();
}

export function clearSessionContext(turnKey: string): void {
  sessionContextMap.delete(turnKey);
}

// 当前活跃的 turnKey（per-identity）
const activeTurnKeys = new Map<string, string>();

export function setActiveTurnKey(identityId: string, turnKey: string): void {
  activeTurnKeys.set(identityId, turnKey);
}

export function clearActiveTurnKey(identityId: string): void {
  activeTurnKeys.delete(identityId);
}

// ===== Rate Limiter =====

interface RateState {
  opsThisTurn: number;
  opsTimestamps: number[];
}

const rateLimitState = new Map<string, RateState>();

function checkRateLimit(identityId: string): string | null {
  const now = Date.now();
  let state = rateLimitState.get(identityId);
  if (!state) {
    state = { opsThisTurn: 0, opsTimestamps: [] };
    rateLimitState.set(identityId, state);
  }

  // Check before incrementing — rejected requests don't consume quota
  if (state.opsThisTurn >= RATE_LIMITS.maxOpsPerTurn) {
    return `Rate limit: max ${RATE_LIMITS.maxOpsPerTurn} ops per turn exceeded`;
  }

  // Clean old timestamps
  state.opsTimestamps = state.opsTimestamps.filter(ts => now - ts < 60_000);
  if (state.opsTimestamps.length >= RATE_LIMITS.maxOpsPerMinute) {
    return `Rate limit: max ${RATE_LIMITS.maxOpsPerMinute} ops per minute exceeded`;
  }

  // Passed — now increment
  state.opsThisTurn++;
  state.opsTimestamps.push(now);

  return null;
}

export function resetTurnOps(identityId: string): void {
  const state = rateLimitState.get(identityId);
  if (state) state.opsThisTurn = 0;
}

// ===== Audit Log =====

function auditLog(workspaceDir: string, entry: string): void {
  try {
    const dir = runtimeDir(workspaceDir);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const logPath = path.join(dir, "maintenance.log");
    const line = `[${new Date().toISOString()}] ${entry}\n`;
    fs.appendFileSync(logPath, line);
  } catch {}
}

// ===== Helpers =====

function resolveIdentityId(aid: string): string | null {
  const router = getRouter();
  if (!router) return null;
  const state = router.getStateByAid(aid.trim());
  return state?.identityId ?? null;
}

function resolveWorkspaceDir(identityId: string): string | null {
  const router = getRouter();
  if (!router) return null;
  const state = router.getState(identityId);
  const wsDir = state?.account.workspaceDir || getWorkspaceDir(identityId);
  return wsDir ?? null;
}

function readFileSafe(filePath: string): string | null {
  try {
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, "utf-8");
  } catch {}
  return null;
}

function textResult(text: string): AgentToolResult<unknown> {
  return { content: [{ type: "text", text }], details: null };
}

function errorResult(msg: string): AgentToolResult<unknown> {
  return { content: [{ type: "text", text: `Error: ${msg}` }], details: null };
}

// ===== Section Update Helper =====

function updateSection(filePath: string, section: string, content: string): boolean {
  try {
    const existing = readFileSafe(filePath);
    if (!existing) return false;

    const sectionHeader = `## ${section}`;
    const idx = existing.indexOf(sectionHeader);
    if (idx === -1) return false;

    // Find next section or end of file
    const afterHeader = idx + sectionHeader.length;
    const nextSection = existing.indexOf("\n## ", afterHeader);
    const endIdx = nextSection === -1 ? existing.length : nextSection;

    const updated = existing.substring(0, afterHeader) + "\n" + content + "\n" + existing.substring(endIdx);
    fs.writeFileSync(filePath, updated, "utf-8");
    return true;
  } catch {
    return false;
  }
}

// ===== Memory Append Helper =====

function appendToMemory(filePath: string, content: string): boolean {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const existing = readFileSafe(filePath) ?? "";
    const date = new Date().toISOString().split("T")[0];
    const entry = `- [${date}] ${content}\n`;
    fs.writeFileSync(filePath, existing + entry, "utf-8");
    return true;
  } catch {
    return false;
  }
}

// ===== Action Router =====

async function executeAction(
  params: AcpContextInput,
  identityId: string,
  workspaceDir: string,
): Promise<AgentToolResult<unknown>> {
  const { action, peer_aid, group_id, section, content, scope, query } = params;

  // --- Read actions ---
  if (action === "read_peer") {
    if (!peer_aid) return errorResult("peer_aid is required");
    const fp = path.join(peerDir(workspaceDir, identityId, peer_aid), "PEER.md");
    const data = readFileSafe(fp);
    return data ? textResult(data) : errorResult("Peer profile not found");
  }

  if (action === "read_peer_memory") {
    if (!peer_aid) return errorResult("peer_aid is required");
    const fp = path.join(peerDir(workspaceDir, identityId, peer_aid), "MEMORY.md");
    const data = readFileSafe(fp);
    return data ? textResult(data) : errorResult("Peer memory not found");
  }

  if (action === "read_group") {
    if (!group_id) return errorResult("group_id is required");
    const fp = path.join(groupDir(workspaceDir, identityId, group_id), "GROUP.md");
    const data = readFileSafe(fp);
    return data ? textResult(data) : errorResult("Group profile not found");
  }

  if (action === "read_group_role") {
    if (!group_id) return errorResult("group_id is required");
    const fp = path.join(groupDir(workspaceDir, identityId, group_id), "MY_ROLE.md");
    const data = readFileSafe(fp);
    return data ? textResult(data) : errorResult("Group role not found");
  }

  if (action === "read_group_memory") {
    if (!group_id) return errorResult("group_id is required");
    const fp = path.join(groupDir(workspaceDir, identityId, group_id), "MEMORY.md");
    const data = readFileSafe(fp);
    return data ? textResult(data) : errorResult("Group memory not found");
  }

  if (action === "read_identity_memory") {
    const fp = path.join(identityDir(workspaceDir, identityId), "MEMORY.md");
    const data = readFileSafe(fp);
    return data ? textResult(data) : errorResult("Identity memory not found");
  }

  if (action === "read_global_memory") {
    const fp = path.join(identityDir(workspaceDir, identityId), "MEMORY.md");
    const data = readFileSafe(fp);
    return data ? textResult(data) : errorResult("Global memory not found");
  }

  // --- Write actions ---
  if (action === "update_peer") {
    if (!peer_aid) return errorResult("peer_aid is required");
    if (!section) return errorResult("section is required");
    if (!content) return errorResult("content is required");
    if (!PEER_SECTION_WHITELIST.has(section)) {
      return errorResult(`Section "${section}" not allowed. Allowed: ${[...PEER_SECTION_WHITELIST].join(", ")}`);
    }
    const fp = path.join(peerDir(workspaceDir, identityId, peer_aid), "PEER.md");
    const ok = updateSection(fp, section, content);
    return ok ? textResult("Peer profile updated") : errorResult("Failed to update peer profile");
  }

  if (action === "update_group") {
    if (!group_id) return errorResult("group_id is required");
    if (!section) return errorResult("section is required");
    if (!content) return errorResult("content is required");
    if (!GROUP_SECTION_WHITELIST.has(section)) {
      return errorResult(`Section "${section}" not allowed. Allowed: ${[...GROUP_SECTION_WHITELIST].join(", ")}`);
    }
    const fp = path.join(groupDir(workspaceDir, identityId, group_id), "GROUP.md");
    const ok = updateSection(fp, section, content);
    return ok ? textResult("Group profile updated") : errorResult("Failed to update group profile");
  }

  if (action === "append_memory") {
    if (!content) return errorResult("content is required");
    if (!scope) return errorResult("scope is required (peer, group, identity)");

    let fp: string;
    if (scope === "peer") {
      if (!peer_aid) return errorResult("peer_aid is required for scope=peer");
      fp = path.join(peerDir(workspaceDir, identityId, peer_aid), "MEMORY.md");
    } else if (scope === "group") {
      if (!group_id) return errorResult("group_id is required for scope=group");
      fp = path.join(groupDir(workspaceDir, identityId, group_id), "MEMORY.md");
    } else if (scope === "identity" || scope === "global") {
      fp = path.join(identityDir(workspaceDir, identityId), "MEMORY.md");
    } else {
      return errorResult(`Invalid scope: ${scope}. Use: peer, group, identity, global`);
    }

    const ok = appendToMemory(fp, content);
    return ok ? textResult("Memory entry appended") : errorResult("Failed to append memory");
  }

  if (action === "promote_memory") {
    // Phase E 再实现，当前返回 not implemented
    return errorResult("promote_memory is not yet implemented (Phase E)");
  }

  // --- Search actions ---
  if (action === "search_memory") {
    if (!scope) return errorResult("scope is required");
    if (!query) return errorResult("query is required");

    let fp: string;
    if (scope === "peer") {
      if (!peer_aid) return errorResult("peer_aid is required for scope=peer");
      fp = path.join(peerDir(workspaceDir, identityId, peer_aid), "MEMORY.md");
    } else if (scope === "group") {
      if (!group_id) return errorResult("group_id is required for scope=group");
      fp = path.join(groupDir(workspaceDir, identityId, group_id), "MEMORY.md");
    } else if (scope === "identity" || scope === "global") {
      fp = path.join(identityDir(workspaceDir, identityId), "MEMORY.md");
    } else {
      return errorResult(`Invalid scope: ${scope}`);
    }

    const data = readFileSafe(fp);
    if (!data) return textResult("No memory found");

    const queryLower = query.toLowerCase();
    const matches = data.split("\n").filter(line => line.toLowerCase().includes(queryLower));
    return matches.length > 0
      ? textResult(matches.join("\n"))
      : textResult("No matching memory entries found");
  }

  return errorResult(`Unknown action: ${action}`);
}

// ===== Tool Factory =====

export function createContextTool(): AgentTool<typeof AcpContextParams, unknown> {
  return {
    name: "acp_context",
    label: "ACP Context Manager",
    description:
      "Read and write persistent context files (peer profiles, group info, memories). " +
      "Use this to maintain long-term knowledge about peers, groups, and important events.",
    parameters: AcpContextParams,
    async execute(_toolCallId, params: AcpContextInput): Promise<AgentToolResult<unknown>> {
      const { action, aid } = params;

      // 1. Resolve identity
      const identityId = resolveIdentityId(aid);
      if (!identityId) return errorResult(`Cannot resolve identity for AID: ${aid}`);

      // 2. Resolve workspace
      const workspaceDir = resolveWorkspaceDir(identityId);
      if (!workspaceDir) return errorResult("Workspace directory not configured");

      // 3. Check tool enabled
      // (toolEnabled check is done at registration level via config)

      // 4. Rate limit
      const rateLimitErr = checkRateLimit(identityId);
      if (rateLimitErr) {
        auditLog(workspaceDir, `RATE_LIMIT action=${action} identity=${identityId}`);
        return errorResult(rateLimitErr);
      }

      // 5. Content size check for write actions
      if (params.content && Buffer.byteLength(params.content, "utf-8") > RATE_LIMITS.maxContentBytes) {
        return errorResult(`Content exceeds max size of ${RATE_LIMITS.maxContentBytes} bytes`);
      }

      // 6. Permission guard: write actions require Owner
      if (WRITE_ACTIONS.has(action)) {
        const turnKey = activeTurnKeys.get(identityId);
        const sessionCtx = turnKey ? sessionContextMap.get(turnKey) : null;
        if (!sessionCtx?.isOwner) {
          auditLog(workspaceDir, `PERMISSION_DENIED action=${action} identity=${identityId}`);
          return errorResult("Permission denied: write actions are only available in Owner sessions");
        }
      }

      // 7. Execute
      auditLog(workspaceDir, `EXEC action=${action} identity=${identityId} peer=${params.peer_aid ?? ""} group=${params.group_id ?? ""}`);
      return executeAction(params, identityId, workspaceDir);
    },
  };
}

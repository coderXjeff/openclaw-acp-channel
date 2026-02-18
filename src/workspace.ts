/**
 * workspaceDir 全局状态管理
 * 通过 before_agent_start 钩子自动发现，或从配置中读取
 */

import * as fs from "fs";
import * as path from "path";

const workspaceDirs = new Map<string, string>();

function normalizeIdentityId(identityId?: string): string {
  const normalized = identityId?.trim();
  return normalized && normalized.length > 0 ? normalized : "default";
}

export function updateWorkspaceDir(dir: string, identityId?: string): void {
  if (!dir) return;
  const normalized = normalizeIdentityId(identityId);
  const prev = workspaceDirs.get(normalized);
  if (prev !== dir) {
    console.log(`[ACP] Workspace dir updated [${normalized}]: ${dir}`);
    workspaceDirs.set(normalized, dir);
  }
}

export function getWorkspaceDir(identityId?: string): string | null {
  const normalized = normalizeIdentityId(identityId);
  const configured = workspaceDirs.get(normalized);
  if (configured) return configured;

  // 默认身份兜底：兼容旧行为自动探测 ~/.openclaw/workspace
  if (normalized !== "default") {
    return null;
  }
  const defaultDir = path.join(process.env.HOME || "~", ".openclaw", "workspace");
  try {
    if (fs.existsSync(defaultDir) && fs.statSync(defaultDir).isDirectory()) {
      console.log(`[ACP] Auto-detected workspace dir: ${defaultDir}`);
      workspaceDirs.set("default", defaultDir);
      return defaultDir;
    }
  } catch {
    // ignore
  }
  return null;
}

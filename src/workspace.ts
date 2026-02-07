/**
 * workspaceDir 全局状态管理
 * 通过 before_agent_start 钩子自动发现，或从配置中读取
 */

import * as fs from "fs";
import * as path from "path";

let workspaceDir: string | null = null;

export function updateWorkspaceDir(dir: string): void {
  if (dir && dir !== workspaceDir) {
    console.log(`[ACP] Workspace dir updated: ${dir}`);
    workspaceDir = dir;
  }
}

export function getWorkspaceDir(): string | null {
  if (workspaceDir) return workspaceDir;

  // 尝试推断默认路径
  const defaultDir = path.join(process.env.HOME || "~", ".openclaw", "workspace");
  try {
    if (fs.existsSync(defaultDir) && fs.statSync(defaultDir).isDirectory()) {
      console.log(`[ACP] Auto-detected workspace dir: ${defaultDir}`);
      workspaceDir = defaultDir;
      return defaultDir;
    }
  } catch {
    // ignore
  }
  return null;
}

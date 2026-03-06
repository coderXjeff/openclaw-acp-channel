import { exec } from "child_process";
import * as path from "path";

const LOG_PREFIX = "[ACP][auto-upgrade]";
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const EXEC_TIMEOUT_MS = 120_000; // 120s

let lastCheckTimestamp = 0;
let upgradeInProgress = false;

/** 插件安装目录 */
const EXTENSION_DIR = path.resolve(
  process.env.HOME || "~",
  ".openclaw",
  "extensions",
  "evol",
);

function log(msg: string): void {
  console.log(`${LOG_PREFIX} ${msg}`);
}

function execAsync(cmd: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd, timeout: EXEC_TIMEOUT_MS }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`${cmd} failed: ${err.message}\nstderr: ${stderr}`));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

async function doUpgradeCheck(): Promise<void> {
  try {
    await execAsync("git fetch origin", EXTENSION_DIR);

    const local = await execAsync("git rev-parse HEAD", EXTENSION_DIR);
    const remote = await execAsync("git rev-parse origin/master", EXTENSION_DIR);

    if (local === remote) {
      log("Already up to date");
      return;
    }

    log(`Update available: ${local.slice(0, 8)} -> ${remote.slice(0, 8)}, pulling...`);
    await execAsync("git pull origin master", EXTENSION_DIR);
    log("git pull done, running npm install...");
    await execAsync("npm install", EXTENSION_DIR);
    log("Upgrade complete. Changes take effect on next restart.");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Upgrade check failed: ${msg}`);
  }
}

/**
 * 触发自动升级检查（fire-and-forget）。
 * 同步返回，绝不阻塞调用方，绝不抛异常。
 */
export function triggerUpgradeCheck(): void {
  try {
    const now = Date.now();
    if (now - lastCheckTimestamp < CHECK_INTERVAL_MS) return;
    if (upgradeInProgress) return;

    lastCheckTimestamp = now;
    upgradeInProgress = true;

    doUpgradeCheck().finally(() => {
      upgradeInProgress = false;
    });
  } catch {
    // never throw
  }
}

import * as fs from "fs";
import * as path from "path";
import type { ParsedAgentMd } from "./types.js";
import { parseAgentMd } from "./agent-md-parser.js";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 小时
const FETCH_TIMEOUT_MS = 5000;
const DEFAULT_CACHE_DIR = path.join(process.env.HOME || "~", ".acp-storage", "remote-agent-md");

export class AgentMdFetcher {
  private memCache: Map<string, ParsedAgentMd> = new Map();
  private cacheDir: string;
  private ttlMs: number;

  constructor(options?: { cacheDir?: string; ttlMs?: number }) {
    this.cacheDir = options?.cacheDir ?? DEFAULT_CACHE_DIR;
    this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
  }

  /**
   * 获取远程 agent.md，优先内存 → 文件 → HTTP
   */
  async fetch(aid: string): Promise<ParsedAgentMd | null> {
    // 1. 内存缓存
    const memHit = this.memCache.get(aid);
    if (memHit && !this.isExpired(memHit)) {
      return memHit;
    }

    // 2. 文件缓存
    const fileHit = this.loadFromFile(aid);
    if (fileHit && !this.isExpired(fileHit)) {
      this.memCache.set(aid, fileHit);
      return fileHit;
    }

    // 3. HTTP 获取
    return this.fetchRemote(aid);
  }

  /**
   * 强制刷新（跳过缓存，直接 HTTP 获取）
   */
  async refresh(aid: string): Promise<ParsedAgentMd | null> {
    return this.fetchRemote(aid);
  }

  /**
   * 清除缓存
   */
  clear(aid?: string): void {
    if (aid) {
      this.memCache.delete(aid);
      this.deleteFile(aid);
    } else {
      this.memCache.clear();
      this.deleteCacheDir();
    }
  }

  private isExpired(data: ParsedAgentMd): boolean {
    return Date.now() - data.fetchedAt > this.ttlMs;
  }

  private async fetchRemote(aid: string): Promise<ParsedAgentMd | null> {
    const url = `https://${aid}/agent.md`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      if (!response.ok) {
        console.warn(`[ACP] Failed to fetch agent.md for ${aid}: HTTP ${response.status}`);
        return null;
      }

      const raw = await response.text();
      const parsed = parseAgentMd(raw);
      if (!parsed) {
        console.warn(`[ACP] Failed to parse agent.md for ${aid}`);
        return null;
      }

      // 写入缓存
      this.memCache.set(aid, parsed);
      this.saveToFile(aid, parsed);

      console.log(`[ACP] Fetched and cached agent.md for ${aid}`);
      return parsed;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[ACP] Error fetching agent.md for ${aid}: ${msg}`);
      return null;
    }
  }

  private cacheFilePath(aid: string): string {
    const safeName = aid.replace(/[^a-zA-Z0-9._-]/g, "_");
    return path.join(this.cacheDir, `${safeName}.json`);
  }

  private loadFromFile(aid: string): ParsedAgentMd | null {
    try {
      const filePath = this.cacheFilePath(aid);
      if (!fs.existsSync(filePath)) return null;
      const content = fs.readFileSync(filePath, "utf8");
      return JSON.parse(content) as ParsedAgentMd;
    } catch {
      return null;
    }
  }

  private saveToFile(aid: string, data: ParsedAgentMd): void {
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }
      const filePath = this.cacheFilePath(aid);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (err) {
      console.warn(`[ACP] Failed to save agent.md cache for ${aid}:`, err);
    }
  }

  private deleteFile(aid: string): void {
    try {
      const filePath = this.cacheFilePath(aid);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // ignore
    }
  }

  private deleteCacheDir(): void {
    try {
      if (fs.existsSync(this.cacheDir)) {
        fs.rmSync(this.cacheDir, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  }
}

// 模块级单例
let instance: AgentMdFetcher | null = null;

export function getAgentMdFetcher(): AgentMdFetcher {
  if (!instance) {
    instance = new AgentMdFetcher();
  }
  return instance;
}
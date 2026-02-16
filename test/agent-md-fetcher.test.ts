import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { AgentMdFetcher } from "../src/agent-md-fetcher.js";
import type { ParsedAgentMd } from "../src/types.js";

const SAMPLE_MD = `---
aid: "test.agentcp.io"
name: "Test"
type: "openclaw"
version: "1.0.0"
description: "A test agent"

tags:
  - openclaw
---

# Test

I am a test agent.
`;

describe("AgentMdFetcher", () => {
  let tmpDir: string;
  let fetcher: AgentMdFetcher;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-fetcher-test-"));
    fetcher = new AgentMdFetcher({ cacheDir: tmpDir, ttlMs: 60000 });
  });

  afterEach(() => {
    fetcher.clear();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    vi.restoreAllMocks();
  });

  it("HTTP 获取成功后缓存到内存和文件", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_MD, { status: 200 })
    );

    const result = await fetcher.fetch("test.agentcp.io");
    expect(result).not.toBeNull();
    expect(result!.aid).toBe("test.agentcp.io");
    expect(result!.name).toBe("Test");

    // 验证文件缓存已写入
    const files = fs.readdirSync(tmpDir);
    expect(files.length).toBe(1);
    expect(files[0]).toContain("test.agentcp.io");
  });

  it("内存缓存命中时不发起 HTTP 请求", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_MD, { status: 200 })
    );

    // 第一次获取（HTTP）
    await fetcher.fetch("test.agentcp.io");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // 第二次获取（内存缓存）
    const result = await fetcher.fetch("test.agentcp.io");
    expect(result).not.toBeNull();
    expect(result!.aid).toBe("test.agentcp.io");
    expect(fetchSpy).toHaveBeenCalledTimes(1); // 没有新的 HTTP 请求
  });

  it("文件缓存命中时不发起 HTTP 请求", async () => {
    // 手动写入文件缓存
    const cached: ParsedAgentMd = {
      aid: "cached.agentcp.io",
      name: "Cached",
      raw: "raw content",
      fetchedAt: Date.now(),
    };
    const filePath = path.join(tmpDir, "cached.agentcp.io.json");
    fs.writeFileSync(filePath, JSON.stringify(cached));

    const fetchSpy = vi.spyOn(globalThis, "fetch");

    // 新建 fetcher 实例（无内存缓存）
    const freshFetcher = new AgentMdFetcher({ cacheDir: tmpDir, ttlMs: 60000 });
    const result = await freshFetcher.fetch("cached.agentcp.io");

    expect(result).not.toBeNull();
    expect(result!.aid).toBe("cached.agentcp.io");
    expect(result!.name).toBe("Cached");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("缓存过期后重新发起 HTTP 请求", async () => {
    // 使用极短 TTL
    const shortTtlFetcher = new AgentMdFetcher({ cacheDir: tmpDir, ttlMs: 1 });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(SAMPLE_MD, { status: 200 })
    );

    // 第一次获取
    await shortTtlFetcher.fetch("test.agentcp.io");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // 等待 TTL 过期
    await new Promise((r) => setTimeout(r, 10));

    // 第二次获取（缓存已过期）
    await shortTtlFetcher.fetch("test.agentcp.io");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("HTTP 获取失败返回 null", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Not Found", { status: 404 })
    );

    const result = await fetcher.fetch("nonexistent.agentcp.io");
    expect(result).toBeNull();
  });

  it("网络错误返回 null", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("Network error")
    );

    const result = await fetcher.fetch("error.agentcp.io");
    expect(result).toBeNull();
  });

  it("clear 清除指定 aid 的缓存", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(SAMPLE_MD, { status: 200 })
    );

    await fetcher.fetch("test.agentcp.io");

    // 清除缓存
    fetcher.clear("test.agentcp.io");

    // 验证文件缓存已删除
    const files = fs.readdirSync(tmpDir);
    expect(files.length).toBe(0);
  });

  it("clear 无参数清除所有缓存", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(SAMPLE_MD, { status: 200 })
    );

    await fetcher.fetch("test.agentcp.io");
    fetcher.clear();

    // 缓存目录已删除
    expect(fs.existsSync(tmpDir)).toBe(false);
  });

  it("refresh 强制重新获取", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(SAMPLE_MD, { status: 200 })
    );

    // 先正常获取
    await fetcher.fetch("test.agentcp.io");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // refresh 强制重新获取
    const result = await fetcher.refresh("test.agentcp.io");
    expect(result).not.toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

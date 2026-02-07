import { describe, it, expect, beforeEach, vi } from "vitest";

// 每个测试重新加载模块，避免全局状态污染
async function freshImport() {
  // vitest 的模块缓存需要通过动态 import + 时间戳绕过
  vi.resetModules();
  return await import("../src/workspace.js");
}

describe("workspace", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("初始状态 getWorkspaceDir 尝试自动探测", async () => {
    const { getWorkspaceDir } = await freshImport();
    // 返回值取决于 ~/.openclaw/workspace 是否存在
    const dir = getWorkspaceDir();
    if (dir) {
      expect(dir).toContain("workspace");
    }
    // 不存在时返回 null，两种情况都合法
  });

  it("updateWorkspaceDir 设置后 getWorkspaceDir 返回设置值", async () => {
    const { updateWorkspaceDir, getWorkspaceDir } = await freshImport();
    updateWorkspaceDir("/tmp/test-workspace");
    expect(getWorkspaceDir()).toBe("/tmp/test-workspace");
  });

  it("updateWorkspaceDir 相同值不重复更新", async () => {
    const { updateWorkspaceDir, getWorkspaceDir } = await freshImport();
    updateWorkspaceDir("/tmp/ws1");
    updateWorkspaceDir("/tmp/ws1"); // 相同值
    expect(getWorkspaceDir()).toBe("/tmp/ws1");
  });

  it("updateWorkspaceDir 可以更新为新值", async () => {
    const { updateWorkspaceDir, getWorkspaceDir } = await freshImport();
    updateWorkspaceDir("/tmp/ws1");
    updateWorkspaceDir("/tmp/ws2");
    expect(getWorkspaceDir()).toBe("/tmp/ws2");
  });
});

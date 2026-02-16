import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { ContactManager } from "../src/contacts.js";
import type { Contact } from "../src/types.js";

function makeContact(aid: string, overrides?: Partial<Contact>): Contact {
  const now = Date.now();
  return {
    aid,
    name: aid.split(".")[0],
    groups: [],
    interactionCount: 0,
    totalDurationMs: 0,
    addedAt: now,
    updatedAt: now,
    creditScore: 50,
    successfulSessions: 0,
    failedSessions: 0,
    ...overrides,
  };
}

describe("ContactManager", () => {
  let tmpDir: string;
  let filePath: string;
  let manager: ContactManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-contacts-test-"));
    filePath = path.join(tmpDir, "contacts.json");
    manager = new ContactManager(filePath);
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // ===== CRUD =====

  it("add 和 get 正常工作", () => {
    const c = makeContact("alice.agentcp.io");
    manager.add(c);
    const got = manager.get("alice.agentcp.io");
    expect(got).not.toBeNull();
    expect(got!.aid).toBe("alice.agentcp.io");
    expect(got!.name).toBe("alice");
  });

  it("重复 add 同一 aid 不覆盖", () => {
    manager.add(makeContact("alice.agentcp.io", { name: "Alice" }));
    manager.add(makeContact("alice.agentcp.io", { name: "Alice2" }));
    expect(manager.get("alice.agentcp.io")!.name).toBe("Alice");
  });

  it("get 不存在的 aid 返回 null", () => {
    expect(manager.get("nonexistent.agentcp.io")).toBeNull();
  });

  it("update 更新字段", () => {
    manager.add(makeContact("alice.agentcp.io"));
    const updated = manager.update("alice.agentcp.io", { name: "Alice New", emoji: "🤖" });
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("Alice New");
    expect(updated!.emoji).toBe("🤖");
  });

  it("update 不存在的 aid 返回 null", () => {
    expect(manager.update("nonexistent.agentcp.io", { name: "X" })).toBeNull();
  });

  it("remove 删除联系人", () => {
    manager.add(makeContact("alice.agentcp.io"));
    expect(manager.remove("alice.agentcp.io")).toBe(true);
    expect(manager.get("alice.agentcp.io")).toBeNull();
  });

  it("remove 不存在的 aid 返回 false", () => {
    expect(manager.remove("nonexistent.agentcp.io")).toBe(false);
  });

  it("list 返回所有联系人", () => {
    manager.add(makeContact("alice.agentcp.io"));
    manager.add(makeContact("bob.agentcp.io"));
    const all = manager.list();
    expect(all.length).toBe(2);
  });

  // ===== 分组 =====

  it("addToGroup 和 list(group) 过滤", () => {
    manager.add(makeContact("alice.agentcp.io"));
    manager.add(makeContact("bob.agentcp.io"));
    manager.addToGroup("alice.agentcp.io", "friends");
    const friends = manager.list("friends");
    expect(friends.length).toBe(1);
    expect(friends[0].aid).toBe("alice.agentcp.io");
  });

  it("addToGroup 不存在的 aid 返回 false", () => {
    expect(manager.addToGroup("nonexistent.agentcp.io", "g")).toBe(false);
  });

  it("addToGroup 重复添加同一分组不重复", () => {
    manager.add(makeContact("alice.agentcp.io"));
    manager.addToGroup("alice.agentcp.io", "friends");
    manager.addToGroup("alice.agentcp.io", "friends");
    expect(manager.get("alice.agentcp.io")!.groups).toEqual(["friends"]);
  });

  it("removeFromGroup 移除分组", () => {
    manager.add(makeContact("alice.agentcp.io"));
    manager.addToGroup("alice.agentcp.io", "friends");
    expect(manager.removeFromGroup("alice.agentcp.io", "friends")).toBe(true);
    expect(manager.get("alice.agentcp.io")!.groups).toEqual([]);
  });

  it("removeFromGroup 不存在的分组返回 false", () => {
    manager.add(makeContact("alice.agentcp.io"));
    expect(manager.removeFromGroup("alice.agentcp.io", "nonexistent")).toBe(false);
  });

  it("listGroups 返回所有分组", () => {
    manager.add(makeContact("alice.agentcp.io"));
    manager.add(makeContact("bob.agentcp.io"));
    manager.addToGroup("alice.agentcp.io", "friends");
    manager.addToGroup("bob.agentcp.io", "work");
    manager.addToGroup("alice.agentcp.io", "work");
    const groups = manager.listGroups();
    expect(groups.sort()).toEqual(["friends", "work"]);
  });

  // ===== 交互记录 =====

  it("recordInteraction 更新计数和时间", () => {
    manager.add(makeContact("alice.agentcp.io"));
    manager.recordInteraction("alice.agentcp.io", 1000);
    manager.recordInteraction("alice.agentcp.io", 2000);
    const c = manager.get("alice.agentcp.io")!;
    expect(c.interactionCount).toBe(2);
    expect(c.totalDurationMs).toBe(3000);
    expect(c.lastInteractionAt).toBeGreaterThan(0);
  });

  it("recordInteraction 不传 durationMs 不累加时长", () => {
    manager.add(makeContact("alice.agentcp.io"));
    manager.recordInteraction("alice.agentcp.io");
    const c = manager.get("alice.agentcp.io")!;
    expect(c.interactionCount).toBe(1);
    expect(c.totalDurationMs).toBe(0);
  });

  it("recordInteraction 不存在的 aid 不报错", () => {
    expect(() => manager.recordInteraction("nonexistent.agentcp.io")).not.toThrow();
  });

  // ===== 持久化 =====

  it("save 后新实例 load 能读到数据", () => {
    manager.add(makeContact("alice.agentcp.io", { name: "Alice" }));
    manager.addToGroup("alice.agentcp.io", "friends");
    manager.recordInteraction("alice.agentcp.io", 500);

    // 新实例从同一文件加载
    const manager2 = new ContactManager(filePath);
    const c = manager2.get("alice.agentcp.io");
    expect(c).not.toBeNull();
    expect(c!.name).toBe("Alice");
    expect(c!.groups).toEqual(["friends"]);
    expect(c!.interactionCount).toBe(1);
    expect(c!.totalDurationMs).toBe(500);
  });

  it("文件不存在时 load 不报错", () => {
    const emptyPath = path.join(tmpDir, "nonexistent.json");
    expect(() => new ContactManager(emptyPath)).not.toThrow();
  });

  it("文件内容损坏时 load 不报错", () => {
    fs.writeFileSync(filePath, "not valid json{{{");
    expect(() => new ContactManager(filePath)).not.toThrow();
  });

  // ===== 返回值是副本，不影响内部状态 =====

  it("get 返回的是副本", () => {
    manager.add(makeContact("alice.agentcp.io"));
    const c = manager.get("alice.agentcp.io")!;
    c.name = "Hacked";
    expect(manager.get("alice.agentcp.io")!.name).toBe("alice");
  });

  // ===== 信用评分 =====

  it("新联系人有默认信用字段", () => {
    manager.add(makeContact("alice.agentcp.io"));
    const c = manager.get("alice.agentcp.io")!;
    expect(c.creditScore).toBe(50);
    expect(c.successfulSessions).toBe(0);
    expect(c.failedSessions).toBe(0);
    expect(c.creditManualOverride).toBeUndefined();
  });

  it("setCreditScore 设置手动覆盖", () => {
    manager.add(makeContact("alice.agentcp.io"));
    const result = manager.setCreditScore("alice.agentcp.io", 80, "good agent");
    expect(result).not.toBeNull();
    expect(result!.creditScore).toBe(80);
    expect(result!.creditManualOverride).toBe(80);
    expect(result!.creditManualReason).toBe("good agent");
  });

  it("setCreditScore clamp 到 [0, 100]", () => {
    manager.add(makeContact("alice.agentcp.io"));
    manager.setCreditScore("alice.agentcp.io", 150);
    expect(manager.get("alice.agentcp.io")!.creditScore).toBe(100);
    manager.setCreditScore("alice.agentcp.io", -10);
    expect(manager.get("alice.agentcp.io")!.creditScore).toBe(0);
  });

  it("setCreditScore 不存在的 aid 返回 null", () => {
    expect(manager.setCreditScore("nonexistent.agentcp.io", 80)).toBeNull();
  });

  it("clearCreditOverride 恢复自动计算", () => {
    manager.add(makeContact("alice.agentcp.io"));
    manager.setCreditScore("alice.agentcp.io", 10, "bad");
    expect(manager.get("alice.agentcp.io")!.creditScore).toBe(10);

    const result = manager.clearCreditOverride("alice.agentcp.io");
    expect(result).not.toBeNull();
    expect(result!.creditManualOverride).toBeUndefined();
    expect(result!.creditManualReason).toBeUndefined();
    // 自动计算回基础分 50
    expect(result!.creditScore).toBe(50);
  });

  it("clearCreditOverride 不存在的 aid 返回 null", () => {
    expect(manager.clearCreditOverride("nonexistent.agentcp.io")).toBeNull();
  });

  it("recordSessionClose 更新成功会话统计和信用分", () => {
    manager.add(makeContact("alice.agentcp.io"));
    manager.recordSessionClose("alice.agentcp.io", true, 60000);
    const c = manager.get("alice.agentcp.io")!;
    expect(c.successfulSessions).toBe(1);
    expect(c.failedSessions).toBe(0);
    // 50 + 0(interaction) + 1(duration: 60000ms = 1min) + 1*3(session) = 54
    expect(c.creditScore).toBe(54);
  });

  it("recordSessionClose 更新失败会话统计和信用分", () => {
    manager.add(makeContact("alice.agentcp.io"));
    manager.recordSessionClose("alice.agentcp.io", false, 60000);
    const c = manager.get("alice.agentcp.io")!;
    expect(c.successfulSessions).toBe(0);
    expect(c.failedSessions).toBe(1);
    // 50 + 0(interaction) + 1(duration: 60000ms = 1min) - 1*3(session) = 48
    expect(c.creditScore).toBe(48);
  });

  it("recordSessionClose 不存在的 aid 不报错", () => {
    expect(() => manager.recordSessionClose("nonexistent.agentcp.io", true, 1000)).not.toThrow();
  });

  it("向后兼容：加载缺少信用字段的联系人", () => {
    // 写入一个没有信用字段的旧格式联系人
    const oldContact = {
      aid: "old.agentcp.io",
      name: "old",
      groups: [],
      interactionCount: 5,
      totalDurationMs: 10000,
      addedAt: Date.now(),
      updatedAt: Date.now(),
    };
    fs.writeFileSync(filePath, JSON.stringify([oldContact]));

    const manager2 = new ContactManager(filePath);
    const c = manager2.get("old.agentcp.io")!;
    expect(c.creditScore).toBe(50);
    expect(c.successfulSessions).toBe(0);
    expect(c.failedSessions).toBe(0);
  });
});

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
    const c = makeContact("alice.aid.pub");
    manager.add(c);
    const got = manager.get("alice.aid.pub");
    expect(got).not.toBeNull();
    expect(got!.aid).toBe("alice.aid.pub");
    expect(got!.name).toBe("alice");
  });

  it("重复 add 同一 aid 不覆盖", () => {
    manager.add(makeContact("alice.aid.pub", { name: "Alice" }));
    manager.add(makeContact("alice.aid.pub", { name: "Alice2" }));
    expect(manager.get("alice.aid.pub")!.name).toBe("Alice");
  });

  it("get 不存在的 aid 返回 null", () => {
    expect(manager.get("nonexistent.aid.pub")).toBeNull();
  });

  it("update 更新字段", () => {
    manager.add(makeContact("alice.aid.pub"));
    const updated = manager.update("alice.aid.pub", { name: "Alice New", emoji: "🤖" });
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("Alice New");
    expect(updated!.emoji).toBe("🤖");
  });

  it("update 不存在的 aid 返回 null", () => {
    expect(manager.update("nonexistent.aid.pub", { name: "X" })).toBeNull();
  });

  it("remove 删除联系人", () => {
    manager.add(makeContact("alice.aid.pub"));
    expect(manager.remove("alice.aid.pub")).toBe(true);
    expect(manager.get("alice.aid.pub")).toBeNull();
  });

  it("remove 不存在的 aid 返回 false", () => {
    expect(manager.remove("nonexistent.aid.pub")).toBe(false);
  });

  it("list 返回所有联系人", () => {
    manager.add(makeContact("alice.aid.pub"));
    manager.add(makeContact("bob.aid.pub"));
    const all = manager.list();
    expect(all.length).toBe(2);
  });

  // ===== 分组 =====

  it("addToGroup 和 list(group) 过滤", () => {
    manager.add(makeContact("alice.aid.pub"));
    manager.add(makeContact("bob.aid.pub"));
    manager.addToGroup("alice.aid.pub", "friends");
    const friends = manager.list("friends");
    expect(friends.length).toBe(1);
    expect(friends[0].aid).toBe("alice.aid.pub");
  });

  it("addToGroup 不存在的 aid 返回 false", () => {
    expect(manager.addToGroup("nonexistent.aid.pub", "g")).toBe(false);
  });

  it("addToGroup 重复添加同一分组不重复", () => {
    manager.add(makeContact("alice.aid.pub"));
    manager.addToGroup("alice.aid.pub", "friends");
    manager.addToGroup("alice.aid.pub", "friends");
    expect(manager.get("alice.aid.pub")!.groups).toEqual(["friends"]);
  });

  it("removeFromGroup 移除分组", () => {
    manager.add(makeContact("alice.aid.pub"));
    manager.addToGroup("alice.aid.pub", "friends");
    expect(manager.removeFromGroup("alice.aid.pub", "friends")).toBe(true);
    expect(manager.get("alice.aid.pub")!.groups).toEqual([]);
  });

  it("removeFromGroup 不存在的分组返回 false", () => {
    manager.add(makeContact("alice.aid.pub"));
    expect(manager.removeFromGroup("alice.aid.pub", "nonexistent")).toBe(false);
  });

  it("listGroups 返回所有分组", () => {
    manager.add(makeContact("alice.aid.pub"));
    manager.add(makeContact("bob.aid.pub"));
    manager.addToGroup("alice.aid.pub", "friends");
    manager.addToGroup("bob.aid.pub", "work");
    manager.addToGroup("alice.aid.pub", "work");
    const groups = manager.listGroups();
    expect(groups.sort()).toEqual(["friends", "work"]);
  });

  // ===== 交互记录 =====

  it("recordInteraction 更新计数和时间", () => {
    manager.add(makeContact("alice.aid.pub"));
    manager.recordInteraction("alice.aid.pub", 1000);
    manager.recordInteraction("alice.aid.pub", 2000);
    const c = manager.get("alice.aid.pub")!;
    expect(c.interactionCount).toBe(2);
    expect(c.totalDurationMs).toBe(3000);
    expect(c.lastInteractionAt).toBeGreaterThan(0);
  });

  it("recordInteraction 不传 durationMs 不累加时长", () => {
    manager.add(makeContact("alice.aid.pub"));
    manager.recordInteraction("alice.aid.pub");
    const c = manager.get("alice.aid.pub")!;
    expect(c.interactionCount).toBe(1);
    expect(c.totalDurationMs).toBe(0);
  });

  it("recordInteraction 不存在的 aid 不报错", () => {
    expect(() => manager.recordInteraction("nonexistent.aid.pub")).not.toThrow();
  });

  // ===== 持久化 =====

  it("save 后新实例 load 能读到数据", () => {
    manager.add(makeContact("alice.aid.pub", { name: "Alice" }));
    manager.addToGroup("alice.aid.pub", "friends");
    manager.recordInteraction("alice.aid.pub", 500);

    // 新实例从同一文件加载
    const manager2 = new ContactManager(filePath);
    const c = manager2.get("alice.aid.pub");
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
    manager.add(makeContact("alice.aid.pub"));
    const c = manager.get("alice.aid.pub")!;
    c.name = "Hacked";
    expect(manager.get("alice.aid.pub")!.name).toBe("alice");
  });

  // ===== 信用评分 =====

  it("新联系人有默认信用字段", () => {
    manager.add(makeContact("alice.aid.pub"));
    const c = manager.get("alice.aid.pub")!;
    expect(c.creditScore).toBe(50);
    expect(c.successfulSessions).toBe(0);
    expect(c.failedSessions).toBe(0);
    expect(c.creditManualOverride).toBeUndefined();
  });

  it("setCreditScore 设置手动覆盖", () => {
    manager.add(makeContact("alice.aid.pub"));
    const result = manager.setCreditScore("alice.aid.pub", 80, "good agent");
    expect(result).not.toBeNull();
    expect(result!.creditScore).toBe(80);
    expect(result!.creditManualOverride).toBe(80);
    expect(result!.creditManualReason).toBe("good agent");
  });

  it("setCreditScore clamp 到 [0, 100]", () => {
    manager.add(makeContact("alice.aid.pub"));
    manager.setCreditScore("alice.aid.pub", 150);
    expect(manager.get("alice.aid.pub")!.creditScore).toBe(100);
    manager.setCreditScore("alice.aid.pub", -10);
    expect(manager.get("alice.aid.pub")!.creditScore).toBe(0);
  });

  it("setCreditScore 不存在的 aid 返回 null", () => {
    expect(manager.setCreditScore("nonexistent.aid.pub", 80)).toBeNull();
  });

  it("clearCreditOverride 恢复自动计算", () => {
    manager.add(makeContact("alice.aid.pub"));
    manager.setCreditScore("alice.aid.pub", 10, "bad");
    expect(manager.get("alice.aid.pub")!.creditScore).toBe(10);

    const result = manager.clearCreditOverride("alice.aid.pub");
    expect(result).not.toBeNull();
    expect(result!.creditManualOverride).toBeUndefined();
    expect(result!.creditManualReason).toBeUndefined();
    // 自动计算回基础分 50
    expect(result!.creditScore).toBe(50);
  });

  it("clearCreditOverride 不存在的 aid 返回 null", () => {
    expect(manager.clearCreditOverride("nonexistent.aid.pub")).toBeNull();
  });

  it("recordSessionClose 更新成功会话统计和信用分", () => {
    manager.add(makeContact("alice.aid.pub"));
    manager.recordSessionClose("alice.aid.pub", true, 60000);
    const c = manager.get("alice.aid.pub")!;
    expect(c.successfulSessions).toBe(1);
    expect(c.failedSessions).toBe(0);
    // 50 + 0(interaction) + 1(duration: 60000ms = 1min) + 1*3(session) = 54
    expect(c.creditScore).toBe(54);
  });

  it("recordSessionClose 更新失败会话统计和信用分", () => {
    manager.add(makeContact("alice.aid.pub"));
    manager.recordSessionClose("alice.aid.pub", false, 60000);
    const c = manager.get("alice.aid.pub")!;
    expect(c.successfulSessions).toBe(0);
    expect(c.failedSessions).toBe(1);
    // 50 + 0(interaction) + 1(duration: 60000ms = 1min) - 1*3(session) = 48
    expect(c.creditScore).toBe(48);
  });

  it("recordSessionClose 不存在的 aid 不报错", () => {
    expect(() => manager.recordSessionClose("nonexistent.aid.pub", true, 1000)).not.toThrow();
  });

  it("向后兼容：加载缺少信用字段的联系人", () => {
    // 写入一个没有信用字段的旧格式联系人
    const oldContact = {
      aid: "old.aid.pub",
      name: "old",
      groups: [],
      interactionCount: 5,
      totalDurationMs: 10000,
      addedAt: Date.now(),
      updatedAt: Date.now(),
    };
    fs.writeFileSync(filePath, JSON.stringify([oldContact]));

    const manager2 = new ContactManager(filePath);
    const c = manager2.get("old.aid.pub")!;
    expect(c.creditScore).toBe(50);
    expect(c.successfulSessions).toBe(0);
    expect(c.failedSessions).toBe(0);
  });
});

import * as fs from "fs";
import * as path from "path";
import type { Contact } from "./types.js";
import { calculateCreditScore } from "./credit.js";

const STORAGE_PATH = path.join(process.env.HOME || "~", ".acp-storage", "contacts.json");

export class ContactManager {
  private contacts: Map<string, Contact> = new Map();
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? STORAGE_PATH;
    this.load();
  }

  /** 添加联系人，如果已存在则忽略 */
  add(contact: Contact): void {
    if (this.contacts.has(contact.aid)) {
      return;
    }
    this.contacts.set(contact.aid, {
      ...contact,
      creditScore: contact.creditScore ?? 50,
      successfulSessions: contact.successfulSessions ?? 0,
      failedSessions: contact.failedSessions ?? 0,
    });
    this.save();
  }

  /** 获取联系人 */
  get(aid: string): Contact | null {
    const c = this.contacts.get(aid);
    return c ? { ...c } : null;
  }

  /** 更新联系人，返回更新后的联系人或 null */
  update(aid: string, updates: Partial<Omit<Contact, "aid">>): Contact | null {
    const c = this.contacts.get(aid);
    if (!c) return null;
    Object.assign(c, updates, { updatedAt: Date.now() });
    this.save();
    return { ...c };
  }

  /** 删除联系人 */
  remove(aid: string): boolean {
    const deleted = this.contacts.delete(aid);
    if (deleted) this.save();
    return deleted;
  }

  /** 列出联系人，可按分组过滤 */
  list(group?: string): Contact[] {
    const all = Array.from(this.contacts.values());
    if (group) {
      return all.filter((c) => c.groups.includes(group)).map((c) => ({ ...c }));
    }
    return all.map((c) => ({ ...c }));
  }

  /** 将联系人添加到分组 */
  addToGroup(aid: string, group: string): boolean {
    const c = this.contacts.get(aid);
    if (!c) return false;
    if (c.groups.includes(group)) return true;
    c.groups.push(group);
    c.updatedAt = Date.now();
    this.save();
    return true;
  }

  /** 将联系人从分组移除 */
  removeFromGroup(aid: string, group: string): boolean {
    const c = this.contacts.get(aid);
    if (!c) return false;
    const idx = c.groups.indexOf(group);
    if (idx === -1) return false;
    c.groups.splice(idx, 1);
    c.updatedAt = Date.now();
    this.save();
    return true;
  }

  /** 列出所有分组 */
  listGroups(): string[] {
    const groups = new Set<string>();
    for (const c of this.contacts.values()) {
      for (const g of c.groups) {
        groups.add(g);
      }
    }
    return Array.from(groups);
  }

  /** 记录一次交互 */
  recordInteraction(aid: string, durationMs?: number): void {
    const c = this.contacts.get(aid);
    if (!c) return;
    c.interactionCount++;
    c.lastInteractionAt = Date.now();
    if (durationMs != null) {
      c.totalDurationMs += durationMs;
    }
    c.updatedAt = Date.now();
    this.save();
  }

  /** 设置手动信用覆盖（主人操作） */
  setCreditScore(aid: string, score: number, reason?: string): Contact | null {
    const c = this.contacts.get(aid);
    if (!c) return null;
    c.creditManualOverride = Math.max(0, Math.min(score, 100));
    c.creditManualReason = reason;
    c.creditScore = calculateCreditScore(c);
    c.updatedAt = Date.now();
    this.save();
    return { ...c };
  }

  /** 清除手动覆盖，恢复自动计算 */
  clearCreditOverride(aid: string): Contact | null {
    const c = this.contacts.get(aid);
    if (!c) return null;
    delete c.creditManualOverride;
    delete c.creditManualReason;
    c.creditScore = calculateCreditScore(c);
    c.updatedAt = Date.now();
    this.save();
    return { ...c };
  }

  /** 记录会话关闭（更新统计 + 重算信用） */
  recordSessionClose(aid: string, success: boolean, durationMs: number): void {
    const c = this.contacts.get(aid);
    if (!c) return;
    if (success) {
      c.successfulSessions++;
    } else {
      c.failedSessions++;
    }
    c.totalDurationMs += durationMs;
    c.creditScore = calculateCreditScore(c);
    c.updatedAt = Date.now();
    this.save();
  }

  /** 记录会话评分（将单次评分融入累积信用分） */
  recordSessionRating(aid: string, sessionScore: number, aiSummary?: string): void {
    const c = this.contacts.get(aid);
    if (!c) return;

    // 手动覆盖时跳过自动更新
    if (c.creditManualOverride != null) return;

    // 加权融合：累积分 * 0.7 + 本次评分 * 0.3
    c.creditScore = Math.round(
      Math.max(0, Math.min(c.creditScore * 0.7 + sessionScore * 0.3, 100)),
    );

    // 可选：将 AI 摘要追加到 notes（限制 500 字符）
    if (aiSummary) {
      const timestamp = new Date().toISOString().substring(0, 10);
      const entry = `[${timestamp}] ${aiSummary}`;
      if (c.notes) {
        c.notes = `${entry}\n${c.notes}`.substring(0, 500);
      } else {
        c.notes = entry.substring(0, 500);
      }
    }

    c.updatedAt = Date.now();
    this.save();
  }

  /** 持久化到 JSON 文件（原子写入） */
  private save(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = Array.from(this.contacts.values());
      const tmpPath = this.filePath + ".tmp";
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
      fs.renameSync(tmpPath, this.filePath);
    } catch (err) {
      console.error("[ACP] Failed to save contacts:", err);
    }
  }

  /** 从 JSON 文件加载 */
  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = fs.readFileSync(this.filePath, "utf8");
      const data: Contact[] = JSON.parse(raw);
      if (!Array.isArray(data)) return;
      for (const c of data) {
        if (c.aid) {
          // 向后兼容：补充缺失的信用字段
          if (c.creditScore == null) c.creditScore = 50;
          if (c.successfulSessions == null) c.successfulSessions = 0;
          if (c.failedSessions == null) c.failedSessions = 0;
          this.contacts.set(c.aid, c);
        }
      }
    } catch (err) {
      console.error("[ACP] Failed to load contacts:", err);
    }
  }
}

// 按 identityId 分实例
const instances = new Map<string, ContactManager>();

export function getContactManager(identityId?: string): ContactManager {
  const key = identityId ?? "default";
  if (!instances.has(key)) {
    const filePath = identityId && identityId !== "default"
      ? path.join(process.env.HOME || "~", ".acp-storage", "identities", identityId, "contacts.json")
      : STORAGE_PATH;  // 兼容旧路径
    instances.set(key, new ContactManager(filePath));
  }
  return instances.get(key)!;
}

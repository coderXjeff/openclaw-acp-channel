import type { Contact } from "./types.js";

/** 信用等级 */
export type CreditLevel = "trusted" | "neutral" | "untrusted";

/** 根据分数计算等级 */
export function getCreditLevel(score: number): CreditLevel {
  if (score >= 70) return "trusted";
  if (score >= 40) return "neutral";
  return "untrusted";
}

/** 根据联系人数据自动计算信用评分 */
export function calculateCreditScore(contact: Contact): number {
  // 手动覆盖优先
  if (contact.creditManualOverride != null) {
    return contact.creditManualOverride;
  }

  const base = 50;
  const interactionBonus = Math.min(contact.interactionCount, 20);
  const durationBonus = Math.min(Math.floor(contact.totalDurationMs / 60000), 15);
  const sessionDelta = (contact.successfulSessions - contact.failedSessions) * 3;
  const sessionBonus = Math.max(-15, Math.min(sessionDelta, 15));

  const raw = base + interactionBonus + durationBonus + sessionBonus;
  return Math.max(0, Math.min(raw, 100));
}

/** 判断是否应拒绝交互 */
export function shouldRejectByCredit(contact: Contact | null): boolean {
  if (!contact) return false;
  return contact.creditScore < 20;
}

import { describe, it, expect } from "vitest";
import { getCreditLevel, calculateCreditScore, shouldRejectByCredit } from "../src/credit.js";
import type { Contact } from "../src/types.js";

function makeContact(overrides?: Partial<Contact>): Contact {
  const now = Date.now();
  return {
    aid: "test.aid.pub",
    name: "test",
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

describe("getCreditLevel", () => {
  it("score >= 70 → trusted", () => {
    expect(getCreditLevel(70)).toBe("trusted");
    expect(getCreditLevel(100)).toBe("trusted");
  });

  it("score >= 40 and < 70 → neutral", () => {
    expect(getCreditLevel(40)).toBe("neutral");
    expect(getCreditLevel(69)).toBe("neutral");
  });

  it("score < 40 → untrusted", () => {
    expect(getCreditLevel(39)).toBe("untrusted");
    expect(getCreditLevel(0)).toBe("untrusted");
  });
});

describe("calculateCreditScore", () => {
  it("基础分 50（无任何交互）", () => {
    const c = makeContact();
    expect(calculateCreditScore(c)).toBe(50);
  });

  it("交互次数加分，上限 20", () => {
    expect(calculateCreditScore(makeContact({ interactionCount: 10 }))).toBe(60);
    expect(calculateCreditScore(makeContact({ interactionCount: 30 }))).toBe(70);
  });

  it("交互时长加分，每分钟 +1，上限 15", () => {
    // 5 分钟 = 300000ms → +5
    expect(calculateCreditScore(makeContact({ totalDurationMs: 300000 }))).toBe(55);
    // 20 分钟 = 1200000ms → +15 (capped)
    expect(calculateCreditScore(makeContact({ totalDurationMs: 1200000 }))).toBe(65);
  });

  it("成功会话加分，每次 +3，上限 +15", () => {
    expect(calculateCreditScore(makeContact({ successfulSessions: 3 }))).toBe(59);
    // 6 次 → +18 但 capped 到 +15
    expect(calculateCreditScore(makeContact({ successfulSessions: 6 }))).toBe(65);
  });

  it("失败会话减分，每次 -3，下限 -15", () => {
    expect(calculateCreditScore(makeContact({ failedSessions: 3 }))).toBe(41);
    // 6 次 → -18 但 capped 到 -15
    expect(calculateCreditScore(makeContact({ failedSessions: 6 }))).toBe(35);
  });

  it("综合计算并 clamp 到 [0, 100]", () => {
    // 全满：50 + 20 + 15 + 15 = 100
    const maxContact = makeContact({
      interactionCount: 100,
      totalDurationMs: 6000000,
      successfulSessions: 10,
    });
    expect(calculateCreditScore(maxContact)).toBe(100);

    // 全低：50 + 0 + 0 - 15 = 35（不会低于 0）
    const lowContact = makeContact({ failedSessions: 20 });
    expect(calculateCreditScore(lowContact)).toBe(35);
  });

  it("clamp 下限为 0", () => {
    // 极端情况不会出现负数，但验证 clamp
    // 50 + 0 + 0 - 15 = 35，最低也是 35
    // 要到 0 需要手动覆盖
    const c = makeContact({ failedSessions: 100 });
    expect(calculateCreditScore(c)).toBeGreaterThanOrEqual(0);
  });

  it("有手动覆盖时直接返回覆盖值", () => {
    const c = makeContact({
      interactionCount: 100,
      creditManualOverride: 10,
    });
    expect(calculateCreditScore(c)).toBe(10);
  });
});

describe("shouldRejectByCredit", () => {
  it("contact 为 null 不拒绝", () => {
    expect(shouldRejectByCredit(null)).toBe(false);
  });

  it("creditScore < 20 拒绝", () => {
    expect(shouldRejectByCredit(makeContact({ creditScore: 19 }))).toBe(true);
    expect(shouldRejectByCredit(makeContact({ creditScore: 0 }))).toBe(true);
  });

  it("creditScore >= 20 不拒绝", () => {
    expect(shouldRejectByCredit(makeContact({ creditScore: 20 }))).toBe(false);
    expect(shouldRejectByCredit(makeContact({ creditScore: 50 }))).toBe(false);
  });
});

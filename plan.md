# Phase 4 实现记录：信用评级体系（已完成）

## 状态：✅ 已完成

## 实现内容

### 新增文件

| 文件 | 说明 |
|------|------|
| `src/credit.ts` | 信用评分计算：getCreditLevel / calculateCreditScore / shouldRejectByCredit |
| `test/credit.test.ts` | 14 个测试用例 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `src/types.ts` | Contact 接口新增 creditScore / creditManualOverride / creditManualReason / successfulSessions / failedSessions |
| `src/contacts.ts` | 新增 setCreditScore / clearCreditOverride / recordSessionClose 方法；add() 默认信用字段；load() 向后兼容 |
| `src/monitor.ts` | closeSession() 记录会话统计；handleInboundMessage() 入站信用检查（非主人） |
| `src/actions.ts` | manage-contacts 新增 setCreditScore / clearCreditOverride / getCreditInfo 子操作 |
| `test/contacts.test.ts` | 新增 12 个信用相关测试 |

### 评分公式

```
base = 50
+ min(interactionCount, 20)                         // 交互频次，上限 +20
+ min(floor(totalDurationMs / 60000), 15)            // 交互时长，每分钟 +1，上限 +15
+ clamp((successfulSessions - failedSessions) * 3, -15, 15)  // 会话成功率
= clamp(result, 0, 100)
```

有 creditManualOverride 时直接返回覆盖值。

### 真实验证结果

ykjwsy2.agentcp.io 与 yiksclaw-2026-v2.agentcp.io 对话 6 轮后 idle_timeout 正常结束：
- successfulSessions: 0 → 1
- creditScore: 50 → 61（50 base + 8 交互 + 0 时长 + 3 成功）

## 下一步：Phase 5（插件钩子集成）

# 值班 Agent SDK 变动文档

> 版本: v1.3.0 | 日期: 2026-02-20

## 1. 变动概述

本次变更为 ACP TypeScript SDK 新增值班（Duty）Agent 机制支持，涵盖类型定义、事件处理、操作方法三个层面。对应服务端文档：《值班 Agent SDK 接入指南 v1.0》。

涉及文件：

| 文件 | 变动类型 |
|------|----------|
| `src/group/types.ts` | 新增错误码、常量、7 个接口 |
| `src/group/events.ts` | 新增事件回调 + 分发逻辑 |
| `src/group/operations.ts` | 新增 5 个操作方法 |
| `src/group/index.ts` | 新增导出 |
| `src/agentcp.ts` | 默认事件处理器补充 |
| `src/server.ts` | 浏览器推送补充 |

---

## 2. 新增错误码

`GroupErrorCode` 枚举新增 6 个值班相关错误码：

| 错误码 | 枚举名 | 说明 |
|--------|--------|------|
| 1020 | `DUTY_NOT_ENABLED` | 值班模式未启用 |
| 1021 | `NOT_DUTY_AGENT` | 不是当前值班 Agent |
| 1022 | `DISPATCH_NOT_FOUND` | 待仲裁消息不存在（已超时或已处理） |
| 1023 | `INVALID_DECISION` | 仲裁决策参数不合法 |
| 1024 | `AGENT_MD_NOT_FOUND` | agent.md 不可达 |
| 1025 | `AGENT_MD_INVALID` | agent.md 无效或缺少 type 字段 |

---

## 3. 新增常量

```typescript
export const NOTIFY_DUTY_DISPATCH = "duty_dispatch";
```

---

## 4. 新增类型定义

### 4.1 DutyMemberInfo

值班上下文中的成员信息。

```typescript
interface DutyMemberInfo {
    agent_id: string;   // Agent 标识
    agent_type: string; // "ai" | "human" | "avatar"
}
```

### 4.2 DutyContext

值班 Agent 收到 `duty_dispatch` 通知时的上下文数据。

```typescript
interface DutyContext {
    needs_dispatch: boolean;        // 是否需要仲裁
    original_msg_id: number;        // 原始消息 ID
    sender_id: string;              // 发送者 Agent ID
    sender_type: string;            // 发送者类型 ("human" | "ai")
    group_member_count: number;     // 群成员总数
    online_ai_members: DutyMemberInfo[];  // 在线 AI 成员列表
    human_members: DutyMemberInfo[];      // 人类成员列表
}
```

### 4.3 DispatchDecisionParams

值班 Agent 提交仲裁决策的参数。

```typescript
interface DispatchDecisionParams {
    original_msg_id: number;                        // 原始消息 ID
    type: "broadcast" | "selective" | "suppress";   // 决策类型
    hint?: string;                                  // 建议说明
    reply_mode?: string;                            // 回复模式
}
```

`type` 取值说明：
- `broadcast` — AI 全员高优先级处理
- `selective` — 结合 hint 建议特定 Agent 优先处理
- `suppress` — AI 全员延后处理（并入下一批）

### 4.4 DispatchMetadata

普通 AI Agent 收到的消息中附带的 dispatch 元数据。

```typescript
interface DispatchMetadata {
    type: string;       // 决策类型
    hint: string;       // 建议说明
    reply_mode: string; // 回复模式
}
```

### 4.5 DutyConfig

值班配置。

```typescript
interface DutyConfig {
    mode: "none" | "fixed" | "rotation";              // 值班模式
    rotation_strategy?: "round_robin" | "random";      // 轮值策略
    shift_duration_ms?: number;                        // 轮值时长（毫秒）
    max_messages_per_shift?: number;                   // 每轮最大消息数
    dispatch_timeout_ms?: number;                      // 仲裁超时（毫秒）
    timeout_fallback?: "broadcast" | "next_duty";      // 超时降级策略
    agents?: string[];                                 // 固定值班 Agent 列表
}
```

### 4.6 DutyState

值班运行时状态。

```typescript
interface DutyState {
    current_duty_agent?: string;    // 当前值班 Agent
    shift_start_time?: number;      // 当前轮次开始时间
    messages_in_shift?: number;     // 当前轮次已处理消息数
    [key: string]: any;             // 服务端可能扩展的其他字段
}
```

### 4.7 DutyStatusResp

`get_duty_status` 响应。

```typescript
interface DutyStatusResp {
    config: DutyConfig;
    state: DutyState;
}
```

---

## 5. 新增事件回调

`ACPGroupEventHandler` 接口新增：

```typescript
onDutyDispatch(groupId: string, context: DutyContext): void;
```

当值班 Agent 收到服务端推送的 `duty_dispatch` 通知时触发。SDK 会自动解析 `DutyContext`，包含原始消息信息、在线 AI 成员列表、人类成员列表等。

默认处理器行为：仅打印日志，不做自动仲裁。业务方需自行实现仲裁逻辑。

---

## 6. 新增操作方法

`GroupOperations` 类新增 5 个方法：

### 6.1 updateDutyConfig

更新群组值班配置。权限要求：creator 或 admin。

```typescript
async updateDutyConfig(
    targetAid: string,
    groupId: string,
    config: Partial<DutyConfig>
): Promise<void>
```

示例：
```typescript
await groupOps.updateDutyConfig(targetAid, groupId, {
    mode: "rotation",
    rotation_strategy: "round_robin",
    shift_duration_ms: 300000,
    dispatch_timeout_ms: 30000,
    timeout_fallback: "broadcast",
});
```

### 6.2 setFixedAgents

快捷设置固定值班 Agent 列表，自动切换为 `fixed` 模式。

```typescript
async setFixedAgents(
    targetAid: string,
    groupId: string,
    agents: string[]
): Promise<void>
```

示例：
```typescript
await groupOps.setFixedAgents(targetAid, groupId, [
    "manager-bot.example.com",
    "backup-bot.example.com",
]);
```

### 6.3 getDutyStatus

获取值班状态，返回当前配置和运行时状态。

```typescript
async getDutyStatus(
    targetAid: string,
    groupId: string
): Promise<DutyStatusResp>
```

### 6.4 dispatchDecision

值班 Agent 提交仲裁决策。

```typescript
async dispatchDecision(
    targetAid: string,
    groupId: string,
    params: DispatchDecisionParams
): Promise<void>
```

示例：
```typescript
await groupOps.dispatchDecision(targetAid, groupId, {
    original_msg_id: 12345,
    type: "selective",
    hint: "用户需要翻译，建议 translator-bot 优先处理",
    reply_mode: "single",
});
```

### 6.5 refreshMemberTypes

重新获取所有成员的 agent.md 并更新 AgentType。

```typescript
async refreshMemberTypes(
    targetAid: string,
    groupId: string
): Promise<void>
```

---

## 7. 典型接入流程

### 7.1 值班 Agent 接入

```typescript
// 1. 注册自定义事件处理器
agentCP.setGroupEventHandler({
    // ... 其他回调 ...

    async onDutyDispatch(groupId, context) {
        // 2. 收到仲裁请求，分析消息内容
        console.log(`收到仲裁请求: msg=${context.original_msg_id} from=${context.sender_id}`);

        // 3. 提交仲裁决策
        await agentCP.groupOps.dispatchDecision(targetAid, groupId, {
            original_msg_id: context.original_msg_id,
            type: "selective",
            hint: "建议 translator-bot 优先处理",
            reply_mode: "single",
        });

        // 4. 发送主持回复（可选）
        await agentCP.groupOps.sendGroupMessage(targetAid, groupId,
            "本批消息是翻译请求，已分配给 translator-bot。");
    },
});
```

### 7.2 管理端配置值班

```typescript
// 开启轮值模式
await groupOps.updateDutyConfig(targetAid, groupId, {
    mode: "rotation",
    rotation_strategy: "round_robin",
    shift_duration_ms: 300000,
    max_messages_per_shift: 50,
    dispatch_timeout_ms: 30000,
    timeout_fallback: "broadcast",
});

// 或使用快捷方式设置固定值班
await groupOps.setFixedAgents(targetAid, groupId, [
    "manager-bot.example.com",
]);

// 查询值班状态
const status = await groupOps.getDutyStatus(targetAid, groupId);
console.log(`当前值班: ${status.state.current_duty_agent}`);
console.log(`模式: ${status.config.mode}`);
```

### 7.3 普通 AI Agent 处理 dispatch 元数据

普通 AI Agent 收到的批量消息中，`metadata` 字段可能包含 `dispatch` 对象：

```typescript
agentCP.setGroupEventHandler({
    onGroupMessageBatch(groupId, batch) {
        for (const msg of batch.messages) {
            const dispatch = msg.metadata?.dispatch as DispatchMetadata | undefined;
            if (dispatch) {
                if (dispatch.type === "selective" && dispatch.hint.includes(myAgentId)) {
                    // 我被点名，立即处理
                } else if (dispatch.type === "suppress") {
                    // 延后处理
                } else {
                    // broadcast 或未匹配，正常处理
                }
            }
        }
    },
});
```

---

## 8. 新增导出清单

`src/group/index.ts` 新增导出：

```typescript
// 常量
NOTIFY_DUTY_DISPATCH

// 类型
DutyMemberInfo, DutyContext, DispatchDecisionParams, DispatchMetadata,
DutyConfig, DutyState, DutyStatusResp
```

---

## 9. 兼容性说明

- 本次变更为纯新增，不修改任何已有接口的签名或行为
- `ACPGroupEventHandler` 接口新增了 `onDutyDispatch` 方法，所有实现该接口的代码需要补充此方法
- 如果群组未开启值班模式，所有 duty 操作会返回错误码 `1020 (DUTY_NOT_ENABLED)`
- `send_message` 用于值班 Agent 发送主持回复，复用已有方法，无需额外适配

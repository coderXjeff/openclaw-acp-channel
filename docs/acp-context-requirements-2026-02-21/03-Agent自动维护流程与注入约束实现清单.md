# Agent 自动维护流程与注入约束实现清单

> 目标：让 Agent 在回复用户的同时，自动将有价值的信息写入上下文文件（MEMORY.md / PEER.md 等），且不污染用户可见回复

## 0. 前置理解：谁来做维护决策？

**不是插件代码做决策，是 LLM 自己做决策。**

插件的职责是：
1. 通过 prompt 注入告诉 LLM "你有维护上下文的职责和规则"
2. 提供 `acp_context` 工具让 LLM 能执行读写操作
3. 工具侧做权限校验和安全防护

LLM 在一次推理中可以同时：输出回复文本 + 调用 `acp_context` 工具写入记忆。这是 OpenClaw 的 tool-use 能力天然支持的，不需要"双轨并行"的特殊机制。

## 1. 总览流程图

```mermaid
flowchart TD
    MSG[消息到达] --> SCENE{场景识别}

    SCENE -->|私聊 DM| DM_ENTRY[handleInboundMessageForIdentity]
    SCENE -->|群聊 Group| GRP_ENTRY[handleGroupMessagesForIdentity]

    DM_ENTRY --> BUILD_PROMPT[构建 prompt]
    GRP_ENTRY --> BUILD_PROMPT

    subgraph 插件侧 — prompt 组装
        BUILD_PROMPT --> SYS[buildAcpSystemPrompt<br/>ACP 网络规则]
        SYS --> HINTS[messageToolHints 注入<br/>维护 SOP + 工具说明]
        HINTS --> CTX[finalizeInboundContext<br/>GroupSystemPrompt 拼入 system prompt]
    end

    CTX --> RECORD[recordInboundSession<br/>记录会话元信息]
    RECORD --> DISPATCH[dispatchReplyFromConfig<br/>调用 LLM]

    subgraph OpenClaw 内部 — LLM 推理循环
        DISPATCH --> LLM_THINK[LLM 阅读 prompt + 历史]
        LLM_THINK --> LLM_DECIDE{是否有值得<br/>记录的信息?}

        LLM_DECIDE -->|有| TOOL_CALL[生成 tool-call<br/>acp_context]
        LLM_DECIDE -->|无| GEN_REPLY[生成回复文本]

        TOOL_CALL --> TOOL_EXEC[插件执行 acp_context<br/>权限检查 → 写入文件]
        TOOL_EXEC --> TOOL_RESULT[返回 tool-result]
        TOOL_RESULT --> GEN_REPLY

        GEN_REPLY --> MORE_TOOLS{还需要<br/>调用工具?}
        MORE_TOOLS -->|是| TOOL_CALL
        MORE_TOOLS -->|否| REPLY_DONE[回复文本完成]
    end

    REPLY_DONE --> DELIVER[deliver 回调<br/>发送回复给用户]
    DELIVER --> IDLE[markDispatchIdle<br/>结束]
```

## 2. 私聊详细流程

```mermaid
sequenceDiagram
    participant Sender as 外部 Agent / Owner
    participant Monitor as monitor.ts
    participant OpenClaw as OpenClaw Runtime
    participant LLM as LLM
    participant Tool as acp_context 工具
    participant FS as workspace/acp/

    Sender->>Monitor: ACP 消息到达
    Note over Monitor: handleInboundMessageForIdentity()

    Monitor->>Monitor: buildAcpSystemPrompt()<br/>含维护 SOP 指令
    Monitor->>OpenClaw: finalizeInboundContext()<br/>GroupSystemPrompt = ACP规则 + 维护SOP
    Monitor->>OpenClaw: recordInboundSession()
    Monitor->>OpenClaw: dispatchReplyFromConfig()

    OpenClaw->>LLM: system prompt + 历史 + 当前消息 + 可用工具列表

    Note over LLM: LLM 推理开始

    alt 消息包含值得记录的信息
        LLM->>OpenClaw: tool_call: acp_context(action="append_memory",<br/>scope="peer", aid="...", content="...")
        OpenClaw->>Tool: execute()
        Tool->>Tool: 权限检查: ChatType=direct,<br/>CommandAuthorized=false<br/>→ scope=peer 允许
        Tool->>Tool: 限流检查: opsThisTurn < 3 ✓
        Tool->>FS: 追加写入 peers/{aid}/MEMORY.md
        Tool-->>OpenClaw: tool_result: {ok: true}
        OpenClaw->>LLM: tool_result
    end

    LLM-->>OpenClaw: 回复文本（不含维护操作描述）
    OpenClaw->>Monitor: deliver(payload)
    Monitor->>Sender: sendReply(回复文本)
```

## 3. 群聊详细流程

```mermaid
sequenceDiagram
    participant Group as ACP 群
    participant GC as group-client.ts
    participant Monitor as monitor.ts
    participant OpenClaw as OpenClaw Runtime
    participant LLM as LLM
    participant Tool as acp_context 工具
    participant FS as workspace/acp/

    Group->>GC: onGroupMessageBatch
    GC->>GC: feedBufferGate → 聚合/去重/P1活力计算
    GC->>Monitor: handleGroupMessagesForIdentity()

    Monitor->>Monitor: buildAcpSystemPrompt()
    Monitor->>Monitor: buildGroupSituationPrompt()<br/>P1 活力态势 + mention 信息
    Monitor->>OpenClaw: finalizeInboundContext()<br/>GroupSystemPrompt = ACP规则 + 维护SOP + 群态势

    Monitor->>OpenClaw: dispatchReplyFromConfig()
    OpenClaw->>LLM: system prompt + 群历史 + 批量消息 + 工具列表

    Note over LLM: LLM 推理开始

    alt 群讨论包含值得记录的结论
        LLM->>OpenClaw: tool_call: acp_context(action="append_memory",<br/>scope="group", group_id="g-xxx", content="...")
        OpenClaw->>Tool: execute()
        Tool->>Tool: 权限检查: ChatType=group<br/>→ scope=group 允许<br/>→ scope=peer 拒绝 ✗
        Tool->>FS: 追加写入 groups/{gid}/MEMORY.md
        Tool-->>OpenClaw: tool_result: {ok: true}
        OpenClaw->>LLM: tool_result
    end

    alt LLM 决定回复
        LLM-->>OpenClaw: 回复文本
        OpenClaw->>Monitor: deliver(payload)
        Monitor->>Monitor: postProcessReply(裁剪)
        Monitor->>Group: sendGroupMessage(回复)
    else LLM 决定静默
        LLM-->>OpenClaw: 空文本
        Note over Monitor: deliver 收到空文本，跳过发送
    end
```

## 4. acp_context 工具内部流程

```mermaid
flowchart TD
    CALL[LLM 调用 acp_context] --> VALIDATE{参数校验}

    VALIDATE -->|aid 缺失| ERR_AID[返回错误:<br/>aid is required]
    VALIDATE -->|scope 与 id 不匹配<br/>如 scope=group 但无 group_id| ERR_SCOPE[返回错误:<br/>group_id required for scope=group]
    VALIDATE -->|通过| PERM{权限检查}

    PERM --> PERM_INPUT[输入:<br/>ChatType + CommandAuthorized<br/>+ action + scope]

    PERM_INPUT --> PERM_CHECK{会话类型?}
    PERM_CHECK -->|Owner| PERM_OK[全部 action 允许]
    PERM_CHECK -->|外部私聊| DM_PERM{action?}
    PERM_CHECK -->|群聊| GRP_PERM{action?}

    DM_PERM -->|read_peer*| PERM_OK
    DM_PERM -->|append_memory<br/>scope=peer| PERM_OK
    DM_PERM -->|其他| PERM_DENY[返回错误:<br/>permission denied]

    GRP_PERM -->|read_group*| PERM_OK
    GRP_PERM -->|append_memory<br/>scope=group| PERM_OK
    GRP_PERM -->|update_group_role<br/>update_peer 等| PERM_DENY

    PERM_OK --> RATE{限流检查}
    RATE -->|本轮 >= 3 次写入| RATE_DENY[返回错误:<br/>rate limit exceeded]
    RATE -->|本分钟 >= 10 次| RATE_DENY
    RATE -->|通过| PATH[路径解析]

    PATH --> PATH_RESOLVE[scope + identityId + targetId<br/>→ workspace/acp/.../*.md]
    PATH_RESOLVE --> PATH_SAFE{安全检查}
    PATH_SAFE -->|含 .. 或绝对路径| PATH_DENY[返回错误:<br/>invalid path]
    PATH_SAFE -->|通过| EXEC[执行读写操作]

    EXEC --> EXEC_READ{action 类型?}
    EXEC_READ -->|read_*| DO_READ[读取文件内容返回]
    EXEC_READ -->|append_memory| DO_APPEND[追加条目到 MEMORY.md]
    EXEC_READ -->|update_*| DO_PATCH[section patch 更新]
    EXEC_READ -->|promote_memory| DO_PROMOTE[复制条目到上级 scope]

    DO_READ --> AUDIT[写审计日志]
    DO_APPEND --> AUDIT
    DO_PATCH --> AUDIT
    DO_PROMOTE --> AUDIT

    AUDIT --> RESULT[返回 tool_result]
```

## 5. 权限矩阵速查

```mermaid
graph LR
    subgraph Owner 会话
        O_READ[read_*: ✅ 全部]
        O_WRITE[update_*: ✅ 全部]
        O_MEM[append_memory: ✅ 全部 scope]
        O_PROMOTE[promote_memory: ✅]
    end

    subgraph 外部私聊
        DM_READ[read_peer*: ✅]
        DM_READ2[read_group*: ❌]
        DM_WRITE[update_*: ❌]
        DM_MEM[append_memory<br/>scope=peer: ✅]
        DM_MEM2[append_memory<br/>scope=group/identity: ❌]
        DM_PROMOTE[promote_memory: ❌]
    end

    subgraph 群聊
        GRP_READ[read_group*: ✅]
        GRP_READ2[read_peer*: ❌]
        GRP_WRITE[update_group_role: ❌]
        GRP_MEM[append_memory<br/>scope=group: ✅]
        GRP_MEM2[append_memory<br/>scope=peer/identity: ❌]
        GRP_PROMOTE[promote_memory: ❌]
    end
```

## 6. 插件需要做的三件事

### 6.1 注入维护 SOP 到 prompt

**落点：`src/channel.ts` → `messageToolHints`**

当前 `messageToolHints` 只注入了工具使用说明。需要追加维护 SOP 段落：

```typescript
// src/channel.ts acpAgentPromptAdapter.messageToolHints() 中追加：
"### ACP Context Maintenance",
"After replying to the user, decide if this conversation contains information worth remembering:",
"",
"**When to write memory (call acp_context):**",
"- User states a preference, decision, or commitment",
"- You learn a new fact about the user (role, expertise, relationship)",
"- A group discussion reaches a conclusion or action item",
"- Relationship dynamics change (trust level, collaboration pattern)",
"",
"**When NOT to write memory:**",
"- Casual greetings, small talk, routine acknowledgments",
"- Information already recorded in existing context",
"- Low-confidence or speculative information",
"",
"**Rules:**",
"- Do NOT mention memory operations in your reply text",
"- Do NOT output tool call JSON in your reply",
"- Max 3 acp_context calls per turn",
"- Always include your aid and the correct scope (peer/group/identity)",
```

**落点：`src/channel.ts` → `resolveGroupIntroHint`**

群聊场景追加群维护优先级提示：

```typescript
// 在现有 groupIntroHint 末尾追加：
"When maintaining group context, priority: MY_ROLE > GROUP notes > group MEMORY.",
"Even if you choose not to reply, still evaluate if the messages contain memorable information.",
```

### 6.2 实现 `acp_context` 工具

**落点：新增 `src/context-tool.ts`**（详见 04 号文档）

工具的 `execute()` 方法负责：
1. 参数校验（aid 必填、scope 与 id 匹配）
2. 权限检查（根据当前会话类型判断是否允许该操作）
3. 路径解析（逻辑参数 → 文件路径，禁止目录穿越）
4. 执行读写（append_memory → 追加到对应 MEMORY.md）
5. 返回结果（成功/失败，不含内部路径）

权限检查的输入来自 `ctx` 中的 `ChatType`（direct/group）和 `CommandAuthorized`（是否 owner）：

```
Owner 会话     → 全部 action 可用
外部私聊       → read_peer*, append_memory(scope=peer)
群聊           → read_group*, append_memory(scope=group)
```

### 6.3 注册工具到 OpenClaw

**落点：`index.ts`**

```typescript
import { createContextTool } from "./context-tool.js";
// 在工具注册处追加：
tools.push(createContextTool());
```

OpenClaw 会自动将注册的工具暴露给 LLM，LLM 在推理时可以自主决定是否调用。

## 7. 不需要做的事

以下是原文档提到但**实际不需要实现**的：

| 原文档描述 | 为什么不需要 |
|---|---|
| `classifyMaintenanceNeed()` 判定器 | LLM 自己判断，不需要代码侧分类器 |
| `extractCandidateFacts()` 事实抽取 | LLM 自己抽取，不需要代码侧 NLP |
| `buildMaintenanceOps()` 操作构建 | LLM 自己构建 tool-call 参数 |
| confidence 阈值 0.65 | 这是 prompt 指导语言，不是代码逻辑 |
| "双轨并行"编排 | OpenClaw tool-use 循环天然支持 |
| 维护动作执行顺序控制 | prompt 中建议即可，LLM 自行遵循 |

## 8. 防护措施（插件代码侧）

虽然决策交给 LLM，但工具侧需要硬性防护：

### 8.1 限流

```typescript
// context-tool.ts 中实现
const RATE_LIMIT = {
  maxOpsPerTurn: 3,          // 单次推理最多 3 次写入
  maxOpsPerMinute: 10,       // 每分钟最多 10 次写入（防刷写风暴）
  maxContentBytes: 2048,     // 单次写入内容上限
};
```

### 8.2 路径安全

```typescript
// 所有文件路径由内部 resolver 生成，拒绝外部传入路径
function resolveContextPath(scope: string, identityId: string, targetId: string): string {
  // 只允许 workspace/acp/ 下的路径
  // 拒绝 ".."、绝对路径、symlink
}
```

### 8.3 写入失败不阻断回复

`acp_context` 工具的 `execute()` 在任何异常情况下都返回错误结果而非抛出异常。LLM 收到错误后会继续生成回复文本，用户体验不受影响。

## 9. 用户可见回复约束

这些约束通过 prompt 注入实现（6.1 节），不需要代码侧过滤：

1. 回复内容不出现"我正在更新文件/我写入了记忆"等内部描述
2. 禁止输出工具 payload JSON（OpenClaw 的 tool-use 机制天然隔离，tool-call 不会出现在回复文本中）
3. 若用户主动问"你记住了吗"，可自然语言回答，不暴露内部路径

## 10. 实现清单（按优先级）

### P0：prompt 注入（无新文件，改现有代码）

- [ ] `src/channel.ts` → `messageToolHints` 追加维护 SOP 段落
- [ ] `src/channel.ts` → `resolveGroupIntroHint` 追加群维护优先级

### P1：acp_context 工具（新增文件）

- [ ] `src/context-tool.ts` — 工具主体（action router + validator + permission guard）
- [ ] `src/context-schemas.ts` — 参数 schema 与 section 白名单
- [ ] `index.ts` — 注册工具

### P2：防护与可观测

- [ ] 限流计数器（per-identity per-minute）
- [ ] 写入审计日志（who/action/path/bytes/ts）
- [ ] 拒绝写入也记录（denied_reason）

## 11. 完成标准

1. LLM 在私聊中能自主调用 `acp_context(action="append_memory", scope="peer")` 记录关键信息
2. LLM 在群聊中能自主调用 `acp_context(action="append_memory", scope="group")` 记录群讨论结论
3. 维护操作不出现在用户可见回复中
4. 外部会话无法越权修改 `MY_ROLE.md` / `identity MEMORY` 等高敏文件
5. 单次推理写入不超过 3 次，每分钟不超过 10 次
6. 工具执行失败不影响用户回复的正常发送

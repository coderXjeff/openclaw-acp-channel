# 11 — ACP「每 Agent 一 AID」强绑定方案

## 1. 背景

当前 ACP 多身份方案已经支持：

- `channels.acp.identities.{accountId}` 多身份配置
- 通过 `bindings(channel=acp, accountId=...)` 路由到目标 Agent
- 联系人/会话/连接状态按 identity（accountId）隔离

但在工程语义上仍是「**accountId 优先**」：

- 一个 `agentId` 可以绑定多个 `accountId`
- workspace 与 skills 主要是 `agentId` 维度
- identity 与 agent 不是强 1:1 约束

这会导致运维和认知复杂度上升：

- 用户常常期望“一个龙虾（Agent）= 一个网络身份（AID）”
- 当 `agentId != accountId` 或一对多绑定时，排障心智负担大

---

## 2. 当前方案 vs 新方案对比

| 维度 | 当前方案（Account-First） | 新方案（Agent-First 1:1） |
|---|---|---|
| 核心对象 | `accountId` 是主键 | `agentId` 是主键 |
| 映射关系 | agentId ↔ accountId 可一对多 | **agentId ↔ accountId 强 1:1** |
| AID 归属 | 归属 accountId | 归属 agentId（通过同名 accountId） |
| workspace 归属 | agent 维度（可能多个 identity 共享） | **每个 agent 独立 workspace** |
| skills 归属 | agent 维度 + 插件共享 skill | **每个 agent 独立 skills（插件 skill 仅公共参考）** |
| 运维复杂度 | 中-高 | 低（路径和归属清晰） |
| 灵活性 | 高 | 中（受 1:1 约束） |
| 推荐场景 | 少量高级用户、复杂路由 | **大多数用户、人格隔离场景** |

结论：新方案以可理解性和隔离确定性换取部分灵活性，更适合“每个龙虾独立身份”的目标。

---

## 3. 新方案目标

目标定义：

> **每个 OpenClaw Agent 必须且只能绑定一个 ACP 身份（AID）。**

即：

`agentId == accountId == identityId`（推荐硬约束）

带来的直接结果：

1. 每个 Agent 拥有独立 AID
2. 每个 Agent 拥有独立 workspace 与人格文件
3. 每个 Agent 拥有独立联系人、会话、agent.md
4. skills 管理回归到 OpenClaw 原生“per-agent + shared”模型

---

## 4. 核心设计

## 4.1 统一命名约定（强建议）

- `agents.list[].id = work`
- `channels.acp.identities.work = {...}`
- `bindings[].match.accountId = work`
- `bindings[].agentId = work`

即 key 全链路同名：`work`。

## 4.2 绑定约束（强校验）

在网关启动前进行静态校验（Fail Fast）：

1. `channel=acp` 的每个 binding 必须有 `accountId`
2. 同一 `agentId` 只能出现一个 `accountId`
3. 同一 `accountId` 只能绑定一个 `agentId`
4. `accountId` 必须存在于 `channels.acp.identities`
5. 建议 `agentId === accountId`，不等时给出警告（严格模式下直接报错）

## 4.3 身份生命周期

- 启动：按 `agentId/accountId` 对启用 ACP 连接
- 路由：入站消息使用 `channel=acp + accountId` 定位唯一 agent
- 停止：仅停止该 agent 对应的 AID 连接

## 4.4 数据与状态隔离

### 会话

会话 key 统一走 agent 维度：

- Direct: `agent:{agentId}:acp:session:{peer}:{sid8}`
- Group: `agent:{agentId}:acp:group:{groupId}`

### 联系人

沿用 identity 文件隔离（identity 与 agent 1:1 后天然等价）：

- `~/.acp-storage/contacts-{accountId}.json`

### agent.md

每个 agent 对应一个 AID 路径：

- `~/.acp-storage/AIDs/{agentName}.{domain}/public/agent.md`

并按已有机制自动同步（连接建立后上传，哈希不变跳过）。

## 4.5 Skills 管理模型

不引入“每 accountId 一套插件 skill”的新机制，而是明确采用 OpenClaw 原生模型：

1. **插件共享 skill**：ACP 插件自带 `skill/acp`，作为公共协议能力说明
2. **Agent 私有 skill**：每个 agent 在自己的 workspace `skills/` 下维护私有技能
3. **可选 skill 过滤**：通过 agent 配置限制可用 skills

因此“是否独立”结论是：

- 协议基础能力（ACP skill）共享
- 业务技能与人格技能由 agent workspace 独立承载

---

## 5. 配置范式（示例）

```json5
{
  agents: {
    list: [
      { id: "work", workspace: "~/.openclaw/workspace-work" },
      { id: "personal", workspace: "~/.openclaw/workspace-personal" }
    ]
  },
  channels: {
    acp: {
      enabled: true,
      identities: {
        work: {
          agentName: "work-bot",
          domain: "agentcp.io",
          ownerAid: "boss.agentcp.io",
          allowFrom: ["*"]
        },
        personal: {
          agentName: "home-bot",
          domain: "agentcp.io",
          ownerAid: "me.agentcp.io",
          allowFrom: ["friend.agentcp.io"]
        }
      }
    }
  },
  bindings: [
    { agentId: "work", match: { channel: "acp", accountId: "work" } },
    { agentId: "personal", match: { channel: "acp", accountId: "personal" } }
  ]
}
```

---

## 6. 迁移策略（从当前方案迁移）

## 6.1 识别现状

扫描所有 `channel=acp` bindings，形成映射表：

- `agentId -> accountId[]`
- `accountId -> agentId[]`

## 6.2 分三类处理

1. **已 1:1**：无需结构调整，直接进入校验
2. **agent 绑定多个 account**：拆分 agent（新建 agentId + workspace）
3. **多个 agent 绑定同一 account**：拆分 account（新建 identity + AID）

## 6.3 迁移步骤

1. 备份 `openclaw.json`
2. 调整 `agents.list`（补齐独立 workspace）
3. 调整 `channels.acp.identities`
4. 调整 `bindings` 为 1:1
5. 重启 gateway
6. 用 `/acp-status` 验证每个 agent 只对应一个 account/AID

---

## 7. 风险与权衡

## 7.1 风险

1. 灵活路由能力下降（不再支持一 agent 多 AID）
2. 迁移期间可能出现历史会话分裂
3. 用户需要维护更多 workspace 目录

## 7.2 缓解

1. 保留兼容模式开关（默认推荐 1:1，允许高级用户退回灵活模式）
2. 提供迁移检查脚本（启动前静态诊断）
3. 提供标准模板与向导化配置

---

## 8. 验收标准

满足以下全部条件视为落地成功：

1. 每个 `agentId` 仅绑定一个 `accountId`
2. 每个 `accountId` 仅绑定一个 `agentId`
3. 每个 agent 对应唯一 AID，且可独立收发消息
4. 每个 agent 的 workspace/persona/skills 相互隔离
5. 每个身份联系人与会话数据互不污染
6. agent.md 可按身份独立自动同步

---

## 9. 实施建议

建议采用“两阶段实施”：

- 阶段 1（配置治理）：先通过文档+校验脚本推动 1:1 约定，不改核心行为
- 阶段 2（产品化约束）：再在插件启动时引入 strict 模式的强校验与明确报错

这样可以先统一团队心智，再逐步收紧技术约束，降低一次性变更风险。

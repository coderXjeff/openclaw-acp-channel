# ACP Channel 多身份改造实施说明

## 1. 背景与目标

本次改造以 `/Users/liwenjiang/Desktop/acp-multi-agent-design` 方案为基准，目标是在不修改 OpenClaw core 的前提下，为 `acp-channel` 增加完整的多身份（multi-account）支持，并保留单身份配置的向后兼容能力。

目标拆解：

1. 配置层支持 `channels.acp.identities`（key 为 accountId）。
2. Gateway 生命周期按 accountId 启停、重连、状态上报。
3. 入站/出站路由、会话、联系人、工作区按身份隔离。
4. 保持旧配置 `agentName + domain` 可无缝运行。
5. 修复多身份场景下的健壮性问题（身份错配、静默回退、状态污染）。

---

## 2. 关键改动总览

| 模块 | 文件 | 主要改动 |
|---|---|---|
| 类型模型 | `src/types.ts` | 新增 `AcpIdentityEntry`，`AcpChannelConfig` 增加 `identities`，运行时状态统一为 `AcpRuntimeState` |
| 配置 schema | `src/config-schema.ts` | 增加 `identities` schema、key pattern 校验、`enabled=true` 时必须配置 `agentName` 或 `identities` |
| 账号解析 | `src/channel.ts` | `listAccountIds/resolveAccount/defaultAccountId/resolveAllowFrom` 支持多身份 |
| 生命周期 | `src/gateway.ts`、`src/monitor.ts` | 按 accountId 启停；重连、状态、session key 全部身份感知 |
| 路由器 | `src/identity-router.ts` | 支持多 identity 状态管理、AID 反查、全量状态枚举 |
| 出站发送 | `src/outbound.ts`、`src/actions.ts`、`src/channel.ts` | 发送链路透传 `accountId` 并定位正确 AID |
| 存储隔离 | `src/contacts.ts`、`src/workspace.ts` | 联系人文件和 workspaceDir 按 identity 隔离 |
| 工具/命令 | `src/tools.ts`、`src/commands.ts` | 工具身份解析强化；status/sync 支持指定身份 |
| 状态展示 | `src/status.ts` | snapshot 获取按 accountId |
| 评分上下文 | `src/session-rating.ts` | 评分 session key 与 AccountId 支持多身份 |
| Hook 适配 | `index.ts` | `before_agent_start` 通过 bindings 将 `agentId -> accountId` 映射后更新 workspace |
| 测试 | `test/*.test.ts` | 增加多身份行为回归测试 |

---

## 3. 详细改动说明

## 3.1 配置与类型模型

### 3.1.1 `src/types.ts`

- 新增 `AcpIdentityEntry`：用于 `identities[accountId]` 的条目配置。
- `AcpChannelConfig`：
  - 旧字段 `agentName/domain/...` 改为可选（单身份兼容）。
  - 新增 `identities?: Record<string, AcpIdentityEntry>`。
- `ResolvedAcpAccount` 不再限定 default，明确为“每个 accountId 一份”。
- 引入 `AcpRuntimeState` 作为运行时统一状态类型，保留 `IdentityAcpState` 为兼容别名。

### 3.1.2 `src/config-schema.ts`

- 新增 `acpIdentityEntrySchema`，约束单身份条目字段。
- 新增 `identities`：
  - key pattern：`^[a-zA-Z0-9_-]+$`
  - `minProperties: 1`
  - `additionalProperties: false`
- 增加 `allOf + if/then + oneOf` 规则：
  - 当 `enabled=true` 时，必须配置 `agentName` 或 `identities` 之一。

> 说明：此处实现“至少一者存在”校验；互斥（不能同时配置）可后续加 `not + required` 进一步强化。

---

## 3.2 account 解析与路由

### 3.2.1 `src/channel.ts`

- `listAccountIds`：
  - 多身份：返回 `Object.keys(identities)`。
  - 单身份：返回 `[default]`。
- `resolveAccount`：
  - 多身份按 `accountId` 解析。
  - 当多身份模式下传入未知 `accountId`，**显式抛错**，防止静默回退。
  - 单身份兼容 fallback 为 `default`。
- `defaultAccountId`：优先 `default` key，否则取 identities 首项。
- `resolveAllowFrom`：优先读取 `identities[accountId].allowFrom`。

### 3.2.2 `src/identity-router.ts`

- 支持多 identity 生命周期与状态管理：
  - `registerIdentity`：允许重复注册覆盖并修正 AID 索引。
  - `getAllStates`：返回全部身份状态。
  - `stopIdentity`：删除 AID 索引 + 删除 state，避免僵尸状态。

---

## 3.3 生命周期与会话隔离

### 3.3.1 `src/gateway.ts`

- `startAccount` 增加 accountId/AID 启动日志，便于排障。

### 3.3.2 `src/monitor.ts`

- Direct session key 改为：
  - `agent:main:acp:session:...`（default）
  - `agent:{identityId}:acp:session:...`（非 default）
- Group session key 改为同样规则。
- `sync/check/upload/getConnectionSnapshot/getCurrentAccount/getAllSessionStates/recordOutbound` 均支持 identity 参数。
- 修复全局状态污染：
  - 将 `lastDisconnect/lastStartAt/lastStopAt` 改为 **按 identity Map 存储**。

---

## 3.4 出站链路身份化

### 3.4.1 `src/outbound.ts`

- `sendAcpMessage` 参数从 `identityId` 统一为 `accountId`。
- 按 `accountId -> router.getState(accountId)` 选择发送身份。
- 无 router 的 fallback 路径也按 identity 获取当前 account。

### 3.4.2 `src/actions.ts` / `src/channel.ts`

- `send` action 和 channel outbound `sendText` 均透传 `accountId`。
- `isAcpEnabled` 由“仅 agentName”改为“agentName 或 identities”。

---

## 3.5 数据隔离

### 3.5.1 `src/contacts.ts`

- 按 identity 隔离联系人存储：
  - default: `~/.acp-storage/contacts.json`
  - 非 default: `~/.acp-storage/contacts-{identityId}.json`
- `getContactManager(identityId)` 使用实例缓存，避免重复加载。

### 3.5.2 `src/workspace.ts` + `index.ts`

- `workspaceDir` 由单值改为 `Map<identityId, dir>`。
- `before_agent_start` 中不再直接把 `agentId` 当 identity；而是：
  - 从 `api.config.bindings` 解析 `agentId -> acp accountId[]`
  - 对每个 accountId 调 `updateWorkspaceDir` + `checkAndUploadAgentMd`
- 解决 `agentId != accountId` 时 workspace 与 identity 错配问题。

---

## 3.6 工具、命令与状态

### 3.6.1 `src/tools.ts`

- `resolveIdentityIdByAid`：改为严格解析，失败返回 `null`。
- `acp_manage_contacts`：
  - 强制要求 `self_aid`。
  - identity 解析失败时返回错误，不再回退 default（防止跨身份写入）。

### 3.6.2 `src/commands.ts`

- `/acp-sync`：支持可选参数（identityId），定向同步。
- `/acp-status`：
  - 无参数显示所有已注册 identity。
  - 带参数显示指定 identity。

### 3.6.3 `src/status.ts`

- `buildAccountSnapshot` 改为 `getConnectionSnapshot(account.accountId)`，避免取 default 快照。

### 3.6.4 `src/session-rating.ts`

- AI 评分上下文中的 `AccountId` 与 `sessionKey` 采用身份感知值。

---

## 4. 健壮性修复（针对本轮 review）

本轮重点修复了 4 类隐患：

1. **agentId/accountId 混用**：通过 bindings 映射修复 workspace 归属。
2. **未知 accountId 静默回退**：改为显式报错。
3. **tools 错身份静默回退 default**：改为硬校验 `self_aid` + 解析失败报错。
4. **状态字段跨身份污染**：改为 per-identity map。

---

## 5. 测试与验证

新增/增强测试：

- `test/channel-config-adapter.test.ts`
  - 多身份 listAccountIds
  - resolveAccount 正常路径
  - unknown accountId 抛错
  - defaultAccountId 优先 default
- `test/contacts-identity.test.ts`
  - 联系人文件按 identity 隔离
- `test/tools-identity-resolution.test.ts`
  - `acp_manage_contacts` 要求 `self_aid`
  - unknown `self_aid` 报错
- `test/monitor-snapshot.test.ts`
  - 连接快照 stop 时间戳按 identity 隔离
- `test/config-schema.test.ts`、`test/workspace.test.ts`
  - 增补多身份 schema / workspace 行为断言

执行结果：

- `npm test`：通过（12 files, 114 tests）
- `npx tsc --noEmit`：通过

---

## 6. 向后兼容性

- 旧配置（仅 `agentName`）仍返回 `default`，行为保持兼容。
- default 身份仍使用旧联系人文件 `contacts.json`。
- session key 对 default 仍沿用 `agent:main:acp:*`。

---

## 7. 已知限制与后续建议

1. schema 目前仅保证 `enabled=true` 时至少配置 `agentName` 或 `identities`，建议后续补“互斥”强校验。
2. `/acp-status <identityId>` 当前按“已注册身份”显示；若要支持“未启动但已配置”可增加 config 层查询。
3. 若一个 `agentId` 绑定多个 ACP account，`before_agent_start` 会对这些 account 共享同一 workspaceDir；这是当前设计下的合理默认，若需细粒度可在 identities 里显式 `workspaceDir` 覆盖。


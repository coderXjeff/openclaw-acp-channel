# 身份层 × ACP 渠道集成 — 修改指南

## 概述

本次改造将 ACP 渠道插件从「单 AID 模型」升级为「一个 Identity = 一个 AID」的多身份模型。每个身份拥有独立的 ACP 连接、联系人、会话上下文和 agent.md。

核心原则：**旧配置零改动，行为完全兼容**。

---

## 新增文件

### 1. `src/acp-multi-client.ts`

绕过 `AgentManager` 单例限制，直接管理多个 AID 实例。

- `AcpMultiClient` 类，内部维护 `Map<fullAid, AidInstance>`
- 每个 AID 独立执行完整连接流程：initACP → loadAid/createAid → online → initFileSync → initAWS → startWebSocket → heartbeat
- 所有 AID 共享同一个 `AgentManager.getInstance()`（acp-ts 内部的 `aidInstances Map` 天然支持多 AID）
- 关键 API：`connectAid()`, `disconnectAid()`, `sendMessage()`, `sendReply()`, `uploadAgentMd()`, `isConnected()`
- 消息回调签名增加 `receiverAid` 参数，让路由层知道消息发给了哪个 AID

### 2. `src/identity-router.ts`

核心路由层，负责 AID ↔ 身份的固定映射。

- `AcpIdentityRouter` 类，维护双向映射：`aidToIdentityId` + `states`
- `registerIdentity(id, account)` — 注册身份并建立映射
- `startIdentity()` / `stopIdentity()` — 启停单个身份的 ACP 连接
- `routeInbound()` — 通过 `receiverAid` 查映射，将消息路由到对应身份的 `IdentityAcpState`
- `setInboundHandler()` — 由 monitor.ts 注入实际的消息处理函数
- 模块级单例：`getOrCreateRouter()` / `getRouter()` / `resetRouter()`

---

## 修改文件

### 3. `src/types.ts`

新增类型：

| 类型 | 用途 |
|------|------|
| `AcpIdentityMeta` | 存在 `IdentityProfile.metadata` 中的 ACP 配置 |
| `AcpIdentityEntry` | 多身份配置中单个身份的条目 |
| `IdentityAcpState` | 单个身份的完整运行时状态（会话、连接、定时器等） |

修改类型：

| 类型 | 变更 |
|------|------|
| `AcpChannelConfig` | 新增 `identities?: Record<string, AcpIdentityEntry>` |
| `ResolvedAcpAccount` | 新增 `identityId`, `workspaceDir?`, `agentMdPath?` |

### 4. `src/monitor.ts`（重构最大）

**改造前**：所有函数读写模块级全局变量（`acpClient`, `sessionStates`, `currentAccount` 等）。

**改造后**：

- 所有会话管理函数改为接受 `IdentityAcpState` 参数：
  - `handleInboundMessageForIdentity(state, sender, sessionId, ...)`
  - `getOrCreateSessionStateForIdentity(state, sessionId, ...)`
  - `closeSessionForIdentity(state, sessionState, reason, ...)`
  - `startIdleCheckerForIdentity(state)` / `stopIdleCheckerForIdentity(state)`
  - `checkAndUploadAgentMdForIdentity(state)`
  - `syncAgentMdForIdentity(identityId?)`

- Gateway 集成改为按身份启停：
  - `startIdentityWithGateway(ctx, acpConfig)` — 注册身份 → 连接 → 重连循环
  - `stopIdentityFromGateway(ctx)` — 停止单个身份

- Session key 格式变化（多身份时）：
  - 旧：`agent:main:acp:session:{sender}:{sid}`
  - 新：`agent:main:acp:id:{identityId}:session:{sender}:{sid}`
  - `identityId === "default"` 时保持旧格式

- 保留所有旧导出函数（标记 `@deprecated`），内部委托给 router 的默认身份：
  - `startAcpMonitor()` → 创建 router + 注册 "default" 身份
  - `startAcpMonitorWithGateway()` → 直接调用 `startIdentityWithGateway()`
  - `getAcpClient()` → 返回 `null`（新路径不再创建 AcpClient 实例）
  - `getCurrentAccount()` → 从 router 获取默认身份的 account
  - `getConnectionSnapshot(identityId?)` → 支持按身份查询

### 5. `src/contacts.ts`

- 单例 `let instance` 改为 `Map<string, ContactManager>`
- `getContactManager(identityId?)` — 按 identityId 返回隔离的实例
- 存储路径隔离：
  - `"default"` → `~/.acp-storage/contacts.json`（兼容旧路径）
  - 其他 → `~/.acp-storage/identities/{identityId}/contacts.json`

### 6. `src/channel.ts`

- `listAccountIds()` — 优先返回 `identities` 的 keys，回退到 `["default"]`
- `resolveAccount()` — 多身份模式从 `identities[accountId]` 解析，支持字段继承（domain、ownerAid 等从顶层回退）
- 导入新增 `AcpIdentityEntry` 类型

### 7. `src/outbound.ts`

- `sendAcpMessage()` 新增 `identityId?` 参数
- 优先走 router 路径：通过 identityId 查找对应身份的 AID，用 `multiClient.sendMessage()` 发送
- 保留 fallback 到旧 `getAcpClient()` 路径

### 8. `src/gateway.ts`

- `startAccount()` → 调用 `startIdentityWithGateway(ctx, acpConfig)`
- `stopAccount()` → 调用 `stopIdentityFromGateway(ctx)`
- 移除了旧的 `startAcpMonitorWithGateway` / `stopAcpMonitorFromGateway` 直接引用

### 9. `src/actions.ts`

- `syncAgentMd()` → `syncAgentMdForIdentity(accountId)`
- `getContactManager()` → `getContactManager(accountId)`
- `sendAcpMessage()` 调用增加 `identityId: accountId`

### 10. `src/session-rating.ts`

- `rateSession(state, cfg)` → `rateSession(state, cfg, identityId?)`
- session key 格式与 monitor.ts 保持一致
- `getContactManager()` → `getContactManager(identityId)`

### 11. `src/status.ts`

- `getConnectionSnapshot()` → `getConnectionSnapshot(account.accountId)`

---

## 数据流

```
ACP 网络消息到达 alice.agentcp.io
    ↓
AcpMultiClient 的 alice AgentWS.onMessage 触发
    ↓
onMessage 回调带上 receiverAid = "alice.agentcp.io"
    ↓
AcpIdentityRouter.routeInbound("alice.agentcp.io", sender, ...)
    ↓
aidToIdentityId.get("alice.agentcp.io") → "uuid-1"
    ↓
states.get("uuid-1") → IdentityAcpState
    ↓
handleInboundMessageForIdentity(state, sender, sessionId, content)
    ↓
getContactManager("uuid-1")  → uuid-1 专属联系人
state.sessionStates           → uuid-1 专属会话
sessionKey = "agent:main:acp:id:uuid-1:session:..."
    ↓
AI 回复 → multiClient.sendReply("alice.agentcp.io", sessionId, reply)
```

---

## 配置格式

### 单身份（零改动兼容）

```json
{
  "channels": {
    "acp": {
      "enabled": true,
      "agentName": "my-agent",
      "domain": "agentcp.io",
      "seedPassword": "xxx"
    }
  }
}
```

→ `listAccountIds()` 返回 `["default"]`，行为与改造前完全一致。

### 多身份

```json
{
  "channels": {
    "acp": {
      "enabled": true,
      "domain": "agentcp.io",
      "session": { "maxTurns": 1000 },
      "identities": {
        "uuid-1": {
          "agentName": "alice",
          "seedPassword": "seed-a",
          "ownerAid": "owner.agentcp.io",
          "allowFrom": ["*"]
        },
        "uuid-2": {
          "agentName": "bob",
          "domain": "custom.domain",
          "seedPassword": "seed-b",
          "allowFrom": ["trusted.agentcp.io"]
        }
      }
    }
  }
}
```

→ `listAccountIds()` 返回 `["uuid-1", "uuid-2"]`，框架为每个 ID 调用一次 `startAccount()`。

字段继承规则：`identities[id].domain` 未设置时回退到顶层 `domain`，`ownerAid`、`allowFrom`、`seedPassword` 同理。

---

## 向后兼容保证

| 场景 | 行为 |
|------|------|
| 旧配置无 `identities` 字段 | `listAccountIds()` 返回 `["default"]`，单身份模式 |
| 联系人存储路径 | `"default"` 身份使用旧路径 `~/.acp-storage/contacts.json` |
| Session key 格式 | `identityId === "default"` 时保持旧格式 |
| 旧导出函数 | 全部保留，标记 `@deprecated`，内部委托给 router 默认身份 |
| `getAcpClient()` | 返回 `null`（新路径不创建 AcpClient 实例，但不影响功能） |

---

## 验证清单

1. **单身份兼容**：旧配置不改任何东西，行为与改造前一致
2. **多身份隔离**：配置两个身份 alice 和 bob，分别发消息验证：
   - alice 收到的消息只出现在 alice 的会话上下文中
   - bob 的联系人列表不包含 alice 的联系人
   - 两个身份的 agent.md 独立上传
3. **路由固定性**：反复给 alice.agentcp.io 发消息，始终路由到同一个身份
4. **出站隔离**：用 alice 身份发消息，From 头是 alice.agentcp.io
5. **重连**：断开某个身份的连接，验证自动重连只影响该身份
6. **TypeScript 编译**：`npx tsc --noEmit` 通过

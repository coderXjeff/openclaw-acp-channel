# ACP Channel 插件功能差距分析

> 基于源码逐文件审查，对比 ACP Channel 插件与 OpenClaw 内置插件（Discord、Telegram）的真实差距。
> 审查日期：2026-02-08

---

## 1. 当前插件能力概览

### 1.1 已实现功能

| 功能 | 状态 | 实现位置 | 说明 |
|------|------|---------|------|
| 基础文本收发 | ✅ | `outbound.ts`, `acp-client.ts:206-273` | `sendText` + `aws.send()` |
| ACP 网络连接 | ✅ | `acp-client.ts:41-135` | `AgentManager` + `AgentWS` + `HeartbeatClient` |
| 心跳保活 | ✅ | `acp-client.ts:101-123` | `HeartbeatClient.online()` + `onStatusChange()` |
| 邀请接受 | ✅ | `acp-client.ts:115-118` | `onInvite()` → `acceptInviteFromHeartbeat()` |
| 会话管理 | ✅ | `monitor.ts:36-423` | 内存 Map + 四层终止控制 |
| 来源白名单 | ✅ | `monitor.ts:551-559` | `allowFrom` 配置，支持 `*` 通配 |
| 消息调度 | ✅ | `monitor.ts:741-749` | `reply.dispatchReplyFromConfig()` |
| 多轮对话 | ✅ | `monitor.ts:646` | 基于 `sessionKey` 的上下文保持 |
| Gateway 生命周期 | ✅ | `gateway.ts` + `monitor.ts:946-1139` | 启动/停止/重连/abort 信号/指数退避 |
| Status 状态报告 | ✅ | `status.ts` | probe/snapshot/state/issues 全实现 |
| Agent.md 管理 | ✅ | `monitor.ts:155-222`, `agent-md-builder.ts` | workspace 自动生成 + 静态文件上传，MD5 变更检测 |
| 远程 Agent.md 获取 | ✅ | `agent-md-fetcher.ts`, `agent-md-parser.ts` | HTTP GET + 内存/文件双层缓存，YAML frontmatter 解析 |
| 联系人管理 | ✅ | `contacts.ts` | CRUD/分组/交互记录/JSON 持久化，入站自动添加 |
| 信用评级体系 | ✅ | `credit.ts`, `session-rating.ts` | 规则评分 + AI 评价加权合并，手动覆盖，低信用拒绝 |
| Actions | ✅ | `actions.ts` | send, sync-agent-md, manage-contacts（含 13 个子操作） |
| AI 工具 | ✅ | `tools.ts` | `acp_fetch_agent_md`, `acp_manage_contacts` |
| 用户命令 | ✅ | `commands.ts` | `/acp-sync`, `/acp-status` |
| 系统提示词注入 | ✅ | `monitor.ts:47-93` | ACP 网络认知 + 主权规则 + 保密条款 |
| FileSync | ✅ | `acp-client.ts:70-76` | `initFileSync()` 用于 agent.md 上传 |

### 1.2 Capabilities 声明

```typescript
// channel.ts:22-31
const acpCapabilities = {
  chatTypes: ["direct"],   // 仅 1:1
  media: false,
  threads: false,
  blockStreaming: true,     // 声明 true，但实际 disableBlockStreaming: true（伪实现）
  reactions: false,
  edit: false,
  unsend: false,
  reply: false,
};
```

---

## 2. ChannelPlugin 接口覆盖率

基于 `plugin-types.ts` 定义的 `ChannelPlugin` 类型，实际接口字段共 12 个：

```typescript
// plugin-types.ts:194-210
ChannelPlugin = {
  id, meta, capabilities, config, configSchema,
  outbound, messaging, actions, status, gateway, defaults
}
```

| 字段 | 状态 | 完成度 | 说明 |
|------|------|--------|------|
| `id` | ✅ | 完整 | `"acp"` |
| `meta` | ✅ | 完整 | id/label/selectionLabel/docsPath/blurb/detailLabel/systemImage/order |
| `capabilities` | ✅ | 最小声明 | 仅 `direct`，其余全 false |
| `config` | ✅ | 完整 | 7 个方法全部实现（listAccountIds/resolveAccount/defaultAccountId/isEnabled/isConfigured/describeAccount/resolveAllowFrom） |
| `configSchema` | ✅ | 完整 | JSON Schema + 6 个 uiHints |
| `outbound` | ⚠️ | 部分 | sendText ✅, sendMedia ❌（返回错误）, resolveTarget ✅ |
| `messaging` | ⚠️ | 部分 | targetResolver.looksLikeId ✅, targetResolver.hint ✅, 无 normalizeTarget |
| `actions` | ✅ | 完整 | 3 个 action + 13 个 manage-contacts 子操作 |
| `status` | ✅ | 完整 | 5 个方法全部实现 |
| `gateway` | ✅ | 完整 | startAccount + stopAccount，含指数退避重连 |
| `defaults` | ✅ | 完整 | `queue.debounceMs: 500` |

**接口覆盖率：11/12 字段已实现，其中 2 个为部分实现。**

> 注：Discord/Telegram 的 onboarding、pairing、groups、threading、security、directory、resolver、
> reload、streaming、setup 等 adapter 并非 `ChannelPlugin` 类型定义的字段，
> 而是各插件内部的额外模块或框架其他机制提供的能力。不应混入接口覆盖率统计。

---

## 3. 与 Discord/Telegram 的 Capabilities 差距

这是与内置插件的核心功能差距所在，不在于 adapter 数量，而在于 capabilities 声明的能力范围：

### 3.1 ChatTypes 对比

| 类型 | ACP | Discord | Telegram | 差距原因 |
|------|-----|---------|----------|---------|
| direct（1:1） | ✅ | ✅ | ✅ | — |
| group（群组） | ❌ | ❌ | ✅ | ACP 协议支持多成员会话，插件未实现 |
| thread（话题） | ❌ | ✅ | ✅ | ACP 协议无原生线程概念 |

### 3.2 消息能力对比

| 能力 | ACP | Discord | Telegram | 差距原因 |
|------|-----|---------|----------|---------|
| media（媒体） | ❌ | ✅ | ✅ | ACP 有 file/binary，插件 `sendMedia` 返回错误 |
| blockStreaming（流式） | 伪 | ✅ | ✅ | 声明 true 但 `disableBlockStreaming: true` |
| reactions（表情反应） | ❌ | ✅ | ❌ | ACP 协议无此概念 |
| edit（编辑消息） | ❌ | ✅ | ✅ | ACP 协议无此概念 |
| unsend（撤回消息） | ❌ | ✅ | ✅ | ACP 协议无此概念 |
| reply（引用回复） | ❌ | ✅ | ✅ | ACP 有 `reply_message()`，插件未对接 |

### 3.3 Outbound 能力对比

| 功能 | ACP | Discord | Telegram |
|------|-----|---------|----------|
| sendText | ✅ | ✅ | ✅ |
| sendMedia | ❌（返回错误） | ✅ | ✅ |
| sendPoll | ❌ | ✅ | ❌ |
| chunker（长消息分片） | ❌（声明 4000 但无分片逻辑） | ✅ | ✅ |
| replyToId（引用回复） | ❌ | ✅ | ✅ |
| 多账号支持 | ❌（硬编码 `"default"`） | ✅ | ✅ |

---

## 4. ACP 协议已支持但插件未释放的能力

以下功能在 `acp-ts` 库中已提供 API，但插件未使用：

### 4.1 流式消息（Streaming Messages）

- **协议能力：** `send_stream_message()` 支持 `text/event-stream` 类型
- **插件现状：** `monitor.ts:747` 设置 `disableBlockStreaming: true`，AI 回复完整生成后通过 `aws.send()` 一次性发送
- **影响：** 对方 agent 必须等待完整响应，无法看到逐 token 输出
- **优先级：** 低 — agent 间通信场景下，非流式（完整消息）反而更友好，接收方是 AI 不需要逐 token 展示
- **阻塞因素：** acp-ts TypeScript 库未实现 `send_stream_message` API（Python SDK 有），且底层 WebSocket 为 private 无法直接发送流式协议命令。需等待 acp-ts 库支持后再考虑

### 4.2 文件传输（File Transfer）

- **协议能力：** `upload_file()` / `download_file()` / `file/binary` 消息类型
- **插件现状：** `types.ts:52-57` 定义了 `AcpMessageContent` 含 `"image" | "file"` 类型，但从未使用。`sendMedia` 在 `channel.ts:174` 直接返回 `"Media not supported"`
- **影响：** 无法收发图片、文档等文件
- **优先级：** 高

### 4.3 主动会话管理

- **协议能力：** `createSession()` / `close_session()` / `invite_member()` / `get_message_list()`
- **插件现状：** 会话仅在 `connectTo()` 或收到消息时隐式创建。`AcpClient` 用两个内存 Map（`sessions` 和 `sessionsBySessionId`）管理，无持久化。`monitor.ts` 的 `sessionStates` Map 同样纯内存
- **影响：** 重启后所有会话丢失；无法主动创建/关闭协议级会话；无法获取历史消息
- **优先级：** 中

### 4.4 消息引用回复（Reply）

- **协议能力：** `reply_message()` 可引用特定消息 ID
- **插件现状：** `sendReply()` (`acp-client.ts:278-295`) 在同一 session 内发送新消息，不携带被引用消息 ID
- **影响：** 多轮对话中无法明确引用某条消息
- **优先级：** 中

### 4.5 Agent Profile

- **协议能力：** `create_agent_profile()` 声明能力、LLM 配置、I/O 规格、`supportDiscover: true`
- **插件现状：** 仅通过 agent.md 上传暴露信息，未使用协议级 profile 注册
- **影响：** 其他 agent 无法通过协议发现本 agent 的结构化能力声明
- **优先级：** 低

### 4.6 结构化消息（Structured Messages）

- **协议能力：** `AssistantMessageBlock` 含 status（thinking/done/error）、timestamp、结构化 content
- **插件现状：** 纯文本 + `[From:][To:]` 前缀（`outbound.ts:33`）
- **影响：** 无法传达思考状态、错误类型等结构化信息
- **优先级：** 低

### 4.7 多 Agent 协作

- **协议能力：** 一个会话中可有多个 agent 成员，`invite_member()` + 消息路由
- **插件现状：** 仅支持 1:1 对话（`chatTypes: ["direct"]`）
- **影响：** 无法实现多 agent 协作场景
- **优先级：** 低（取决于 ACP 协议演进）

---

## 5. 插件自身的架构/质量问题

这些不是"与 Discord/Telegram 的功能差距"，而是插件自身可改进的点：

| 问题 | 说明 | 位置 | 优先级 |
|------|------|------|--------|
| **会话无持久化** | `sessionStates` 和 `AcpClient.sessions` 均为内存 Map，重启全丢 | `monitor.ts:36`, `acp-client.ts:29-30` | 高 |
| **单账号硬编码** | `listAccountIds` 只返回 `["default"]`，无法同时运行多个 ACP 身份 | `channel.ts:40` | 中 |
| **消息格式耦合** | 手动拼接 `[From:][To:]` 前缀，非结构化 | `outbound.ts:33`, `monitor.ts:660-668` | 中 |
| **blockStreaming 伪实现** | 声明 `blockStreaming: true` 但 dispatch 时 `disableBlockStreaming: true`，实际不流式。agent 间通信场景下属合理设计，非缺陷 | `channel.ts:26`, `monitor.ts:747` | 低 |
| **recordInteraction 缺 durationMs** | 入站消息时调用 `contacts.recordInteraction(sender)` 未传时长参数，导致信用评分的时长维度始终为 0 | `monitor.ts:584` | 低 |
| **AcpMessageContent 死类型** | `types.ts:52-57` 定义了含 `"image" \| "file"` 的类型，但全代码无任何引用 | `types.ts:52-57` | 低 |
| **无启动前配置验证** | 不检测 agentName 冲突或网络连通性，直到 `connect()` 失败才知道 | `acp-client.ts:41` | 低 |
| **无配置热更新** | 改配置需重启整个 gateway | — | 低 |

---

## 6. acp-ts 库 API 使用情况

| API | 说明 | 状态 | 位置 |
|-----|------|------|------|
| `AgentManager.getInstance()` | 获取单例 | ✅ | `acp-client.ts:34` |
| `AgentManager.initACP()` | 初始化 ACP | ✅ | `acp-client.ts:47` |
| `AgentManager.initAWS()` | 初始化 WebSocket | ✅ | `acp-client.ts:79` |
| `AgentManager.initFileSync()` | 初始化文件同步 | ✅ | `acp-client.ts:74` |
| `AgentManager.aws()` | 获取 WebSocket 实例 | ✅ | `acp-client.ts:222` |
| `AgentManager.fs()` | 获取 FileSync 实例 | ✅ | `acp-client.ts:332` |
| `AgentManager.acp()` | 获取 ACP 实例 | ✅ | `acp-client.ts:364` |
| `ACP.loadAid()` | 加载 AID | ✅ | `acp-client.ts:56` |
| `ACP.createAid()` | 创建 AID | ✅ | `acp-client.ts:59` |
| `ACP.online()` | 上线获取配置 | ✅ | `acp-client.ts:64` |
| `ACP.setAgentMdPath()` | 设置 agent.md 路径 | ✅ | `acp-client.ts:52` |
| `ACP.resetAgentMdUploadStatus()` | 重置上传状态 | ✅ | `acp-client.ts:365` |
| `AgentWS.onMessage()` | 接收消息 | ✅ | `acp-client.ts:90` |
| `AgentWS.onStatusChange()` | 连接状态变更 | ✅ | `acp-client.ts:82` |
| `AgentWS.startWebSocket()` | 启动 WebSocket | ✅ | `acp-client.ts:97` |
| `AgentWS.connectTo()` | 连接到目标 | ✅ | `acp-client.ts:241` |
| `AgentWS.send()` | 发送消息 | ✅ | `acp-client.ts:228` |
| `AgentWS.disconnect()` | 断开连接 | ✅ | `acp-client.ts:303` |
| `AgentWS.acceptInviteFromHeartbeat()` | 接受邀请 | ✅ | `acp-client.ts:117` |
| `HeartbeatClient` 构造 | 创建心跳客户端 | ✅ | `acp-client.ts:103` |
| `HeartbeatClient.online()` | 上线 | ✅ | `acp-client.ts:121` |
| `HeartbeatClient.offline()` | 下线 | ✅ | `acp-client.ts:308` |
| `HeartbeatClient.onInvite()` | 邀请通知 | ✅ | `acp-client.ts:115` |
| `HeartbeatClient.onStatusChange()` | 心跳状态变更 | ✅ | `acp-client.ts:110` |
| `FileSync.uploadAgentMd()` | 上传 agent.md 内容 | ✅ | `acp-client.ts:336` |
| `FileSync.uploadAgentMdFromFile()` | 从文件上传 agent.md | ✅ | `acp-client.ts:353` |
| `AgentWS.createSession()` | 主动创建会话 | ❌ | — |
| `AgentWS.invite()` | 邀请成员 | ❌ | — |
| `AgentWS.send_stream_message()` | 流式消息 | ❌ | — |
| `AgentWS.reply_message()` | 引用回复 | ❌ | — |
| `upload_file()` / `download_file()` | 文件传输 | ❌ | — |
| `create_agent_profile()` | Agent Profile | ❌ | — |
| `get_message_list()` | 获取历史消息 | ❌ | — |

**已使用：26 个 API | 未使用：7 个 API | 使用率：约 79%**

---

## 7. 实现建议路线图

### P0 — 协议能力释放

1. **实现 sendMedia** — 对接 `upload_file()` / `download_file()`，将 `media` 改为 `true`
2. **会话持久化** — 将 `sessionStates` Map 持久化到 JSON 文件（类似 contacts.json），重启后恢复
3. **主动会话管理** — 对接 `createSession()` / `close_session()`，支持主动发起会话

### P1 — 架构改进

4. **消息引用回复** — 对接 `reply_message()`，将 `reply` 改为 `true`
5. **多账号支持** — 让 `listAccountIds` 支持配置多个 ACP 身份
6. **修复 recordInteraction 缺少 durationMs** — 在会话关闭时传入实际交互时长
7. **清理死代码** — `AcpMessageContent` 类型要么用起来（对接 sendMedia）要么删掉

### P2 — 协议扩展（取决于 ACP 协议/acp-ts 演进）

8. Agent Profile 注册
9. 结构化消息（`AssistantMessageBlock`）
10. 多 Agent 协作会话
11. 流式消息 — 待 acp-ts 库支持 `send_stream_message` 后再考虑，agent 间通信场景下优先级低

---

## 8. 关键数据汇总

| 指标 | 数据 |
|------|------|
| ChannelPlugin 接口覆盖率 | 11/12 字段（92%），其中 2 个部分实现 |
| Capabilities 声明 | chatTypes 1/3，blockStreaming 非流式（agent 间合理），其余 0/5 |
| acp-ts API 使用率 | 26/33（约 79%） |
| 源码总量 | 23 个文件，约 4,284 行（src/） |
| 测试覆盖 | 10 个测试文件，覆盖辅助模块，核心链路（monitor/acp-client）无测试 |
| 与 Discord/Telegram 的真实差距 | **不在 adapter 层（已基本覆盖），而在 capabilities 层（media/reply 未实现；streaming 因场景差异暂不需要）** |

---

## 附录：ACP 协议消息类型支持情况

| 类型 | 说明 | 插件支持 |
|------|------|----------|
| text（纯文本） | 基本文本消息 | ✅ |
| text/event-stream | 流式文本（LLM 输出） | ❌ |
| file/binary | 二进制文件传输 | ❌ |
| AssistantMessageBlock | 结构化 AI 消息 | ❌ |

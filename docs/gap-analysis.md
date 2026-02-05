# ACP Channel 插件功能差距分析

> 本文档对比分析当前 ACP Channel 插件与 OpenClaw 内置插件（Discord、Telegram）的功能差距，
> 以及 ACP 协议已支持但插件尚未实现的能力。

## 1. 当前插件能力概览

### 1.1 已实现功能

| 功能 | 状态 | 说明 |
|------|------|------|
| 基础文本收发 | ✅ | 通过 `sendText` / `onMessage` 实现 |
| ACP 网络连接 | ✅ | 使用 `acp-ts` 的 `AgentManager` + `AgentWS` |
| 心跳保活 | ✅ | `HeartbeatClient` 在线状态维护 |
| 邀请接受 | ✅ | 通过 `HeartbeatClient.onInvite()` 自动接受邀请 |
| 会话管理（基础） | ✅ | 内存 `Map<string, AcpSession>` 管理活跃会话 |
| 来源白名单 | ✅ | `allowFrom` 配置，支持 `*` 通配 |
| 消息调度 | ✅ | 接入 OpenClaw 的 `reply.dispatchReplyFromConfig()` |
| 多轮对话 | ✅ | 基于 session key 的上下文保持 |

当有新会话，清除原始的   LRU原则

### 1.2 Capabilities 声明

```typescript
const acpCapabilities = {
  chatTypes: ["direct"],   // 仅支持 1:1 对话
  media: false,
  threads: false,
  blockStreaming: true,     // 声明支持但未真正实现协议级流式
  reactions: false,
  edit: false,
  unsend: false,
  reply: false,
};
```

---

## 2. 与内置插件对比

### 2.1 Plugin Adapter 对比

OpenClaw 的 `ChannelPlugin` 接口定义了丰富的 adapter 模块。下表列出各插件的实现情况：

| Adapter | ACP | Discord | Telegram | 说明 |
|---------|-----|---------|----------|------|
| **meta** | ✅ | ✅ | ✅ | 插件元信息 |
| **capabilities** | ✅ (最小) | ✅ (完整) | ✅ (完整) | 功能声明 |
| **config** | ✅ (基础) | ✅ | ✅ | 配置 schema |
| **outbound** | ✅ (仅文本) | ✅ | ✅ | 出站消息 |
| **messaging** | ❌ | ✅ | ✅ | normalizeTarget, targetResolver |
| **actions** | ✅ (空) | ✅ | ✅ | 动作处理 |
| **onboarding** | ❌ | ✅ | ✅ | 新用户/群组引导 |
| **pairing** | ❌ | ✅ | ✅ | DM 安全配对、审批通知 | T0
| **security** | ❌ | ✅ | ✅ | DM 策略、群组安全警告 |  T0
| **groups** | ❌ | ✅ | ✅ | requireMention, toolPolicy |
| **threading** | ❌ | ✅ | ✅ | 消息线程 / 话题 |
| **directory** | ❌ | ✅ | ✅ | listPeers, listGroups |
| **resolver** | ❌ | ✅ | ✅ | 目标解析（用户、频道） |
| **status** | ❌ | ✅ | ✅ | 运行状态、探测、审计 |
| **gateway** | ❌ | ✅ | ✅ | 账号生命周期管理 |
| **setup** | ❌ | ✅ | ✅ | 账号验证、配置应用 |
| **streaming** | ❌ | ✅ | ✅ | 流式输出合并配置 |
| **reload** | ❌ | ✅ | ✅ | 配置热更新 |

### 2.2 Outbound 能力对比

| 功能 | ACP | Discord | Telegram |
|------|-----|---------|----------|
| sendText | ✅ | ✅ | ✅ |
| sendMedia | ❌ (返回错误) | ✅ | ✅ |
| sendPoll | ❌ | ✅ | ❌ |
| chunker（长消息分片） | ❌ | ✅ | ✅ |
| replyToId（引用回复） | ❌ | ✅ | ✅ |
| 多账号支持 | ❌ | ✅ | ✅ |

### 2.3 ChatTypes 对比

| 类型 | ACP | Discord | Telegram |
|------|-----|---------|----------|
| direct（1:1） | ✅ | ✅ | ✅ |
| channel（频道） | ❌ | ✅ | ✅ |
| group（群组） | ❌ | ❌ | ✅ |
| thread（话题） | ❌ | ✅ | ✅ |

---

## 3. ACP 协议已支持但插件未实现的功能

以下功能在 ACP 协议（`acp-ts` 库 + ACP 网络）中已支持，但当前插件未使用：

### 3.1 流式消息（Streaming Messages）

**协议能力：** `send_stream_message()` 支持 `text/event-stream` 类型，可实现 LLM token 级别的流式输出。

**当前状态：** 插件声明 `blockStreaming: true`，但实际只是将完整消息一次性发送。未使用 `AgentWS` 的流式发送能力。

**影响：** 用户无法实时看到 AI 逐字输出，必须等待完整响应。

### 3.2 文件传输（File Transfer）

**协议能力：**
- `upload_file()` — 上传文件到 ACP 网络
- `download_file()` — 下载文件
- `send_stream_message()` 支持 `file/binary` 类型

**当前状态：** `AcpMessageContent` 类型定义中有 `type: "image" | "file"`，但 `sendMedia` 直接返回错误 `"Media not supported"`。

**影响：** 无法收发图片、文档等文件。

### 3.3 Agent Profile（代理人档案）

**协议能力：**
- `create_agent_profile()` — 声明 agent 的能力、LLM 配置、I/O 规格
- `supportDiscover: true` — 允许被其他 agent 发现
- 能力声明包括：技能列表、支持的输入/输出格式、授权方式

**当前状态：** 未实现。插件仅使用 `agentName` 进行网络注册，不暴露任何 profile 信息。

**影响：** 其他 agent 无法通过 ACP 网络发现本 agent 的能力和特性。

### 3.4 结构化消息（Structured Messages）

**协议能力：** `AssistantMessageBlock` 支持包含 status（thinking/done/error）、timestamp、结构化 content 的消息块。

**当前状态：** 仅收发纯文本，添加 `[From:][To:]` 前缀标头。

**影响：** 无法传达 AI 的思考状态、错误信息等结构化数据。

### 3.5 完整会话管理

**协议能力：**
- `create_session()` — 主动创建会话（支持 public/private）
- `close_session()` — 关闭会话
- `invite_member()` — 邀请成员加入会话
- `get_message_list()` — 获取历史消息列表

**当前状态：** 会话仅在收到消息或主动发送时隐式创建，存储在内存 Map 中。无法主动创建/关闭会话，无法获取历史消息。

**影响：** 重启后会话丢失；无法管理会话生命周期。

### 3.6 多 Agent 协作

**协议能力：**
- 一个会话中可以有多个 agent 成员
- `reply_message()` — 对特定消息回复
- `quick_send_message_content()` 配合回调实现协同工作流
- 支持消息路由到不同 agent

**当前状态：** 仅支持 1:1 对话，无法在一个会话中接入多个 agent。

**影响：** 无法实现多 agent 协作场景（如：一个 agent 负责翻译，另一个负责搜索）。

### 3.7 消息回复（Reply）

**协议能力：** `reply_message()` 可引用特定消息进行回复。

**当前状态：** `capabilities.reply = false`，`sendReply()` 仅向已有会话发送新消息，不携带引用信息。

**影响：** 多轮对话中无法明确引用之前的某条消息。

---

## 4. OpenClaw 框架层面缺失功能

以下功能属于 OpenClaw 框架的标准 adapter，对插件的稳定性和用户体验至关重要：

### 4.1 高优先级

| 功能 | 说明 | 原因 |
|------|------|------|
| **gateway** | 账号启动/停止/探测生命周期 | 当前无法优雅处理连接断开、重连、启动失败等场景 |
| **status** | 运行状态报告 | 用户和管理端无法了解 ACP 连接是否正常 |
| **streaming** | 真正的协议级流式输出 | ACP 协议已支持，用户体验提升明显 |
| **messaging** | normalizeTarget + targetResolver | 当前手动解析 `acp:{aid}:{session}` 格式，缺少标准化 |
排行榜   agent.md   主动发现别的 aid   
### 4.2 中优先级

| 功能 | 说明 | 原因 |
|------|------|------|
| **setup** | 账号配置验证 | 可在启动前检测 agentName 冲突、网络连通性 |
| **directory** | 列出可通信的 agent | 配合 agent profile 实现 agent 发现 |
| **security** | 消息来源安全策略 | 当前仅有简单的 allowFrom 白名单 |
| **onboarding** | 首次对话引导 | 改善新用户交互体验 |

### 4.3 低优先级

| 功能 | 说明 | 原因 |
|------|------|------|
| **groups** | 群组/多人对话支持 | 取决于 ACP 协议的会话模型扩展 |
| **threading** | 话题/线程 | ACP 协议当前无原生线程概念 |
| **pairing** | 配对审批 | 需要 UI 或其他渠道支持审批流程 |
| **resolver** | 目标解析 | 当 directory 实现后自然需要 |
| **reload** | 配置热更新 | 当前重启即可，后续可优化 |

---

## 5. 功能实现建议路线图

### Phase 1：基础完善

1. **实现 gateway adapter** — 管理 ACP 连接生命周期（启动、停止、重连、探测）
2. **实现 status adapter** — 报告连接状态、agent 在线状态
3. **实现 messaging adapter** — 标准化 target 格式和解析
4. **补充 setup adapter** — 启动前验证配置（agentName 唯一性、网络连通性）

### Phase 2：协议能力释放

5. **实现流式消息** — 对接 ACP 的 `send_stream_message()`，实现 token 级流式输出
6. **实现文件传输** — 对接 `upload_file()` / `download_file()`，启用 `sendMedia`
7. **实现 agent profile** — 注册 agent 能力信息，支持被发现
8. **实现结构化消息** — 使用 `AssistantMessageBlock` 传达思考状态

### Phase 3：高级功能

9. **实现 directory adapter** — 列出可通信的 agent，配合 profile 实现发现机制
10. **实现完整会话管理** — 主动创建/关闭会话、会话持久化
11. **实现消息回复** — 引用特定消息进行回复
12. **实现多 agent 协作** — 多成员会话、消息路由

### Phase 4：体验优化

13. **实现 onboarding** — 首次对话引导流程
14. **实现 security adapter** — 更细粒度的安全策略
15. **实现 groups 支持** — 多人/群组对话
16. **实现 reload** — 配置变更热生效

---

## 6. 关键数据

- **当前实现的 adapter 数量：** 4 / 18（meta, capabilities, config, outbound）
- **当前 capabilities 覆盖率：** chatTypes 1/4, 其余 0/6
- **ACP 协议能力使用率：** 约 30%（仅使用了连接、基础消息收发、心跳、邀请）
- **与 Discord/Telegram 的功能差距：** 约 70% 的框架 adapter 未实现

---

## 附录 A：ACP 协议消息类型

| 类型 | 说明 | 插件支持 |
|------|------|----------|
| text（纯文本） | 基本文本消息 | ✅ |
| text/event-stream | 流式文本（LLM 输出） | ❌ |
| file/binary | 二进制文件传输 | ❌ |
| AssistantMessageBlock | 结构化 AI 消息 | ❌ |

## 附录 B：acp-ts 库 API 使用情况

| API | 说明 | 已使用 |
|-----|------|--------|
| `AgentManager.initACP()` | 初始化 ACP | ✅ |
| `AgentManager.initAWS()` | 初始化 WebSocket | ✅ |
| `AgentWS.onMessage()` | 接收消息 | ✅ |
| `AgentWS.connectTo()` | 连接到目标 | ✅ |
| `AgentWS.send()` | 发送消息 | ✅ |
| `HeartbeatClient.online()` | 上线 | ✅ |
| `HeartbeatClient.onInvite()` | 邀请通知 | ✅ |
| `AgentWS.onStatusChange()` | 连接状态变更 | ❌ |
| `AgentWS.createSession()` | 主动创建会话 | ❌ |
| `AgentWS.invite()` | 邀请成员 | ❌ |
| `AgentWS.disconnect()` | 断开连接 | ❌ |
| `HeartbeatClient.offline()` | 下线 | ❌ |
| `HeartbeatClient.onStatusChange()` | 心跳状态变更 | ❌ |

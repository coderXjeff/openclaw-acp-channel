# Channel 与 Workspace 的关系

核心结论：**Channel 和 Workspace 没有直接绑定关系。Workspace 是 Agent 级别的概念，Channel 是消息入口，二者通过路由（Binding）间接关联。**

---

## 一、关系总览图

```
┌─────────────────────────────────────────────────────────────┐
│                    消息流入方向                                │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ Telegram │  │ Discord  │  │  Slack   │  │ WhatsApp │   │
│  │ (channel)│  │ (channel)│  │ (channel)│  │ (channel)│   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
│       │              │              │              │         │
│       └──────────────┴──────┬───────┴──────────────┘         │
│                             │                                │
│                    resolveAgentRoute()                        │
│                    (bindings 路由匹配)                         │
│                             │                                │
│              ┌──────────────┼──────────────┐                 │
│              ▼              ▼              ▼                 │
│       ┌─────────┐    ┌─────────┐    ┌──────────┐           │
│       │ Agent   │    │ Agent   │    │ Agent    │           │
│       │ "main"  │    │"research│    │ "work"   │           │
│       └────┬────┘    └────┬────┘    └────┬─────┘           │
│            │              │              │                   │
│            ▼              ▼              ▼                   │
│       ┌─────────┐    ┌──────────┐   ┌──────────┐           │
│       │~/clawd/ │    │~/clawd-  │   │~/clawd-  │           │
│       │         │    │research/ │   │work/     │           │
│       │AGENTS.md│    │AGENTS.md │   │AGENTS.md │           │
│       │SOUL.md  │    │SOUL.md   │   │SOUL.md   │           │
│       │MEMORY.md│    │MEMORY.md │   │MEMORY.md │           │
│       │skills/  │    │skills/   │   │skills/   │           │
│       │...      │    │...       │   │...       │           │
│       └─────────┘    └──────────┘   └──────────┘           │
│       (workspace)    (workspace)    (workspace)             │
└─────────────────────────────────────────────────────────────┘
```

---

## 二、Channel 安装位置

Channel 不安装在 workspace 中，而是安装在**代码层**：

| 类型 | 安装位置 | 加载方式 | 示例 |
|------|---------|---------|------|
| **核心 Channel** | `src/<channel>/` → 编译到 `dist/` | 内置，随主程序加载 | telegram, whatsapp, discord, slack, signal, imessage, googlechat |
| **扩展 Channel** | `extensions/<channel>/` → 编译到包中 | 插件系统动态加载 | bluebubbles, googlechat, line, matrix, teams, zalo |
| **用户自装 Channel** | `~/.clawdbot/extensions/` | 插件系统动态发现 | 用户自行开发/下载的 channel 插件 |

### 核心 Channel 注册表

定义在 `src/channels/registry.ts:7`：

```typescript
CHAT_CHANNEL_ORDER = [
  "telegram", "whatsapp", "discord", "googlechat", "slack", "signal", "imessage"
]
```

### 扩展 Channel 加载流程

1. **发现** (`src/plugins/discovery.ts`)：扫描 `~/.clawdbot/extensions/` + `extensions/` + 配置的插件路径
2. **加载** (`src/plugins/loader.ts`)：通过 `jiti`（TypeScript 运行时加载器）加载插件
3. **注册**：每个插件调用 `api.registerChannel({ plugin })` 注册到 `PluginRegistry`

```typescript
// extensions/bluebubbles/index.ts 示例
const plugin = {
  id: "bluebubbles",
  name: "BlueBubbles",
  register(api: ClawdbotPluginApi) {
    api.registerChannel({ plugin: bluebubblesPlugin });
    api.registerHttpHandler(handleBlueBubblesWebhookRequest);
  },
};
```

### Channel 运行时配置

存储在 `~/.clawdbot/clawdbot.json` 的 `channels.<channelId>` 节：

```json
{
  "channels": {
    "telegram": { "default": { "token": "bot123:xxx" } },
    "discord": { "default": { "token": "xxx" } }
  }
}
```

---

## 三、Workspace 解析逻辑

Workspace 完全由 Agent 决定，源码在 `src/agents/agent-scope.ts:136`：

```
resolveAgentWorkspaceDir(cfg, agentId):
  1. 检查 agents.list[agentId].workspace → 若配置了，用它
  2. 若是默认 Agent → 检查 agents.defaults.workspace → 否则用 ~/clawd/
  3. 若非默认 Agent → 用 ~/clawd-{agentId}/
```

配置示例：

```json
{
  "agents": {
    "defaults": { "workspace": "~/.clawd" },
    "list": [
      { "id": "main", "default": true, "workspace": "~/.clawd" },
      { "id": "research", "workspace": "~/clawd-research" }
    ]
  }
}
```

---

## 四、路由：Channel 如何关联到 Agent（进而关联到 Workspace）

消息从 Channel 到 Agent 的路由发生在 `resolveAgentRoute()` (`src/routing/resolve-route.ts:142`)。

### 路由匹配优先级

| 优先级 | 匹配类型 | 匹配条件 | 示例配置 | 场景 |
|--------|---------|---------|---------|------|
| 1 (最高) | `binding.peer` | 精确到用户/群组 | `{ agentId: "work", match: { channel: "telegram", peer: { kind: "dm", id: "user_123" } } }` | 指定用户的消息发给特定 Agent |
| 2 | `binding.guild` | Discord 服务器级 | `{ agentId: "research", match: { channel: "discord", guildId: "123456" } }` | 某个 Discord 服务器的所有消息发给 research Agent |
| 3 | `binding.team` | Teams/Slack 团队级 | `{ agentId: "work", match: { channel: "slack", teamId: "T123" } }` | 某个 Slack 团队发给 work Agent |
| 4 | `binding.account` | 精确账号 | `{ agentId: "main", match: { channel: "telegram", accountId: "default" } }` | 某个 Telegram bot 账号的所有消息 |
| 5 | `binding.channel` | 通配账号 | `{ agentId: "main", match: { channel: "telegram", accountId: "*" } }` | 该渠道所有账号 |
| 6 (最低) | `default` | 无匹配 | 无需配置 | 回退到默认 Agent |

### Binding 配置示例

```json
{
  "bindings": [
    {
      "agentId": "research",
      "match": { "channel": "discord", "guildId": "123456789" }
    },
    {
      "agentId": "main",
      "match": { "channel": "*", "accountId": "*" }
    }
  ]
}
```

---

## 五、Session Key 编码 Channel 信息

路由完成后生成 session key，编码了 channel + peer 信息：

```
agent:main:main                              ← 主会话（WebChat 直接对话）
agent:main:telegram:dm:user_123              ← Telegram 私聊 (per-channel-peer 模式)
agent:main:discord:group:channel_456         ← Discord 群组
agent:research:discord:dm:user_789           ← research Agent 的 Discord 私聊
agent:main:dm:user_123                       ← 跨渠道合并 (per-peer 模式)
```

DM 隔离模式由 `config.session.dmScope` 控制：

| dmScope | 行为 | Session Key 示例 |
|---------|------|-----------------|
| `"main"` (默认) | 所有 DM 合并到主会话 | `agent:main:main` |
| `"per-peer"` | 每个用户独立会话，跨渠道合并 | `agent:main:dm:user_123` |
| `"per-channel-peer"` | 每个渠道+用户独立会话 | `agent:main:telegram:dm:user_123` |

Session key 决定了会话历史的隔离粒度，但**不影响 workspace**——同一 Agent 的所有 session 共享同一个 workspace。

---

## 六、完整消息流转链路

```
Channel (安装在代码/插件层)
  │
  │ 1. 接收消息，提取 channel + accountId + peer
  │
  ▼
路由层 resolveAgentRoute()
  │
  │ 2. 按 bindings 匹配，决定 agentId
  │ 3. 生成 sessionKey (含 channel+peer 信息)
  │
  ▼
Agent 层
  │
  │ 4. resolveAgentWorkspaceDir(agentId) → workspace 目录
  │ 5. 加载 workspace 文件 (SOUL.md, AGENTS.md, ...)
  │ 6. 加载 session 历史 (按 sessionKey 隔离)
  │
  ▼
LLM 调用 (workspace 文件注入 system prompt, session 历史注入 messages)
```

---

## 七、Channel 特定提示词注入机制

虽然 Channel 和 Workspace 没有直接绑定，但不同 Channel 会向 LLM 的 System Prompt 注入**不同的 Channel 特定提示词**。这些提示词通过 5 个注入点进入上下文窗口。

### 7.1 注入点总览

```
System Prompt 组装时
  │
  ├─ ## Messaging 段落
  │    └─ resolveChannelMessageToolHints()   ← 注入点 1: messageToolHints
  │
  ├─ ## Reactions 段落
  │    └─ resolveTelegramReactionLevel()     ← 注入点 2: reactionGuidance
  │    └─ resolveSignalReactionLevel()
  │
  ├─ ## Runtime 行
  │    └─ resolveChannelCapabilities()       ← 注入点 3: capabilities
  │    └─ listChannelSupportedActions()      ← 注入点 4: channelActions
  │
  └─ ## Group Chat Context (extraSystemPrompt)
       └─ buildGroupIntro()                  ← 注入点 5: groupIntroHint
            └─ dock.groups.resolveGroupIntroHint()
```

### 7.2 注入点 1: `messageToolHints` — Channel 专属 message 工具指南

**注入位置**: System Prompt → `## Messaging` → `### message tool` 末尾

每个 Channel 插件可通过 `ChannelPlugin.agentPrompt.messageToolHints` 接口提供特定的消息格式指导。代码入口在 `src/agents/channel-tools.ts:52`，通过 `resolveChannelMessageToolHints()` 调用当前 Channel 的 dock。

**当前已实现的 Channel**:

| Channel | 注入内容 | 来源文件 | 预估 Token |
|---------|---------|---------|-----------|
| **LINE** | ~48 行富消息指南：`[[quick_replies:...]]`、`[[location:...]]`、`[[confirm:...]]`、`[[buttons:...]]`、`[[media_player:...]]`、`[[event:...]]`、`[[agenda:...]]`、`[[device:...]]`、`[[appletv_remote:...]]` 等 LINE Flex 卡片语法 | `extensions/line/src/channel.ts:724` | ~400 |
| **MS Teams** | 2 行：Adaptive Cards 发送方式 + target 格式（`user:ID`、`conversation:19:...@thread.tacv2`） | `extensions/msteams/src/channel.ts:68` | ~60 |
| 其他 Channel | 暂无实现，但**接口已预留**，任何插件都可通过实现 `agentPrompt.messageToolHints` 注入 | `types.plugin.ts:77` | - |

**LINE 注入内容示例**:

```
### LINE Rich Messages
LINE supports rich visual messages. Use these directives in your reply when appropriate:

**Quick Replies** (bottom button suggestions):
  [[quick_replies: Option 1, Option 2, Option 3]]

**Location** (map pin):
  [[location: Place Name | Address | latitude | longitude]]

**Confirm Dialog** (yes/no prompt):
  [[confirm: Question text? | Yes Label | No Label]]

**Button Menu** (title + text + buttons):
  [[buttons: Title | Description | Btn1:action1, Btn2:https://url.com]]
...
```

### 7.3 注入点 2: `reactionGuidance` — Emoji 反应行为指导

**注入位置**: System Prompt → `## Reactions` 段落 (`system-prompt.ts:470-492`)

仅 **Telegram** 和 **Signal** 有此机制，通过各自的 `resolveXxxReactionLevel()` 函数读取配置。

| Channel | 配置路径 | 级别 | 注入的提示词 |
|---------|---------|------|------------|
| **Telegram** | `channels.telegram.reactionLevel` | `off` | 不注入任何内容 |
| | | `ack` | 不注入 agent 反应指导（仅启用处理中的 👀 反应） |
| | | `minimal` (默认) | "React sparingly — at most once per 5–10 exchanges. Only when genuinely relevant." |
| | | `extensive` | "Feel free to react liberally…react whenever it feels natural." |
| **Signal** | `channels.signal.reactionLevel` | 同上 | 同上规则 |
| 其他 Channel | - | - | 不注入反应指导 |

来源: `src/telegram/reaction-level.ts`, `src/signal/reaction-level.ts`

### 7.4 注入点 3: `capabilities` — 渠道能力声明

**注入位置**: System Prompt → `## Runtime` 行的 `capabilities=...` 部分

每个 Channel 在 `dock.capabilities` 中声明自身支持的能力（`src/channels/dock.ts`）。这些能力字符串被拼入 Runtime 行，同时影响 `## Messaging` 段落中的 inline buttons 判断。

| Channel | 声明的 capabilities | 来源 |
|---------|-------------------|------|
| **Telegram** | `chatTypes: [direct, group, channel, thread]`, `nativeCommands`, `blockStreaming` | `dock.ts:94-98` |
| **Telegram** (配置后) | + `inlineButtons`（触发 Messaging 段落中 inline buttons 用法注入） | `config.channels.telegram.capabilities` |
| **WhatsApp** | `chatTypes: [direct, group]`, `polls`, `reactions`, `media` | `dock.ts:131-135` |
| **Discord** | `chatTypes: [direct, channel, thread]`, `polls`, `reactions`, `media`, `nativeCommands`, `threads` | `dock.ts:179-185` |
| **Slack** | `chatTypes: [direct, channel, thread]`, `reactions`, `media`, `nativeCommands`, `threads` | `dock.ts:276-282` |
| **Signal** | `chatTypes: [direct, group]`, `reactions`, `media` | `dock.ts:305-309` |
| **iMessage** | `chatTypes: [direct, group]`, `reactions`, `media` | `dock.ts:340-344` |
| **Google Chat** | `chatTypes: [direct, group, thread]`, `reactions`, `media`, `threads`, `blockStreaming` | `dock.ts:219-224` |

**Runtime 行示例**:

```
Runtime: agent=main | host=my-mac | channel=telegram | capabilities=nativeCommands,blockStreaming,inlineButtons | thinking=off
```

### 7.5 注入点 4: `channelActions` — 支持的消息动作

**注入位置**: 传入 `buildSystemPromptParams()` → `runtimeInfo.channelActions`

`listChannelSupportedActions()` (`src/agents/channel-tools.ts:11`) 查询当前 Channel 插件支持哪些消息动作（如 `react`, `edit`, `unsend`, `pin`, `set_topic` 等），注入到运行时信息中，让 Agent 知道可以对消息执行哪些操作。

### 7.6 注入点 5: `groupIntroHint` — 群聊上下文中的 Channel 特定提示

**注入位置**: System Prompt → `## Group Chat Context` (`extraSystemPrompt`)

当消息来自群聊时，`buildGroupIntro()` (`src/auto-reply/reply/groups.ts:56`) 构建群聊上下文。其中调用 `dock.groups.resolveGroupIntroHint()` 注入 Channel 特定信息：

| Channel | 群聊提示内容 | 来源 |
|---------|------------|------|
| **WhatsApp** | `"WhatsApp IDs: SenderId is the participant JID; [message_id: ...] is the message id for reactions (use SenderId as participant)."` | `dock.ts:154` |
| 其他 Channel | 无额外群聊提示 | - |

**完整群聊上下文示例（WhatsApp 群）**:

```
You are replying inside the WhatsApp group "家庭群".
Group members: Alice, Bob, Charlie.
Activation: always-on (you receive every group message).
WhatsApp IDs: SenderId is the participant JID; [message_id: ...] is the message id for reactions (use SenderId as participant).
If no response is needed, reply with exactly ":::CLAWDBOT_SILENT:::" (and nothing else)...
Be extremely selective: reply only when directly addressed or clearly helpful. Otherwise stay silent.
Be a good group participant: mostly lurk and follow the conversation; reply only when directly addressed or you can add clear value...
Write like a human. Avoid Markdown tables. Don't type literal \n sequences; use real line breaks sparingly.
Address the specific sender noted in the message context.
```

### 7.7 Channel 特定提示词全景对照表

| 提示词注入点 | Telegram | Discord | WhatsApp | Slack | Signal | LINE | MS Teams | iMessage | Google Chat |
|-------------|----------|---------|----------|-------|--------|------|----------|----------|-------------|
| **messageToolHints** | - | - | - | - | - | 48行富消息指南 | 2行 Adaptive Cards | - | - |
| **reactionGuidance** | minimal/extensive | - | - | - | minimal/extensive | - | - | - | - |
| **inlineButtons 指导** | 配置后注入 | - | - | - | - | - | - | - | - |
| **groupIntroHint** | - | - | WhatsApp JID 格式 | - | - | - | - | - | - |
| **capabilities** | nativeCommands, blockStreaming | polls, reactions, media, nativeCommands, threads | polls, reactions, media | reactions, media, nativeCommands, threads | reactions, media | (插件定义) | (插件定义) | reactions, media | reactions, media, threads, blockStreaming |
| **channelActions** | 插件定义 | 插件定义 | 插件定义 | 插件定义 | 插件定义 | 插件定义 | 插件定义 | 插件定义 | 插件定义 |
| **groupIntro provider 标签** | "Telegram group" | "Discord channel" | "WhatsApp group" | "Slack channel" | "Signal group" | "LINE group" | "Teams channel" | "iMessage group" | "Google Chat group" |

### 7.8 扩展点：如何为新 Channel 添加提示词

Channel 插件通过实现 `ChannelPlugin` 接口（`src/channels/plugins/types.plugin.ts:48`）的以下字段注入提示词：

```typescript
const myChannelPlugin: ChannelPlugin = {
  id: "my-channel",
  // ...
  capabilities: {                      // → 注入点 3: Runtime capabilities
    chatTypes: ["direct", "group"],
    reactions: true,
    media: true,
  },
  agentPrompt: {                       // → 注入点 1: messageToolHints
    messageToolHints: ({ cfg }) => [
      "My channel supports special [[card:...]] syntax.",
    ],
  },
  groups: {                            // → 注入点 5: groupIntroHint
    resolveGroupIntroHint: () =>
      "My channel uses special ID format: user@domain.",
  },
  actions: {                           // → 注入点 4: channelActions
    listActions: ({ cfg }) => ["react", "edit", "unsend"],
    // ...
  },
};
```

注入点 2 (reactionGuidance) 目前是硬编码在 `system-prompt.ts` 中仅对 Telegram/Signal 生效，新 Channel 需要修改 `system-prompt.ts` 或通过 `capabilities` 间接影响。

---

## 八、概念隔离对照表（含 Channel 提示词）

| 概念 | 隔离粒度 | 存储位置 | 说明 |
|------|---------|---------|------|
| **Channel** | 全局共享 | 代码层 (`src/`, `extensions/`, `~/.clawdbot/extensions/`) | 消息通道，不持有 workspace |
| **Channel 配置** | 全局 | `~/.clawdbot/clawdbot.json` → `channels.*` | Token、账号等运行时配置 |
| **Channel 提示词** | 按 Channel 类型 | 硬编码在 Channel 插件中 (`dock.ts`, `extensions/*/channel.ts`) | 不同 Channel 向 System Prompt 注入不同的格式指导、能力声明、反应规则 |
| **Agent** | 按 agentId | `config.agents.list[]` | 一个 Agent = 一个人格 + 一个 workspace |
| **Workspace** | 按 Agent | `~/clawd/` 或 `~/clawd-{agentId}/` | Agent 的"家"——人格、记忆、技能都在这里 |
| **Session** | 按 channel + peer + agent | `~/.clawdbot/sessions/<sessionKey>.jsonl` | 对话历史，隔离到具体的用户/群组/渠道组合 |
| **Binding** | 路由规则 | `config.bindings[]` | 将 channel 消息路由到特定 Agent |

---

## 九、关键源码文件索引

| 文件 | 作用 |
|------|------|
| `src/channels/registry.ts` | 核心 Channel 注册表与元数据 |
| `src/channels/dock.ts` | Channel Dock 定义：capabilities、threading、groupIntroHint、agentPrompt |
| `src/channels/plugins/index.ts` | Channel 插件加载/列表 |
| `src/channels/plugins/types.plugin.ts` | `ChannelPlugin` 接口定义（含 `agentPrompt` 扩展点） |
| `src/channels/plugins/types.core.ts` | `ChannelAgentPromptAdapter`、`ChannelCapabilities` 类型定义 |
| `src/agents/channel-tools.ts` | `resolveChannelMessageToolHints()`、`listChannelSupportedActions()` |
| `src/agents/system-prompt.ts` | System Prompt 组装，Reactions 段落硬编码 |
| `src/config/channel-capabilities.ts` | `resolveChannelCapabilities()` — 读取渠道能力配置 |
| `src/telegram/reaction-level.ts` | Telegram Emoji 反应级别解析 |
| `src/signal/reaction-level.ts` | Signal Emoji 反应级别解析 |
| `src/auto-reply/reply/groups.ts` | `buildGroupIntro()` — 构建群聊上下文（含 Channel 特定提示） |
| `src/routing/resolve-route.ts` | 消息 → Agent 路由解析 |
| `src/routing/session-key.ts` | Session Key 构建与解析 |
| `src/routing/bindings.ts` | Binding 规则读取 |
| `src/gateway/server-channels.ts` | Channel 生命周期管理 (start/stop) |
| `src/plugins/discovery.ts` | 插件发现（扫描扩展目录） |
| `src/plugins/loader.ts` | 插件加载（jiti 运行时加载） |
| `src/plugins/registry.ts` | 插件注册表 |
| `src/agents/agent-scope.ts` | Agent 配置与 Workspace 解析 |
| `src/agents/workspace.ts` | Workspace 引导文件管理 |
| `extensions/line/src/channel.ts` | LINE Channel 插件（messageToolHints 实现示例） |
| `extensions/msteams/src/channel.ts` | MS Teams Channel 插件（messageToolHints 实现示例） |

---

## 十、类比总结

**Channel 是"门"（消息入口），Workspace 是"家"（Agent 的文件系统）。**

- 多个"门"可以通往同一个"家"（多个 Channel 路由到同一个 Agent）
- 哪个"门"通向哪个"家"由 bindings 路由规则决定
- "家"里的东西（SOUL.md、MEMORY.md、skills/）跟"门"无关，只跟住在"家"里的 Agent 有关
- 对话记录（Session）按"门+来访者"隔离存储，但访问的"家"取决于 Agent

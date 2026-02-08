# 配置参考与故障排查

## 配置字段

所有配置位于 `~/.openclaw/openclaw.json` 的 `channels.acp` 下。修改后需重启 gateway 生效。

### 顶层字段

| 字段 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `enabled` | boolean | 是 | `false` | 启用 ACP 通道 |
| `agentName` | string | 是 | — | Agent 名称，不含域名（格式：`^[a-z0-9-]+$`） |
| `domain` | string | 否 | `"aid.pub"` | ACP 域名，完整 AID = `{agentName}.{domain}` |
| `seedPassword` | string | 否 | — | 种子密码，用于生成固定身份密钥对。相同 agentName + seedPassword 始终生成相同 AID |
| `ownerAid` | string | 否 | — | 主人 AID。来自此 AID 的消息拥有完整权限（命令、文件、配置），其他人仅对话权限 |
| `allowFrom` | string[] | 否 | `[]` | 允许发消息的 AID 列表。`["*"]` 允许所有人；空数组 `[]` 不做过滤（等同允许所有人） |
| `agentMdPath` | string | 否 | — | agent.md 文件路径，连接成功后自动上传。支持 `~` 前缀 |
| `workspaceDir` | string | 否 | — | Workspace 目录路径，启用后从工作区源文件自动生成 agent.md（优先于 `agentMdPath`） |
| `profile` | object | 否 | — | Agent 元数据（见下方） |
| `session` | object | 否 | （见下方） | 会话终止控制配置 |

### profile 子对象

| 字段 | 类型 | 说明 |
|------|------|------|
| `profile.displayName` | string | Agent 显示名称 |
| `profile.description` | string | Agent 简短描述 |
| `profile.capabilities` | string[] | Agent 能力标签列表 |

### session 子对象（会话终止控制）

ACP 采用 4 层会话终止机制，每层对应不同的配置字段。详细行为说明见 [消息与会话](./messaging.md)。

**第一层：软控制（AI 驱动）**

| 字段 | 类型 | 默认值 | 最小值 | 说明 |
|------|------|--------|--------|------|
| `session.endMarkers` | string[] | `["[END]", "[GOODBYE]", "[NO_REPLY]"]` | 每项 ≥3 字符 | AI 回复或对方消息中包含这些标记时，会话优雅关闭 |
| `session.consecutiveEmptyThreshold` | number | `2` | 1 | 连续空回复达到此阈值后自动关闭会话 |

**第二层：协议标记**

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `session.sendEndMarkerOnClose` | boolean | `true` | 关闭会话时是否向对方发送结束标记 |
| `session.sendAckOnReceiveEnd` | boolean | `false` | 收到对方结束标记时是否回复 ACK 确认 |

**第三层：硬限制**

| 字段 | 类型 | 默认值 | 最小值 | 说明 |
|------|------|--------|--------|------|
| `session.maxTurns` | number | `100` | 1 | 每个会话最大入站消息次数（注意：是入站消息数，不是对话轮次） |
| `session.maxDurationMs` | number | `1800000` (30 分钟) | 1000 | 会话最大持续时间（毫秒） |
| `session.idleTimeoutMs` | number | `600000` (10 分钟) | 1000 | 会话空闲超时（毫秒），每 5 秒检查一次 |

**第四层：并发控制（LRU 淘汰）**

| 字段 | 类型 | 默认值 | 最小值 | 说明 |
|------|------|--------|--------|------|
| `session.maxConcurrentSessions` | number | `10` | 1 | 最大同时活跃会话数。超出时淘汰最久未活动的会话 |

> **配置校验**：所有 session 字段在启动时自动校验。无效值（非数字、低于最小值、空数组等）会静默回退到默认值，不会报错。

### 完整配置示例

```json
{
  "channels": {
    "acp": {
      "enabled": true,
      "agentName": "my-bot",
      "domain": "aid.pub",
      "seedPassword": "your-secret-password",
      "ownerAid": "your-name.aid.pub",
      "allowFrom": ["*"],
      "agentMdPath": "~/.acp-storage/AIDs/my-bot.aid.pub/public/agent.md",
      "workspaceDir": "",
      "profile": {
        "displayName": "My Bot",
        "description": "OpenClaw AI 助手",
        "capabilities": ["chat", "acp"]
      },
      "session": {
        "endMarkers": ["[END]", "[GOODBYE]", "[NO_REPLY]"],
        "consecutiveEmptyThreshold": 2,
        "sendEndMarkerOnClose": true,
        "sendAckOnReceiveEnd": false,
        "maxTurns": 100,
        "maxDurationMs": 1800000,
        "idleTimeoutMs": 600000,
        "maxConcurrentSessions": 10
      }
    }
  }
}
```

---

## 连接状态

使用 `/acp-status` 命令查看连接状态、联系人数量、活跃会话等信息。

### 连接状态值

| 状态 | 含义 | 说明 |
|------|------|------|
| `connecting` | 正在连接 | 初始化 AID、获取服务器配置、建立 WebSocket |
| `connected` | 已连接 | WebSocket 和心跳均正常，可收发消息 |
| `disconnected` | 已断开 | 连接正常关闭，等待重连 |
| `reconnecting` | 重连中 | 断开后自动重连（指数退避） |
| `error` | 连接错误 | 连接异常断开，等待重连 |

### 会话状态值

| 状态 | 含义 |
|------|------|
| `active` | 会话活跃，正常收发消息 |
| `closing` | AI 回复中包含结束标记，发送完毕后即关闭 |
| `closed` | 会话已关闭，后续消息将被忽略。关闭 5 分钟后自动清理 |

### 会话关闭原因

| closeReason | 触发条件 | 层级 |
|-------------|---------|------|
| `received_end_marker` | 对方消息包含结束标记（如 `[END]`） | 第一层 |
| `ai_sent_end_marker` | AI 回复包含结束标记 | 第一层 |
| `consecutive_empty_{N}` | 连续 N 次空回复达到阈值 | 第一层 |
| `idle_timeout_{N}ms` | 空闲超过 idleTimeoutMs | 第三层 |
| `max_turns_{N}` | 入站消息数达到 maxTurns | 第三层 |
| `max_duration_{N}ms` | 会话时长超过 maxDurationMs | 第三层 |
| `lru_evicted` | 并发会话超限，被 LRU 淘汰 | 第四层 |
| `superseded` | 同一对方发起了新会话，旧会话被替代 | 自动 |
| `manual_close` | 手动调用关闭 | 手动 |

### 重连机制

连接断开后自动重连，采用指数退避 + 随机抖动：

| 重连次数 | 基础延迟 | 实际延迟（含 ±25% 抖动） |
|---------|---------|------------------------|
| 第 1 次 | 1 秒 | 0.75 ~ 1.25 秒 |
| 第 2 次 | 2 秒 | 1.5 ~ 2.5 秒 |
| 第 3 次 | 4 秒 | 3 ~ 5 秒 |
| 第 4 次 | 8 秒 | 6 ~ 10 秒 |
| 第 5 次 | 16 秒 | 12 ~ 20 秒 |
| 第 6 次+ | 30 秒（上限） | 22.5 ~ 37.5 秒 |

连接成功后重连计数归零。Gateway 停止（abort 信号）时退出重连循环。

### 日志中的关键状态消息

日志中 `[ACP]` 前缀的消息：

| 日志 | 含义 |
|------|------|
| `Connection status changed: connected` | 连接成功 |
| `Connection status changed: disconnected` | 连接断开 |
| `Connection failed: {error}; retrying in {N}ms (attempt {N})` | 连接失败，正在重连 |
| `Monitor started for {aid}` | 监听启动成功 |
| `Session {id} inbound message {N}/{max}` | 会话收到第 N 条入站消息 |
| `Session {id} closed: {reason}` | 会话关闭及原因 |
| `LRU evicting session {id}` | 并发超限，淘汰最旧会话 |
| `Session {id} idle timeout ({N}ms)` | 会话空闲超时 |
| `Rejected message from {sender} (not in allowlist)` | 消息被 allowFrom 拒绝 |
| `Rejected message from {sender} (low credit: {score})` | 消息因信用分过低被拒（< 20 分） |
| `agent.md uploaded successfully: {url}` | agent.md 上传成功 |
| `agent.md sources unchanged (hash match), skipping upload` | agent.md 无变化，跳过上传 |

---

## 本地存储文件

ACP 插件在 `~/.acp-storage/` 下维护以下文件：

| 文件 | 用途 | 损坏时的影响 |
|------|------|-------------|
| `localStorage.json` | ACP 身份密钥存储（模拟浏览器 localStorage） | 丢失后需重新创建 AID，如果 seedPassword 相同则身份不变 |
| `agent-md-hash.json` | agent.md 内容哈希，用于变更检测 | 丢失后下次启动会重新上传 agent.md |
| `contacts.json` | 联系人数据（信用评分、分组、交互记录） | 丢失后联系人信息清空，新消息会重新自动添加 |

> 这些文件损坏时插件会静默忽略错误并继续运行，不会导致崩溃。

---

## 故障排查

### 启动与连接

| 症状 | 原因 | 解决 |
|------|------|------|
| `ACP channel not enabled or not configured` | `channels.acp` 中缺少 `enabled: true` 或 `agentName` | 检查配置，确保两者都已设置 |
| `No ACP config found` | `channels.acp` 整个字段缺失 | 在 `openclaw.json` 中添加 `channels.acp` 配置 |
| `PluginRuntime not initialized` | 插件 register() 未被调用 | 确认 `plugins.entries.acp.enabled` 为 `true`，重启 gateway |
| `Agent name not configured` | `agentName` 为空 | 设置 `channels.acp.agentName` |
| `ACP channel is configured but not enabled` | 有 `agentName` 但 `enabled` 为 `false` | 设置 `channels.acp.enabled: true` |
| `Module not found: acp-ts` | 依赖未安装 | `cd ~/.openclaw/extensions/acp && npm install` |
| `Account not enabled` | `enabled` 为 `false` | 设置 `channels.acp.enabled: true` |

### 网络与身份

| 症状 | 原因 | 解决 |
|------|------|------|
| `Connection failed: {error}; retrying in {N}ms` | 网络不通或服务器不可达 | 检查网络连接，确认能访问 `aid.pub` |
| `Connection error: {error}` | 连接过程中发生异常 | 查看具体错误信息，检查网络或代理设置 |
| 预检 `PREFLIGHT_FAIL` + `is used by another user` | AID 名字已被其他人注册 | 换一个 `agentName` |
| 预检 `PREFLIGHT_FAIL` + `signIn` 错误 | AID 存在但 `seedPassword` 不匹配 | 使用正确密码，或换 `agentName`，或删除 `~/.acp-storage/localStorage.json` 中对应条目 |
| 预检 `PREFLIGHT_FAIL` + `TIMEOUT` | 网络超时 | 检查网络连接、代理设置 |
| `Invite to {target} timed out after 30s` | 对方不在线或不可达 | 确认对方 AID 正确且在线 |
| `Invite to {target} failed - target may be offline` | 对方拒绝或不在线 | 确认对方 AID 正确且在线 |
| `ACP client not connected` | 在未连接状态下尝试发送消息 | 等待连接恢复，检查 `/acp-status` |

### 消息与会话

| 症状 | 原因 | 解决 |
|------|------|------|
| 消息被静默丢弃 | 发送方不在 `allowFrom` 列表中 | 将对方 AID 加入 `allowFrom` 或使用 `["*"]` |
| `Rejected message from {sender} (low credit: {score})` | 对方信用分低于 20 | 用 `setCreditScore` 手动提高对方信用分，或 `clearCreditOverride` 恢复自动计算 |
| 会话意外关闭 | 触及硬限制（轮次/时长/空闲） | 查看日志中的 closeReason，调大对应的 session 参数 |
| `Session {id} hit hard limit: max_turns_{N}` | 入站消息数达到上限 | 调大 `session.maxTurns` |
| `Session {id} hit hard limit: max_duration_{N}ms` | 会话时长超限 | 调大 `session.maxDurationMs` |
| `Session {id} idle timeout ({N}ms)` | 会话空闲超时 | 调大 `session.idleTimeoutMs` |
| `LRU evicting session {id}` | 并发会话数超过 `maxConcurrentSessions` | 调大 `session.maxConcurrentSessions` |
| 连续空回复后会话关闭 | AI 连续返回空内容 | 检查 AI 配置，或调大 `session.consecutiveEmptyThreshold` |
| 对方持续发消息但会话已关闭 | 会话处于 `closed` 状态 | 对方需发起新会话；如果配置了 `sendAckOnReceiveEnd`，对方会收到关闭通知 |

### agent.md 上传

| 症状 | 原因 | 解决 |
|------|------|------|
| `agent.md file not found, skipping upload check` | `agentMdPath` 指向的文件不存在 | 检查路径是否正确，文件是否已创建 |
| `agent.md sources unchanged (hash match), skipping upload` | 文件内容未变化 | 编辑文件后重试，或使用 `/acp-sync` 强制上传 |
| `Failed to upload agent.md: {error}` | 上传失败 | 检查网络连接；确认文件大小不超过 4KB |
| `FileSync not initialized` | 连接配置中缺少 `messageSignature` | 通常是连接未完全建立，等待重连 |
| `Neither workspaceDir nor agentMdPath configured` | 手动同步时两个路径都未配置 | 设置 `agentMdPath` 或 `workspaceDir` |

### 其他

| 症状 | 原因 | 解决 |
|------|------|------|
| 配置后 gateway 启动失败 | `openclaw.json` 格式错误 | 从备份恢复：`cp ~/.openclaw/openclaw.json.bak ~/.openclaw/openclaw.json` |
| `/acp` skill 不可用 | 插件未启用或 skill 目录未被发现 | 1. 确认 `plugins.entries.acp.enabled` 为 `true`；2. 确认 `SKILL.md` 存在；3. 兜底：`ln -s ~/.openclaw/extensions/acp/skill/acp ~/.openclaw/skills/acp` |
| `Failed to save contacts` / `Failed to load contacts` | 磁盘空间不足或权限问题 | 检查 `~/.acp-storage/` 目录权限和磁盘空间 |
| `Failed to save agent.md hash` | 磁盘写入失败 | 检查 `~/.acp-storage/` 目录权限和磁盘空间 |

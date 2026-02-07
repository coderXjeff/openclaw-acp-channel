# 配置参考与故障排查

## 连接状态

使用 `/acp-status` 命令查看连接状态、联系人数量、活跃会话等信息。

日志中 `[ACP]` 前缀的关键状态消息：

| 日志 | 含义 |
|------|------|
| `ACP connection established` | 成功连接 ACP 网络 |
| `Connection status changed: connected` | 连接活跃 |
| `Connection status changed: disconnected` | 连接断开 |
| `ACP channel not enabled or not configured` | 缺少 `enabled: true` 或 `agentName` |
| `Account not enabled` | `enabled` 为 false |

## 配置字段

`channels.acp` 下所有字段：

| 字段 | 必需 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | 是 | `false` | 启用 ACP 通道 |
| `agentName` | 是 | — | Agent 名称（小写字母、数字、连字符：`^[a-z0-9-]+$`） |
| `domain` | 否 | `aid.pub` | ACP 域名 |
| `seedPassword` | 否 | — | 用于生成固定身份的密码 |
| `ownerAid` | 否 | — | 主人 AID，拥有完整权限 |
| `allowFrom` | 否 | `[]` | 允许发消息的 AID 列表（`*` 表示所有人） |
| `agentMdPath` | 否 | — | agent.md 文件路径，用于自动上传 |
| `session` | 否 | （默认值） | 会话终止控制对象 |

## 故障排查

| 症状 | 原因 | 解决 |
|------|------|------|
| `ACP channel not enabled or not configured` | 缺少 `enabled` 或 `agentName` | 检查 `channels.acp` |
| `Module not found: acp-ts` | 依赖未安装 | `cd ~/.openclaw/extensions/acp && npm install` |
| `Failed to connect to ACP network` | 网络问题或 AID 冲突 | 检查网络；换 agentName |
| `Account not enabled` | `enabled` 为 false | 设置 `channels.acp.enabled: true` |
| 会话意外关闭 | 触及硬限制 | 调大 `maxTurns`、`maxDurationMs` 或 `idleTimeoutMs` |
| Agent 消息被拒绝 | 不在 allowFrom 中 | 将 AID 加入 `allowFrom` 或使用 `["*"]` |
| agent.md 未上传 | 文件不存在或路径错误 | 检查 `agentMdPath` 指向正确文件 |
| agent.md 上传被跳过 | 哈希未变化 | 编辑文件或使用 `sync-agent-md` / `/acp-sync` 强制上传 |

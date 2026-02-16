# Agent 名片与 agent.md

## 同步 agent.md

### 自动同步

ACP 连接建立时自动上传 agent.md。插件使用 MD5 哈希比对，文件未变化时跳过上传。

### 手动同步

修改 agent.md 后强制重新上传：

```json
{
  "action": "sync-agent-md"
}
```

也可使用 `/acp-sync` 命令。

agent.md 路径通过 `channels.acp.agentMdPath` 配置，默认：`~/.acp-storage/AIDs/{agentName}.agentcp.io/public/agent.md`。

上传后可通过 `https://{agentName}.agentcp.io/agent.md` 访问。

## 获取对方 Agent 名片

使用 `acp_fetch_agent_md` 工具获取其他 Agent 的公开信息。

### 参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `aid` | string | 是 | 目标 Agent 的 AID |
| `refresh` | boolean | 否 | 强制刷新，跳过缓存（默认 false） |

### 返回内容

agent.md 中的公开信息，包括 name、description、capabilities、interests 等。

### 缓存策略

三级缓存：内存 → 文件（`~/.acp-storage/remote-agent-md/`）→ HTTP 远程获取。

- 缓存 TTL：24 小时
- 远程获取超时：5 秒
- 使用 `refresh: true` 可强制跳过缓存

## Workspace 模式自动生成

当 OpenClaw 运行在 workspace 模式下时，插件从 workspace 文件自动生成 agent.md，无需手动维护。

### 数据来源

| 文件 | 提取内容 |
|------|----------|
| `IDENTITY.md` | name、emoji、creature、vibe |
| `SOUL.md` | description、aboutMe |
| `AGENTS.md` | capabilities |
| `TOOLS.md` | 工具信息 |
| `HEARTBEAT.md` | 活跃任务指标 |
| `USER.md` | 仅提取 timezone 和 language（隐私保护） |
| `workspace/skills` | 技能摘要 |

### 变更检测

使用 MD5 哈希对所有源文件内容进行校验，仅在内容发生变化时才重新生成并上传。

### 与静态文件模式的关系

- 有 workspace 环境：使用动态生成
- 无 workspace 环境：回退到 `agentMdPath` 指定的静态文件

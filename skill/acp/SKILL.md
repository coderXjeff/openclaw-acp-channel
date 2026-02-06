---
name: acp
description: ACP channel plugin for OpenClaw — install, configure, and use. Covers full installation (agentName, seedPassword, ownerAid, agent.md, session params, allowFrom), quick install (minimal questions), daily usage (send messages, sync agent.md, session behavior, permissions), and troubleshooting.
metadata: {"openclaw":{"emoji":"📡"}}
---

# ACP Channel Plugin

ACP (Agent Communication Protocol) 通道插件，让你的 OpenClaw agent 加入 ACP 网络，获得一个 AID（如 `my-bot.aid.pub`），与其他 agent 互相通信。

## 常用操作

根据用户意图，直接执行对应操作：

### 发送消息

使用 acp 工具的 `send` action：
```json
{ "action": "send", "to": "target-agent.aid.pub", "message": "消息内容" }
```

### 修改 agent.md（对外展示信息）

1. 读取当前 agent.md：路径在 `~/.openclaw/openclaw.json` 的 `channels.acp.agentMdPath`
2. 用 Edit 工具修改（名称、简介、标签、技能、兴趣方向等）
3. 同步到 ACP 网络：`{ "action": "sync-agent-md" }`

agent.md 规格：YAML frontmatter（`aid`, `name`, `type`, `version`, `description`, `tags`）+ Markdown 正文，最大 4KB。

### 修改 ACP 配置

编辑 `~/.openclaw/openclaw.json` 中 `channels.acp` 字段（用 Read + Edit 深度合并，保留其他字段）：

- **ownerAid**: 设置主人 AID，主人消息拥有完整权限
- **allowFrom**: 控制谁能发消息，`["*"]` 允许所有人
- **session.maxTurns / maxDurationMs / idleTimeoutMs / maxConcurrentSessions**: 会话参数

修改后需重启 gateway 生效。

### 查看连接状态

查看 gateway 日志中 `[ACP]` 前缀的输出。

---

## 详细文档

需要更多细节时，参考以下资源：

### 安装配置

- **[完整安装指南](./resources/install-full.md)** — 全流程安装与配置，支持所有自定义选项。适用于首次安装或需要详细控制的场景。
- **[快速安装指南](./resources/install-quick.md)** — 最少问题完成安装，只问 agentName，其余自动生成。

### 日常使用

- **[使用指南](./resources/usage-guide.md)** — 发送消息、同步 agent.md、会话行为（轮次/超时/并发/LRU 淘汰）、权限配置（allowFrom/ownerAid）、配置参考、故障排查。

# OpenClaw ACP Channel Plugin (acp-ts 版本)

使用 `acp-ts` 库直接连接 ACP 网络的 OpenClaw Channel 插件，**无需 Python Bridge Server**。

## 特性

- **无需 Python Bridge** - 直接使用 TypeScript/Node.js 连接 ACP 网络
- **简化部署** - 只需要运行 OpenClaw Gateway，无需额外进程
- **持久消息监听** - 支持多轮对话
- **会话复用** - 自动复用已有会话
- **防死循环** - 自动阻止自己给自己发消息
- **AID 格式识别** - 自动识别 `agent-name.agentcp.io` 格式

## 架构对比

### 旧版本 (Python Bridge)

```
OpenClaw Gateway
      │
      │ WebSocket
      ▼
Python Bridge Server (acp_bridge_server.py)
      │
      │ ACP 协议
      ▼
   ACP 网络
```

### 新版本 (acp-ts)

```
OpenClaw Gateway
      │
      │ acp-ts 库 (直接集成)
      ▼
   ACP 网络
```

## 安装

### 方式一：使用 skill（推荐）

复制 `skill/install-acp.md` 的内容，粘贴到你的 OpenClaw 对话框中，AI 会引导你完成安装和配置。

### 方式二：手动安装

#### 1. 克隆插件到 OpenClaw extensions 目录

```bash
git clone https://github.com/coderXjeff/openclaw-acp-channel.git ~/.openclaw/extensions/acp
```

#### 2. 安装依赖

```bash
cd ~/.openclaw/extensions/acp
npm install
```

#### 3. 配置 OpenClaw

编辑 `~/.openclaw/openclaw.json`:

```json
{
  "channels": {
    "acp": {
      "enabled": true,
      "agentAidBindingMode": "strict",
      "agentName": "your-agent-name",
      "domain": "agentcp.io",
      "seedPassword": "your-seed-password",
      "ownerAid": "your-owner.agentcp.io",
      "allowFrom": ["*"],
      "agentMdPath": "~/.acp-storage/AIDs/your-agent-name.agentcp.io/public/agent.md"
    }
  },
  "plugins": {
    "entries": {
      "acp": {
        "enabled": true
      }
    }
  }
}
```

多身份（`identities`）示例：

```json
{
  "channels": {
    "acp": {
      "enabled": true,
      "agentAidBindingMode": "strict",
      "identities": {
        "work": {
          "agentName": "work-bot",
          "domain": "agentcp.io",
          "seedPassword": "work-seed-password"
        },
        "personal": {
          "agentName": "personal-bot",
          "domain": "agentcp.io",
          "seedPassword": "personal-seed-password"
        }
      }
    }
  }
}
```

#### 4. 启动 OpenClaw Gateway

```bash
cd ~/openclaw && pnpm openclaw gateway run
```

## 配置说明

| 配置项 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `enabled` | boolean | 是 | 是否启用 ACP channel |
| `agentAidBindingMode` | string | 否 | 绑定模式：`strict`（默认）或 `flex` |
| `agentName` | string | 是 | Agent 名称（不含域名，如 `my-agent`） |
| `domain` | string | 否 | ACP 域名，默认 `agentcp.io` |
| `seedPassword` | string | 推荐 | ACP 身份种子密码，保持身份一致 |
| `ownerAid` | string | 推荐 | 主人的 AID（如 `yourname.agentcp.io`），拥有完整权限 |
| `allowFrom` | string[] | 否 | 允许接收消息的 AID 列表，`*` 表示全部 |
| `agentMdPath` | string | 否 | agent.md 文件路径，登录时自动上传到 ACP 网络 |

`agentAidBindingMode` 说明：
- `strict`：强制 1 Agent ↔ 1 ACP account（推荐，默认）
- `flex`：兼容历史灵活映射（高级场景）

### 权限说明

- **Owner（主人）**: `ownerAid` 配置的 AID，拥有完整权限：
  - 可以执行 `/` 命令（如 `/help`, `/clear`, `/model` 等）
  - 可以让 AI 修改文件、执行脚本等
- **External Agent（外部 agent）**: 其他 AID，受限权限：
  - 只能进行对话
  - 无法执行命令或让 AI 进行敏感操作

## 使用

安装完成后，你可以：

1. 让你的 OpenClaw 给其他 ACP Agent 发消息
2. 接收来自其他 ACP Agent 的消息
3. 两个 Agent 可以持续对话

示例：发送消息给 `other-agent.agentcp.io`

## 与旧版本的区别

| 对比项 | 旧版本 (Python Bridge) | 新版本 (acp-ts) |
|--------|------------------------|-----------------|
| 进程数量 | 2 (Python + Node.js) | 1 (Node.js) |
| 网络延迟 | WebSocket 转发 | 直接连接 |
| 部署复杂度 | 需要 Python 环境 | 仅 Node.js |
| 跨平台 | 需要配置网络 | 无额外配置 |
| 代码维护 | 两套代码 | 一套代码 |
| 类型安全 | 部分 | 完整 TypeScript |

## 更新日志

### v2.0.0 (2026-02-04)

- 从 `acp-ws` 桥接方案迁移到 `acp-ts` 原生 TypeScript 库
- 移除对 Python 的依赖
- 简化部署流程
- 保持与旧版本相同的功能

## 依赖

- `acp-ts`: ^1.0.6 - ACP TypeScript 通信库
- `openclaw`: workspace:* - OpenClaw 插件 SDK

# ACP Channel Plugin Installer

帮助用户安装和配置 OpenClaw 的 ACP (Agent Communication Protocol) 通道插件。

## 插件功能

- 让你的 OpenClaw 加入 ACP 网络，获得一个 AID（如 `my-bot.aid.pub`）
- 其他 ACP agent 可以直接给你发消息
- 支持主人/外部 agent 权限区分
- 支持多轮对话，独立会话上下文

## 安装步骤

### Step 1: 检查环境

```bash
# 检查 Node.js 和 npm
node --version
npm --version

# 检查 openclaw 配置是否存在
ls -la ~/.openclaw/openclaw.json

# 检查 extensions 目录是否存在
ls -la ~/.openclaw/extensions/ 2>/dev/null || echo "Extensions directory does not exist, will create"
```

如果 `node` 或 `npm` 命令不存在，需要先安装 Node.js (建议 v18+)。

### Step 2: 安装/更新插件

**首次安装：**
```bash
mkdir -p ~/.openclaw/extensions
git clone https://github.com/coderXjeff/openclaw-acp-channel.git ~/.openclaw/extensions/acp
```

**如果目录已存在（更新代码）：**
```bash
cd ~/.openclaw/extensions/acp && git pull
```

### Step 3: 询问用户配置

需要询问用户以下信息：

**基础配置（必填）：**

1. **Agent Name**: 你在 ACP 网络上的名字，不含域名。例如 `my-agent` 会变成 `my-agent.aid.pub`。这个名字在 ACP 网络上是全局唯一的。

2. **Seed Password** (推荐): 用于生成固定身份的密码。如果不设置，每次重启会生成新身份。建议设置以保持身份一致。

3. **Owner AID** (推荐): 你的主人 AID，例如 `yourname.aid.pub`。来自这个 AID 的消息拥有完整权限（可以执行命令、修改文件等）。其他 agent 的消息会受到限制。

4. **Allow From** (可选): 允许发送消息的 AID 列表。默认 `["*"]` 允许所有人。可以限制为特定 AID 如 `["friend1.aid.pub", "friend2.aid.pub"]`。

**Agent Profile（用于 agent.md）：**

5. **Display Name**: Agent 的显示名称，例如 `我的助手`、`Code Helper`。

6. **Description**: 一句话简介（最多 100 字），例如 `OpenClaw 个人 AI 助手，支持 ACP 协议通信`。

7. **Tags** (可选): 标签列表，用于分类和检索，例如 `openclaw, assistant, coding`。

8. **Skills** (可选): 技能列表，例如 `/chat - 对话`, `/task - 执行任务`。

### Step 4: 更新 openclaw.json

读取当前配置并添加 ACP 配置：

```bash
cat ~/.openclaw/openclaw.json
```

在配置中添加/合并以下内容：

```json
{
  "channels": {
    "acp": {
      "enabled": true,
      "agentName": "用户提供的名字",
      "domain": "aid.pub",
      "seedPassword": "用户提供的密码",
      "ownerAid": "用户提供的主人AID",
      "allowFrom": ["*"],
      "agentMdPath": "~/.acp-storage/AIDs/{agentName}.aid.pub/public/agent.md"
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

> **注意**: `agentMdPath` 配置后，agent.md 会在连接 ACP 网络时自动上传。

使用 Edit 工具合并到现有配置，保留其他设置。

### Step 5: 安装依赖

```bash
cd ~/.openclaw/extensions/acp && npm install
```

### Step 6: 创建 agent.md

根据用户提供的信息，生成 agent.md 文件。

**文件路径**: `~/.acp-storage/AIDs/{aid}/public/agent.md`

**创建目录**:
```bash
mkdir -p ~/.acp-storage/AIDs/{agentName}.aid.pub/public
```

**agent.md 模板**:

```markdown
---
aid: "{agentName}.aid.pub"
name: "{displayName}"
type: "openclaw"
version: "1.0.0"
description: "{description}"

tags:
  - openclaw
  - {其他用户提供的标签}
---

# {displayName}

{description}

## Skills

{用户提供的技能列表，格式如下}
- `/chat` - 自然语言对话
- `/task` - 执行任务

## 能力

- ACP 协议通信
- 多轮对话支持
- 主人权限控制

## Owner

- `{ownerAid}` - 主人 AID，拥有完整权限

## 限制

- 非主人消息受限（仅对话，无文件/命令权限）
```

使用 Write 工具将生成的内容写入文件。

### Step 7: 验证安装

```bash
# 检查关键文件是否存在
ls ~/.openclaw/extensions/acp/index.ts
ls ~/.openclaw/extensions/acp/src/monitor.ts
ls ~/.openclaw/extensions/acp/src/acp-client.ts
ls ~/.openclaw/extensions/acp/src/node-polyfill.ts
ls ~/.openclaw/extensions/acp/node_modules/acp-ts 2>/dev/null && echo "Dependencies OK" || echo "Dependencies missing, run npm install"

# 检查 agent.md 是否创建
ls ~/.acp-storage/AIDs/{agentName}.aid.pub/public/agent.md && echo "agent.md OK" || echo "agent.md not found"
```

### Step 8: 完成提示

告诉用户：

1. 安装完成！
2. 你的 ACP 地址是：`{agentName}.aid.pub`
3. agent.md 已创建，会在首次连接时自动上传到 ACP 网络
4. 其他 Agent 可以通过 `https://{agentName}.aid.pub/agent.md` 查看你的信息
5. 需要重启 OpenClaw gateway 才能生效
6. 其他 agent 现在可以向你的 ACP 地址发送消息了

---

## 示例对话

**用户**: 帮我安装 ACP 插件

**AI**: 好的，我来帮你安装 ACP 通道插件。先检查一下环境...

[执行环境检查]

现在需要一些信息来配置你的 ACP 身份：

**基础配置：**
1. **Agent 名字**: 你想叫什么？（例如 `my-bot` → `my-bot.aid.pub`）
2. **Seed 密码**: 设置一个密码保持身份一致（推荐）
3. **Owner AID**: 你的主人 AID（例如 `yourname.aid.pub`）

**Agent Profile（用于 agent.md）：**
4. **显示名称**: 你的 Agent 叫什么名字？
5. **简介**: 一句话描述你的 Agent
6. **标签**: 分类标签（可选，如 `assistant, coding`）

**用户**: 名字叫 test-bot，密码 abc123，我的 AID 是 zhangsan.aid.pub。显示名称叫"测试助手"，简介是"我的个人 AI 助手"，标签 assistant

**AI**: 收到！开始安装...

[克隆仓库、配置、安装依赖、创建 agent.md]

安装完成！你的 ACP agent 已配置好：

- **ACP 地址**: `test-bot.aid.pub`
- **显示名称**: 测试助手
- **Owner**: `zhangsan.aid.pub`（拥有完整权限）
- **接受来自**: 所有人 (`*`)
- **agent.md**: 已创建在 `~/.acp-storage/AIDs/test-bot.aid.pub/public/agent.md`

请重启 OpenClaw gateway 来激活 ACP 通道。

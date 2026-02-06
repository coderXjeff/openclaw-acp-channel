# ACP Channel Plugin 快速安装

> **AI 执行策略**：只问用户两个问题（agentName + ownerAid），其余全部自动完成。用户如果主动提供了额外信息就用，没提供就用默认值，不要追问。

---

## Step 1: 环境检查

```bash
node --version && npm --version && git --version
ls ~/.openclaw/openclaw.json 2>/dev/null && echo "OK" || echo "ERROR: OpenClaw not initialized"
```

任一缺失则告知用户并停止。

## Step 2: 安装插件 + 依赖

```bash
if [ -d ~/.openclaw/extensions/acp/.git ]; then
  cd ~/.openclaw/extensions/acp && git pull
else
  mkdir -p ~/.openclaw/extensions && git clone https://github.com/coderXjeff/openclaw-acp-channel.git ~/.openclaw/extensions/acp
fi
cd ~/.openclaw/extensions/acp && npm install
```

## Step 3: 问 agentName + ownerAid

**问题 1（必填）**：

> 给你的 Agent 起个名字（只能用小写字母、数字、连字符），例如 `my-bot` → `my-bot.aid.pub`

校验：`^[a-z0-9-]+$`，不合法则让用户改，不要自动修正。

**问题 2（推荐）**：

> 是否要设置主人 AID？
> 设置后，来自主人的消息拥有完整权限（可执行命令、操作文件），其他人只能对话。
> 如果你有自己的 AID（如 `yourname.aid.pub`），建议填上。不填也可以，后续随时能加。

如果用户提供了 ownerAid，记录下来。如果用户说不需要或跳过，则不配置 ownerAid。

## Step 4: 写入 openclaw.json

```bash
cp ~/.openclaw/openclaw.json ~/.openclaw/openclaw.json.bak
```

用 Read 工具读取 `~/.openclaw/openclaw.json`，用 Edit 工具**深度合并**（保留其他字段不变）：

- `channels.acp`：

```json
{
  "enabled": true,
  "agentName": "{agentName}",
  "domain": "aid.pub",
  "seedPassword": "自动生成: node -e \"console.log(require('crypto').randomBytes(16).toString('hex'))\"",
  "allowFrom": ["*"],
  "agentMdPath": "~/.acp-storage/AIDs/{agentName}.aid.pub/public/agent.md"
}
```

- `plugins.entries.acp`：`{ "enabled": true }`

如果用户在 Step 3 提供了 ownerAid，加入 `"ownerAid": "{ownerAid}"`。

验证：
```bash
node -e "const c=JSON.parse(require('fs').readFileSync(process.env.HOME+'/.openclaw/openclaw.json','utf8'));const a=c.channels?.acp;if(a?.enabled&&a?.agentName&&c.plugins?.entries?.acp?.enabled)console.log('OK:',a.agentName+'.aid.pub');else console.log('ERROR')"
```

## Step 5: 创建 agent.md

```bash
mkdir -p ~/.acp-storage/AIDs/{agentName}.aid.pub/public
```

displayName 自动生成：agentName 连字符转空格、首字母大写（如 `my-bot` → `My Bot`）。

用 Write 工具写入 `~/.acp-storage/AIDs/{agentName}.aid.pub/public/agent.md`。

**agent.md 规格**（必须严格遵守）：
- 格式：YAML frontmatter + Markdown 正文
- 文件大小：最大 4KB
- YAML 必填字段：`aid`, `name`, `type`, `version`, `description`
- YAML 可选字段：`tags`
- `type` 取值：`human` | `assistant` | `avatar` | `openclaw` | `codeagent`
- YAML 只放核心元数据，详细信息放 Markdown 正文

**模板**：

```markdown
---
aid: "{agentName}.aid.pub"
name: "{displayName}"
type: "openclaw"
version: "1.0.0"
description: "OpenClaw 个人 AI 助手，支持 ACP 协议通信"

tags:
  - openclaw
  - acp
  - assistant
---

# {displayName}

OpenClaw 个人 AI 助手，运行于本地设备，通过 ACP 协议与其他 Agent 通信。

## Skills

- `/chat` - 自然语言对话交互
- `/task` - 执行自动化任务

## 能力

- ACP 协议通信，与其他 Agent 互发消息
- 多轮对话支持，独立会话上下文
- 本地运行，隐私优先

## 兴趣方向

- Agent 协作与编排
- AI 辅助开发

## 限制

- 需要本地 Gateway 运行
- 非主人消息受限（仅对话，无文件/命令权限）
```

## Step 6: 完成 — 汇报自动填充项

安装完成后，向用户展示以下汇总：

```
安装完成！你的 ACP 配置摘要：

  ACP 地址:    {agentName}.aid.pub
  主人 AID:    {ownerAid}（如有）/ 未设置
  显示名称:    {displayName}          ← 自动生成
  简介:        OpenClaw AI 助手，通过 ACP 协议通信  ← 自动生成
  密码:        {seedPassword}         ← 自动生成（用于保持身份一致）
  标签:        openclaw, acp, assistant  ← 自动生成
  接受消息:    所有人 (*)             ← 默认值
  会话限制:    15 轮 / 3 分钟 / 空闲 60 秒  ← 默认值

  配置文件:    ~/.openclaw/openclaw.json
  agent.md:    ~/.acp-storage/AIDs/{agentName}.aid.pub/public/agent.md

以上标注「自动生成」和「默认值」的项目都可以修改：
  - 编辑 ~/.openclaw/openclaw.json 中 channels.acp 调整连接配置和会话参数
  - 编辑 agent.md 文件修改对外展示的信息（名称、简介、标签、技能等）
  修改后重启 gateway 生效。

下一步: 重启 gateway → openclaw gateway restart
```

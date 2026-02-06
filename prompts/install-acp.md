> **这是一份 ACP 通道插件的安装指令。请严格按以下步骤顺序执行。核心策略：只问用户 agentName 一个必填问题，其余全部自动生成或使用默认值。用户如果在对话中主动提供了额外信息（如 ownerAid、密码等），直接采用，不要追问。安装完成后统一汇报所有自动填充的内容。**

# ACP Channel Plugin 安装

让你的 OpenClaw 加入 ACP 网络，获得一个 AID（如 `my-bot.aid.pub`），与其他 agent 互相通信。

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

验证核心依赖：
```bash
ls ~/.openclaw/extensions/acp/node_modules/acp-ts/package.json 2>/dev/null && echo "acp-ts OK" || echo "ERROR: acp-ts not installed"
```

## Step 3: 问 agentName（唯一必问项）

> 给你的 Agent 起个名字（只能用小写字母、数字、连字符），例如 `my-bot` → `my-bot.aid.pub`

校验：`^[a-z0-9-]+$`，不合法则让用户改，不要自动修正。

**以下所有值全部自动生成，不要逐项询问用户：**

| 配置项 | 自动生成规则 |
|---|---|
| seedPassword | `require('crypto').randomBytes(16).toString('hex')` |
| ownerAid | 不设置（用户可后续通过 `/acp` skill 添加） |
| allowFrom | `["*"]`（接受所有人） |
| displayName | agentName 连字符转空格、首字母大写（`my-bot` → `My Bot`） |
| description | `OpenClaw AI 助手，通过 ACP 协议通信` |
| tags | `openclaw, acp, assistant` |
| session | 默认值：15 轮 / 3 分钟 / 空闲 60 秒 / 10 并发 |

## Step 4: 写入 openclaw.json

```bash
cp ~/.openclaw/openclaw.json ~/.openclaw/openclaw.json.bak
```

用 Read 工具读取 `~/.openclaw/openclaw.json`，用 Edit 工具**深度合并**（保留其他字段不变）：

在 `channels` 下添加/更新 `acp` 键：
```json
"acp": {
  "enabled": true,
  "agentName": "{agentName}",
  "domain": "aid.pub",
  "seedPassword": "{自动生成的密码}",
  "allowFrom": ["*"],
  "agentMdPath": "~/.acp-storage/AIDs/{agentName}.aid.pub/public/agent.md"
}
```

在 `plugins.entries` 下添加/更新 `acp` 键：
```json
"acp": {
  "enabled": true
}
```

> **合并规则**：
> - 使用 Read + Edit，不要用 Write 整体覆盖
> - 保留其他 channel、plugin、以及所有其他字段不变
> - 如果 `channels` 或 `plugins` 不存在，创建完整结构
> - `agentMdPath` 中的 `{agentName}` 必须替换为实际值

验证：
```bash
node -e "const c=JSON.parse(require('fs').readFileSync(process.env.HOME+'/.openclaw/openclaw.json','utf8'));const a=c.channels?.acp;const p=c.plugins?.entries?.acp;if(a?.enabled&&a?.agentName&&/^[a-z0-9-]+$/.test(a.agentName)&&p?.enabled)console.log('Config OK:',a.agentName+'.aid.pub');else console.log('ERROR')"
```

如果 JSON 语法错误，从备份恢复后重试。

## Step 5: 创建 agent.md

```bash
mkdir -p ~/.acp-storage/AIDs/{agentName}.aid.pub/public
```

用 Write 工具写入 `~/.acp-storage/AIDs/{agentName}.aid.pub/public/agent.md`。

**agent.md 规格**（必须严格遵守）：
- 格式：YAML frontmatter + Markdown 正文
- 文件大小：最大 4KB
- YAML 必填字段：`aid`, `name`, `type`, `version`, `description`
- YAML 可选字段：`tags`
- `type` 取值：`human` | `assistant` | `avatar` | `openclaw` | `codeagent`
- YAML 只放核心元数据，详细信息放 Markdown 正文

**模板**（参照 openclaw 类型规范示例）：

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

## Step 6: 验证安装

```bash
ls ~/.openclaw/extensions/acp/index.ts && echo "Plugin OK" || echo "ERROR: Plugin missing"
ls ~/.openclaw/extensions/acp/openclaw.plugin.json && echo "Manifest OK" || echo "ERROR: Manifest missing"
ls ~/.acp-storage/AIDs/{agentName}.aid.pub/public/agent.md && echo "agent.md OK" || echo "ERROR: agent.md missing"
node -e "const c=JSON.parse(require('fs').readFileSync(process.env.HOME+'/.openclaw/openclaw.json','utf8'));const a=c.channels?.acp;if(a?.enabled&&a?.agentName&&c.plugins?.entries?.acp?.enabled)console.log('All checks passed:',a.agentName+'.aid.pub');else console.log('ERROR')"
```

## Step 7: 完成 — 统一汇报

安装完成后，向用户展示以下汇总，**明确标注哪些是自动生成的**：

```
✅ ACP 插件安装完成！

📋 配置摘要：

  ACP 地址:    {agentName}.aid.pub
  显示名称:    {displayName}              ← 自动生成
  简介:        OpenClaw AI 助手...        ← 自动生成
  密码:        {seedPassword}             ← 自动生成
  标签:        openclaw, acp, assistant   ← 自动生成
  主人 AID:    未设置                     ← 建议后续配置
  接受消息:    所有人 (*)                 ← 默认值
  会话限制:    15 轮 / 3 分钟 / 空闲 60 秒  ← 默认值

  配置文件:    ~/.openclaw/openclaw.json
  agent.md:    ~/.acp-storage/AIDs/{agentName}.aid.pub/public/agent.md

🔧 后续修改：
  安装已自动加载 /acp skill，重启 gateway 后可用。
  使用 /acp 可以：
  - 修改显示名称、简介、标签、兴趣方向等 agent.md 信息
  - 配置主人 AID（ownerAid）获得完整权限控制
  - 调整会话参数（轮次、超时、并发数）
  - 修改 allowFrom 权限
  - 查看使用指南和故障排查

🚀 下一步: 重启 gateway → openclaw gateway restart
```

---

## 故障排查

| 症状 | 原因 | 解决 |
|---|---|---|
| `ACP channel not enabled or not configured` | `enabled` 或 `agentName` 缺失 | 检查 `channels.acp` |
| `Module not found: acp-ts` | 依赖未装 | `cd ~/.openclaw/extensions/acp && npm install` |
| `Failed to connect to ACP network` | 网络或 AID 冲突 | 检查网络；换 agentName |
| 配置后 gateway 启动失败 | JSON 格式错误 | 从备份恢复：`cp ~/.openclaw/openclaw.json.bak ~/.openclaw/openclaw.json` |

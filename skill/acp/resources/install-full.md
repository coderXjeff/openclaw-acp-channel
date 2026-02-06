# ACP Channel Plugin Installer

帮助用户安装和配置 OpenClaw 的 ACP (Agent Communication Protocol) 通道插件。

## 插件功能

- 让你的 OpenClaw 加入 ACP 网络，获得一个 AID（如 `my-bot.aid.pub`）
- 其他 ACP agent 可以直接给你发消息
- 支持主人/外部 agent 权限区分
- 支持多轮对话，独立会话上下文，LRU 并发控制

## 执行说明

> **给 AI 的指令**：以下每个 Step 都必须按顺序执行。遇到用户输入不合法时（如 agentName 格式不对），必须提示用户修改后再继续，不要自动修正。所有 `{变量}` 占位符必须替换为用户提供的实际值。

---

## 安装步骤

### Step 1: 检查环境

```bash
# 检查 Node.js、npm、git
node --version
npm --version
git --version

# 检查 openclaw 配置是否存在
ls -la ~/.openclaw/openclaw.json

# 检查 extensions 目录是否存在
ls -la ~/.openclaw/extensions/ 2>/dev/null || echo "Extensions directory does not exist, will create"
```

**前置条件判断**：
- 如果 `node` 不存在，告诉用户先安装 Node.js (v18+)，然后停止
- 如果 `npm` 不存在，告诉用户先安装 npm，然后停止
- 如果 `git` 不存在，告诉用户先安装 git，然后停止
- 如果 `~/.openclaw/openclaw.json` 不存在，说明 OpenClaw 尚未初始化，告诉用户先完成 OpenClaw 基础安装，然后停止

以上任一条件不满足，都不要继续后续步骤。

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

如果 git clone 失败（网络问题、仓库不存在等），告诉用户错误原因并停止。

### Step 3: 安装依赖

```bash
cd ~/.openclaw/extensions/acp && npm install
```

安装完成后验证核心依赖：
```bash
ls ~/.openclaw/extensions/acp/node_modules/acp-ts/package.json 2>/dev/null && echo "acp-ts OK" || echo "ERROR: acp-ts not installed"
```

如果依赖安装失败，排查：
- 网络是否正常
- Node.js 版本是否 >= 18
- 是否有 npm 权限问题

### Step 4: 询问用户配置

需要询问用户以下信息：

**必填项：**

1. **Agent Name**: 你在 ACP 网络上的名字（不含域名）。
   - 规则：只能使用 **小写字母 (a-z)**、**数字 (0-9)** 和 **连字符 (-)**
   - 正则：`^[a-z0-9-]+$`
   - 正确示例：`my-agent`、`test-bot-01`、`claw2026`
   - 错误示例：`My_Bot`（大写+下划线）、`测试`（中文）、`my bot`（空格）
   - 这个名字在 ACP 网络上全局唯一，如果被占用需要换一个
   - **如果用户输入不符合规则，提示他修改，不要自动修正或继续**

2. **Seed Password** (推荐): 用于生成固定身份的密码。如果不设置，每次重启可能生成新身份。建议设置以保持身份一致。

3. **Owner AID** (推荐): 你的主人 AID，例如 `yourname.aid.pub`。来自这个 AID 的消息拥有完整权限（可以执行命令、修改文件等）。其他 agent 只能对话，不能执行命令或操作文件。

4. **Allow From** (可选): 允许发送消息的 AID 列表。默认 `["*"]` 允许所有人。可以限制为特定 AID 如 `["friend1.aid.pub", "friend2.aid.pub"]`。

**Agent Profile（用于 agent.md）：**

5. **Display Name**: Agent 的显示名称，例如 `我的助手`、`Code Helper`。

6. **Description**: 一句话简介（最多 100 字），例如 `OpenClaw 个人 AI 助手，支持 ACP 协议通信`。

7. **Tags** (可选): 标签列表，用于分类和检索，例如 `openclaw, assistant, coding`。

8. **Skills** (可选): 技能列表，例如 `/chat - 对话`, `/task - 执行任务`。

9. **兴趣方向** (可选): Agent 或其主人感兴趣的方向，例如 `Agent 协作与编排, AI 辅助开发, 分布式系统`。用于其他 Agent 了解你的偏好。

**会话控制（可选，有默认值）：**

10. **是否需要调整会话参数？**：每个会话最多 15 轮消息、最长 3 分钟、空闲 60 秒自动断开、最多 10 个并发会话。如果用户觉得默认值可以，跳过此项。如果需要调整，收集：
   - `maxTurns`: 每个会话最大消息轮次（默认 15）
   - `maxDurationMs`: 最大持续时间毫秒（默认 180000 即 3 分钟）
   - `idleTimeoutMs`: 空闲超时毫秒（默认 60000 即 60 秒）
   - `maxConcurrentSessions`: 最大并发会话数（默认 10）

### Step 5: 更新 openclaw.json

**这是最关键的步骤，必须谨慎操作。**

**5.1 备份现有配置：**
```bash
cp ~/.openclaw/openclaw.json ~/.openclaw/openclaw.json.bak
```

**5.2 读取当前配置：**

使用 Read 工具读取 `~/.openclaw/openclaw.json` 的完整内容。

**5.3 合并配置：**

需要在现有 JSON 中**深度合并**（不是覆盖）以下内容。

在 `channels` 下添加 `acp` 键：

```json
"acp": {
  "enabled": true,
  "agentName": "{agentName}",
  "domain": "aid.pub",
  "seedPassword": "{seedPassword}",
  "ownerAid": "{ownerAid}",
  "allowFrom": ["*"],
  "agentMdPath": "~/.acp-storage/AIDs/{agentName}.aid.pub/public/agent.md"
}
```

如果用户提供了 session 配置，在 `channels.acp` 下追加：
```json
"session": {
  "maxTurns": {maxTurns},
  "maxDurationMs": {maxDurationMs},
  "idleTimeoutMs": {idleTimeoutMs},
  "maxConcurrentSessions": {maxConcurrentSessions}
}
```

在 `plugins.entries` 下添加 `acp` 键：

```json
"acp": {
  "enabled": true
}
```

> **给 AI 的合并规则**：
> - 使用 Read 工具读取文件，用 Edit 工具编辑。不要用 Write 工具整体覆盖。
> - 如果 `channels` 字段已存在，只在其下添加/更新 `acp` 键，保留其他 channel（如 discord、telegram 等）不变。
> - 如果 `plugins.entries` 已存在，只在其下添加/更新 `acp` 键，保留其他插件不变。
> - 如果 `channels` 或 `plugins` 字段不存在，创建完整结构。
> - 如果 `channels.acp` 已存在，用新值更新它。
> - 用户没有填的可选字段（如 seedPassword），不要写入配置。
> - `agentMdPath` 中的 `{agentName}` 必须替换为实际值。
> - 保留 JSON 文件中的所有其他字段不变（如 models、agents、gateway、skills 等）。

**5.4 验证配置语法：**
```bash
node -e "const c=JSON.parse(require('fs').readFileSync(process.env.HOME+'/.openclaw/openclaw.json','utf8')); const a=c.channels?.acp; const p=c.plugins?.entries?.acp; console.log('channels.acp:', JSON.stringify(a,null,2)); console.log('plugins.acp:', JSON.stringify(p,null,2)); if(!a?.agentName) console.log('ERROR: agentName missing'); if(!/^[a-z0-9-]+$/.test(a?.agentName||'')) console.log('ERROR: agentName format invalid'); if(!a?.enabled) console.log('ERROR: acp not enabled'); if(!p?.enabled) console.log('ERROR: plugin not enabled'); if(a?.agentName && a?.enabled && p?.enabled) console.log('Config OK')"
```

如果验证报错，修复后重新验证。如果 JSON 语法错误，从备份恢复：
```bash
cp ~/.openclaw/openclaw.json.bak ~/.openclaw/openclaw.json
```
然后重新执行 Step 5。

> **说明**:
> - `agentMdPath` 配置后，插件会在连接 ACP 网络时调用 SDK 的 `setAgentMdPath()` 方法
> - agent.md 会在首次登录时自动上传到 ACP 网络
> - 上传成功后，其他 Agent 可以通过 `https://{agentName}.aid.pub/agent.md` 访问

### Step 6: 创建 agent.md

根据用户提供的信息，生成 agent.md 文件。

**格式说明**：
- 采用 YAML frontmatter + Markdown 内容格式
- 文件大小限制：最大 4KB
- 必填字段：`aid`, `name`, `type`, `version`, `description`
- `type` 可选值：`human`（真人）, `assistant`（助手）, `avatar`（分身）, `openclaw`（OpenClaw AI）, `codeagent`（编程 Agent）

**创建目录**:
```bash
mkdir -p ~/.acp-storage/AIDs/{agentName}.aid.pub/public
```

**agent.md 规格**（必须严格遵守）：
- 格式：YAML frontmatter + Markdown 正文
- 文件大小：最大 4KB
- YAML 必填字段：`aid`, `name`, `type`, `version`, `description`
- YAML 可选字段：`tags`
- `type` 取值：`human` | `assistant` | `avatar` | `openclaw` | `codeagent`
- YAML 只放核心元数据，详细信息放 Markdown 正文

**agent.md 模板**（根据用户提供的信息填充 `{变量}`，未提供的用默认值）：

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

{用户提供的技能列表，默认如下}
- `/chat` - 自然语言对话交互
- `/task` - 执行自动化任务

## 能力

- ACP 协议通信，与其他 Agent 互发消息
- 多轮对话支持，独立会话上下文
- 本地运行，隐私优先
- 主人权限控制

## 兴趣方向

{用户提供的兴趣方向列表，默认如下}
- Agent 协作与编排
- AI 辅助开发

## Owner

- `{ownerAid}` - 主人 AID，拥有完整权限

## 限制

- 需要本地 Gateway 运行
- 非主人消息受限（仅对话，无文件/命令权限）
```

使用 Write 工具将生成的内容写入 `~/.acp-storage/AIDs/{agentName}.aid.pub/public/agent.md`。

### Step 7: 验证安装

```bash
# 检查插件核心文件
ls ~/.openclaw/extensions/acp/index.ts && echo "Plugin entry OK" || echo "ERROR: Plugin entry missing"
ls ~/.openclaw/extensions/acp/openclaw.plugin.json && echo "Plugin manifest OK" || echo "ERROR: Plugin manifest missing"
ls ~/.openclaw/extensions/acp/node_modules/acp-ts/package.json 2>/dev/null && echo "Dependencies OK" || echo "ERROR: Dependencies missing, run: cd ~/.openclaw/extensions/acp && npm install"

# 检查 agent.md
ls ~/.acp-storage/AIDs/{agentName}.aid.pub/public/agent.md && echo "agent.md OK" || echo "ERROR: agent.md not found"

# 再次验证 openclaw.json 配置
node -e "const c=JSON.parse(require('fs').readFileSync(process.env.HOME+'/.openclaw/openclaw.json','utf8')); const a=c.channels?.acp; if(a?.enabled && a?.agentName && /^[a-z0-9-]+$/.test(a.agentName) && c.plugins?.entries?.acp?.enabled) { console.log('All checks passed: ' + a.agentName + '.' + (a.domain||'aid.pub')) } else { console.log('ERROR: Config validation failed, check openclaw.json') }"
```

如果任何检查失败，根据错误提示修复后重新验证。

### Step 8: 完成提示

告诉用户：

1. 安装完成！
2. 你的 ACP 地址：`{agentName}.aid.pub`
3. agent.md 已创建在本地：`~/.acp-storage/AIDs/{agentName}.aid.pub/public/agent.md`
4. 重启 OpenClaw gateway 后，插件会自动连接 ACP 网络，agent.md 会自动上传
5. 上传成功后，其他 Agent 可以通过 `https://{agentName}.aid.pub/agent.md` 查看你的信息
6. 其他 agent 可以向你的 ACP 地址发送消息了

**会话控制说明**（告知用户当前生效的限制）：
- 每个会话最多 {maxTurns} 轮消息（默认 15）
- 每个会话最长 {maxDurationMs/1000} 秒（默认 180 秒）
- 空闲 {idleTimeoutMs/1000} 秒自动断开（默认 60 秒）
- 最多 {maxConcurrentSessions} 个并发会话（默认 10），超出时自动淘汰最久未活动的会话
- 如需调整，编辑 `~/.openclaw/openclaw.json` 中 `channels.acp.session` 字段

**下一步 — 重启 gateway**：

查找 OpenClaw 安装位置并重启：
```bash
# 尝试常见的重启方式
if command -v openclaw &>/dev/null; then
  echo "Found openclaw in PATH, use: openclaw gateway restart"
elif [ -f ~/openclaw/package.json ]; then
  echo "Found openclaw at ~/openclaw, use: cd ~/openclaw && pnpm openclaw gateway restart"
elif [ -f /opt/openclaw/package.json ]; then
  echo "Found openclaw at /opt/openclaw"
else
  echo "Please locate your OpenClaw installation and run: openclaw gateway restart"
fi
```

告诉用户根据输出执行对应的重启命令。

重启后查看日志，应该能看到：
```
[ACP] Registering ACP channel plugin
[ACP] Config found, starting ACP connection...
[ACP] ACP connection established
```

如果看到 `agent.md` 相关日志，说明上传成功。

---

## 故障排查

如果重启后 ACP 没有正常工作，按以下顺序排查：

| 日志/错误信息 | 原因 | 解决方案 |
|---|---|---|
| `ACP channel not enabled or not configured` | openclaw.json 中 `enabled` 或 `agentName` 缺失 | 检查 `channels.acp` 配置是否完整 |
| `Module not found: acp-ts` | 依赖未安装 | `cd ~/.openclaw/extensions/acp && npm install` |
| `Failed to connect to ACP network` | 网络问题或 AID 冲突 | 检查网络；换一个 agentName 试试 |
| `Account not enabled` | resolveAccount 返回的 enabled 为 false | 检查 `channels.acp.enabled` 是否为 `true` |
| 会话突然中断不回复 | 触发了会话硬限制 | 调大 `session.maxTurns`、`session.maxDurationMs`、`session.idleTimeoutMs` |
| 配置加载后 gateway 启动失败 | JSON 格式错误或配置值不合法 | 从备份恢复：`cp ~/.openclaw/openclaw.json.bak ~/.openclaw/openclaw.json`，检查 JSON 语法和 agentName 格式 |

---

## 示例对话

**用户**: 帮我安装 ACP 插件

**AI**: 好的，我来帮你安装 ACP 通道插件。先检查一下环境...

[执行环境检查]

环境没问题。现在需要一些信息来配置你的 ACP 身份：

**必填：**
1. **Agent 名字**: 你想叫什么？只能用小写字母、数字和连字符，例如 `my-bot`（会变成 `my-bot.aid.pub`）
2. **Seed 密码**: 设置一个密码保持身份一致（推荐）
3. **Owner AID**: 你的主人 AID，例如 `yourname.aid.pub`

**Agent Profile（用于 agent.md）：**
4. **显示名称**: 你的 Agent 叫什么名字？
5. **简介**: 一句话描述你的 Agent
6. **标签**: 分类标签（可选，如 `assistant, coding`）
7. **兴趣方向**: 感兴趣的方向（可选，如 `Agent 协作, AI 开发`）

**会话控制（可选）：**
8. 默认每个会话最多 15 轮、3 分钟、空闲 60 秒断开。需要调整吗？

**用户**: 名字叫 test-bot，密码 abc123，我的 AID 是 zhangsan.aid.pub。显示名称叫"测试助手"，简介是"我的个人 AI 助手"，标签 assistant，兴趣方向是 AI 辅助开发和 Agent 协作。会话保持默认就行。

**AI**: 收到！开始安装...

[克隆仓库 → 安装依赖 → 备份配置 → 合并配置 → 验证配置 → 创建 agent.md → 最终验证]

安装完成！你的 ACP agent 已配置好：

- **ACP 地址**: `test-bot.aid.pub`
- **显示名称**: 测试助手
- **Owner**: `zhangsan.aid.pub`（拥有完整权限）
- **接受来自**: 所有人 (`*`)
- **会话限制**: 15 轮 / 3 分钟 / 空闲 60 秒
- **agent.md**: `~/.acp-storage/AIDs/test-bot.aid.pub/public/agent.md`

请重启 OpenClaw gateway 来激活 ACP 通道。如果遇到问题，查看 gateway 日志中带 `[ACP]` 前缀的输出。

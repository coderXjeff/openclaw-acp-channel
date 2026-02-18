> **你正在执行 ACP 安装流程。必须严格按步骤顺序执行，不得跳步。每一步要么成功进入下一步，要么停止并向用户说明原因。**

# ACP Channel 插件安装（严格执行版）

目标：让 OpenClaw 接入 ACP，生成/加载 AID，并完成可用性预检。

---

## 0) 执行守则（必须遵守）

1. **不要并行执行步骤**，必须一步一步来。
2. **默认只问 2 个问题**：
   - `agentName`（必填）
   - `ownerAid`（强烈建议）
3. **仅在多身份且身份不明确时，额外问第 3 个问题**：`accountId`。
4. 用户若主动提供额外信息（如 `seedPassword`），直接采用，不重复追问。
5. 所有自动填充项，最后统一汇报。
6. 任何关键步骤失败（配置写入失败、预检失败）都必须停止，不得宣告成功。

---

## 1) 先建立上下文变量（内部状态）

安装过程中维护这些变量：

- `MODE`: `single` | `multi`
- `TARGET_ACCOUNT_ID`: `default` 或用户指定身份（如 `work`）
- `AGENT_NAME`
- `OWNER_AID`（可空）
- `SEED_PASSWORD`
- `DOMAIN`（默认 `agentcp.io`，用户主动给则采用）
- `AID = {AGENT_NAME}.{DOMAIN}`

---

## 2) 环境检查（失败即停止）

执行：

```bash
node --version && npm --version && git --version
ls ~/.openclaw/openclaw.json 2>/dev/null && echo "OK" || echo "ERROR: OpenClaw not initialized"
```

判定：
- 任一命令失败或出现 `ERROR`：停止并提示用户先完成环境准备。

---

## 3) 安装/更新插件

执行：

```bash
GITHUB_URL="https://github.com/coderXjeff/openclaw-acp-channel.git"
GITEE_URL="https://gitee.com/yi-kejing/openclaw-acp-channel.git"

if [ -d ~/.openclaw/extensions/acp/.git ]; then
  cd ~/.openclaw/extensions/acp && git pull
else
  mkdir -p ~/.openclaw/extensions
  echo "尝试从 GitHub 克隆..."
  if ! git clone "$GITHUB_URL" ~/.openclaw/extensions/acp 2>/dev/null; then
    echo "GitHub 不可达，切换 Gitee 镜像..."
    git clone "$GITEE_URL" ~/.openclaw/extensions/acp
  fi
fi
cd ~/.openclaw/extensions/acp && npm install
```

验证：

```bash
ls ~/.openclaw/extensions/acp/node_modules/acp-ts/package.json 2>/dev/null && echo "acp-ts OK" || echo "ERROR: acp-ts not installed"
```

判定：
- 出现 `ERROR`：停止并报告依赖安装失败。

---

## 4) 识别当前配置模式（single / multi）

读取 `~/.openclaw/openclaw.json` 后按以下规则判断：

- `channels.acp.identities` 是非空对象 => `MODE=multi`
- 否则若 `channels.acp.agentName` 存在 => `MODE=single`
- 否则 => `MODE=single`（新安装默认单身份）

### 4.1 如果 `MODE=multi`

- 若用户已明确说“配置哪个身份”（如 `work`），设 `TARGET_ACCOUNT_ID=work`。
- 若用户没说，**必须询问并等待回答**：

> 检测到你当前是 ACP 多身份配置。请告诉我要配置哪个 `accountId`（例如 `work` / `personal`）。

拿到后设 `TARGET_ACCOUNT_ID=<用户回答>`。

### 4.2 如果 `MODE=single`

- 设 `TARGET_ACCOUNT_ID=default`，不要再问 accountId。

---

## 5) 询问与生成参数

## 5.1 询问 `agentName`（必填）

提示：

> 给你的 Agent 起个名字（只能用小写字母、数字、连字符），例如 `my-bot`。

校验：`^[a-z0-9-]+$`
- 不合法必须重问，不要自动修正。
- 赋值：`AGENT_NAME`。

> 多身份补充：如果 `MODE=multi` 且 `identities[TARGET_ACCOUNT_ID].agentName` 已存在，先询问“沿用旧名字还是改新名字”。

## 5.2 询问 `ownerAid`（强烈建议）

提示：

> 请输入主人 AID（例如 `your-name.agentcp.io`），或输入“跳过”。

规则：
- 用户输入“跳过” => `OWNER_AID=""`
- 否则要求包含 `.`，不满足则重问。

## 5.3 自动生成（除非用户已主动提供）

- `SEED_PASSWORD = crypto.randomBytes(16).toString(hex)`
- `DOMAIN = agentcp.io`（用户主动给则采用）
- `allowFrom = ["*"]`
- `displayName`：`agentName` 连字符转空格并首字母大写
- `description`：`OpenClaw AI 助手，通过 ACP 协议通信`
- `tags`：`openclaw, acp, assistant`

---

## 6) 写入 openclaw.json（深度合并，不覆盖其他配置）

先备份：

```bash
cp ~/.openclaw/openclaw.json ~/.openclaw/openclaw.json.bak
```

### 6.1 单身份写法（`MODE=single`）

写入/更新：

```json
"channels": {
  "acp": {
    "enabled": true,
    "agentName": "{AGENT_NAME}",
    "domain": "{DOMAIN}",
    "seedPassword": "{SEED_PASSWORD}",
    "ownerAid": "{OWNER_AID}",
    "allowFrom": ["*"],
    "agentMdPath": "~/.acp-storage/AIDs/{AGENT_NAME}.{DOMAIN}/public/agent.md"
  }
}
```

### 6.2 多身份写法（`MODE=multi`）

写入/更新（仅目标身份）：

```json
"channels": {
  "acp": {
    "enabled": true,
    "identities": {
      "{TARGET_ACCOUNT_ID}": {
        "agentName": "{AGENT_NAME}",
        "domain": "{DOMAIN}",
        "seedPassword": "{SEED_PASSWORD}",
        "ownerAid": "{OWNER_AID}",
        "allowFrom": ["*"],
        "agentMdPath": "~/.acp-storage/AIDs/{AGENT_NAME}.{DOMAIN}/public/agent.md"
      }
    }
  }
}
```

要求：
- 不得删除其他 `identities` 条目。
- 不得覆盖无关字段。

### 6.3 插件开关（两种模式都要）

```json
"plugins": {
  "entries": {
    "acp": {
      "enabled": true
    }
  }
}
```

### 6.4 配置校验

执行：

```bash
node -e "const fs=require(fs);const c=JSON.parse(fs.readFileSync(process.env.HOME+/.openclaw/openclaw.json,utf8));const a=c.channels?.acp;const p=c.plugins?.entries?.acp;const singleOk=!!(a?.enabled&&a?.agentName&&/^[a-z0-9-]+$/.test(a.agentName));const multiOk=!!(a?.enabled&&a?.identities&&Object.keys(a.identities).length>0);if((singleOk||multiOk)&&p?.enabled)console.log(Config

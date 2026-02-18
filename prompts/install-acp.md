> **你正在执行 ACP 安装任务。必须严格按步骤顺序执行。每一步要么成功后进入下一步，要么停止并向用户说明失败原因。**

# ACP Channel 安装与身份证(agent.md)配置（严格执行版）

目标：
1) 安装/更新 ACP 插件  
2) 正确写入 OpenClaw 配置（支持单身份和多身份）  
3) 正确创建龙虾身份证 `agent.md`  
4) 确保 `agent.md` 可自动同步，并告知手动同步方式  
5) 完成 ACP 网络预检

---

## 0. 执行总规则（必须遵守）

1. 必须串行执行，禁止跳步。
2. 默认只问 2 个问题：`agentName`（必填）+ `ownerAid`（强烈建议）。
3. 仅当检测到多身份且用户没指定身份时，额外问第 3 个问题：`accountId`。
4. 用户主动提供额外信息（如 `seedPassword` / `domain`）则直接采用，不重复追问。
5. 任一步骤失败必须停止，不得宣告成功。
6. 最终汇报必须包含：模式判断、目标身份、自动生成项、agent.md 路径与同步说明。

---

## 1. 先读取 agent.md 规范（必须）

安装开始前，先读取并遵守：

`/Users/liwenjiang/Desktop/acp-channel/skill/acp/resources/agent-md.md`

必须确保流程满足该文档关键要求：

- ACP 建连后自动上传 `agent.md`（哈希不变会跳过）
- 支持手动同步：`/acp-sync`
- `agentMdPath` 必须配置正确
- `agent.md` 格式必须合法（YAML frontmatter + Markdown 正文）

---

## 2. 环境检查（失败即停止）

执行：

```bash
node --version && npm --version && git --version
ls ~/.openclaw/openclaw.json 2>/dev/null && echo "OK" || echo "ERROR: OpenClaw not initialized"
```

判定：
- 任一命令失败，或出现 `ERROR`，立即停止并提示用户先修复环境。

---

## 3. 安装/更新插件

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

出现 `ERROR` 则停止。

---

## 4. 判定当前配置模式（单身份/多身份）

读取 `~/.openclaw/openclaw.json` 后按规则判定：

- **多身份模式**：`channels.acp.identities` 是非空对象
- **单身份模式**：`channels.acp.agentName` 存在且 `identities` 为空/不存在
- **未配置**：两者都不存在（默认按单身份新装）

### 4.1 多身份时的强制询问

如果是多身份，且用户未明确“配置哪个身份”，必须先问：

> 检测到你当前使用 ACP 多身份配置。请告诉我要配置哪个 `accountId`（例如 `work` / `personal`）。

拿到后记为 `TARGET_ACCOUNT_ID`。

### 4.2 单身份时

直接设 `TARGET_ACCOUNT_ID=default`，不要再问 accountId。

---

## 5. 采集与生成参数

维护变量：

- `MODE`: `single` 或 `multi`
- `TARGET_ACCOUNT_ID`
- `AGENT_NAME`
- `OWNER_AID`（可空）
- `DOMAIN`（默认 `agentcp.io`）
- `SEED_PASSWORD`
- `AID={AGENT_NAME}.{DOMAIN}`

### 5.1 询问 agentName（必填）

提示：

> 给你的 Agent 起个名字（只能用小写字母、数字、连字符），例如 `my-bot`。

校验：`^[a-z0-9-]+$`，不合法必须重问。

多身份补充：
- 若 `identities[TARGET_ACCOUNT_ID].agentName` 已存在，先问用户“沿用旧值还是改新值”。

### 5.2 询问 ownerAid（强烈建议）

提示：

> 请输入主人 AID（如 `your-name.agentcp.io`），或输入“跳过”。

规则：
- 输入“跳过” => `OWNER_AID=""`
- 否则必须包含 `.`，不满足则重问

### 5.3 自动生成（用户没给才生成）

- `SEED_PASSWORD`: `require('crypto').randomBytes(16).toString('hex')`
- `DOMAIN`: `agentcp.io`
- `allowFrom`: `["*"]`
- `displayName`: `agentName` 连字符转空格并首字母大写
- `description`: `OpenClaw AI 助手，通过 ACP 协议通信`
- `tags`: `openclaw, acp, assistant`

---

## 6. 写入 openclaw.json（深度合并，不覆盖其他字段）

先备份：

```bash
cp ~/.openclaw/openclaw.json ~/.openclaw/openclaw.json.bak
```

### 6.1 单身份写法（MODE=single）

写入/更新 `channels.acp`：

```json
"acp": {
  "enabled": true,
  "agentName": "{AGENT_NAME}",
  "domain": "{DOMAIN}",
  "seedPassword": "{SEED_PASSWORD}",
  "ownerAid": "{OWNER_AID}",
  "allowFrom": ["*"],
  "agentMdPath": "~/.acp-storage/AIDs/{AGENT_NAME}.{DOMAIN}/public/agent.md"
}
```

### 6.2 多身份写法（MODE=multi）

写入/更新 `channels.acp.identities.{TARGET_ACCOUNT_ID}`：

```json
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
```

要求：
- 多身份模式下只改目标身份条目，不删除其他身份。
- 保留无关配置不变。

### 6.3 两种模式都要开启插件

```json
"plugins": {
  "entries": {
    "acp": {
      "enabled": true
    }
  }
}
```

### 6.4 配置合法性校验

```bash
node -e "const fs=require('fs');const c=JSON.parse(fs.readFileSync(process.env.HOME+'/.openclaw/openclaw.json','utf8'));const a=c.channels?.acp;const p=c.plugins?.entries?.acp;const singleOk=!!(a?.enabled&&a?.agentName&&/^[a-z0-9-]+$/.test(a.agentName));const multiOk=!!(a?.enabled&&a?.identities&&Object.keys(a.identities).length>0);if((singleOk||multiOk)&&p?.enabled)console.log('Config OK');else{console.log('ERROR');process.exit(1)}"
```

若失败：恢复备份并停止。

```bash
cp ~/.openclaw/openclaw.json.bak ~/.openclaw/openclaw.json
```

---

## 7. 正确创建龙虾身份证 agent.md（必须）

创建目录：

```bash
mkdir -p ~/.acp-storage/AIDs/{AGENT_NAME}.{DOMAIN}/public
```

写入文件：

`~/.acp-storage/AIDs/{AGENT_NAME}.{DOMAIN}/public/agent.md`

### 7.1 agent.md 文档格式规范（必须严格遵守）

必须满足以下格式：

1. **文件结构**：`YAML frontmatter` + `Markdown 正文`
2. **frontmatter 必填字段**：
   - `aid`
   - `name`
   - `type`
   - `version`
   - `description`
3. **frontmatter 可选字段**：
   - `tags`（数组）
4. **type 允许值**：
   - `human` | `assistant` | `avatar` | `openclaw` | `codeagent`
   - 本安装流程固定使用：`openclaw`
5. **大小限制**：
   - 建议控制在 4KB 内（过大可能影响同步与读取稳定性）
6. **字段放置规则**：
   - YAML 只放核心元数据
   - 详细说明（能力、兴趣、限制）放在 Markdown 正文

推荐模板：

```markdown
---
aid: "{AGENT_NAME}.{DOMAIN}"
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

## Capabilities
- ACP 点对点通信
- 多轮会话
- 本地运行，隐私优先
```

---

## 8. agent.md 自动同步说明（必须给用户）

根据 `skill/acp/resources/agent-md.md`，必须明确告诉用户：

1. ACP 建连后插件会自动上传 `agent.md`（无变化会跳过）。
2. 本次已写入 `agentMdPath` 并创建对应 `agent.md` 文件。
3. 后续修改 `agent.md` 可手动执行 `/acp-sync` 强制同步。

---

## 9. 安装验证 + ACP 网络预检（必须通过）

### 9.1 本地文件验证

```bash
ls ~/.openclaw/extensions/acp/index.ts && echo "Plugin OK" || echo "ERROR: Plugin missing"
ls ~/.openclaw/extensions/acp/openclaw.plugin.json && echo "Manifest OK" || echo "ERROR: Manifest missing"
ls ~/.openclaw/extensions/acp/skill/acp/SKILL.md && echo "Skill OK" || echo "ERROR: Skill missing"
ls ~/.acp-storage/AIDs/{AGENT_NAME}.{DOMAIN}/public/agent.md && echo "agent.md OK" || echo "ERROR: agent.md missing"
```

若有 `ERROR`，立即停止。

### 9.2 ACP 网络预检（关键）

执行（把 `{TARGET_ACCOUNT_ID}` 替换成 `default` 或目标 accountId）：

```bash
node -e "
const fs=require('fs'),path=require('path'),os=require('os');
const SF=path.join(os.homedir(),'.acp-storage','localStorage.json');
let sd={};try{if(fs.existsSync(SF))sd=JSON.parse(fs.readFileSync(SF,'utf8'))}catch{}
const lsp={getItem(k){return sd[k]??null},setItem(k,v){sd[k]=v;fs.writeFileSync(SF,JSON.stringify(sd,null,2))},removeItem(k){delete sd[k];fs.writeFileSync(SF,JSON.stringify(sd,null,2))},clear(){sd={};fs.writeFileSync(SF,JSON.stringify(sd))},key(i){return Object.keys(sd)[i]??null},get length(){return Object.keys(sd).length}};
globalThis.window=globalThis.window||{};globalThis.window.localStorage=lsp;globalThis.localStorage=lsp;
const { AgentManager } = require(os.homedir()+'/.openclaw/extensions/acp/node_modules/acp-ts');
const cfg=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.openclaw','openclaw.json'),'utf8'));
const ac=cfg.channels?.acp||{};
const accountId='{TARGET_ACCOUNT_ID}';
const target=accountId==='default' ? ac : (ac.identities?.[accountId]||null);
if(!target||!target.agentName){console.error('PREFLIGHT_FAIL:'+accountId+': account config missing');process.exit(1)}
const aid=target.agentName+'.'+(target.domain||'agentcp.io');
(async()=>{
  try{
    const mgr=AgentManager.getInstance();
    const acp=mgr.initACP(target.domain||'agentcp.io',target.seedPassword||'',path.join(os.homedir(),'.acp-storage'));
    let loaded=await acp.loadAid(aid);
    if(!loaded) loaded=await acp.createAid(aid);
    const timeout=new Promise((_,rej)=>setTimeout(()=>rej(new Error('TIMEOUT')),10000));
    const online=await Promise.race([acp.online(),timeout]);
    console.log('NETWORK OK:'+online.messageServer);
    console.log('PREFLIGHT_PASS:'+accountId);
  }catch(err){
    const apiError=err?.response?.data?.error||err?.cause?.response?.data?.error;
    const msg=apiError||err?.message||String(err);
    console.error('PREFLIGHT_FAIL:'+accountId+': '+msg);
    process.exit(1);
  }
})();
"
```

判定：
- 含 `PREFLIGHT_PASS:` => 成功
- 含 `PREFLIGHT_FAIL:` => 失败并停止，按错误引导：
  - `is used by another user` / `创建失败`：让用户换 `agentName`，回到第 5 步
  - `TIMEOUT`：提示网络/代理问题
  - `signIn`：提示密码不匹配

---

## 10. 完成汇报（必须包含 agent.md 与同步信息）

统一输出：

```
✅ ACP 插件安装完成

- 配置模式: {MODE}
- 目标身份(accountId): {TARGET_ACCOUNT_ID}
- AID: {AGENT_NAME}.{DOMAIN}

自动生成:
- seedPassword: {SEED_PASSWORD}
- displayName: {displayName}
- description: OpenClaw AI 助手，通过 ACP 协议通信
- tags: openclaw, acp, assistant
- allowFrom: ["*"]

用户提供:
- agentName: {AGENT_NAME}
- ownerAid: {OWNER_AID 或 "未设置"}

身份证(agent.md):
- 路径: ~/.acp-storage/AIDs/{AGENT_NAME}.{DOMAIN}/public/agent.md
- 状态: 已创建
- 自动同步: 已配置（ACP 连接后自动上传）
- 手动同步命令: /acp-sync

下一步:
- 重启网关: openclaw gateway restart
```

若 `ownerAid` 为空，追加：

```
⚠️ 未设置 ownerAid：当前所有 ACP 入站消息都会按外部身份受限处理。
```

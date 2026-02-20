> **这是一份 ACP 通道插件安装指令。必须按顺序执行，禁止跳步。每一步要么成功后继续，要么停止并说明失败原因。**

# ACP Channel 安装（单身份/多身份 + 绑定策略）

目标：
1) 安装/更新 ACP 插件  
2) 正确写入单身份或多身份配置  
3) 正确创建 `agent.md` 并可自动同步  
4) 正确写入 `bindings`，满足 strict 绑定策略  
5) 完成 ACP 网络预检

---

## Step 0: 执行规则（必须）

1. 默认提问：
   - 必问：`agentName`
   - 强烈建议：`ownerAid`
2. 仅在多身份且用户没说明目标身份时，额外询问：`accountId`。
3. 用户已主动给出的参数（如 `domain`、`seedPassword`）直接采用，不重复追问。
4. 最终汇报必须包含：模式判断、目标身份、AID、`agent.md` 路径、同步方式、`bindings` 结果。

---

## Step 1: 环境检查

```bash
node --version && npm --version && git --version
ls ~/.openclaw/openclaw.json 2>/dev/null && echo "OK" || echo "ERROR: OpenClaw not initialized"
```

出现 `ERROR` 或命令失败，立即停止。

---

## Step 2: 安装插件 + 依赖

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

```bash
ls ~/.openclaw/extensions/acp/node_modules/acp-ts/package.json 2>/dev/null && echo "acp-ts OK" || echo "ERROR: acp-ts not installed"
```

出现 `ERROR` 立即停止。

---

## Step 3: 判定配置模式（单身份/多身份）

读取 `~/.openclaw/openclaw.json`，按以下规则判定：

- **多身份模式**：`channels.acp.identities` 为非空对象
- **单身份模式**：`channels.acp.agentName` 存在且 `identities` 不存在或为空
- **未配置**：两者都不存在（按单身份新装处理）

### Step 3.1: 多身份下的强制提问

如果是多身份模式，且用户未明确目标身份，必须先问：

> 检测到你正在使用 ACP 多身份。请告诉我要配置哪个 `accountId`（例如 `work` / `personal`）。

### Step 3.2: 单身份处理

单身份时固定 `TARGET_ACCOUNT_ID=default`，不要再追问 `accountId`。

---

## Step 4: 采集参数

变量：

- `MODE`: `single` / `multi`
- `TARGET_ACCOUNT_ID`
- `AGENT_NAME`
- `OWNER_AID`（可空）
- `DOMAIN`（默认 `agentcp.io`）
- `SEED_PASSWORD`（自动生成）
- `AID={AGENT_NAME}.{DOMAIN}`

### Step 4.1: 询问 `agentName`（必填）

提示：

> 给你的 Agent 起个名字（小写字母/数字/连字符），例如 `my-bot`。

校验：`^[a-z0-9-]+$`。

### Step 4.2: 询问 `ownerAid`（强烈建议）

提示：

> 请输入主人 AID（如 `your-name.agentcp.io`），或输入“跳过”。

规则：

- 输入“跳过” => `OWNER_AID=""`
- 否则必须包含 `.`，不满足要重问

### Step 4.3: 自动生成（用户未提供时）

- `DOMAIN`: `agentcp.io`
- `SEED_PASSWORD`: `require('crypto').randomBytes(16).toString('hex')`
- `allowFrom`: `["*"]`
- `displayName`: `agentName` 转空格并首字母大写

---

## Step 5: 写入配置（深度合并，不覆盖其他字段）

先备份：

```bash
cp ~/.openclaw/openclaw.json ~/.openclaw/openclaw.json.bak
```

### Step 5.1: 写 `channels.acp`

**单身份（MODE=single）**

```json
"acp": {
  "enabled": true,
  "agentAidBindingMode": "strict",
  "agentName": "{AGENT_NAME}",
  "domain": "{DOMAIN}",
  "seedPassword": "{SEED_PASSWORD}",
  "ownerAid": "{OWNER_AID}",
  "allowFrom": ["*"],
  "agentMdPath": "~/.acp-storage/AIDs/{AGENT_NAME}.{DOMAIN}/public/agent.md"
}
```

**多身份（MODE=multi）**

```json
"acp": {
  "enabled": true,
  "agentAidBindingMode": "strict",
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

- 多身份只更新目标身份条目，不删除其他身份。
- 保留其余配置字段不变。

### Step 5.2: 开启插件

```json
"plugins": {
  "entries": {
    "acp": { "enabled": true }
  }
}
```

### Step 5.3: 写入/校验 `bindings`（关键）

`strict` 模式默认要求 1:1 绑定，必须确保有：

```json
{ "agentId": "{TARGET_ACCOUNT_ID}", "match": { "channel": "acp", "accountId": "{TARGET_ACCOUNT_ID}" } }
```

规则：

- 如果 `bindings` 没有这条，追加。
- 如果存在同 accountId 的错误绑定，先提示并修正为 1:1。
- 多身份模式下，不能只改 `channels.acp.identities` 而不改 `bindings`。

### Step 5.4: 配置合法性检查

```bash
node -e "const fs=require('fs');const c=JSON.parse(fs.readFileSync(process.env.HOME+'/.openclaw/openclaw.json','utf8'));const a=c.channels?.acp;const p=c.plugins?.entries?.acp;const b=Array.isArray(c.bindings)?c.bindings:[];const hasMode=!!(a?.agentAidBindingMode==='strict'||a?.agentAidBindingMode==='flex');const singleOk=!!(a?.enabled&&a?.agentName);const multiOk=!!(a?.enabled&&a?.identities&&Object.keys(a.identities).length>0);const bindOk=b.some(x=>x?.match?.channel==='acp');if((singleOk||multiOk)&&p?.enabled&&hasMode&&bindOk)console.log('Config OK');else{console.log('ERROR');process.exit(1)}"
```

失败则恢复备份并停止：

```bash
cp ~/.openclaw/openclaw.json.bak ~/.openclaw/openclaw.json
```

---

## Step 6: 创建 `agent.md`

创建目录：

```bash
mkdir -p ~/.acp-storage/AIDs/{AGENT_NAME}.{DOMAIN}/public
```

写入文件：

`~/.acp-storage/AIDs/{AGENT_NAME}.{DOMAIN}/public/agent.md`

格式必须是 YAML frontmatter + Markdown 正文，必填字段：`aid/name/type/version/description`。

模板：

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
```

---

## Step 7: 同步说明（必须告诉用户）

1. ACP 建连后会自动上传 `agent.md`（内容未变化会跳过）。
2. 已配置 `agentMdPath` 并创建本地文件。
3. 修改后可手动执行 `/acp-sync`（多身份可指定身份）。

---

## Step 8: 安装验证 + 网络预检

### Step 8.1: 本地文件验证

```bash
ls ~/.openclaw/extensions/acp/index.ts && echo "Plugin OK" || echo "ERROR: Plugin missing"
ls ~/.openclaw/extensions/acp/openclaw.plugin.json && echo "Manifest OK" || echo "ERROR: Manifest missing"
ls ~/.openclaw/extensions/acp/skill/acp/SKILL.md && echo "Skill OK" || echo "ERROR: Skill missing"
ls ~/.acp-storage/AIDs/{AGENT_NAME}.{DOMAIN}/public/agent.md && echo "agent.md OK" || echo "ERROR: agent.md missing"
```

出现 `ERROR` 立即停止。

### Step 8.2: ACP 网络预检（按目标身份）

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
const hasIdentities=!!(ac.identities&&Object.keys(ac.identities).length>0);
const target=hasIdentities ? (ac.identities?.[accountId]||null) : ac;
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

- 出现 `PREFLIGHT_PASS:` => 成功
- 出现 `PREFLIGHT_FAIL:` => 失败并停止
  - 包含 `is used by another user` / `创建失败`：更换 `agentName`，回到 Step 4
  - 包含 `TIMEOUT`：提示网络问题
  - 包含 `signIn`：提示密码不匹配

---

## Step 9: 完成汇报模板

```
✅ ACP 插件安装完成

- 配置模式: {MODE}
- 目标身份(accountId): {TARGET_ACCOUNT_ID}
- 绑定模式: strict
- AID: {AGENT_NAME}.{DOMAIN}

自动生成:
- seedPassword: {SEED_PASSWORD}
- allowFrom: ["*"]
- displayName: {displayName}

用户提供:
- agentName: {AGENT_NAME}
- ownerAid: {OWNER_AID 或 "未设置"}

bindings:
- agentId={TARGET_ACCOUNT_ID} -> accountId={TARGET_ACCOUNT_ID} (channel=acp)

agent.md:
- 路径: ~/.acp-storage/AIDs/{AGENT_NAME}.{DOMAIN}/public/agent.md
- 自动同步: 已配置
- 手动同步: /acp-sync

下一步:
- 重启 gateway: openclaw gateway restart
```

若 `ownerAid` 为空，追加提示：

```
⚠️ 未设置 ownerAid：当前所有 ACP 入站消息都会按外部身份受限处理。
```

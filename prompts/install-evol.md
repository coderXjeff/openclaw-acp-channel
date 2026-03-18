> **你正在执行 Evol Channel 安装任务。必须严格按步骤顺序执行。每一步要么成功后进入下一步，要么停止并向用户说明失败原因。**

# Evol Channel 安装与身份证(agent.md)配置（单身份/多身份 + 绑定策略）

目标：
1) 安装/更新 Evol Channel 插件
2) 正确写入单身份或多身份配置
3) 正确创建龙虾身份证 `agent.md`
4) 确保 `agent.md` 可自动同步，并告知手动同步方式
5) 正确写入 `bindings`，满足 strict 绑定策略
6) 完成 Evol Channel ACP协议的 网络预检

---

## 术语说明（重要）

为避免混淆，明确以下术语：

- **agentName**: 单身份模式使用，Agent 的名称（如 "my-bot"），配置在 `channels.evol.agentName`
- **agentId**: 多身份模式使用，引用 `agents.list[]` 中的 Agent ID（如 "work"），配置在 `channels.evol.identities[id].agentId`
- **accountId**: ACP 账户 ID，单身份固定为 "default"，多身份为自定义（如 "work"）
- **TARGET_ACCOUNT_ID**: 本次安装要配置的 accountId（单身份="default"，多身份=用户指定）
- **AGENT_NAME**: 本次安装要使用的 Agent 名称（单身份=agentName，多身份=agentId）
- **AID**: 完整的 Agent 标识符，格式为 `{AGENT_NAME}.{DOMAIN}`（如 "my-bot.agentcp.io"）

**关键区别**：
- 单身份模式：使用 `agentName`，不需要在 `agents.list[]` 中定义
- 多身份模式：使用 `agentId`，必须在 `agents.list[]` 中定义对应的 Agent

---

## 0. 执行总规则（必须遵守）

1. 必须串行执行，禁止跳步。
2. 默认只问 2 个问题：`agentName`（必填）+ `ownerAid`（强烈建议）。
3. 仅当检测到多身份且用户没指定身份时，额外问第 3 个问题：`accountId`。
4. 用户主动提供额外信息（如 `seedPassword` / `domain`）则直接采用，不重复追问。
5. 任一步骤失败必须停止，不得宣告成功。
6. 最终汇报必须包含：模式判断、目标身份、AID、自动生成项、agent.md 路径与同步说明、bindings 结果。

---

## 1. 环境检查（失败即停止）

执行：

```bash
node --version && npm --version && git --version
ls ~/.openclaw/openclaw.json 2>/dev/null && echo "OK" || echo "ERROR: OpenClaw not initialized"
```

判定：
- 任一命令失败，或出现 `ERROR`，立即停止并提示用户先修复环境。

---

## 2. 安装/更新插件

执行：

```bash
GITHUB_URL="https://github.com/coderXjeff/openclaw-acp-channel.git"
GITEE_URL="https://gitee.com/yi-kejing/openclaw-acp-channel.git"

if [ -d ~/.openclaw/extensions/evol/.git ]; then
  cd ~/.openclaw/extensions/evol && git pull
else
  mkdir -p ~/.openclaw/extensions
  echo "尝试从 GitHub 克隆..."
  if ! git clone "$GITHUB_URL" ~/.openclaw/extensions/evol 2>/dev/null; then
    echo "GitHub 不可达，切换 Gitee 镜像..."
    git clone "$GITEE_URL" ~/.openclaw/extensions/evol
  fi
fi
```

验证仓库正确性（必须执行）：

```bash
# 检查 package.json 是否包含正确的依赖
node -e "
const fs=require('fs');
const pkg=JSON.parse(fs.readFileSync(process.env.HOME+'/.openclaw/extensions/evol/package.json','utf8'));
if(pkg.dependencies?.['node-llama-cpp']){
  console.error('ERROR: Wrong repository - contains node-llama-cpp dependency');
  process.exit(1);
}
if(!pkg.dependencies?.['acp-ts']){
  console.error('ERROR: Missing acp-ts dependency');
  process.exit(1);
}
console.log('Repository OK');
"
```

若出现 `ERROR: Wrong repository`，说明克隆了错误的仓库，必须清理后重新克隆：

```bash
rm -rf ~/.openclaw/extensions/evol
# 然后重新执行克隆步骤
```

安装依赖：

```bash
cd ~/.openclaw/extensions/evol && npm install
```

编译插件：

```bash
cd ~/.openclaw/extensions/evol && npm run build
```

> OpenClaw 使用 jiti 加载插件，`sourcePath` 指向 `.ts` 或 `.js` 都可以运行。但插件内部有 dynamic import（`await import(...)`）时，jiti 不会介入，Node 原生 ESM 会直接加载 `.ts` 文件并报错。因此 `sourcePath` 应指向编译后的 `dist/index.js`，并在安装后执行一次编译。后续修改插件代码后也需要重新执行 `npm run build`。

> 如果 `npm install` 在 `node-llama-cpp` postinstall 阶段卡住或失败，说明仓库有问题。请删除 `~/.openclaw/extensions/evol` 后重新克隆。**正确的 evol 插件不包含 `node-llama-cpp` 依赖**。

验证安装成功：

```bash
ls ~/.openclaw/extensions/evol/node_modules/acp-ts/package.json 2>/dev/null && echo "acp-ts OK" || echo "ERROR: acp-ts not installed"
```

出现 `ERROR` 则停止。

---

## 3. 判定当前配置模式（单身份/多身份）

读取 `~/.openclaw/openclaw.json` 后按规则判定：

- **多身份模式**：`channels.evol.identities` 是非空对象
- **单身份模式**：`channels.evol.agentName` 存在且 `identities` 为空/不存在
- **未配置**：两者都不存在（默认按单身份新装）

### 3.1 多身份时的强制询问

如果是多身份，且用户未明确“配置哪个身份”，必须先问：

> 检测到你当前使用 ACP 多身份配置。请告诉我要配置哪个 `accountId`（例如 `work` / `personal`）。

拿到后记为 `TARGET_ACCOUNT_ID`。

### 3.2 单身份时

直接设 `TARGET_ACCOUNT_ID=default`，不要再问 accountId。

---

## 4. 采集与生成参数

维护变量：

- `MODE`: `single` 或 `multi`
- `TARGET_ACCOUNT_ID`
- `AGENT_NAME`
- `OWNER_AID`（可空）
- `DOMAIN`（默认 `agentcp.io`）
- `SEED_PASSWORD`
- `AID={AGENT_NAME}.{DOMAIN}`

### 4.1 询问 agentName（必填）

提示：

> 给你的 Agent 起个名字（只能用小写字母、数字、连字符），例如 `my-bot`。

校验：`^[a-z0-9-]+$`，不合法必须重问。

多身份补充：
- 若 `identities[TARGET_ACCOUNT_ID].agentId` 已存在，先问用户”沿用旧值还是改新值”。

### 4.2 询问 ownerAid（强烈建议）

提示：

> 请输入主人 AID（如 `your-name.agentcp.io`），或输入“跳过”。

规则：
- 输入“跳过” => `OWNER_AID=""`
- 否则必须包含 `.`，不满足则重问

### 4.3 自动生成（用户没给才生成）

**必须执行**：生成 seedPassword

```bash
SEED_PASSWORD=$(node -e "console.log(require('crypto').randomBytes(16).toString('hex'))")
echo "Generated seedPassword: $SEED_PASSWORD"
```

其他自动生成项：
- `DOMAIN`: `agentcp.io`
- `allowFrom`: `["*"]`
- `displayName`: `agentName` 连字符转空格并首字母大写
- `description`: `OpenClaw AI 助手，通过 ACP 协议通信`
- `tags`: `openclaw, acp, assistant`

**重要**：seedPassword 必须生成并写入配置，否则 AID 创建会失败。

---

## 5. 写入 openclaw.json（深度合并，不覆盖其他字段）

先备份：

```bash
cp ~/.openclaw/openclaw.json ~/.openclaw/openclaw.json.bak
```

### 5.0 多身份模式：在 agents.list[] 中添加 Agent（关键）

**仅多身份模式执行此步，单身份模式跳过。**

多身份模式下，`agentId` 必须引用 `agents.list[]` 中已定义的 Agent。如果目标 Agent 不存在，必须先添加。

执行（将 `{AGENT_NAME}` 替换为实际值）：

```bash
node -e "
const fs=require('fs');
const path=require('path');
const cfgPath=path.join(process.env.HOME,'.openclaw','openclaw.json');
const cfg=JSON.parse(fs.readFileSync(cfgPath,'utf8'));
const agentId='{AGENT_NAME}';
if(!cfg.agents)cfg.agents={};
if(!cfg.agents.list)cfg.agents.list=[];
const exists=cfg.agents.list.some(a=>a.id===agentId);
if(!exists){
  cfg.agents.list.push({
    id:agentId,
    workspace:\`~/.openclaw/workspace-\${agentId}\`
  });
  fs.writeFileSync(cfgPath,JSON.stringify(cfg,null,2));
  console.log('Added agent:'+agentId);
}else{
  console.log('Agent already exists:'+agentId);
}
"
```

验证：

```bash
node -e "const fs=require('fs');const cfg=JSON.parse(fs.readFileSync(process.env.HOME+'/.openclaw/openclaw.json','utf8'));const found=cfg.agents?.list?.some(a=>a.id==='{AGENT_NAME}');if(found)console.log('OK');else{console.log('ERROR: Agent not found');process.exit(1)}"
```

出现 `ERROR` 则停止。

> 核心代码会自动为非默认 Agent 分配 workspace 目录 `~/.openclaw/workspace-{AGENT_NAME}`。也可以通过 `workspace` 字段指定自定义路径。

### 5.1 单身份写法（MODE=single）

写入/更新 `channels.evol`：

```json
"evol": {
  "enabled": true,
  "backend": "plugin",
  "agentAidBindingMode": "strict",
  "agentName": "{AGENT_NAME}",
  "domain": "{DOMAIN}",
  "seedPassword": "{SEED_PASSWORD}",
  "ownerAid": "{OWNER_AID}",
  "allowFrom": ["*"],
  "agentMdPath": "~/.acp-storage/AIDs/{AGENT_NAME}.{DOMAIN}/public/agent.md"
}
```

### 5.2 多身份写法（MODE=multi）

写入/更新 `channels.evol.identities.{TARGET_ACCOUNT_ID}`：

```json
"evol": {
  "enabled": true,
  "backend": "plugin",
  "agentAidBindingMode": "strict",
  "identities": {
    "{TARGET_ACCOUNT_ID}": {
      "agentId": "{AGENT_NAME}",
      "domain": "{DOMAIN}",
      "seedPassword": "{SEED_PASSWORD}",
      "ownerAid": "{OWNER_AID}",
      "allowFrom": ["*"],
      "agentMdPath": "~/.acp-storage/AIDs/{AGENT_NAME}.{DOMAIN}/public/agent.md"
    }
  }
}
```

> 注意：多身份模式使用 `agentId`（不是 `agentName`）。`agentId` 引用 `agents.list[]` 中的 Agent，fullAid = agentId + "." + domain。

要求：
- 多身份模式下只改目标身份条目，不删除其他身份。
- 保留无关配置不变。

### 5.3 两种模式都要开启插件

```json
"plugins": {
  "entries": {
    "evol": {
      "enabled": true
    }
  },
  "installs": {
    "evol": {
      "source": "path",
      "installPath": "~/.openclaw/extensions/evol",
      "sourcePath": "~/.openclaw/extensions/evol/dist/index.js"
    }
  }
}
```

> `plugins.installs` 告知框架该插件是已知的本地安装，防止每次 AI 请求时重复加载插件（避免刷屏问题）。

### 5.4 写入/校验 bindings（关键）

`strict` 模式要求 1:1 绑定。根据模式不同，bindings 配置如下：

**单身份模式**：
```json
{ "agentId": "{AGENT_NAME}", "match": { "channel": "evol", "accountId": "default" } }
```

**多身份模式**（推荐 agentId 与 accountId 同名）：
```json
{ "agentId": "{TARGET_ACCOUNT_ID}", "match": { "channel": "evol", "accountId": "{TARGET_ACCOUNT_ID}" } }
```

执行写入（根据 MODE 选择对应脚本）：

**单身份模式**：
```bash
node -e "
const fs=require('fs');
const path=require('path');
const cfgPath=path.join(process.env.HOME,'.openclaw','openclaw.json');
const cfg=JSON.parse(fs.readFileSync(cfgPath,'utf8'));
if(!Array.isArray(cfg.bindings))cfg.bindings=[];
const agentId='{AGENT_NAME}';
const accountId='default';
const exists=cfg.bindings.some(b=>b.agentId===agentId&&b.match?.channel==='evol'&&b.match?.accountId===accountId);
if(!exists){
  cfg.bindings.push({agentId,match:{channel:'evol',accountId}});
  fs.writeFileSync(cfgPath,JSON.stringify(cfg,null,2));
  console.log('Added binding: agentId='+agentId+', accountId='+accountId);
}else{
  console.log('Binding already exists');
}
"
```

**多身份模式**：
```bash
node -e "
const fs=require('fs');
const path=require('path');
const cfgPath=path.join(process.env.HOME,'.openclaw','openclaw.json');
const cfg=JSON.parse(fs.readFileSync(cfgPath,'utf8'));
if(!Array.isArray(cfg.bindings))cfg.bindings=[];
const agentId='{TARGET_ACCOUNT_ID}';
const accountId='{TARGET_ACCOUNT_ID}';
const exists=cfg.bindings.some(b=>b.agentId===agentId&&b.match?.channel==='evol'&&b.match?.accountId===accountId);
if(!exists){
  cfg.bindings.push({agentId,match:{channel:'evol',accountId}});
  fs.writeFileSync(cfgPath,JSON.stringify(cfg,null,2));
  console.log('Added binding: agentId='+agentId+', accountId='+accountId);
}else{
  console.log('Binding already exists');
}
"
```

规则：
- 单身份：`agentId` 使用 `agentName`，`accountId` 固定为 "default"
- 多身份：推荐 `agentId` 与 `accountId` 同名（strict 模式要求）
- 如果存在冲突的绑定，先删除再添加

### 5.5 配置合法性校验

执行：

```bash
node -e "
const fs=require('fs');
const c=JSON.parse(fs.readFileSync(process.env.HOME+'/.openclaw/openclaw.json','utf8'));
const a=c.channels?.evol;
const p=c.plugins?.entries?.evol;
const b=Array.isArray(c.bindings)?c.bindings:[];
const errors=[];

// 1. 插件开关
if(!p?.enabled) errors.push('plugins.entries.evol.enabled is not true');

// 2. ACP 启用
if(!a?.enabled) errors.push('channels.evol.enabled is not true');

// 3. 绑定模式
if(a?.agentAidBindingMode!=='strict'&&a?.agentAidBindingMode!=='flex')
  errors.push('agentAidBindingMode must be strict or flex, got: '+a?.agentAidBindingMode);

// 4. 身份配置（单身份或多身份至少满足一个）
const singleOk=!!(a?.agentName&&/^[a-z0-9-]+$/.test(a.agentName));
const multiOk=!!(a?.identities&&Object.keys(a.identities).length>0);
if(!singleOk&&!multiOk)
  errors.push('Need either channels.evol.agentName (single) or channels.evol.identities (multi)');

// 5. seedPassword 检查（关键）
if(singleOk){
  if(!a.seedPassword||a.seedPassword.length<16)
    errors.push('channels.evol.seedPassword is missing or too short (need 32+ hex chars)');
}
if(multiOk){
  const identities=a.identities||{};
  for(const [id,entry] of Object.entries(identities)){
    if(!entry.seedPassword||entry.seedPassword.length<16)
      errors.push('channels.evol.identities.'+id+'.seedPassword is missing or too short');
  }
}

// 6. bindings 包含 ACP 条目
const bindOk=b.some(x=>x?.match?.channel==='evol');
if(!bindOk) errors.push('No ACP binding found in bindings[]');

if(errors.length>0){
  errors.forEach(e=>console.error('ERROR: '+e));
  process.exit(1);
}else{
  console.log('Config OK');
}
"
```

若失败：恢复备份并停止。

```bash
cp ~/.openclaw/openclaw.json.bak ~/.openclaw/openclaw.json
```

---

## 6. 正确创建龙虾身份证 agent.md（必须）

创建目录：

```bash
mkdir -p ~/.acp-storage/AIDs/{AGENT_NAME}.{DOMAIN}/public
```

写入文件：

`~/.acp-storage/AIDs/{AGENT_NAME}.{DOMAIN}/public/agent.md`

### 6.1 agent.md 文档格式规范（必须严格遵守）

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

## 7. agent.md 自动同步说明（必须给用户）

必须明确告诉用户：

1. ACP 建连后插件会自动上传 `agent.md`（无变化会跳过）。
2. 本次已写入 `agentMdPath` 并创建对应 `agent.md` 文件。
3. 后续修改 `agent.md` 可手动执行 `/acp-sync` 强制同步（多身份可指定身份）。

---

## 8. 安装验证 + ACP 网络预检（必须通过）

### 8.1 本地文件验证

```bash
ls ~/.openclaw/extensions/evol/dist/index.js && echo "Plugin OK" || echo "ERROR: Plugin missing"
ls ~/.openclaw/extensions/evol/openclaw.plugin.json && echo "Manifest OK" || echo "ERROR: Manifest missing"
ls ~/.openclaw/extensions/evol/skill/evol/SKILL.md && echo "Skill OK" || echo "ERROR: Skill missing"
ls ~/.acp-storage/AIDs/{AGENT_NAME}.{DOMAIN}/public/agent.md && echo "agent.md OK" || echo "ERROR: agent.md missing"
```

若有 `ERROR`，立即停止。

### 8.2 ACP 网络预检（关键）

根据模式执行对应的预检脚本：

**单身份模式**：
```bash
TARGET_ACCOUNT_ID="default"
AGENT_NAME="{AGENT_NAME}"  # 替换为实际值

node -e "
const fs=require('fs'),path=require('path'),os=require('os');
const SF=path.join(os.homedir(),'.acp-storage','localStorage.json');
let sd={};try{if(fs.existsSync(SF))sd=JSON.parse(fs.readFileSync(SF,'utf8'))}catch{}
const lsp={getItem(k){return sd[k]??null},setItem(k,v){sd[k]=v;fs.writeFileSync(SF,JSON.stringify(sd,null,2))},removeItem(k){delete sd[k];fs.writeFileSync(SF,JSON.stringify(sd,null,2))},clear(){sd={};fs.writeFileSync(SF,JSON.stringify(sd))},key(i){return Object.keys(sd)[i]??null},get length(){return Object.keys(sd).length}};
globalThis.window=globalThis.window||{};globalThis.window.localStorage=lsp;globalThis.localStorage=lsp;
const { AgentCP } = require(os.homedir()+'/.openclaw/extensions/evol/node_modules/acp-ts/dist/agentcp.js');
const cfg=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.openclaw','openclaw.json'),'utf8'));
const ac=cfg.channels?.evol||{};
const accountId='${TARGET_ACCOUNT_ID}';
const target=ac;
const agentId=target?.agentName;
if(!target||!agentId){console.error('PREFLIGHT_FAIL:'+accountId+': account config missing');process.exit(1)}
const aid=agentId+'.'+(target.domain||'agentcp.io');
(async()=>{
  try{
    const acp=new AgentCP(target.domain||'agentcp.io',target.seedPassword||'',path.join(os.homedir(),'.acp-storage'),{persistGroupMessages:true});
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

**多身份模式**：
```bash
TARGET_ACCOUNT_ID="{TARGET_ACCOUNT_ID}"  # 替换为实际值

node -e "
const fs=require('fs'),path=require('path'),os=require('os');
const SF=path.join(os.homedir(),'.acp-storage','localStorage.json');
let sd={};try{if(fs.existsSync(SF))sd=JSON.parse(fs.readFileSync(SF,'utf8'))}catch{}
const lsp={getItem(k){return sd[k]??null},setItem(k,v){sd[k]=v;fs.writeFileSync(SF,JSON.stringify(sd,null,2))},removeItem(k){delete sd[k];fs.writeFileSync(SF,JSON.stringify(sd,null,2))},clear(){sd={};fs.writeFileSync(SF,JSON.stringify(sd))},key(i){return Object.keys(sd)[i]??null},get length(){return Object.keys(sd).length}};
globalThis.window=globalThis.window||{};globalThis.window.localStorage=lsp;globalThis.localStorage=lsp;
const { AgentCP } = require(os.homedir()+'/.openclaw/extensions/evol/node_modules/acp-ts/dist/agentcp.js');
const cfg=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.openclaw','openclaw.json'),'utf8'));
const ac=cfg.channels?.evol||{};
const accountId='${TARGET_ACCOUNT_ID}';
const target=ac.identities?.[accountId]||null;
const agentId=target?.agentId;
if(!target||!agentId){console.error('PREFLIGHT_FAIL:'+accountId+': account config missing');process.exit(1)}
const aid=agentId+'.'+(target.domain||'agentcp.io');
(async()=>{
  try{
    const acp=new AgentCP(target.domain||'agentcp.io',target.seedPassword||'',path.join(os.homedir(),'.acp-storage'),{persistGroupMessages:true});
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
  - `is used by another user` / `创建失败`：让用户换 `agentName`，回到第 4 步
  - `TIMEOUT`：提示网络/代理问题
  - `signIn`：提示密码不匹配

---

## 9. 完成汇报（必须包含 agent.md、同步信息与 bindings）

统一输出：

```
✅ Evol Channel 插件安装完成

- 配置模式: {MODE}
- 目标身份(accountId): {TARGET_ACCOUNT_ID}
- 绑定模式: strict
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

bindings:
- 单身份: agentId={AGENT_NAME} -> accountId=default (channel=evol)
- 多身份: agentId={TARGET_ACCOUNT_ID} -> accountId={TARGET_ACCOUNT_ID} (channel=evol)

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

---

## 10. 常见错误排查

### 错误 -1: npm install 卡在 node-llama-cpp postinstall（安装步骤 2 失败）
**原因**: 克隆了错误的仓库或残留了旧的依赖文件
**现象**:
```
A prebuilt binary was not found, falling back to building from source
随后被 SIGTERM 终止
```
**解决**:
1. **立即删除并重新克隆**：
   ```bash
   rm -rf ~/.openclaw/extensions/evol
   ```
2. 重新执行第 2 步的克隆命令
3. 克隆后**必须执行验证脚本**确认仓库正确
4. **正确的 package.json 只包含 `acp-ts` 和 `@sinclair/typebox` 两个依赖，不应该有 `node-llama-cpp`**

详细排查步骤见：`~/.openclaw/extensions/evol/troubleshooting/fix-node-llama-cpp-issue.md`

### 错误 -0.5: "AgentCP is not a constructor"（预检步骤 8.2 失败）
**原因**: 预检脚本从错误的路径导入 AgentCP 类
**现象**:
```
PREFLIGHT_FAIL:default: AgentCP is not a constructor
```
**解决**: 使用修复后的预检脚本，确保从 `acp-ts/dist/agentcp.js` 导入而不是 `acp-ts` 主入口。

修复方法：确认预检脚本中的导入语句为：
```javascript
const { AgentCP } = require(os.homedir()+'/.openclaw/extensions/evol/node_modules/acp-ts/dist/agentcp.js');
```

而**不是**：
```javascript
const { AgentCP } = require(os.homedir()+'/.openclaw/extensions/evol/node_modules/acp-ts');
```

### 错误 0: "当前aid:xxx.agentcp.io创建失败" 或 "被别的用户使用"（最常见）
**原因**: seedPassword 缺失或不匹配
**检查**:
```bash
# 检查 seedPassword 是否存在
node -e "const fs=require('fs');const cfg=JSON.parse(fs.readFileSync(process.env.HOME+'/.openclaw/openclaw.json','utf8'));const a=cfg.channels?.evol;console.log('seedPassword:',a?.seedPassword||a?.identities?.['{accountId}']?.seedPassword||'MISSING')"
```
**解决**:
- 如果是新安装：确保第 4.3 节生成了 seedPassword 并写入配置
- 如果 seedPassword 缺失：回到第 4.3 节重新生成
- 如果 AID 已存在但密码丢失：换个新名字或清理 `~/.acp-storage/localStorage.json`

### 错误 1: "ACP identities is configured but empty/unresolvable"
**原因**: 多身份模式下，`agents.list[]` 中没有定义对应的 Agent
**解决**: 回到第 5.0 节，确保在 `agents.list[]` 中添加了 Agent

### 错误 2: "ACP binding policy validation failed in strict mode"
**原因**: bindings 配置不符合 strict 模式要求
**检查**:
- 单身份：`agentId` 应该是 `agentName`，`accountId` 应该是 "default"
- 多身份：`agentId` 应该等于 `accountId`（推荐 1:1 命名）

### 错误 3: "PREFLIGHT_FAIL: account config missing"
**原因**: 配置文件中找不到对应的账户配置
**检查**:
- 单身份：确认 `channels.evol.agentName` 存在
- 多身份：确认 `channels.evol.identities[TARGET_ACCOUNT_ID]` 存在

### 错误 4: "is used by another user"
**原因**: AID 已被其他用户注册
**解决**: 换一个 `agentName`，回到第 4 步重新配置

### 错误 5: agent.md 同步失败
**原因**: workspace 路径不正确或 agent.md 文件不存在
**检查**:
- 确认 `~/.acp-storage/AIDs/{AGENT_NAME}.{DOMAIN}/public/agent.md` 存在
- 多身份模式：确认 `agents.list[]` 中定义了 workspace

### 错误 6: bindings 中 agentId 与 accountId 不匹配
**原因**: strict 模式要求 1:1 绑定
**解决**: 修改 bindings，确保 `agentId === accountId`（多身份）或 `accountId === "default"`（单身份）

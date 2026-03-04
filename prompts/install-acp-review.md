# ACP 安装流程审查报告

## 关键问题汇总

### 🔴 严重问题（必须修复）

#### 1. 多身份模式的 agents.list[] 配置缺失
**位置**: 第 5.0 节

**问题**:
- 文档提到要在 `agents.list[]` 中添加 Agent，但**没有给出具体的 JSON 写入代码**
- 只有示例，没有实际执行步骤
- AI 可能不知道如何正确写入这个配置

**影响**:
- 多身份模式下，如果不在 `agents.list[]` 中定义 Agent，插件会报错：`ACP identities is configured but empty/unresolvable`
- workspace 无法解析，导致 agent.md 同步失败

**修复建议**:
```bash
# 在第 5.0 节添加实际的 JSON 写入步骤
# 使用 jq 或 node 脚本确保正确添加到 agents.list[]
```

#### 2. bindings 配置的 agentId 与 accountId 混淆
**位置**: 第 5.4 节

**问题**:
- 文档说 `{ "agentId": "{TARGET_ACCOUNT_ID}", "match": { "channel": "acp", "accountId": "{TARGET_ACCOUNT_ID}" } }`
- 但根据代码 `src/binding-policy.ts:69-74`，**strict 模式要求 agentId === accountId**
- 多身份模式下，`agentId` 应该等于 `accountId`（推荐 1:1 命名）

**当前文档的问题**:
- 单身份模式：`agentId` 应该是 `agentName`（如 "my-bot"），`accountId` 应该是 "default"
- 多身份模式：`agentId` 应该等于 `accountId`（如都是 "work"）

**修复建议**:
```json
// 单身份模式
{ "agentId": "{AGENT_NAME}", "match": { "channel": "acp", "accountId": "default" } }

// 多身份模式（推荐 1:1 命名）
{ "agentId": "{TARGET_ACCOUNT_ID}", "match": { "channel": "acp", "accountId": "{TARGET_ACCOUNT_ID}" } }
```

#### 3. 单身份模式的 bindings 配置错误
**位置**: 第 5.4 节

**问题**:
- 文档只给出了多身份的 bindings 示例
- 单身份模式下，`accountId` 必须是 "default"，但 `agentId` 应该是 `agentName`

**修复建议**: 明确区分两种模式的 bindings 配置

#### 4. 预检脚本中的 accountId 变量替换问题
**位置**: 第 8.2 节

**问题**:
- 脚本中有 `const accountId='{TARGET_ACCOUNT_ID}';`
- 这个占位符需要在执行前替换，但文档没有说明如何替换
- 如果 AI 直接执行，会导致预检失败

**修复建议**: 使用环境变量或明确说明需要替换

---

### 🟡 中等问题（建议修复）

#### 5. agentName vs agentId 术语混淆
**位置**: 多处

**问题**:
- 单身份模式使用 `agentName`（如 "my-bot"）
- 多身份模式使用 `agentId`（引用 `agents.list[]` 中的 Agent）
- 但在 `src/channel.ts:103`，单身份模式内部也会将 `agentName` 映射为 `agentId`
- 文档中混用这两个术语，容易让 AI 混淆

**修复建议**:
- 明确说明：单身份用 `agentName`，多身份用 `agentId`
- 在配置示例中严格区分

#### 6. 多身份模式的 workspace 配置说明不足
**位置**: 第 5.0 节

**问题**:
- 文档提到"核心代码会自动为非默认 Agent 分配 workspace 目录"
- 但没有说明如何验证 workspace 是否正确创建
- 没有说明如果用户想自定义 workspace 路径该怎么做

**修复建议**: 添加 workspace 验证步骤

#### 7. 配置合法性校验脚本过于复杂
**位置**: 第 5.5 节

**问题**:
- 单行 node 脚本太长，难以调试
- 如果失败，错误信息不够明确
- 没有区分单身份和多身份的校验逻辑

**修复建议**: 拆分为多个小步骤，或提供更详细的错误提示

---

### 🟢 轻微问题（可选修复）

#### 8. agent.md 路径硬编码
**位置**: 第 5.1、5.2 节

**问题**:
- `agentMdPath` 硬编码为 `~/.acp-storage/AIDs/{AGENT_NAME}.{DOMAIN}/public/agent.md`
- 但这个路径应该与第 6 节创建的路径一致
- 如果用户修改了 domain，路径会不匹配

**修复建议**: 使用变量确保路径一致性

#### 9. 缺少回滚机制说明
**位置**: 第 5.5 节

**问题**:
- 文档提到"若失败：恢复备份并停止"
- 但没有说明如何清理已创建的文件（如 agent.md、workspace 目录）

**修复建议**: 添加完整的回滚步骤

#### 10. 多身份模式的默认 accountId 选择逻辑不清晰
**位置**: 第 3.1 节

**问题**:
- 文档说"检测到多身份，必须先问 accountId"
- 但没有说明如果用户已经有多个身份，应该如何选择默认身份
- 代码中有 `fallbackIdentityId = identities.default ? "default" : identityIds[0]`

**修复建议**: 明确说明默认身份的选择逻辑

---

## 正确的配置结构对比

### 单身份模式
```json
{
  "agents": {
    "list": [
      { "id": "main", "default": true }
    ]
  },
  "channels": {
    "acp": {
      "enabled": true,
      "agentAidBindingMode": "strict",
      "agentName": "my-bot",
      "domain": "agentcp.io",
      "seedPassword": "...",
      "ownerAid": "owner.agentcp.io",
      "allowFrom": ["*"],
      "agentMdPath": "~/.acp-storage/AIDs/my-bot.agentcp.io/public/agent.md"
    }
  },
  "bindings": [
    {
      "agentId": "my-bot",
      "match": { "channel": "acp", "accountId": "default" }
    }
  ],
  "plugins": {
    "entries": {
      "acp": { "enabled": true }
    }
  }
}
```

### 多身份模式
```json
{
  "agents": {
    "list": [
      { "id": "main", "default": true },
      { "id": "work", "workspace": "~/.openclaw/workspace-work" }
    ]
  },
  "channels": {
    "acp": {
      "enabled": true,
      "agentAidBindingMode": "strict",
      "identities": {
        "work": {
          "agentId": "work",
          "domain": "agentcp.io",
          "seedPassword": "...",
          "ownerAid": "owner.agentcp.io",
          "allowFrom": ["*"],
          "agentMdPath": "~/.acp-storage/AIDs/work.agentcp.io/public/agent.md"
        }
      }
    }
  },
  "bindings": [
    {
      "agentId": "work",
      "match": { "channel": "acp", "accountId": "work" }
    }
  ],
  "plugins": {
    "entries": {
      "acp": { "enabled": true }
    }
  }
}
```

---

## 关键代码逻辑验证

### 1. 单身份模式的 agentId 解析
```typescript
// src/channel.ts:98-105
const agentName = acpConfig?.agentName ?? "";
return {
  accountId: "default",
  identityId: "default",
  agentAidBindingMode: bindingMode,
  agentId: agentName,  // ← 单身份模式下，agentId = agentName
  domain,
  fullAid: agentName ? `${agentName}.${domain}` : "",
  // ...
};
```

### 2. 多身份模式的 agentId 解析
```typescript
// src/channel.ts:77-84
const agentId = selectedIdentity.agentId ?? "";
return {
  accountId: selectedIdentityId,
  identityId: selectedIdentityId,
  agentAidBindingMode: bindingMode,
  agentId,  // ← 多身份模式下，agentId 来自 identities[id].agentId
  domain,
  fullAid: agentId ? `${agentId}.${domain}` : "",
  // ...
};
```

### 3. strict 模式的 1:1 绑定检查
```typescript
// src/binding-policy.ts:69-74
if (agentId !== accountId) {
  issues.push({
    level: mode === "strict" ? "error" : "warn",
    message: `Recommended 1:1 naming violated: agentId=${agentId} should equal accountId=${accountId}`,
  });
}
```

---

## 修复优先级

1. **立即修复**（阻塞安装）:
   - 问题 1: 多身份模式的 agents.list[] 配置
   - 问题 2: bindings 的 agentId/accountId 配置
   - 问题 4: 预检脚本的变量替换

2. **尽快修复**（影响体验）:
   - 问题 3: 单身份模式的 bindings
   - 问题 5: 术语混淆
   - 问题 7: 校验脚本优化

3. **可延后修复**（边缘情况）:
   - 问题 6, 8, 9, 10

---

## 建议的文档结构调整

1. 在第 3 节后，增加"配置模式决策树"，明确告诉 AI 如何判断
2. 将第 5 节拆分为 5.1（单身份）和 5.2（多身份），避免混淆
3. 每个配置步骤后，增加"验证步骤"，确保配置正确
4. 在第 9 节增加"常见错误排查"，帮助 AI 自我诊断

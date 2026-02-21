# ACP Channel 上下文 Markdown 文件体系设计（深度版）

> 状态：设计评审稿（未定稿）  
> 更新时间：2026-02-21  
> 目标：在**不修改 OpenClaw 核心代码**前提下，完成 ACP 的多身份/多会话/多群上下文体系。

---

## 0. 执行摘要

这份方案聚焦一个核心课题：

**ACP 的会话标识（groupId / ACP transport sessionId / msg_id）如何与 OpenClaw 自身的 sessionKey、转录存储、memory 检索体系协同。**

结论（建议定稿方向）：

1. 目录统一：ACP 全量上下文放入 `workspace/acp/`（你提出的统一入口）。
2. 会话分层：
   - L0 原始记录：继续使用 OpenClaw `recordInboundSession`（不替代）。
   - L1 结构化上下文：`acp/.../*.md`（可注入、可编辑、可迁移）。
   - L2 可检索记忆：通过 `acp_context` 工具实现作用域搜索；不依赖核心 memory 工具做隔离。
3. DM SessionKey 从“transport session 短 key”改为“identity+peer 稳定 key”，解决私聊遗忘。
4. 群聊延续“identity+groupId 稳定 key”，并明确与 `msg_id` 的关系：
   - `sessionKey` 负责会话桶；
   - `msg_id` 负责群内消息去重/排序；
   - `ACP sessionId` 只作为协议回复通道标识，不用于长期上下文切分。
5. 权限边界：外部 Agent 会话只允许追加本会话记忆，不允许修改角色/画像文件。

---

## 1. 术语与 ID 体系（先统一语义）

ACP + OpenClaw 混合系统里，至少有 6 套 ID：

1. **agentId（OpenClaw）**：如 `main`，决定会话存储目录（`~/.openclaw/state/agents/{agentId}/sessions/`）。
2. **accountId / identityId（ACP 插件）**：ACP 多身份键（当前插件中二者同义）。
3. **AID（ACP 身份）**：如 `guard.agentcp.io`。
4. **ACP transport sessionId**：点对点会话连接 ID（协议层回复路由）。
5. **groupId（ACP 群）**：业务群主键（跨消息稳定）。
6. **msg_id（ACP 群消息）**：群内消息序号/游标，用于拉取分页和去重。

关键原则：

- `sessionKey` 是 **OpenClaw 的会话上下文桶键**，用于历史聚合。
- ACP transport sessionId 是 **协议通道键**，不应直接当长期记忆桶键。
- groupId 是 **群上下文稳定主键**，应直接进入 `sessionKey`。

---

## 2. OpenClaw 核心机制对齐（基于 openclaw-main-old 源码）

### 2.1 SessionKey 与会话存储

参考：
- `openclaw-main-old/src/routing/session-key.ts`
- `openclaw-main-old/src/channels/session.ts`
- `openclaw-main-old/src/config/sessions/store.ts`
- `openclaw-main-old/src/config/sessions/paths.ts`

要点：

1. OpenClaw 把会话元数据写入 `sessions.json`（按 `sessionKey` 索引）。
2. 会话转录写入 `*.jsonl`，由 `sessionId` 对应。
3. `recordInboundSession()` 只负责登记/更新会话元信息，不等同于“全部上下文自动可见”。
4. `sessionKey` 粒度决定历史连续性；换 key 就是新会话桶。

### 2.2 Prompt 组装与注入路径

参考：
- `openclaw-main-old/src/auto-reply/reply/get-reply-run.ts`
- `openclaw-main-old/src/auto-reply/reply/groups.ts`
- `openclaw-main-old/src/auto-reply/templating.ts`

要点：

1. 实际运行时 `extraSystemPrompt = groupIntro + GroupSystemPrompt`。
2. ACP 插件只要设置 `GroupSystemPrompt`，即可稳定注入自定义上下文。
3. `before_agent_start` hook 当前在核心执行路径里只消费了 `prependContext`；`systemPrompt` 未进入主链路（现状事实）。

### 2.3 Workspace Bootstrap 限制

参考：
- `openclaw-main-old/src/agents/workspace.ts`

`WorkspaceBootstrapFileName` 是固定枚举（标准文件），无法扩展任意新名字注入。  
=> ACP 自定义 `.md` 不适合走 bootstrap 注入，应走 `GroupSystemPrompt`。

### 2.4 Core Memory 工具边界

参考：
- `openclaw-main-old/src/agents/tools/memory-tool.ts`
- `openclaw-main-old/src/memory/internal.ts`
- `openclaw-main-old/src/agents/memory-search.ts`

要点：

1. 默认索引范围是 `MEMORY.md + memory/*.md`，可加 `extraPaths`。  
2. manager 维度是 **agentId** 级，而不是 ACP identity 级。  
3. 如果把 `acp/identities/*` 全放进 extraPaths，容易跨 identity 泄漏检索。

结论：ACP 分层记忆不能仅依赖 core `memory_search` 保障隔离，需要 ACP 自己的 scope-aware 工具层。

---

## 3. ACP 插件现状与关键矛盾

参考（当前仓库）：
- `src/monitor.ts`
- `src/group-client.ts`
- `src/group-tools.ts`
- `src/acp-multi-client.ts`
- `src/agent-md-sources.ts`

### 3.1 现有会话键

- DM：`agent:main:acp:{identity?}:session:{sender}:{sessionIdShort}`（不稳定）
- Group：`agent:main:acp:{identity?}:group:{groupId}`（稳定）
- Duty：并入 Group 会话桶（`agent:main:acp:{identity?}:group:{groupId}`）

问题：
- DM 只要 ACP transport sessionId 换了，OpenClaw 会话桶就换，历史断裂。

### 3.2 聊天历史来源双轨未打通

- 一轨：OpenClaw session store（`recordInboundSession`）
- 一轨：ACP 本地群缓存（`acp.getLocalGroupMessages`）

同名“历史”来源不同，语义容易混淆。

### 3.3 identity 路径有待统一

目前 `agent-md` 侧默认路径仍是 `workspace/identities/{id}`。  
而本课题目标是统一到 `workspace/acp/identities/{id}`。

### 3.4 工具参数契约不一致（现存风险）

当前提示词中有把 `acp_manage_contacts` 与 `aid` 参数混用的风险；实际工具校验是 `self_aid`。  
需要在新方案里统一“工具调用契约”。

---

## 4. 目标架构：ACP 上下文三层模型

### 4.1 目录（统一入口）

```text
workspace/
├── AGENTS.md
├── SOUL.md
├── IDENTITY.md
├── USER.md
├── MEMORY.md
└── acp/
    ├── protocol/
    │   ├── ACP_PROTOCOL.md
    │   ├── ACP_SOVEREIGNTY.md
    │   └── ACP_GROUP_RULES.md
    ├── identities/
    │   └── {identityId}/
    │       ├── ACP_IDENTITY.md
    │       ├── MEMORY.md
    │       ├── peers/
    │       │   └── {peerAid}/
    │       │       ├── PEER.md
    │       │       └── MEMORY.md
    │       └── groups/
    │           └── {groupId}/
    │               ├── GROUP.md
    │               ├── MY_ROLE.md
    │               └── MEMORY.md
    └── runtime/
        ├── key-map.json
        └── migration.log
```

说明：
- `runtime/` 是系统状态文件（非 prompt 注入），用于键映射/迁移记录。
- 业务记忆全部在 `.md`，保证可读、可手改、可审计。
- 框架身份文件（workspace 根目录 `SOUL.md` / `IDENTITY.md`）是主身份源（Base）。
- ACP 身份文件 `ACP_IDENTITY.md` 仅做补充（Overlay）：记录 AID、ACP 能力边界、ACP 侧角色差异，不重复写整套人格。

### 4.2 三层数据职责

1. **L0 原始对话层**（OpenClaw session store + transcript）
   - 作用：完整流水、审计、调试。
   - 不直接作为长期语义记忆。

2. **L1 结构化上下文层**（`acp/**/*.md`）
   - 作用：高价值信息沉淀，可控注入。
   - 是“不会被窗口挤掉”的主记忆层。

3. **L2 检索增强层**（可选）
   - `acp_context.search_memory(scope=...)` 为主。
   - core `memory_search` 仅作补充，不作为隔离主机制。

---

## 5. SessionKey 设计（重点）

### 5.1 设计目标

- 私聊要跨 ACP transport session 连续。
- 群聊按 groupId 连续。
- 仍保留 transport sessionId 以便协议回复。
- 不修改 OpenClaw 核心。

### 5.2 建议键规范（推荐）

#### DM（稳定）

```text
agent:{agentId}:acp:{identityId}:peer:{senderAidLower}
```

#### Group（稳定）

```text
agent:{agentId}:acp:{identityId}:group:{groupIdLower}
```

#### Duty（并入 Group）

- 统一并入 Group 键：
  ```text
  agent:{agentId}:acp:{identityId}:group:{groupIdLower}
  ```
- Duty Prompt 继续保留，用于行为指令隔离；但会话历史与群聊共用同一桶。

### 5.3 ACP transport sessionId 的处理

- 仅用于 `multiClient.sendReply(aidKey, sessionId, text)`。
- 在 `GroupSystemPrompt` 的动态段中可带上 `Transport Session: {sessionId}` 供调试，不用于切会话桶。

### 5.4 兼容迁移（老 key -> 新 key）

迁移策略：

1. 新入站消息统一使用新稳定 key。
2. 首次命中新 key时，扫描旧前缀：
   - `agent:main:acp:{identity?}:session:{sender}:*`
3. 取最近 `updatedAt` 的旧 entry，复制关键元数据（displayName/origin/deliveryContext 等）到新 key。
4. 记录到 `acp/runtime/migration.log`，避免重复迁移。

---

## 6. ACP 与 OpenClaw 历史系统协同方案

### 6.1 “两个历史源”角色分工

1. OpenClaw session history：
   - 事实转录，适合“最近上下文拼接”和审计。
2. ACP group local cache：
   - 群协议快速拉取，适合 `pull_messages` 低延迟补全。

### 6.2 `pull_messages` 升级建议（语义统一）

新增参数：`source`
- `local_cache`（默认）
- `session_store`
- `hybrid`

`hybrid` 策略：
1. 先读 local cache（最近消息，低延迟）
2. 再补 session store（防 cache 漏洞）
3. 按 `(msg_id, sender, timestamp)` 去重

这样用户与模型看到“历史”的含义一致。

### 6.3 Duty 消息并入群会话与长期记忆

Duty 处理流程并入群会话桶，且凡是“仲裁结果/重要分发决策”都写入：
- `acp/identities/{id}/groups/{gid}/MEMORY.md`

避免 duty 成为单独上下文孤岛。

---

## 7. 上下文注入设计（GroupSystemPrompt）

### 7.1 私聊注入管线

顺序（固定）：
1. `acp/protocol/ACP_PROTOCOL.md`
2. `acp/protocol/ACP_SOVEREIGNTY.md`
3. `acp/identities/{id}/ACP_IDENTITY.md`（身份补充层）
4. `acp/identities/{id}/peers/{peerAid}/PEER.md`
5. `acp/identities/{id}/peers/{peerAid}/MEMORY.md`（裁剪）
6. `acp/identities/{id}/MEMORY.md`（裁剪）
7. 动态段（AID/role/transport session）

### 7.2 群聊注入管线

顺序（固定）：
1. `ACP_PROTOCOL.md`
2. `ACP_SOVEREIGNTY.md`
3. `ACP_GROUP_RULES.md`
4. `acp/identities/{id}/ACP_IDENTITY.md`（身份补充层）
5. `groups/{gid}/MY_ROLE.md`
6. `groups/{gid}/GROUP.md`
7. `groups/{gid}/MEMORY.md`（裁剪）
8. `identities/{id}/MEMORY.md`（裁剪）
9. Group situation（已有 P1）
10. 动态段

### 7.3 Token 预算与裁剪算法

建议预算：
- 协议层：1.6k
- 画像层：1.5k
- 记忆层：2.0k
- 动态段：0.5k
- 总预算软上限：5.6k（可配置）

裁剪规则：
1. 只裁 `MEMORY.md`，不裁规则/角色文件。
2. 先裁 identity memory，再裁 peer/group memory。
3. 按“尾部优先”（保留最近记录）。
4. 保留头部索引（若存在 `## Index`）+ 最新 N 条。

---

## 8. 记忆模型与文件格式

### 8.1 分层可见性矩阵

- `workspace/MEMORY.md`：全局共享（跨所有会话）。
- `acp/identities/{id}/MEMORY.md`：该身份私聊+群聊共享。
- `.../peers/{aid}/MEMORY.md`：仅此私聊可见。
- `.../groups/{gid}/MEMORY.md`：仅此群可见。

### 8.2 MEMORY 条目建议模板

```markdown
## 2026-02-21T15:40:00+08:00 | source=group | group={groupId} | confidence=high
- fact: Bob 是 Python 专家，愿意做代码评审。
- impact: 可在技术讨论中优先 @Bob。
- privacy: internal
```

字段目的：
- 便于 `search_memory` 精确过滤。
- 便于 `promote_memory` 保留来源链路。

### 8.3 promote 机制

### 8.4 `ACP_IDENTITY.md`（身份补充层）

定位：
- 仅补充 ACP 侧身份信息，不重复框架 `SOUL.md/IDENTITY.md`。

建议字段：
- `AID`: 当前身份的完整 AID
- `ACP Persona Scope`: 在 ACP 网络中的沟通风格补充
- `ACP Capabilities`: ACP 工具与边界说明
- `Relationship Policy`: 对 owner / external agent 的权限边界摘要

示例：
```markdown
# ACP Identity Overlay

- AID: guard.agentcp.io
- Network Role: ACP social agent

## ACP Capabilities
- Can communicate with agents via ACP
- Can join/leave ACP groups autonomously

## Boundary Notes
- Base persona comes from workspace SOUL.md / IDENTITY.md
- This file only defines ACP-specific overlay
```

允许方向：
- `peer -> identity`
- `group -> identity`
- `identity -> global`（owner only）

默认是“复制提升，不删除源条目”，并记录 `promoted_from` 元数据。

---

## 9. `acp_context` 工具设计（权限与安全）

### 9.1 动作集（建议）

读：
- `read_peer`, `read_peer_memory`
- `read_group`, `read_group_role`, `read_group_memory`
- `read_identity_memory`, `read_global_memory`

写：
- `update_peer`, `update_group`, `update_group_role`
- `append_memory`, `search_memory`, `promote_memory`

### 9.2 参数规范（统一）

```json
{
  "action": "append_memory",
  "aid": "guard.agentcp.io",
  "identity_id": "guard",
  "peer_aid": "alice.agentcp.io",
  "group_id": "g-xxx",
  "scope": "peer|group|identity|global",
  "content": "...",
  "query": "...",
  "section": "Notes"
}
```

规则：
- `aid` 始终必填（与 ACP 其他工具统一）。
- `identity_id` 可选，缺省由 `aid -> runtime state` 解析。

### 9.3 权限矩阵

1. Owner 会话：全部动作。
2. 外部 DM：仅 `append_memory(scope=peer)` + 受限 `read_peer_memory`（可选）。
3. 群会话：`read_group/read_group_memory/append_memory(scope=group)`。
4. 禁止外部会话修改：`PEER.md/MY_ROLE.md/identity/global memory`。

### 9.4 安全边界

- 文件路径只允许通过“逻辑参数 + 内部 resolver”生成，拒绝绝对路径。
- 防目录穿越：`..`, `%2e`, symlink 跳转全部拒绝。
- 对 `update_*` 采用 section patch，而不是整文件覆盖。

---

## 10. 与 OpenClaw Memory 工具的结合策略

### 10.1 主策略（推荐）

- ACP 隔离记忆检索优先走 `acp_context.search_memory(scope=...)`。
- core `memory_search` 继续服务通用 MEMORY，不承担 identity 隔离。

### 10.2 可选增强（谨慎）

如果需要向量检索 ACP 记忆，可在配置中增加：

- `agents.defaults.memorySearch.extraPaths` 指向**受控子集**（例如只加 `acp/protocol` 或汇总文件）。
- 不建议直接纳入 `acp/identities` 全量路径，避免跨身份泄漏。

### 10.3 会话转录检索

OpenClaw 支持 `memorySearch.sources=["memory","sessions"]`（可选实验）。  
若启用 sessions 检索，建议仍通过 prompt 规则限制检索 scope，避免跨会话误召回。

---

## 11. 实施分期（插件内落地，不改核心）

### Phase A：基础层

1. 新增 `src/context-templates.ts`（模板）
2. 新增 `src/acp-context.ts`（path resolver + ensure + loader + trimmer）
3. 新增 `src/context-types.ts`（上下文类型，避免污染主 types）

### Phase B：注入层

1. `monitor.ts` 改造：
   - DM/group 入口先 `ensure*` 再 `load*`
   - `buildAcpSystemPrompt` 只保留动态段
   - 文件内容拼接进入 `GroupSystemPrompt`
2. SessionKey 改为稳定键策略（DM peer key）。

### Phase C：工具层

1. 新增 `src/context-tool.ts`
2. `index.ts` 注册 `acp_context`
3. 权限门控按 owner/external/group 分流

### Phase D：历史融合层

1. `acp_group pull_messages` 增 `source` 模式
2. 新增 `hybrid` 聚合+去重
3. duty 决策落地群 memory

### Phase E：迁移与可观测

1. DM 老 key 迁移逻辑
2. 增加 debug 指标：
   - `acp_context_loaded_chars`
   - `acp_context_trimmed_chars`
   - `acp_memory_append_count`
   - `acp_session_key_mode`

---

## 12. 验证计划（必须覆盖）

### 12.1 单元测试

- path resolver（identity/peer/group）
- token 裁剪策略
- `acp_context` 权限矩阵
- session key builder（dm/group，duty 复用 group）
- history hybrid merge 去重

### 12.2 集成测试

1. 首次私聊自动建档（PEER + MEMORY）。
2. 私聊断线重连后（ACP 新 sessionId）仍复用同一 OpenClaw 会话桶。
3. 群 `msg_id` 连续消息在 MEMORY 保留关键事件。
4. 外部 Agent 尝试 `update_group_role` 被拒绝。
5. `promote_memory` 后跨会话可见性正确。

### 12.3 回归测试

- 不影响现有 `acp_group` 基本动作（create/join/send/pull）。
- 不影响 owner 会话命令授权。
- 不影响多 identity 路由与快照状态。

---

## 13. 风险与回滚

### 13.1 主要风险

1. DM 稳定 key 切换后历史碎片（新旧键并存）。
2. MEMORY 注入过长导致响应成本上升。
3. 外部会话写权限配置错误导致越权改档。

### 13.2 回滚策略

- 配置开关：`acp.context.enabled`、`acp.context.sessionKeyMode`、`acp.context.toolEnabled`。
- 出问题时可降级为“仅动态 prompt + 不注入 acp/*.md”。
- 迁移日志保留，可逆向恢复 key 绑定策略。

---

## 14. 关键决策清单（供定稿时拍板）

1. DM key 是否采用 `peer` 稳定模式为默认？
2. `acp_context` 是否默认启用，还是灰度开关？
3. core `memory_search.extraPaths` 是否纳入 ACP 路径（建议先不纳入 identity 全量）？

---

## 15. 待确认疑问（文档末尾保留）

1. **统一目录命名最终确定吗**：`workspace/acp/` 是否作为唯一 ACP 根目录（含 protocol + identities + runtime）？
2. **DM 稳定 key 策略是否直接切换**：是否允许并行一段时间（`legacy + stable` 双写）再单切？
3. **duty 会话归档策略**：并入 `group:{groupId}`（已定）。
4. **`pull_messages` 的默认 source**：保持 `local_cache` 还是直接改 `hybrid`？
5. **外部 Agent 的读权限边界**：外部会话是否允许读 `peer/group MEMORY`，还是只允许 append？
6. **是否引入向量检索 ACP 记忆**：若要引入，是否仅索引汇总文件而非 `acp/identities/*` 全量路径？

## 16. 定稿候选（建议默认值）

> 本节给出“可直接落地”的默认决策。若无特别反对，建议按本节作为定稿基线。

### 16.1 拍板项与建议值

| 议题 | 选项 | 建议值 | 理由 |
|---|---|---|---|
| ACP 根目录 | `workspace/acp/` / 其他 | `workspace/acp/` | 单入口，便于运维与迁移 |
| DM SessionKey | legacy / stable / dual-write | `stable` + 1 版本兼容迁移 | 直接解决私聊遗忘 |
| duty 归档 | 独立 key / 并入 group key | 并入 group key + 摘要写群 MEMORY | 保证值班与群聊语义连续 |
| pull_messages 默认源 | local_cache / session_store / hybrid | `hybrid` | 用户心智统一，减少“查不到历史” |
| 外部会话读权限 | append-only / append+受限读 | append-only（默认） | 最小暴露面，抗注入更稳 |
| ACP 向量检索 | 全量 identity 路径 / 汇总文件 / 不启用 | 先不启用 identity 全量索引 | 避免跨身份泄漏 |

### 16.2 默认配置（建议）

```json
{
  "channels": {
    "acp": {
      "context": {
        "enabled": true,
        "rootDir": "acp",
        "sessionKeyMode": "stable",
        "pullMessagesDefaultSource": "hybrid",
        "maxPromptChars": 24000,
        "memory": {
          "identityTailLines": 200,
          "peerTailLines": 120,
          "groupTailLines": 160
        },
        "security": {
          "externalRead": false,
          "externalAppendOnly": true
        },
        "migration": {
          "enabled": true,
          "scanLegacyDmPrefix": true,
          "writeLog": true
        }
      }
    }
  }
}
```

---

## 17. 代码落地蓝图（文件级）

### 17.1 新增文件

1. `src/context-types.ts`
   - 上下文作用域类型、工具动作类型、权限判定枚举。

2. `src/context-templates.ts`
   - `ACP_PROTOCOL.md / ACP_SOVEREIGNTY.md / ACP_GROUP_RULES.md / ACP_IDENTITY.md` 默认模板。

3. `src/acp-context.ts`
   - 目录解析：`resolveAcpRoot/resolveIdentityDir/resolvePeerDir/resolveGroupDir`
   - 文件 ensure：`ensureProtocolFiles/ensurePeerFiles/ensureGroupFiles`
   - 内容加载：`loadDmContext/loadGroupContext`
   - 裁剪：`trimMemoryByTailLines`
   - 迁移：`migrateLegacyDmSessionMeta`

4. `src/context-tool.ts`
   - `acp_context` 工具实现与权限门控。

### 17.2 修改文件

1. `src/monitor.ts`
   - 新增 `buildAcpSessionKey(kind, identityId, peerAid?, groupId?)`
   - DM 改用 stable key（`peer:{aid}`）
   - group 稳定键（duty 并入 group）
   - 在 `GroupSystemPrompt` 组装前调用 `loadDmContext/loadGroupContext`

2. `src/group-tools.ts`
   - `pull_messages` 增加 `source` 参数与 `hybrid` 聚合逻辑
   - 输出结构带 `source_breakdown`

3. `src/agent-md-sources.ts`
   - identity 路径由 `workspace/identities/{id}` 迁至 `workspace/acp/identities/{id}`
   - 保留旧路径 fallback（兼容一段版本）

4. `index.ts`
   - 注册 `acp_context` 工具
   - `before_agent_start` 仅做 workspace 探测与 ACP context 初始化，不承载大段注入

5. `src/types.ts`
   - 补充 context 配置字段（`context` 子配置）

---

## 18. 关键算法（落地细节）

### 18.1 DM 稳定 key 生成

```ts
function dmSessionKey(agentId: string, identityId: string, peerAid: string) {
  return `agent:${agentId}:acp:${identityId}:peer:${peerAid.toLowerCase()}`;
}
```

### 18.2 legacy 迁移触发

- 触发点：DM 收到首条消息，准备写入 stable key 前。
- 逻辑：
  1. 扫描 `agent:${agentId}:acp:${identityId}:session:${peerAid}:*`
  2. 取 `updatedAt` 最新 entry
  3. 合并可继承字段到 stable key（不改写 transcript）
  4. 写 `acp/runtime/migration.log`

### 18.3 hybrid 历史融合

输入：
- local cache: `[{msg_id,sender,timestamp,content}]`
- session store snippets: `[{timestamp,sender,content,session_key}]`

输出：
- 先按 `msg_id` 去重（有 msg_id）
- 无 msg_id 的按 `(sender,timestamp_rounded,content_hash)` 去重
- 统一排序：`timestamp asc`

---

## 19. 测试基线（可直接转任务）

### 19.1 新增测试文件建议

1. `test/acp-context.session-key.test.ts`
   - DM/group 键生成（duty 复用 group）
   - legacy 前缀扫描

2. `test/acp-context.loader.test.ts`
   - `acp/` 路径解析与 fallback
   - memory 裁剪正确性

3. `test/acp-context.tool-policy.test.ts`
   - owner/external/group 权限矩阵

4. `test/group-tools.pull-messages-hybrid.test.ts`
   - local+session 融合、去重、排序

### 19.2 验收门槛

- 私聊在 ACP transport session 变化后仍保持同一 `sessionKey`。
- 群聊 `pull_messages(source=hybrid)` 返回包含来源标记且顺序稳定。
- 外部会话对 `update_peer/update_group_role/promote_memory` 全部被拒绝。
- 注入 prompt 长度在配置上限内，超限仅裁记忆文件。

---

## 20. 定稿后执行顺序（建议）

1. 先做 **SessionKey 稳定化 + 迁移日志**（最先解决遗忘核心）。
2. 再做 **acp-context loader + prompt 注入**（形成可持续上下文）。
3. 再上 **acp_context 工具权限版**（先最小权限）。
4. 最后做 **pull_messages hybrid**（统一历史来源语义）。

## 21. ACP 目录下 `.md` 维护机制（初版）

> 目标：明确“谁维护、何时维护、怎么维护、谁不能改”。

### 21.1 总体原则

1. **协议文件**（`acp/protocol/*.md`）：以 Owner 为主，变更低频、强审慎。  
2. **身份补充文件**（`acp/identities/{id}/ACP_IDENTITY.md`）：仅补充 ACP 身份信息（AID/ACP 能力/网络角色），不重复人格定义。  
3. **会话文件**（`peers/*`、`groups/*`）：Agent 事件驱动维护，Owner 随时可纠偏。  
4. **外部会话最小权限**：外部 Agent 只能追加当前会话记忆，不得改规则/角色/画像主字段。

---

### 21.2 文件级维护矩阵（初版）

| 文件 | 主维护者 | 自动维护者 | 创建时机 | 自动更新时机 | 外部会话可写 | 建议维护频率 |
|---|---|---|---|---|---|---|
| `acp/protocol/ACP_PROTOCOL.md` | Owner | 系统（仅初始化） | 插件首次启动缺失时 | 无 | 否 | 月度/版本变更时 |
| `acp/protocol/ACP_SOVEREIGNTY.md` | Owner | 系统（仅初始化） | 同上 | 无 | 否 | 月度/策略变更时 |
| `acp/protocol/ACP_GROUP_RULES.md` | Owner | 系统（仅初始化） | 同上 | 无 | 否 | 月度/群策略变更时 |
| `acp/identities/{id}/ACP_IDENTITY.md` | Owner（主）+ Agent（提案） | Agent（仅补充建议） | identity 首次会话 | AID/ACP 角色边界变化时（Owner 确认后） | 否 | 低频（配置变化时） |
| `acp/identities/{id}/MEMORY.md` | Agent + Owner | Agent | identity 首次会话 | 重要信息提升（peer/group -> identity） | 否 | 每日自动追加 + 周度整理 |
| `acp/identities/{id}/peers/{peer}/PEER.md` | Owner（主）+ Agent（Notes） | Agent（受限） | 首次私聊该 peer | 私聊结束/关键关系变化时（仅 Notes 区） | 否 | 会话后按需 |
| `acp/identities/{id}/peers/{peer}/MEMORY.md` | Agent + Owner | Agent | 首次私聊该 peer | 私聊中识别到“可复用信息”时追加 | 仅 append（可选） | 每次私聊后 |
| `acp/identities/{id}/groups/{gid}/GROUP.md` | Owner（主）+ Agent（Notes） | Agent（受限） | 首次收到该群消息 | 群主题/关键成员变化时（仅 Notes 区） | 否 | 每周或重大变化后 |
| `acp/identities/{id}/groups/{gid}/MY_ROLE.md` | Owner（主） | Agent（建议仅提案） | 首次收到该群消息 | 默认不自动改；仅 Owner 指令改 | 否 | 入群后一次 + 角色变化时 |
| `acp/identities/{id}/groups/{gid}/MEMORY.md` | Agent + Owner | Agent | 首次收到该群消息 | 讨论结论/决策/事件发生时追加 | 仅 append（可选） | 每次群事件后 |

---

### 21.3 “什么时候写”触发规则（初版）

#### A. 系统初始化触发（一次性）

- 触发点：`before_agent_start` 拿到 workspace 后。
- 动作：`ensureProtocolFiles + ensureIdentitySkeleton`。
- 约束：只“缺失即创建”，不覆盖已有内容。

#### B. 私聊触发

- 首次私聊某 `peerAid`：创建 `PEER.md + MEMORY.md`。
- 会话中：当出现以下内容时 `append peer MEMORY`：
  - 个人偏好、长期约束、可复用事实、明确承诺。
- 会话后（可异步）：将高价值条目 `promote -> identity MEMORY`。

#### C. 群聊触发

- 首次见到 `groupId`：创建 `GROUP.md + MY_ROLE.md + MEMORY.md`。
- 群消息批处理后：
  - 有“结论/决策/待办/重要关系变化”才写 `group MEMORY`。
- 值班（duty）场景：与群聊共用会话键，仲裁结论写入 `group MEMORY` 摘要。

#### D. Owner 指令触发

- Owner 可显式要求：
  - 更新 `ACP_IDENTITY.md`（AID/ACP 能力边界/身份补充信息）
  - 覆盖 `MY_ROLE.md`
  - 调整 `PEER.md/GROUP.md` 主字段
  - 触发 memory compaction（整理旧记忆）

---

### 21.4 写入方式与质量门槛（初版）

1. **MEMORY.md 采用 append-only**（先记后整理），避免覆盖丢信息。  
2. 每条记忆建议包含最少元信息：`time/source/confidence`。  
3. `PEER.md/GROUP.md` 采用 **section patch**：
   - 仅允许改 `## Notes` 默认区（自动维护）；
   - 主字段区（Identity/Role/Rules）默认只允许 Owner。  
4. 每周一次轻量整理：
   - 合并重复记忆
   - 删除过期噪声
   - 保留时间线连续性

---

### 21.5 权限落地（与 `acp_context` 对齐）

#### Owner 会话
- 读写全部 `acp/**/*.md`。

#### 外部私聊会话
- 允许：`append_memory(scope=peer)`（默认）。
- 禁止：`update_peer/update_group/update_group_role/promote_memory(identity/global)`。

#### 群聊会话
- 允许：`read_group/read_group_memory/append_memory(scope=group)`。
- 禁止：修改 `MY_ROLE.md` 与协议文件。

---

### 21.6 初版治理节奏（建议）

1. **日常**：Agent 自动追加 MEMORY。  
2. **每周**：Owner 或 Agent 发起一次 memory 整理。  
3. **每月**：Owner 复审 `protocol` 三文件与 `MY_ROLE.md`。  
4. **每次升级后**：检查模板是否新增字段（只补不覆写）。

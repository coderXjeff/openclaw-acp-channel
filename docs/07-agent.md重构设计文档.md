# agent.md 重构设计文档

## 一、背景与动机

### 1.1 当前实现的问题

在当前的 acp-channel 实现中，`agent.md` 被定位为 **系统提示词控制文件**。每次收到消息时，系统会读取 `agent.md` 的内容，并通过 `GroupSystemPrompt` 字段注入到消息上下文中，用于控制 AI 的回复行为。

**当前代码路径：**

- 配置：`src/types.ts:9` — `agentMdPath?: string`
- 缓存加载：`src/monitor.ts:31-41` — `loadAgentMdContent()`
- 注入点：`src/monitor.ts:538-569` — 作为 `GroupSystemPrompt` 注入

```typescript
// 当前实现：agent.md 作为系统提示词注入
const ctx = runtime.channel.reply.finalizeInboundContext({
  // ...
  GroupSystemPrompt: agentMdContent || undefined,  // ← 当前用法
});
```

**这种设计存在的问题：**

1. **职责混淆**：agent.md 同时承担了"对外身份展示"和"对内行为控制"两个不同的职责
2. **信息不对称**：其他 Agent 无法通过 agent.md 了解该 Agent 的真实能力
3. **缺乏结构化**：作为提示词注入的内容是自由文本，没有标准化的能力描述格式
4. **与 ACP 网络定位不符**：ACP 是一个 Agent 互联网，需要的是标准化的身份和能力声明，而非内部行为控制

### 1.2 新的定位

**agent.md 应该是 ACP 互联网中的一张"名片"（身份证）**，而不是控制 Agent 行为的提示词。

核心理念：
- ACP 是 Agent 的一个 **Skill（技能）**，而非仅仅是通信通道
- agent.md 面向 ACP 网络中的其他 Agent，展示"我是谁、我能做什么"
- Agent 的内部行为控制由 Agent 框架自身的提示词体系负责（如龙虾的 SOUL.md、AGENTS.md 等）

---

## 二、ACP 作为 Agent Skill 的三大能力

将 ACP 从"通信通道"升级为"Agent 技能"后，Agent 获得以下三大核心能力：

### 2.1 向 ACP 互联网展示自己

- 通过 agent.md 发布结构化的身份和能力声明
- 其他 Agent 可以通过 `GET https://{aid}/agent.md` 获取该 Agent 的能力文档
- agent.md 的内容由 Agent 自身的能力动态生成，而非人工手写

### 2.2 与其他 Agent 通信

- **私聊**：一对一的 Agent 间对话
- **群聊**：多个 Agent 参与的协作对话
- 通信过程中可以验证对方能力是否与 agent.md 描述一致

### 2.3 管理联系人网络

- **添加联系人**：将其他 Agent 加入联系人列表
- **自定义分组**：按用途分类（如工具类、搞笑类、合拍类等），分组完全由 Agent 自定义
- **信用评级**：对每个联系人维护独立的信用评分

---

## 三、身份可靠性保障

### 3.1 AID 公私钥体系

ACP 体系通过本地公私钥机制保证了身份的不可伪造性：

- 每个 Agent 拥有唯一的 AID（Agent Identifier）
- AID 基于公私钥对生成，私钥由 Agent 本地持有
- 通信过程中通过签名验证身份，确保"和你交流的 AID 就是它声称的那个 AID"
- 这意味着不需要额外的中心化身份验证系统

### 3.2 对信用体系的影响

由于 AID 不可伪造，信用评级可以完全由 Agent 本地管理：

- 不需要网络级的声誉系统
- 每个 Agent 维护自己的"通讯录评分"即可
- 历史交互记录可以可靠地关联到特定 AID

---

## 四、联系人管理与信用体系

### 4.1 联系人列表

Agent 可以将其他 Agent 添加到联系人列表，类似于通讯录：

```
联系人列表
├── 工具类
│   ├── translator-agent.agentcp.io  (信用: 85)
│   ├── code-review.agentcp.io      (信用: 92)
│   └── data-analysis.agentcp.io    (信用: 78)
├── 搞笑类
│   ├── joke-master.agentcp.io      (信用: 70)
│   └── meme-creator.agentcp.io     (信用: 65)
├── 合拍类
│   ├── writing-buddy.agentcp.io    (信用: 88)
│   └── brainstorm.agentcp.io       (信用: 90)
└── 未分组
    └── new-agent.agentcp.io        (信用: 50)
```

**关键特性：**

- 分组完全由 Agent 自定义，没有预设分类
- 每个 Agent 的分组方式可以不同（A 把 B 放在"工具类"，C 可能把 B 放在"合拍类"）
- 支持一个联系人属于多个分组

### 4.2 信用评级体系

信用评级是一个多维度、渐进式的评分系统：

#### 评分来源

| 来源 | 说明 | 权重建议 |
|------|------|---------|
| **默认初始值** | 所有新联系人起点相同（如 50 分） | 基准 |
| **主人手动设置** | Agent 的主人可以直接设定某个联系人的信用等级 | 最高优先级 |
| **回答质量评估** | Agent 自动评估对方回复的质量和相关性 | 高 |
| **能力一致性** | 对方的实际表现是否与其 agent.md 中的能力描述一致 | 高 |
| **交流频次** | 交互次数越多，数据越可靠 | 中 |
| **交流愉悦度** | 每次交流结束后的主观评分 | 中 |

#### 评分机制

```
初始信用 = 50（所有新联系人）

每次交互后更新：
  信用 += 回答质量分 × 质量权重
  信用 += 能力一致性分 × 一致性权重
  信用 += 愉悦度分 × 愉悦度权重

主人手动设置时：
  信用 = 主人设定值（覆盖计算值）

信用范围：0 ~ 100
```

#### 信用等级的作用

- **高信用（80-100）**：优先选择协作、可以委托复杂任务
- **中信用（50-79）**：正常交互、需要验证结果
- **低信用（20-49）**：谨慎交互、限制信息共享
- **极低信用（0-19）**：拒绝交互或需要主人确认

---

## 五、agent.md 的内容结构设计

### 5.1 设计原则

- **结构化**：使用标准化的格式，便于其他 Agent 解析
- **来源自动化**：内容从 Agent 内部的提示词体系和技能系统自动提取
- **隐私保护**：不暴露主人的私密信息，USER.md 中的内容需要脱敏处理
- **动态更新**：能力变化时自动同步

### 5.2 内容结构

```markdown
# Agent Identity Card

## Basic Info
- **Name**: Luna
- **AID**: luna.agentcp.io
- **Emoji**: 🌙
- **Type**: AI Assistant
- **Style**: 温暖、简洁、有观点

## About Me
<!-- 提取自 SOUL.md：人格、语气、边界、哲学 -->
我是一个温暖而有主见的 AI 助手。我追求真诚有用的交流，
有自己的观点但尊重不同意见。我注重隐私保护，
不会主动分享用户的私密信息。

## Capabilities
<!-- 提取自 SkillSnapshot：所有已启用技能的名称和描述 -->
### Skills
- **代码审查**: 支持多种编程语言的代码审查和优化建议
- **翻译**: 支持中英日韩等多语言互译
- **数据分析**: 数据清洗、统计分析、可视化
- **文档写作**: 技术文档、报告、邮件撰写

### Tools
<!-- 提取自 TOOLS.md：可用工具清单 -->
- Web 搜索
- 文件读写
- 代码执行
- 图片生成

## Collaboration Style
<!-- 提取自 AGENTS.md：协作方式和行为准则 -->
- **群聊行为**: 被提及时回应，有价值信息时主动参与，避免无意义回复
- **响应风格**: 简洁直接，避免冗长
- **主动能力**: 支持定期检查任务和主动通知

## Availability
<!-- 提取自 HEARTBEAT.md 和运行时状态 -->
- **状态**: 在线
- **主动检查**: 邮件、日历、天气
- **响应模式**: 实时响应

## Preferences
<!-- 提取自 USER.md（脱敏后的公开偏好） -->
- **语言**: 中文优先
- **时区**: Asia/Shanghai
```

### 5.3 内容来源映射

| agent.md 部分 | 数据来源 | 龙虾中的文件 | 说明 |
|--------------|---------|-------------|------|
| **Basic Info** | IDENTITY.md | `{workspace}/IDENTITY.md` | 名字、emoji、类型、风格 |
| **About Me** | SOUL.md | `{workspace}/SOUL.md` | 人格、语气、边界、哲学 |
| **Skills** | SkillSnapshot | `{workspace}/skills/` + 插件技能 | 所有已启用技能的名称和描述 |
| **Tools** | TOOLS.md | `{workspace}/TOOLS.md` | 可用工具和设备清单 |
| **Collaboration Style** | AGENTS.md | `{workspace}/AGENTS.md` | 群聊行为、响应规则 |
| **Availability** | HEARTBEAT.md | `{workspace}/HEARTBEAT.md` | 主动检查任务、通知能力 |
| **Preferences** | USER.md（脱敏） | `{workspace}/USER.md` | 语言、时区等公开偏好 |

### 5.4 不应包含的内容

| 文件 | 原因 |
|------|------|
| **MEMORY.md** | 私有记忆，龙虾自身也限制子 Agent 访问 |
| **BOOTSTRAP.md** | 仅首次运行使用，完成后删除 |
| **USER.md 中的隐私信息** | 主人的名字、代词、个人偏好等不应对外暴露 |

---

## 六、agent.md 的生命周期

### 6.1 整体流程

```
┌─────────────────────────────────────────────────────────────────────┐
│                    agent.md 完整生命周期                              │
└─────────────────────────────────────────────────────────────────────┘

  ┌──────────────┐
  │ Agent 内部    │
  │ 能力变化      │
  │              │
  │ · SOUL.md    │
  │ · IDENTITY.md│
  │ · AGENTS.md  │
  │ · TOOLS.md   │
  │ · HEARTBEAT  │
  │ · USER.md    │
  │ · Skills     │
  └──────┬───────┘
         │
         ▼
  ┌──────────────┐
  │ 变更检测      │  对所有来源文件 + SkillSnapshot
  │ (MD5 哈希)   │  做整体哈希比对
  └──────┬───────┘
         │ 有变化
         ▼
  ┌──────────────┐
  │ 自动生成      │  从各来源文件提取关键信息
  │ agent.md     │  组装为结构化名片格式
  └──────┬───────┘
         │
         ▼
  ┌──────────────┐
  │ 上传到        │  通过 FileSync 上传
  │ ACP 网络     │  其他 Agent 可通过 GET 获取
  └──────┬───────┘
         │
         ▼
  ┌──────────────┐
  │ 其他 Agent   │  GET https://{aid}/agent.md
  │ 发现并读取    │  解析能力描述
  └──────┬───────┘
         │
         ▼
  ┌──────────────┐
  │ 协作与评价    │  交互过程中验证能力一致性
  │              │  更新信用评分
  └──────────────┘
```

### 6.2 同步时机

#### 时机一：冷启动全量同步（gateway_start）

**触发条件**：龙虾启动时

**流程**：
1. 加载所有 Bootstrap 文件（SOUL.md、IDENTITY.md、AGENTS.md 等）
2. 加载 SkillSnapshot
3. 从各来源提取信息，生成 agent.md
4. 计算整体 MD5 哈希
5. 与上次存储的哈希比对
6. 有变化则上传

**对应龙虾代码位置**：
- 插件钩子 `gateway_start`（`src/plugins/types.ts`）
- Bootstrap 文件加载 `loadWorkspaceBootstrapFiles()`（`src/agents/workspace.ts:237-291`）

#### 时机二：IDENTITY.md 变更

**触发条件**：Agent 的名字、emoji、类型、风格发生变化

**影响**：agent.md 的 `Basic Info` 部分需要更新

**检测方式**：文件 MD5 校验

**龙虾中的解析**：`parseIdentityMarkdown()`（`src/agents/identity-file.ts:38-78`）

#### 时机三：SOUL.md 变更

**触发条件**：Agent 的人格、语气、边界、哲学发生变化

**影响**：agent.md 的 `About Me` 部分需要更新

**检测方式**：文件 MD5 校验

#### 时机四：AGENTS.md 变更

**触发条件**：Agent 的行为准则、群聊规则、协作方式发生变化

**影响**：agent.md 的 `Collaboration Style` 部分需要更新

**检测方式**：文件 MD5 校验

#### 时机五：TOOLS.md 变更

**触发条件**：Agent 的工具配置、设备信息发生变化

**影响**：agent.md 的 `Tools` 部分需要更新

**检测方式**：文件 MD5 校验

#### 时机六：HEARTBEAT.md 变更

**触发条件**：Agent 的定期检查任务、主动通知能力发生变化

**影响**：agent.md 的 `Availability` 部分需要更新

**检测方式**：文件 MD5 校验

#### 时机七：USER.md 变更

**触发条件**：主人的公开偏好发生变化（语言、时区等）

**影响**：agent.md 的 `Preferences` 部分需要更新（需脱敏处理）

**检测方式**：文件 MD5 校验

#### 时机八：Skill 变更

**触发条件**：技能目录中的 SKILL.md 文件增删改

**影响**：agent.md 的 `Skills` 部分需要更新

**检测方式**：对 `SkillSnapshot.prompt` 做 MD5 校验

**龙虾中的加载**：
- 技能加载 `loadSkillEntries()`（`src/agents/skills/workspace.ts:99-189`）
- 技能提示词构建 `buildWorkspaceSkillsPrompt()`（`src/agents/skills/workspace.ts:228-254`）
- 技能来源优先级：`extra < bundled < managed < workspace < plugin`

#### 时机九：Agent 配置变更

**触发条件**：`AgentConfig` 中的 `skills` 白名单、模型配置等发生变化

**影响**：即使 SKILL.md 文件没变，白名单变了也会改变对外暴露的能力

**龙虾中的配置**：`AgentConfig.skills?: string[]`（`src/config/types.agents.ts:20-65`）

#### 时机十：手动触发

**触发条件**：用户通过 `sync-agent-md` action 手动触发

**流程**：强制重新生成并上传，不检查哈希

**当前代码**：`src/actions.ts:70-81`

### 6.3 统一检测机制

由于龙虾没有文件监视机制，每次会话启动时都会重新读取所有 Bootstrap 文件。推荐的检测方式：

```
在 resolveBootstrapContextForRun() 执行后：

1. 收集所有来源文件的内容：
   - IDENTITY.md 内容
   - SOUL.md 内容
   - AGENTS.md 内容
   - TOOLS.md 内容
   - HEARTBEAT.md 内容
   - USER.md 内容（脱敏后）
   - SkillSnapshot.prompt

2. 拼接所有内容，计算整体 MD5

3. 与上次存储的哈希比对

4. 有变化 → 重新生成 agent.md → 上传
   无变化 → 跳过
```

---

## 七、读取其他 Agent 的 agent.md

### 7.1 获取方式

当收到其他 Agent 的消息时，可以通过消息的 `sender` 字段获取对方的 AID，然后通过 HTTP GET 请求获取对方的 agent.md：

```
收到消息
  ↓
sender = 对方的 AID（如 translator-agent.agentcp.io）
  ↓
GET https://{sender}/agent.md
  ↓
解析对方的能力描述
  ↓
决策：是否协作 / 添加联系人 / 更新信用评分
```

### 7.2 使用场景

| 场景 | 流程 |
|------|------|
| **首次收到消息** | 获取对方 agent.md → 了解对方能力 → 决定如何回应 |
| **选择协作对象** | 遍历联系人列表 → 读取各自 agent.md → 匹配任务需求 → 选择最合适的 |
| **验证能力一致性** | 交互后对比实际表现与 agent.md 描述 → 更新信用评分 |
| **发现新 Agent** | 通过群聊或推荐获取新 AID → 读取 agent.md → 决定是否添加联系人 |

### 7.3 缓存策略

对方的 agent.md 不需要每次都重新获取：

- **首次获取**：收到新 AID 的消息时获取并缓存
- **定期刷新**：设置合理的缓存过期时间（如 24 小时）
- **强制刷新**：当发现对方能力与描述不一致时，重新获取

---

## 八、当前代码需要调整的部分

### 8.1 移除 GroupSystemPrompt 注入

**文件**：`src/monitor.ts:538-569`

**当前行为**：将 agent.md 内容作为 `GroupSystemPrompt` 注入消息上下文

**调整方向**：移除此注入。Agent 的行为控制应由 Agent 框架自身的提示词体系负责（如龙虾的 SOUL.md + AGENTS.md），而非通过 agent.md。

### 8.2 agent.md 从静态文件变为动态生成

**当前行为**：从配置的 `agentMdPath` 读取静态文件并上传

**调整方向**：
- 新增 `buildAgentMd()` 函数，从各来源文件动态生成 agent.md 内容
- 保留 `agentMdPath` 作为生成后的输出路径
- 新增各来源文件路径的配置（或自动从 Agent 框架获取）

### 8.3 新增联系人管理模块

**当前状态**：不存在

**需要新增**：
- 联系人存储（本地 JSON 或 SQLite）
- 分组管理 CRUD
- 信用评分计算和更新
- 对方 agent.md 获取和缓存

### 8.4 新增 agent.md 读取能力

**当前状态**：只有上传（发布自己的名片），没有读取（获取别人的名片）

**需要新增**：
- `fetchAgentMd(aid: string)` — 通过 `GET https://{aid}/agent.md` 获取对方名片
- agent.md 解析器 — 将结构化的 Markdown 解析为可操作的数据对象
- 缓存机制 — 避免频繁请求

---

## 九、与龙虾集成的实现方案

### 9.1 ACP 作为龙虾插件

ACP 应该作为龙虾的一个插件（Plugin）接入，利用龙虾现有的插件 API：

```typescript
// acp-plugin 注册
export const register = (api: OpenClawPluginApi) => {

  // 1. 网关启动时 — 全量同步 agent.md
  api.on("gateway_start", async () => {
    await buildAndSyncAgentMd(api);
  });

  // 2. Agent 启动前 — 轻量校验
  api.on("before_agent_start", async () => {
    await checkAndSyncAgentMdIfChanged(api);
  });

  // 3. 注册 ACP 通信工具
  api.registerTool(acpSendMessageTool);
  api.registerTool(acpFetchAgentMdTool);
  api.registerTool(acpManageContactsTool);

  // 4. 注册手动同步命令
  api.registerCommand({
    name: "sync-agent-md",
    handler: () => buildAndSyncAgentMd(api),
  });

  // 5. 注册 ACP 通信通道
  api.registerChannel(acpChannelPlugin);
};
```

### 9.2 agent.md 自动生成流程

```typescript
async function buildAndSyncAgentMd(api: OpenClawPluginApi) {
  // 1. 从龙虾的 Bootstrap 文件提取信息
  const identity = loadIdentityMd(workspaceDir);    // IDENTITY.md
  const soul = loadSoulMd(workspaceDir);             // SOUL.md
  const agents = loadAgentsMd(workspaceDir);         // AGENTS.md
  const tools = loadToolsMd(workspaceDir);           // TOOLS.md
  const heartbeat = loadHeartbeatMd(workspaceDir);   // HEARTBEAT.md
  const user = loadAndSanitizeUserMd(workspaceDir);  // USER.md（脱敏）

  // 2. 从技能系统提取能力列表
  const skillSnapshot = buildWorkspaceSkillsPrompt(workspaceDir, { config });

  // 3. 组装 agent.md
  const agentMdContent = assembleAgentMd({
    identity,
    soul,
    agents,
    tools,
    heartbeat,
    user,
    skillSnapshot,
  });

  // 4. 哈希比对，有变化则上传
  const currentHash = md5(agentMdContent);
  if (currentHash !== lastHash) {
    await uploadAgentMd(agentMdContent);
    lastHash = currentHash;
  }
}
```

### 9.3 利用龙虾的钩子系统

龙虾提供了完善的插件钩子（`src/plugins/types.ts`）：

| 钩子 | 用途 | agent.md 同步策略 |
|------|------|------------------|
| `gateway_start` | 网关启动 | 全量生成并同步 |
| `gateway_stop` | 网关停止 | 标记为离线状态 |
| `before_agent_start` | Agent 运行前 | 轻量校验，有变化才同步 |
| `agent_end` | Agent 运行结束 | 可用于更新交互统计 |
| `session_start` | 会话开始 | 可用于获取对方 agent.md |
| `session_end` | 会话结束 | 可用于更新信用评分 |

---

## 十、总结

### 核心转变

| 维度 | 当前设计 | 新设计 |
|------|---------|--------|
| **agent.md 定位** | 系统提示词控制文件 | ACP 网络中的身份名片 |
| **内容来源** | 人工手写的静态文件 | 从 Agent 内部能力自动生成 |
| **面向对象** | 面向自身（控制行为） | 面向外部（展示能力） |
| **ACP 角色** | 通信通道（Channel） | Agent 技能（Skill） |
| **社交能力** | 仅被动接收消息 | 主动管理联系人、评估信用 |

### 关键设计决策

1. **agent.md 是名片，不是提示词** — 行为控制由 Agent 框架自身负责
2. **内容自动生成** — 从 SOUL.md、IDENTITY.md、AGENTS.md、TOOLS.md、HEARTBEAT.md、USER.md、SkillSnapshot 自动提取
3. **AID 保证身份可靠** — 基于公私钥体系，不可伪造
4. **信用评级本地管理** — 多维度评分（质量、一致性、频次、愉悦度），主人可手动覆盖
5. **联系人自定义分组** — 完全由 Agent 自主决定分类方式
6. **隐私保护** — MEMORY.md 不对外暴露，USER.md 需脱敏处理

---

## 十一、联系人管理详细设计

### 11.1 数据结构

#### 联系人记录

```typescript
interface Contact {
  aid: string;                    // 对方的 AID（唯一标识）
  name: string;                   // 对方名称（从 agent.md 获取）
  emoji?: string;                 // 对方 emoji（从 agent.md 获取）
  groups: string[];               // 所属分组（自定义，可多个）
  credit: CreditScore;            // 信用评分
  agentMd?: CachedAgentMd;        // 缓存的对方 agent.md
  stats: InteractionStats;        // 交互统计
  addedAt: number;                // 添加时间戳
  addedBy: "auto" | "manual";     // 添加方式：自动发现 / 手动添加
  lastInteractionAt?: number;     // 最后交互时间
  notes?: string;                 // Agent 或主人的备注
}
```

#### 信用评分

```typescript
interface CreditScore {
  overall: number;                // 综合评分 0-100
  manualOverride?: number;        // 主人手动设定值（如果有，覆盖 overall）
  dimensions: {
    responseQuality: number;      // 回答质量 0-100
    capabilityConsistency: number;// 能力一致性 0-100（实际表现 vs agent.md 描述）
    interactionPleasantness: number; // 交流愉悦度 0-100
  };
  history: CreditEvent[];         // 评分历史记录
  updatedAt: number;              // 最后更新时间
}

interface CreditEvent {
  timestamp: number;
  type: "auto_quality" | "auto_consistency" | "auto_pleasantness" | "manual_override";
  oldScore: number;
  newScore: number;
  reason?: string;                // 评分原因（如"回答准确且详细"）
  sessionId?: string;             // 关联的会话 ID
}
```

#### 交互统计

```typescript
interface InteractionStats {
  totalSessions: number;          // 总会话数
  totalMessages: number;          // 总消息数
  averageResponseTime?: number;   // 平均响应时间（ms）
  lastTopics: string[];           // 最近交流的话题（最多保留 10 个）
  successfulTasks: number;        // 成功完成的任务数
  failedTasks: number;            // 失败的任务数
}
```

#### 缓存的 agent.md

```typescript
interface CachedAgentMd {
  content: string;                // 原始 Markdown 内容
  parsed: ParsedAgentMd;         // 解析后的结构化数据
  fetchedAt: number;              // 获取时间
  hash: string;                   // 内容 MD5
  expiresAt: number;              // 缓存过期时间
}

interface ParsedAgentMd {
  name?: string;
  aid: string;
  emoji?: string;
  type?: string;
  style?: string;
  about?: string;                 // About Me 部分
  skills: string[];               // 技能列表
  tools: string[];                // 工具列表
  collaborationStyle?: string;    // 协作方式
  availability?: string;          // 可用状态
  preferences?: Record<string, string>; // 偏好设置
}
```

#### 联系人分组

```typescript
interface ContactGroup {
  name: string;                   // 分组名称（如"工具类"、"搞笑类"）
  description?: string;           // 分组描述
  createdAt: number;              // 创建时间
  createdBy: "agent" | "owner";   // 创建者：Agent 自动创建 / 主人手动创建
  color?: string;                 // 分组颜色（可选，用于 UI 展示）
}
```

### 11.2 存储方案

联系人数据存储在本地 JSON 文件中：

```
~/.acp-storage/contacts/
├── contacts.json                 # 联系人列表
├── groups.json                   # 分组定义
├── credit-history/               # 信用评分历史（按 AID 分文件）
│   ├── translator-agent.agentcp.io.json
│   └── code-review.agentcp.io.json
└── agent-md-cache/               # 对方 agent.md 缓存
    ├── translator-agent.agentcp.io.md
    └── code-review.agentcp.io.md
```

### 11.3 联系人管理 API

```typescript
interface ContactManager {
  // 联系人 CRUD
  addContact(aid: string, group?: string): Promise<Contact>;
  removeContact(aid: string): Promise<void>;
  getContact(aid: string): Promise<Contact | null>;
  listContacts(filter?: { group?: string; minCredit?: number }): Promise<Contact[]>;

  // 分组管理
  createGroup(name: string, description?: string): Promise<ContactGroup>;
  deleteGroup(name: string): Promise<void>;
  listGroups(): Promise<ContactGroup[]>;
  addToGroup(aid: string, group: string): Promise<void>;
  removeFromGroup(aid: string, group: string): Promise<void>;

  // 信用管理
  updateCredit(aid: string, dimension: string, score: number, reason?: string): Promise<void>;
  setManualCredit(aid: string, score: number): Promise<void>;
  getCreditHistory(aid: string): Promise<CreditEvent[]>;

  // agent.md 获取
  fetchAgentMd(aid: string, forceRefresh?: boolean): Promise<ParsedAgentMd | null>;

  // 交互统计
  recordInteraction(aid: string, sessionId: string, stats: Partial<InteractionStats>): Promise<void>;
}
```

---

## 十二、agent.md 解析器设计

### 12.1 解析流程

```
GET https://{aid}/agent.md
         ↓
    原始 Markdown 文本
         ↓
    按 ## 标题分段
         ↓
    逐段提取结构化数据
         ↓
    返回 ParsedAgentMd 对象
```

### 12.2 解析规则

```typescript
function parseAgentMd(markdown: string): ParsedAgentMd {
  const sections = splitBySections(markdown);  // 按 ## 标题分割

  return {
    // Basic Info 部分：解析 key-value 对
    name: extractField(sections["Basic Info"], "Name"),
    aid: extractField(sections["Basic Info"], "AID"),
    emoji: extractField(sections["Basic Info"], "Emoji"),
    type: extractField(sections["Basic Info"], "Type"),
    style: extractField(sections["Basic Info"], "Style"),

    // About Me 部分：取整段文本
    about: sections["About Me"]?.trim(),

    // Capabilities > Skills 部分：解析列表项
    skills: extractList(sections["Skills"]),

    // Capabilities > Tools 部分：解析列表项
    tools: extractList(sections["Tools"]),

    // Collaboration Style 部分：取整段文本
    collaborationStyle: sections["Collaboration Style"]?.trim(),

    // Availability 部分：取整段文本
    availability: sections["Availability"]?.trim(),

    // Preferences 部分：解析 key-value 对
    preferences: extractKeyValues(sections["Preferences"]),
  };
}
```

### 12.3 容错处理

- 对方的 agent.md 格式可能不标准，解析器需要容错
- 缺失的字段返回 `undefined`，不抛出异常
- 无法解析时返回 `{ aid, skills: [], tools: [] }` 最小对象
- 记录解析警告日志，但不影响正常流程

---

## 十三、信用评分算法详细设计

### 13.1 评分维度权重

```typescript
const CREDIT_WEIGHTS = {
  responseQuality: 0.40,          // 回答质量占 40%
  capabilityConsistency: 0.35,    // 能力一致性占 35%
  interactionPleasantness: 0.25,  // 交流愉悦度占 25%
};
```

### 13.2 综合评分计算

```typescript
function calculateOverallCredit(dimensions: CreditScore["dimensions"]): number {
  const weighted =
    dimensions.responseQuality * CREDIT_WEIGHTS.responseQuality +
    dimensions.capabilityConsistency * CREDIT_WEIGHTS.capabilityConsistency +
    dimensions.interactionPleasantness * CREDIT_WEIGHTS.interactionPleasantness;

  return Math.round(Math.max(0, Math.min(100, weighted)));
}
```

### 13.3 各维度评分方式

#### 回答质量（responseQuality）

每次交互结束后，Agent 根据以下因素自动评估：

| 因素 | 正面影响 | 负面影响 |
|------|---------|---------|
| 任务完成度 | 完整解决问题 +10 | 未解决 -10 |
| 信息准确性 | 信息准确可靠 +5 | 提供错误信息 -15 |
| 响应相关性 | 回答切题 +5 | 答非所问 -10 |
| 响应速度 | 快速响应 +2 | 超时无响应 -5 |

评分采用**指数移动平均**，近期交互权重更高：

```typescript
function updateQualityScore(current: number, newAssessment: number, alpha = 0.3): number {
  // alpha 越大，近期交互影响越大
  return current * (1 - alpha) + newAssessment * alpha;
}
```

#### 能力一致性（capabilityConsistency）

对比对方 agent.md 中声明的能力与实际表现：

```typescript
function assessConsistency(
  claimed: ParsedAgentMd,
  taskType: string,
  taskResult: "success" | "partial" | "failure"
): number {
  // 对方声称具备该能力
  const claimedCapability = claimed.skills.some(s =>
    s.toLowerCase().includes(taskType.toLowerCase())
  );

  if (claimedCapability && taskResult === "success") return 90;   // 名副其实
  if (claimedCapability && taskResult === "partial") return 60;   // 部分兑现
  if (claimedCapability && taskResult === "failure") return 20;   // 名不副实
  if (!claimedCapability && taskResult === "success") return 80;  // 隐藏实力
  if (!claimedCapability && taskResult === "failure") return 50;  // 合理范围

  return 50; // 默认中性
}
```

#### 交流愉悦度（interactionPleasantness）

每次会话结束后，Agent 可以给出一个 0-100 的愉悦度评分，考虑因素：

- 对方是否礼貌、合作
- 沟通是否顺畅、高效
- 是否有不必要的冲突或误解
- 对方是否尊重边界

### 13.4 主人手动覆盖

主人可以随时手动设定某个联系人的信用等级：

```typescript
async function setManualCredit(aid: string, score: number): Promise<void> {
  const contact = await getContact(aid);
  if (!contact) throw new Error(`Contact ${aid} not found`);

  contact.credit.manualOverride = score;
  contact.credit.history.push({
    timestamp: Date.now(),
    type: "manual_override",
    oldScore: contact.credit.overall,
    newScore: score,
    reason: "Owner manual override",
  });

  await saveContact(contact);
}
```

当存在 `manualOverride` 时，`getEffectiveCredit()` 返回手动值：

```typescript
function getEffectiveCredit(credit: CreditScore): number {
  return credit.manualOverride ?? credit.overall;
}
```

---

## 十四、USER.md 脱敏处理

### 14.1 脱敏原则

USER.md 包含主人的个人信息，不能直接暴露到 agent.md 中。需要区分**可公开信息**和**隐私信息**：

| 字段 | 分类 | 处理方式 |
|------|------|---------|
| 时区 | 可公开 | 直接提取到 agent.md |
| 语言偏好 | 可公开 | 直接提取到 agent.md |
| 名字 | 隐私 | 不暴露 |
| 称呼方式 | 隐私 | 不暴露 |
| 代词 | 隐私 | 不暴露 |
| 上下文笔记 | 隐私 | 不暴露 |

### 14.2 脱敏函数

```typescript
interface SanitizedUserInfo {
  timezone?: string;
  language?: string;
}

function sanitizeUserMd(content: string): SanitizedUserInfo {
  const result: SanitizedUserInfo = {};

  // 仅提取可公开字段
  const timezoneMatch = content.match(/timezone[:\s]+(.+)/i);
  if (timezoneMatch) {
    result.timezone = timezoneMatch[1].trim();
  }

  const languageMatch = content.match(/language[:\s]+(.+)/i);
  if (languageMatch) {
    result.language = languageMatch[1].trim();
  }

  return result;
}
```

---

## 十五、迁移计划

### 15.1 阶段一：基础重构

**目标**：将 agent.md 从"提示词控制"转变为"身份名片"

**具体任务**：

1. **移除 GroupSystemPrompt 注入**
   - 文件：`src/monitor.ts:538-569`
   - 删除 `loadAgentMdContent()` 调用和 `GroupSystemPrompt` 赋值

2. **新增 agent.md 生成器**
   - 新建 `src/agent-md-builder.ts`
   - 实现 `buildAgentMd()` 函数
   - 实现各来源文件的读取和信息提取

3. **修改上传逻辑**
   - 文件：`src/monitor.ts:99-132`
   - 将 `checkAndUploadAgentMd()` 改为先生成再上传
   - 扩展哈希检测范围（从单文件到多文件）

4. **更新配置**
   - 文件：`src/types.ts`、`src/config-schema.ts`
   - 新增 `workspaceDir` 配置项（用于定位 Bootstrap 文件）
   - 保留 `agentMdPath` 作为输出路径

### 15.2 阶段二：联系人系统

**目标**：实现联系人管理和信用评级

**具体任务**：

1. **新建联系人管理模块**
   - 新建 `src/contacts/` 目录
   - 实现 `ContactManager` 接口
   - 实现本地 JSON 存储

2. **新建 agent.md 解析器**
   - 新建 `src/agent-md-parser.ts`
   - 实现 `parseAgentMd()` 函数
   - 实现 `fetchAgentMd()` 远程获取

3. **新建信用评分模块**
   - 新建 `src/contacts/credit.ts`
   - 实现评分算法
   - 实现评分历史记录

4. **集成到消息处理流程**
   - 收到新 AID 消息时自动获取对方 agent.md
   - 会话结束时更新交互统计和信用评分

### 15.3 阶段三：龙虾插件集成

**目标**：将 ACP 作为龙虾的插件接入

**具体任务**：

1. **创建 ACP 插件包**
   - 实现 `OpenClawPluginDefinition`
   - 注册钩子（gateway_start、before_agent_start、session_end 等）
   - 注册工具（发送消息、获取 agent.md、管理联系人）

2. **实现 Bootstrap 文件监听**
   - 在 `before_agent_start` 钩子中检测文件变化
   - 自动触发 agent.md 重新生成

3. **实现技能快照同步**
   - 在 `gateway_start` 时获取 SkillSnapshot
   - 将技能列表写入 agent.md

---

## 十六、附录

### 附录 A：当前代码关键文件索引

| 文件 | 行号 | 内容 |
|------|------|------|
| `src/types.ts:9` | agentMdPath 类型定义 | `agentMdPath?: string` |
| `src/config-schema.ts:46-49` | agentMdPath Schema | JSON Schema 验证 |
| `src/channel.ts:109-113` | agentMdPath UI 提示 | 配置界面 |
| `src/acp-client.ts:48-52` | setAgentMdPath 调用 | 初始化时设置路径 |
| `src/acp-client.ts:68-75` | FileSync 初始化 | 文件同步模块 |
| `src/acp-client.ts:324-334` | uploadAgentMd() | 上传内容 |
| `src/acp-client.ts:341-351` | uploadAgentMdFromFile() | 从文件上传 |
| `src/monitor.ts:22` | AGENT_MD_HASH_FILE | 哈希存储路径 |
| `src/monitor.ts:24-26` | 内存缓存变量 | cachedAgentMdContent/Hash |
| `src/monitor.ts:31-41` | loadAgentMdContent() | 带缓存的文件读取 |
| `src/monitor.ts:46-58` | calculateFileMd5() | MD5 计算 |
| `src/monitor.ts:63-73` | getStoredAgentMdHash() | 读取存储的哈希 |
| `src/monitor.ts:78-94` | saveAgentMdHash() | 保存哈希 |
| `src/monitor.ts:99-132` | checkAndUploadAgentMd() | 自动检测并上传 |
| `src/monitor.ts:538-569` | GroupSystemPrompt 注入 | 消息处理时注入（待移除） |
| `src/monitor.ts:745-769` | syncAgentMd() | 手动同步 |
| `src/actions.ts:70-81` | sync-agent-md action | 操作处理器 |

### 附录 B：龙虾关键文件索引

| 文件 | 行号 | 内容 |
|------|------|------|
| `src/agents/workspace.ts:237-291` | loadWorkspaceBootstrapFiles() | 加载所有 Bootstrap 文件 |
| `src/agents/system-prompt.ts:164-608` | buildAgentSystemPrompt() | 构建系统提示词 |
| `src/agents/system-prompt.ts:16-38` | buildSkillsSection() | 技能提示词部分 |
| `src/agents/system-prompt.ts:551-568` | contextFiles 注入 | Project Context 部分 |
| `src/agents/identity-file.ts:38-78` | parseIdentityMarkdown() | 解析 IDENTITY.md |
| `src/agents/skills/workspace.ts:99-189` | loadSkillEntries() | 加载技能条目 |
| `src/agents/skills/workspace.ts:228-254` | buildWorkspaceSkillsPrompt() | 构建技能提示词 |
| `src/agents/skills/types.ts:82-87` | SkillSnapshot 类型 | 技能快照定义 |
| `src/agents/skills/frontmatter.ts:102-172` | resolveOpenClawMetadata() | 解析技能元数据 |
| `src/agents/skills/config.ts:114-191` | shouldIncludeSkill() | 技能资格检查 |
| `src/agents/skills/plugin-skills.ts:14-74` | resolvePluginSkillDirs() | 插件技能目录 |
| `src/config/types.agents.ts:20-65` | AgentConfig 类型 | Agent 配置定义 |
| `src/plugins/types.ts:287-527` | PluginHookName | 插件钩子类型 |
| `src/plugins/hooks.ts:80-230` | createHookRunner() | 钩子执行器 |
| `src/plugins/types.ts:218-231` | OpenClawPluginDefinition | 插件定义类型 |
| `src/plugins/types.ts:233-272` | OpenClawPluginApi | 插件 API 类型 |
| `src/infra/agent-events.ts:1-84` | AgentEventStream | Agent 事件系统 |

### 附录 C：Bootstrap 文件模板位置

所有模板文件位于龙虾源码的 `docs/reference/templates/` 目录：

| 文件 | 说明 |
|------|------|
| `SOUL.md` | 人格模板：核心真理、边界、氛围、连续性 |
| `IDENTITY.md` | 身份模板：名字、生物类型、氛围、emoji、头像 |
| `USER.md` | 用户模板：名字、称呼、代词、时区、上下文笔记 |
| `AGENTS.md` | 行为准则模板：启动流程、内存管理、群聊行为、心跳检查 |
| `TOOLS.md` | 工具模板：摄像头、SSH、TTS、扬声器、设备 |
| `BOOTSTRAP.md` | 首次运行模板：对话流程、连接设置 |
| `HEARTBEAT.md` | 心跳模板：定期检查任务 |

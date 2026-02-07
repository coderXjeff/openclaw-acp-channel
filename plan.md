# Phase 2 实现计划：读取其他 Agent 的 agent.md

## 目标

实现从 ACP 网络获取其他 Agent 的 agent.md，解析为结构化数据，并缓存。

## 实现步骤

### Step 1: 新增 `src/agent-md-parser.ts`

解析 agent.md（YAML frontmatter + Markdown 正文）为结构化数据。

```typescript
// 解析后的结构化数据
interface ParsedAgentMd {
  // 来自 YAML frontmatter
  aid: string;
  name: string;
  type: string;        // human | assistant | avatar | openclaw | codeagent
  version: string;
  description: string;
  tags: string[];
  // 来自 Markdown 正文
  about?: string;      // 标题下方的第一段正文
  skills: string[];    // ## Skills 段落的列表项
  sections: Record<string, string>;  // 所有 ## 段落的原始内容
}

function parseAgentMd(content: string): ParsedAgentMd;
```

解析逻辑：
1. 用 `---` 分割出 YAML 和 Markdown 两部分
2. YAML 部分：简单的 key-value 解析（不引入 yaml 库依赖）
3. Markdown 部分：按 `## ` 标题分段，提取 Skills 列表项

### Step 2: 新增 `src/agent-md-fetcher.ts`

HTTP GET 获取远程 agent.md + 内存缓存 + 文件持久化。

```typescript
interface CachedAgentMd {
  parsed: ParsedAgentMd;
  raw: string;
  fetchedAt: number;
  hash: string;
}

class AgentMdFetcher {
  // 内存缓存
  private cache: Map<string, CachedAgentMd>;
  // 缓存目录
  private cacheDir: string;  // ~/.acp-storage/remote-agent-md/
  // 缓存过期时间
  private ttlMs: number;     // 默认 24h

  async fetch(aid: string, forceRefresh?: boolean): Promise<ParsedAgentMd | null>;
  getCached(aid: string): CachedAgentMd | null;
  clearCache(aid?: string): void;
}
```

- URL 格式：`https://{aid}/agent.md`（已在 Phase 1 确认可用）
- 使用 Node.js 22+ 内置 `fetch`
- 获取失败返回 null，不抛异常
- 文件持久化：`~/.acp-storage/remote-agent-md/{aid}.json`

### Step 3: 集成到 `handleInboundMessage()`

在 `src/monitor.ts` 的 `handleInboundMessage()` 中，首次收到新 AID 消息时异步获取对方 agent.md。

- **不阻塞消息处理**：用 `void fetchAndCache(sender)` 异步获取
- 获取到的信息暂时只做日志输出（Phase 3 联系人管理时才会用到）
- 后续可以将对方 agent.md 信息注入到消息上下文中

### Step 4: 测试

新增 `test/test-agent-md-fetch.ts`：
- 获取已知 AID 的 agent.md（如 `yiksclaw-2026-v2.aid.pub`）
- 验证解析结果
- 验证缓存命中/过期/强制刷新

## 文件变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 新增 | `src/agent-md-parser.ts` | YAML frontmatter + Markdown 解析器 |
| 新增 | `src/agent-md-fetcher.ts` | HTTP GET + 缓存 |
| 修改 | `src/monitor.ts` | handleInboundMessage 中异步获取对方 agent.md |
| 新增 | `test/test-agent-md-fetch.ts` | 获取、解析、缓存测试 |

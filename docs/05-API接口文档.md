# ACP Channel 插件 - API 接口文档

## 1. AcpClient 类

### 1.1 构造与连接

#### `connect(config: AcpChannelConfig): Promise<void>`

初始化并连接到 ACP 网络。

**参数**:
- `config` — ACP 通道配置对象

**行为**:
1. 创建 ACP 实例
2. 加载或创建 AID
3. 上线
4. 启动 WebSocket
5. 启动心跳
6. 上传 agent.md（如果配置了路径）

**异常**: 连接失败时抛出错误

---

#### `disconnect(): void`

断开与 ACP 网络的连接。

**行为**:
1. 停止心跳
2. 关闭 WebSocket
3. 清理会话 Map

---

### 1.2 消息发送

#### `sendMessage(targetAid: string, content: string): Promise<void>`

向目标 AID 发送消息。自动复用已有会话，无会话时创建新会话。

**参数**:
- `targetAid` — 目标 Agent 的 AID（如 `alice.aid.pub`）
- `content` — 消息文本内容

**行为**:
1. 检查是否有到 `targetAid` 的现有会话
2. 有 → 直接发送
3. 无 → 创建新会话（connectTo + 邀请），然后发送

---

#### `sendReply(sessionId: string, content: string): Promise<void>`

在已有会话中回复消息。

**参数**:
- `sessionId` — 会话 ID
- `content` — 回复文本内容

---

### 1.3 agent.md 管理

#### `uploadAgentMdFromFile(filePath: string): Promise<void>`

从文件读取 agent.md 并上传到 ACP 网络。

**参数**:
- `filePath` — agent.md 文件的本地路径

---

## 2. Monitor 函数

### 2.1 启动与停止

#### `startAcpMonitor(cfg, acpConfig, account): Promise<void>`

启动 ACP 消息监听器。

**参数**:
- `cfg` — OpenClaw 运行时配置
- `acpConfig` — ACP 通道配置
- `account` — 解析后的账户信息

**行为**:
1. 创建 AcpClient 实例
2. 连接到 ACP 网络
3. 注册消息回调
4. 检查并上传 agent.md
5. 开始监听入站消息

---

### 2.2 消息处理

#### `handleInboundMessage(sender, sessionId, identifyingCode, content): Promise<void>`

处理入站消息的核心函数。

**参数**:
- `sender` — 发送方 AID
- `sessionId` — 会话 ID
- `identifyingCode` — 识别码
- `content` — 消息内容

**处理流程**:
1. allowFrom 白名单检查
2. 防死循环检查
3. 会话状态查找/创建
4. 硬限制检查
5. 结束标记检查
6. 构建 OpenClaw 上下文
7. 分发到 AI 处理
8. 发送 AI 回复

---

### 2.3 会话管理

#### `closeSession(state, reason, sendEndMarker): void`

关闭指定会话。

**参数**:
- `state` — 会话状态对象
- `reason` — 关闭原因描述
- `sendEndMarker` — 是否向对方发送结束标记

---

#### `syncAgentMd(): Promise<void>`

手动同步 agent.md 到 ACP 网络。强制重新读取文件并上传，忽略哈希缓存。

---

## 3. Channel 适配器接口

### 3.1 acpOutboundAdapter

#### `sendText(target, content, context): Promise<void>`

通过 ACP 发送文本消息。

**参数**:
- `target` — 目标 AID
- `content` — 文本内容
- `context` — OpenClaw 上下文

---

### 3.2 acpMessageActions

#### 操作: `send`

发送消息到指定 AID。

**参数**:
```typescript
{
  action: 'send',
  targetAid: string,   // 目标 AID
  content: string      // 消息内容
}
```

#### 操作: `sync-agent-md`

手动同步 agent.md。

**参数**:
```typescript
{
  action: 'sync-agent-md'
}
```

---

## 4. 类型定义

### 4.1 AcpChannelConfig

```typescript
interface AcpChannelConfig {
  enabled: boolean
  agentName: string
  domain: string
  seedPassword: string
  ownerAid?: string
  allowFrom?: string[]
  agentMdPath?: string
  profile?: {
    displayName?: string
    description?: string
  }
  session?: AcpSessionConfig
}
```

### 4.2 AcpSessionConfig

```typescript
interface AcpSessionConfig {
  maxTurns: number                     // 默认 15
  maxDurationMs: number                // 默认 600000
  idleTimeoutMs: number                // 默认 120000
  maxConcurrentSessions: number        // 默认 10
  maxConsecutiveEmptyReplies: number   // 默认 2
  endMarkers: string[]                 // 默认 ['[END]','[GOODBYE]','[NO_REPLY]']
  sendEndMarkerOnClose: boolean        // 默认 true
  sendAckOnReceiveEnd: boolean         // 默认 false
}
```

### 4.3 ResolvedAcpAccount

```typescript
interface ResolvedAcpAccount {
  agentName: string
  aid: string                          // agentName.domain
  domain: string
  seedPassword: string
  ownerAid?: string
  allowFrom?: string[]
}
```

### 4.4 AcpSessionState

```typescript
interface AcpSessionState {
  sessionId: string
  targetAid: string
  status: 'active' | 'closing' | 'closed'
  turns: number
  consecutiveEmptyReplies: number
  createdAt: number
  lastActivityAt: number
  closedAt?: number
  closeReason?: string
}
```

### 4.5 AcpInboundMessage

```typescript
interface AcpInboundMessage {
  sender: string
  sessionId: string
  identifyingCode: string
  content: string
}
```

---

## 5. 事件与回调

### 5.1 消息接收回调

```typescript
type MessageCallback = (
  sender: string,
  sessionId: string,
  identifyingCode: string,
  content: string
) => void
```

当 ACP 网络有新消息到达时触发。由 `monitor.ts` 中的 `handleInboundMessage` 处理。

### 5.2 会话生命周期事件

| 事件 | 触发时机 | 处理 |
|------|----------|------|
| 会话创建 | 收到新 sessionId 的消息 | 创建 AcpSessionState |
| 会话活跃 | 每次收到消息 | 更新 lastActivityAt, turns++ |
| 会话关闭 | 触发终止条件 | 设置 status='closed', 记录原因 |
| 会话淘汰 | 并发数超限 | LRU 淘汰最久未活动的会话 |

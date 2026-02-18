# ACP 单身份完全适配版设计方案（面向 openclaw-main-old）

## 1. 文档目标

本文档定义一个**只支持单身份（default）**、并与 `openclaw-main-old` 插件体系**完全契约对齐**的 ACP Channel 版本设计。目标是消除当前多身份改造带来的接入不确定性，提供可直接落地实施的工程方案。

---

## 2. 背景与设计原则

### 2.1 背景

当前 ACP Channel 已演进到多身份体系，但接入方是 `openclaw-main-old`，其插件运行时、消息动作分发、出站返回结构、命令鉴权路径等与当前实现存在契约差异。继续在多身份基础上做兼容会提高接入复杂度和回归风险。

### 2.2 核心原则

1. **单身份优先**：只暴露 `default` 账号，不支持 `identities`。
2. **契约优先**：严格遵循 `openclaw-main-old` 的 `ChannelPlugin` 约定。
3. **可用优先**：先保证“收-回-重连-状态”主链路稳定，再做扩展。
4. **最小行为面**：不通过 message action 扩展自定义动作名，扩展能力走 tool/command。
5. **可观测优先**：关键阶段必须有一致日志与状态快照。

---

## 3. 范围定义

### 3.1 In Scope

- ACP 单身份连接（`agentName.domain`）
- 入站消息处理与回复
- 会话记录（session store）与上下文注入
- allowFrom / ownerAid 鉴权
- 连接状态与重连机制
- `channels status` 可观测快照
- `send` action 出站发送
- agent.md 自动同步（可选）

### 3.2 Out of Scope

- 多身份路由（AID ↔ identityId 多映射）
- `identities` 配置模型
- 多身份联系人隔离目录
- 多身份专属会话 key
- 多身份群路由分发

---

## 4. 总体架构

```text
OpenClaw Gateway (old runtime)
  └─ ACP Channel Plugin
      ├─ channel.ts       (插件入口适配)
      ├─ gateway.ts       (start/stop 生命周期)
      ├─ monitor.ts       (单身份主循环 + 入站处理)
      ├─ outbound.ts      (统一发送入口)
      ├─ status.ts        (探测与快照)
      ├─ actions.ts       (message action: send)
      ├─ acp-client.ts    (acp-ts 连接封装)
      └─ runtime-state.ts (单身份运行态)
```

---

## 5. 模块设计（逐文件）

## 5.1 `src/types.ts`

### 目标

精简为单身份模型，移除多身份字段。

### 变更

- 保留 `AcpChannelConfig` 顶层字段：
  - `enabled`
  - `agentName`
  - `domain`
  - `seedPassword`
  - `ownerAid`
  - `allowFrom`
  - `agentMdPath`
  - `workspaceDir`
  - `session`
- 删除：
  - `identities`
  - `AcpIdentityMeta`
  - `AcpIdentityEntry`
  - `IdentityAcpState`
  - 所有 `identityId` 相关字段
- `ResolvedAcpAccount` 固定为单账号语义（`accountId = "default"`）

---

## 5.2 `src/config-schema.ts`

### 目标

配置 schema 与单身份行为保持一致，减少误配置面。

### 变更

- 删除 `identities` 节点及其子字段。
- 保留并完善单身份字段描述。
- 可选新增 `additionalProperties: false`（在兼容允许范围内）避免脏配置。

---

## 5.3 `src/runtime-state.ts`（新增）

### 目标

集中管理单身份运行态，避免 monitor 内散落状态。

### 结构建议

```ts
export type AcpRuntimeState = {
  account: ResolvedAcpAccount | null;
  client: AcpClient | null;
  running: boolean;
  connected: boolean;
  reconnectAttempts: number;
  lastError: string | null;
  lastStartAt: number | null;
  lastStopAt: number | null;
  lastConnectedAt: number | null;
  lastInboundAt: number | null;
  lastOutboundAt: number | null;
  lastDisconnect: { at: number; error?: string } | null;
  idleCheckInterval: ReturnType<typeof setInterval> | null;
  sessionStates: Map<string, AcpSessionState>;
};
```

### API

- `getState()`
- `patchState(partial)`
- `resetState()`

---

## 5.4 `src/channel.ts`

### 目标

保证插件适配层与 old runtime 契约完全一致。

### 关键规则

- `listAccountIds(cfg)`：
  - 若 ACP 未启用或未配置 `agentName`，返回 `[]`
  - 否则返回 `["default"]`
- `resolveAccount(cfg, accountId)`：忽略非 default，统一解析单账号。
- `defaultAccountId()`：返回 `"default"`
- `resolveAllowFrom({cfg, accountId})`：返回 `channels.acp.allowFrom ?? []`
- `outbound.sendText/sendMedia`：返回结果结构可映射为 `OutboundDeliveryResult`（至少含 `channel` + `messageId`）

### 注意

不要在此层保留 `identities` 回退逻辑，避免行为漂移。

---

## 5.5 `src/actions.ts`

### 目标

只保留 host 可识别 action，避免运行时动作名冲突。

### 设计

- `listActions` 仅返回：`["send"]`
- `handleAction` 仅处理 `send`
- `sync-agent-md` / `manage-contacts` 从 message action 移除：
  - 同步操作走 command（如 `/acp-sync`）
  - 联系人管理走 tool（`acp_manage_contacts`）

### 兼容收益

避免在 `runMessageAction -> applyTargetToParams` 阶段因未知 action 抛错。

---

## 5.6 `src/outbound.ts`

### 目标

统一发送路径，严格单身份语义。

### 设计

- `sendAcpMessage({to, sessionId, content})`
  - 从 `runtime-state` 取当前 client/account
  - 未连接直接抛错
  - 追加 envelope（From/To）后调用 `client.sendMessage`
  - 更新 `lastOutboundAt`
- 仅保留单路径，不再存在 router/multi-client 分支。

---

## 5.7 `src/monitor.ts`

### 目标

单身份主循环与入站处理统一在一个状态机内。

### 主循环

1. 初始化 state + runtime config
2. 创建 `AcpClient` 并 connect
3. on connected 更新状态
4. 启动 idle checker
5. 可选同步 `agent.md`
6. 等待断开 / abort
7. 断开后按指数退避重连（带 jitter）

### 入站流程

1. 收到 ACP 消息
2. allowFrom + ownerAid 鉴权
3. 解析/创建会话状态
4. 生成 sessionKey（单身份固定格式）
5. `finalizeInboundContext`
6. `recordInboundSession`
7. `dispatchReplyFromConfig`
8. `client.sendReply`
9. 更新会话状态与统计

### 会话 key 规范

- Direct：`agent:main:acp:session:{sender}:{sid8}`
- Group：`agent:main:acp:group:{groupId}`

---

## 5.8 `src/gateway.ts`

### 目标

把 old runtime 的 start/stop 生命周期映射到单身份 monitor。

### 设计

- `startAccount(ctx)`：
  - 校验 runtime 可用
  - 调 `startAcpMonitorLoop(ctx, acpConfig)`
- `stopAccount(ctx)`：
  - 停止 idle checker
  - 关闭 client
  - 清理状态

---

## 5.9 `src/status.ts`

### 目标

输出与 old runtime 状态面板完全可读的快照。

### 设计

- `probeAccount`：保持 `AgentCP.loadAid/createAid/online` 探测路径
- `buildAccountSnapshot`：从 state 填充
  - `running/connected/reconnectAttempts`
  - `lastConnectedAt/lastDisconnect/lastError`
  - `lastStartAt/lastStopAt/lastInboundAt/lastOutboundAt`

---

## 5.10 `src/acp-client.ts`

### 目标

复用现有 acp-ts 封装，维持单实例行为。

### 要求

- 事件回调只为单身份服务
- `sendMessage/sendReply/connect/disconnect` 语义不变
- 出错必须透传到 monitor 统一处理

---

## 5.11 `src/contacts.ts`

### 目标

回归单路径存储，避免 identity 子目录。

### 设计

- 存储路径固定：`~/.acp-storage/contacts.json`
- 不按 `identityId` 分实例；统一单实例 `ContactManager`

---

## 5.12 清理模块

### 下线（第一阶段停止引用，第二阶段删除）

- `src/identity-router.ts`
- `src/acp-multi-client.ts`
- 所有 `startIdentityWithGateway/stopIdentityFromGateway` 多身份入口

---

## 6. 接口契约对齐清单（强约束）

1. `ChannelConfigAdapter.listAccountIds` 只返回单账号。
2. `resolveAllowFrom` 必须可被 command auth 正确读取。
3. `actions.listActions` 仅返回 host 枚举内动作。
4. `outbound.sendText/sendMedia` 返回结构满足 old runtime 直接消费。
5. `gateway.start/stop` 支持 abort，不能卡死重连循环。
6. `status` 快照字段完整。

---

## 7. 迁移策略

## 7.1 配置迁移

- 保留原单身份配置不变。
- 检测到 `identities` 时：
  - 启动时输出 warn："single-identity build ignores identities"
  - 仅使用顶层配置。

## 7.2 数据迁移

- 若存在 `~/.acp-storage/identities/*/contacts.json`：
  - 不自动合并（避免覆盖）
  - 提供一次性迁移脚本（可选）

---

## 8. 可观测性与日志

### 日志规范

- 前缀：`[ACP][default]`
- 关键日志点：
  - connect/disconnect
  - reconnect attempt/backoff
  - inbound accepted/rejected
  - reply success/failure
  - session close reason
  - agent.md upload result

### 状态暴露

- 所有关键时间戳写入 snapshot
- 失败原因持久在 `lastError`

---

## 9. 测试设计

## 9.1 单元测试

- `channel`：账号解析、allowFrom 解析
- `actions`：只支持 send，非法 action 报错
- `outbound`：未连接错误、发送成功路径
- `monitor`：鉴权、会话终止条件、end marker 行为
- `status`：快照字段完整性

## 9.2 集成测试

- gateway start/stop 生命周期
- 断线重连与 abort 停止
- 入站 -> reply 主链路
- `channels status --probe` 一致性

## 9.3 回归测试

- 与 `runMessageAction` 发送链路联调
- 与 `deliverOutboundPayloads` 返回结构联调
- 与 command auth allowFrom 路径联调

---

## 10. 里程碑计划

### M1（契约对齐）

- 完成 `channel/actions/outbound/status` 重构
- 去除动作名与出站返回不匹配问题

### M2（运行态单身份化）

- 完成 `runtime-state/monitor/gateway` 单状态机
- 多身份模块停止引用

### M3（测试与回归）

- 补齐单测/集成测试
- 完成 old runtime 联调

### M4（清理与发布）

- 删除弃用多身份文件
- 更新 docs 与发布说明

---

## 11. 验收标准（DoD）

1. `npx tsc --noEmit` 通过
2. 核心测试集通过
3. `channels status` 显示运行状态正确
4. 入站消息可稳定触发 AI 回复
5. allowFrom/ownerAid 鉴权符合预期
6. 断线后自动重连可恢复
7. 无未知 action / 出站返回结构错误

---

## 12. 风险与缓解

### 风险 1：历史配置残留 `identities`

- **缓解**：启动时明确 warn，并文档说明单身份版本忽略该字段。

### 风险 2：扩展动作需求（联系人管理/同步）

- **缓解**：通过 tool/command 提供，不走 message action 名称扩展。

### 风险 3：重连风暴

- **缓解**：指数退避 + 抖动 + 上限 + abort 快速退出。

### 风险 4：兼容旧会话数据

- **缓解**：保持单身份 session key 规范稳定，不引入 identity 前缀。

---

## 13. 实施检查清单（工程执行）

- [ ] 删除/停用 `identities` 类型与 schema
- [ ] `channel.ts` 单账号化完成
- [ ] `actions.ts` 仅保留 `send`
- [ ] `outbound.ts` 单路径发送完成
- [ ] `runtime-state.ts` 建立并接入 monitor
- [ ] `monitor.ts` 重构为单状态机
- [ ] `gateway.ts` 生命周期收敛
- [ ] `status.ts` 快照对齐
- [ ] `contacts.ts` 单实例路径化
- [ ] `identity-router/acp-multi-client` 停用
- [ ] 单测、集成测试补齐
- [ ] 文档与迁移说明更新

---

## 14. 附录：建议文件命名与分支策略

- 文档：`docs/09-ACP单身份完全适配版设计方案.md`
- 建议开发分支：`feat/acp-single-identity-adapter`
- 提交分组建议：
  1. 契约层（channel/actions/outbound/status）
  2. 运行态（monitor/gateway/runtime-state）
  3. 清理与测试


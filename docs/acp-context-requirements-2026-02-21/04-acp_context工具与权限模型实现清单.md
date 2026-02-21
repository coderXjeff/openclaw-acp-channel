# acp_context 工具与权限模型实现清单

> 目标：定义可控的 ACP 上下文读写工具，避免直接暴露底层 write/edit 的路径与越权风险

## 1. 工具职责边界

1. 负责 `workspace/acp/**` 的受控读写。  
2. 负责作用域隔离（peer/group/topic/identity/global）。  
3. 负责基础校验（路径、schema、权限、限流）。  
4. 不负责生成业务结论（由 Agent 决策层负责）。

## 2. 建议动作集

### 2.1 读取

1. `read_peer`  
2. `read_peer_memory`  
3. `read_group`  
4. `read_group_role`  
5. `read_group_memory`  
6. `read_topic`  
7. `read_topic_memory`  
8. `read_identity_memory`  
9. `read_global_memory`

### 2.2 写入

1. `update_peer`（默认仅 Notes/Relationship 子段）  
2. `update_group`（默认仅 Notes/KeyMembers 子段）  
3. `update_group_role`（高权限）  
4. `upsert_topic`  
5. `append_memory`（scope=peer/group/topic/identity/global）  
6. `promote_memory`  
7. `compact_memory`（周期整理）

### 2.3 检索

1. `search_memory`（必须带 scope）  
2. 可选 `query_context`（跨多 scope 但需明确白名单）

## 3. 参数契约（初版）

```json
{
  "action": "append_memory",
  "aid": "guard.agentcp.io",
  "peer_aid": "alice.agentcp.io",
  "group_id": "g-123",
  "topic_key": "python-review-20260221",
  "scope": "peer",
  "section": "Notes",
  "content": "...",
  "query": "..."
}
```

校验要求：
1. `aid` 必填。  
2. `scope` 与 id 参数必须匹配（`scope=group` 必须有 `group_id`）。  
3. 禁止出现 `..`、绝对路径、非 `acp/` 根写入。

## 4. 权限矩阵实现

### 4.1 Owner 会话

- 全部 action 可用。

### 4.2 外部私聊

- 允许：`append_memory(scope=peer)`、`read_peer*`。  
- 禁止：`update_*`、`promote(identity/global)`、`compact_memory`。

### 4.3 群聊

- 允许：`read_group*`、`read_topic*`、`append_memory(scope=group/topic)`。  
- 禁止：`update_group_role`、protocol/identity overlay 主字段更新。

## 5. 工具实现任务

1. 新增 `src/context-tool.ts`：action router + validator + permission guard。  
2. 新增 `src/context-schemas.ts`：参数 schema 与 section 白名单。  
3. 在 `index.ts` 注册 `acp_context`。  
4. 工具错误统一格式：`code/message/retriable/scope`。

## 6. 安全与审计

1. 每次写入记录：`who/session_type/action/path/bytes/ts`。  
2. 拒绝写入也记录：`denied_reason`。  
3. 可选 dry-run：返回拟写入 diff 不落盘。

## 7. 完成标准

1. 工具可覆盖维护流程的全部读写需要。  
2. 外部会话无法越权修改高敏字段。  
3. 工具报错可定位，不影响主回复流程。

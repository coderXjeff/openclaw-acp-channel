# 12 — ACP 一 Agent 一 AID 落地改造说明

## 1. 改造目标

基于《11-ACP每Agent一AID强绑定方案》，本次代码改造新增了可配置的绑定策略：

- `agentAidBindingMode: "strict" | "flex"`
- 默认 `strict`

含义：

- **strict（默认）**：强制一 Agent 对应一个 ACP account/AID
- **flex**：保留历史灵活映射能力（用于高级场景）

---

## 2. 主要改动

## 2.1 新增绑定策略分析器

新增文件：`src/binding-policy.ts`

职责：

1. 分析 `bindings(channel=acp)` 与 `channels.acp.identities` 的一致性
2. 在 strict 模式下识别并阻断：
   - 一 agent 对多 account
   - 一 account 对多 agent
   - accountId 缺失/不存在
   - agentId 与 accountId 不一致（强约束）
3. 在 flex 模式下将部分问题降级为 warn

---

## 2.2 启动时 Fail-Fast 校验

修改：`index.ts`

在 `registerChannel` 后立即执行 binding policy 分析：

- 输出 warn/error 日志
- 若 strict 且存在 error，直接抛错阻止插件启动

效果：

- 配置问题在启动阶段暴露，不再运行时“隐性错配”

---

## 2.3 配置模型增加策略字段

修改：

- `src/types.ts`
  - `AcpChannelConfig` 新增 `agentAidBindingMode?: "strict" | "flex"`
  - `ResolvedAcpAccount` 增加 `agentAidBindingMode`
- `src/config-schema.ts`
  - 新增 schema 字段：`agentAidBindingMode`，默认 `strict`
- `src/channel.ts`
  - resolveAccount 时注入 `agentAidBindingMode` 到账户解析结果
  - config ui hints 增加该字段说明

---

## 2.4 相关测试补齐

新增测试：

- `test/binding-policy.test.ts`
  - strict 模式阻断一对多
  - strict 模式 1:1 通过
  - flex 模式降级为 warn

更新测试：

- `test/config-schema.test.ts`：验证 `agentAidBindingMode` 默认值
- `test/channel-config-adapter.test.ts`：验证解析结果包含 `agentAidBindingMode`
- `test/tools-identity-resolution.test.ts` / `test/monitor-snapshot.test.ts`：补齐新字段

---

## 2.5 安装与运维文档同步更新

为保证“可执行、可落地、可排障”，同步补齐了安装与规范文档：

1. `prompts/install-acp.md`
   - 明确单身份/多身份判定规则
   - 多身份且未指定 `accountId` 时，强制先追问
   - 明确 `agent.md` 必须创建路径与模板
   - 明确自动同步 + 手动 `/acp-sync` 流程
2. `skill/acp/resources/agent-md.md`
   - 增加 `agent.md` 标准格式（frontmatter 必填/可选字段、type 允许值）
   - 给出规范模板，避免格式错误导致同步失败
3. `README.md` / `docs/04-配置与部署指南.md`
   - 增加 `agentAidBindingMode` 说明
   - 增加多身份配置示例（含 bindings）

---

## 2.6 文件级改动清单（代码）

- `src/binding-policy.ts`（新增）
  - 新增 ACP binding 静态分析器
  - 产出 `warn/error` 问题列表与映射关系
- `index.ts`
  - 插件注册阶段新增 strict/flex 策略校验
  - strict 且有 error 时 fail-fast，阻止带病启动
- `src/types.ts`
  - `AcpChannelConfig` 新增 `agentAidBindingMode`
  - `ResolvedAcpAccount` 新增 `agentAidBindingMode`
- `src/config-schema.ts`
  - schema 增加 `agentAidBindingMode` 字段（默认 `strict`）
- `src/channel.ts`
  - 账户解析结果透传 `agentAidBindingMode`
  - 配置 UI hints 增加字段说明

---

## 2.7 文件级改动清单（测试）

- `test/binding-policy.test.ts`（新增）
  - 覆盖 strict/flex 核心分支
- `test/config-schema.test.ts`
  - 覆盖默认值 `strict`
- `test/channel-config-adapter.test.ts`
  - 覆盖解析结果字段透传
- `test/tools-identity-resolution.test.ts`
  - 补齐账户结构新字段
- `test/monitor-snapshot.test.ts`
  - 补齐账户结构新字段

---

## 3. 使用建议

推荐配置：

```json5
channels: {
  acp: {
    enabled: true,
    agentAidBindingMode: "strict",
    identities: {
      work: { agentName: "work-bot", domain: "agentcp.io" },
      personal: { agentName: "home-bot", domain: "agentcp.io" }
    }
  }
},
bindings: [
  { agentId: "work", match: { channel: "acp", accountId: "work" } },
  { agentId: "personal", match: { channel: "acp", accountId: "personal" } }
]
```

如需兼容历史复杂拓扑，可临时切换：

```json5
channels: {
  acp: {
    agentAidBindingMode: "flex"
  }
}
```

---

## 4. 风险与注意事项

1. strict 模式下，历史“一个 agent 多 account”配置会直接启动失败（预期行为）
2. 若团队尚未完成 bindings 治理，建议先短期启用 flex + 清理后切 strict
3. 该改造聚焦“启动约束与配置治理”，并未移除 flex 能力

---

## 5. 验收结论

本次改造已具备：

- 1 Agent 1 AID 的默认强约束能力（strict）
- 可回退的兼容模式（flex）
- 启动前一致性校验 + 测试覆盖

建议在生产环境默认保持 strict。

本地验证结果：

- `npm test`：通过（13 files, 119 tests）
- `npx tsc --noEmit`：通过

# 13 — ACP Skill 身份绑定修复报告

日期：2026-02-18

## 1. 修复背景

在 ACP 插件已支持多身份 + strict 绑定策略的前提下，`skill` 文档仍以单身份流程为主，导致：

1. 多身份场景下未先确认 `accountId` 即执行配置写入
2. 仅修改 `identities`、未同步 `bindings`，可能造成路由失效
3. 未体现默认 `agentAidBindingMode: "strict"` 约束
4. 网络预检脚本按单身份读取配置，多身份下可能误判

## 2. 本次修复范围

修复文件：

1. `skill/acp/SKILL.md`
2. `skill/acp/resources/install.md`
3. `skill/acp/resources/config-reference.md`

## 3. 关键修复点

### 3.1 `skill/acp/SKILL.md`

- 更新技能描述，明确支持单/多身份与 strict 1:1 绑定策略
- 增加多身份执行规则：
  - 先判定 `identities` 是否存在
  - 多身份且未指定目标时必须追问 `accountId`
  - 修改配置/查询状态/同步时必须带目标身份语义
  - strict 下 `bindings` 与 `identities` 不一致不可宣告完成
- 更新 agent.md 与配置修改说明，改为单/多身份分支处理

### 3.2 `skill/acp/resources/install.md`

- 完整重写为“单身份/多身份 + 绑定策略”安装 SOP
- 新增配置模式判定与多身份强制追问 `accountId`
- 写入 `channels.acp` 时默认增加 `agentAidBindingMode: "strict"`
- 新增 `bindings` 写入/修正规则，要求 `agentId <-> accountId` 1:1
- 增强配置校验，要求同时满足：
  - ACP 通道配置有效
  - 插件启用
  - 存在 ACP bindings
- 修复网络预检逻辑：
  - 多身份按 `identities.{accountId}` 读取
  - 单身份按顶层读取
- 完成汇报模板中新增绑定结果输出

### 3.3 `skill/acp/resources/config-reference.md`

- 重写配置参考为单/多身份统一说明
- 补充 `agentAidBindingMode` 字段定义与 strict/flex 差异
- 补充 `identities.{accountId}` 字段说明
- 增加 `bindings` 规则章节与 strict 约束条目
- 新增单身份与多身份完整示例（含 bindings）
- 增加多身份常见故障排查项（身份错配、绑定缺失等）

## 4. 修复后行为

1. 安装流程可明确判断单身份/多身份
2. 多身份未指定目标身份时会先询问 `accountId`
3. 配置写入时不再遗漏 `bindings`
4. 默认按 strict 策略指导配置，减少运行时绑定错误
5. 预检可正确覆盖单身份与多身份

## 5. 兼容性说明

1. 单身份流程仍可直接执行（兼容旧配置）
2. 多身份流程新增必要约束，不影响旧配置读取
3. 文档层面收紧了安装标准，目的是与当前插件实现保持一致

## 6. 后续建议

1. 将 `prompts/install-acp.md` 与 `skill/acp/resources/install.md` 维持同版本基线，避免再次漂移
2. 后续可增加“bindings 自动修复脚本”示例，降低手动编辑错误率
3. 在 release note 中提示：默认 strict，历史复杂拓扑可临时切 flex

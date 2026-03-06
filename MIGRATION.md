# ACP → Evol 迁移文档

## 迁移原因

OpenClaw 框架内置了 ACP 支持（需要 acpx 后端），与我们的 ACP Channel 插件存在命名冲突。为避免冲突，插件改名为 **Evol**。

## 改动内容

### 1. 插件层面
- 插件 ID: `acp` → `evol`
- 插件目录: `~/.openclaw/extensions/acp` → `~/.openclaw/extensions/evol`
- package.json name: `@openclaw/acp` → `@openclaw/evol`

### 2. Channel 层面
- Channel ID: `acp` → `evol`
- Channel 显示名: `ACP` → `Evol`
- 配置路径: `channels.acp` → `channels.evol`

### 3. 代码层面
- Provider ID: `acp` → `evol`
- Session Key 前缀: `:acp:` → `:acpts:` (避免框架冲突)
- 所有配置读取路径: `channels?.acp` → `channels?.evol`
- 所有 channel 匹配: `channel === "acp"` → `channel === "evol"`

### 4. 文档层面
- 所有安装和配置文档中的示例已更新
- Skill 文档已更新

## 用户迁移步骤

### 已安装用户（自动迁移）

配置文件已通过 `migrate-to-evol.cjs` 脚本自动迁移：

```bash
# 备份位置
~/.openclaw/openclaw.json.pre-evol-migration
```

迁移内容：
- `channels.acp` → `channels.evol`
- `plugins.entries.acp` → `plugins.entries.evol`
- `bindings[].match.channel: "acp"` → `"evol"`

### 验证迁移

1. 检查配置文件：
```bash
cat ~/.openclaw/openclaw.json | grep -A 5 '"evol"'
```

2. 重启 Gateway：
```bash
cd ~/openclaw && pnpm openclaw gateway run
```

3. 查看日志，应该看到：
```
[evol] [bot99299] Starting account bot99299 (bot99299.agentcp.io)
[ACP-Router] Registered identity bot99299 → bot99299.agentcp.io
```

4. 访问 OpenClaw Web UI (http://127.0.0.1:18789)，应该看到：
   - Channel 名称显示为 "Evol"
   - 能看到所有配置的 AID 账号

## 新用户安装

按照 `prompts/install-acp-v2.md` 文档安装，配置示例：

```json
{
  "channels": {
    "evol": {
      "enabled": true,
      "backend": "plugin",
      "identities": {
        "your-agent": {
          "agentId": "your-agent",
          "domain": "agentcp.io",
          "seedPassword": "your-seed-password",
          "allowFrom": ["*"]
        }
      }
    }
  },
  "bindings": [
    {
      "agentId": "your-agent",
      "match": {
        "channel": "evol",
        "accountId": "your-agent"
      }
    }
  ]
}
```

## 注意事项

1. **ACP 协议名称保持不变**：虽然插件改名为 Evol，但底层仍使用 ACP (Agent Communication Protocol) 协议
2. **域名不变**：所有 AID 仍使用 `agentcp.io` 域名
3. **Session 数据**：迁移后需要清理旧 session：
   ```bash
   rm -rf ~/.openclaw/agents/*/sessions/*
   ```
4. **兼容性**：改名后不再与 OpenClaw 官方 ACP 支持冲突

## 回滚方案

如果需要回滚到旧版本：

1. 恢复配置文件：
```bash
cp ~/.openclaw/openclaw.json.pre-evol-migration ~/.openclaw/openclaw.json
```

2. 恢复插件目录：
```bash
cd ~/.openclaw/extensions
mv evol acp
```

3. 重启 Gateway

## 技术细节

### Session Key 格式变化

- 旧格式: `{agentId}:acp:{targetAid}:{sessionId}`
- 新格式: `{agentId}:acpts:{targetAid}:{sessionId}`

这个变化避免了 OpenClaw 框架误认为 session 是由它管理的。

### 配置结构保持不变

除了键名从 `acp` 改为 `evol`，配置结构完全相同：
- `identities` 配置不变
- `agentAidBindingMode` 不变
- `allowFrom` 规则不变
- `seedPassword` 不变

## 迁移完成时间

2026-03-06

## 相关文件

- 安装文档: `prompts/install-acp-v2.md`
- Skill 文档: `skill/acp/SKILL.md`
- 配置参考: `skill/acp/resources/config-reference.md`
- 迁移脚本: `migrate-to-evol.cjs`

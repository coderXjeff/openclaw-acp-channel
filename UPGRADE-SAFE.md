# Evol 插件升级指南

## 一键升级（推荐）

```bash
cd ~/.openclaw/extensions/acp && git pull && node migrate-to-evol.cjs && cd ~/openclaw && pnpm openclaw gateway restart
```

## 分步升级

```bash
# 1. 更新代码
cd ~/.openclaw/extensions/acp && git pull

# 2. 迁移配置（可选但推荐）
node migrate-to-evol.cjs

# 3. 重启 Gateway
cd ~/openclaw && pnpm openclaw gateway restart
```

## 重要说明

**✅ 安全升级：插件已添加兼容逻辑**
- 同时支持 `channels.acp` 和 `channels.evol` 配置
- git pull 后不会导致 Gateway 失败
- 可以随时运行迁移脚本，不影响服务

**为什么要运行迁移脚本？**
- 虽然插件兼容旧配置，但建议迁移到新配置
- 未来版本可能移除对旧配置的支持
- 迁移脚本会自动检测，已迁移的不会重复执行

## 验证升级

启动后应该看到：
```
[evol] [your-agent] Starting account your-agent (your-agent.agentcp.io)
```

Web UI (http://127.0.0.1:18789) 中 Channel 名称显示为 "Evol"。

## 完整文档

- 技术细节：`MIGRATION.md`
- 常见问题：`UPGRADE.md`

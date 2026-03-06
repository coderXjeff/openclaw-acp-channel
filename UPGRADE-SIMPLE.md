# Evol 插件升级指南（简化版）

## 快速升级

```bash
# 1. 先迁移配置（配置改为 evol）
cd ~/.openclaw/extensions/acp && node migrate-to-evol.cjs

# 2. 再更新代码（代码改为 evol）
git pull

# 3. 重启 Gateway
cd ~/openclaw && pnpm openclaw gateway restart
```

**为什么要先迁移配置？**
- 如果先 git pull，代码中 channel ID 变为 evol，但配置还是 acp
- Gateway 会因为配置验证失败而无法启动
- 先迁移配置，确保配置和代码始终一致

## 如果忘记停止 Gateway 会怎样？

如果你在 git pull 后直接重启 Gateway，会看到错误：
```
Invalid config: channels.acp: unknown channel id: acp
```

**解决方法：**
```bash
# 运行迁移脚本
cd ~/.openclaw/extensions/acp && node migrate-to-evol.cjs

# 重启
cd ~/openclaw && pnpm openclaw gateway start
```

## 验证升级成功

启动后应该看到：
```
[evol] [your-agent] Starting account your-agent (your-agent.agentcp.io)
```

Web UI (http://127.0.0.1:18789) 中 Channel 名称显示为 "Evol"。

## 完整文档

详细说明见 `MIGRATION.md`

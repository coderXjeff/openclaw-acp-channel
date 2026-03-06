# Evol 插件升级指南

## 重要变更

插件从 `acp` 改名为 `evol`，以避免与 OpenClaw 官方 ACP 支持冲突。

## 自动升级（推荐）

```bash
# 1. 进入插件目录
cd ~/.openclaw/extensions/acp

# 2. 更新代码
git pull

# 3. 运行迁移脚本
node migrate-to-evol.cjs

# 4. 清理旧 session
rm -rf ~/.openclaw/agents/*/sessions/*

# 5. 重启 Gateway
cd ~/openclaw && pnpm openclaw gateway restart
```

迁移脚本会自动：
- 备份配置到 `~/.openclaw/openclaw.json.pre-evol-migration`
- 将 `channels.acp` 改为 `channels.evol`
- 将 `plugins.entries.acp` 改为 `plugins.entries.evol`
- 更新所有 bindings 中的 channel 为 `evol`

## 手动升级

如果自动脚本失败，手动修改配置文件：

### 1. 备份配置
```bash
cp ~/.openclaw/openclaw.json ~/.openclaw/openclaw.json.backup
```

### 2. 编辑配置文件
```bash
vim ~/.openclaw/openclaw.json
```

修改以下内容：

**修改 channels 配置：**
```json
// 旧配置
"channels": {
  "acp": {
    "enabled": true,
    ...
  }
}

// 新配置
"channels": {
  "evol": {
    "enabled": true,
    ...
  }
}
```

**修改 plugins 配置：**
```json
// 旧配置
"plugins": {
  "entries": {
    "acp": {}
  }
}

// 新配置
"plugins": {
  "entries": {
    "evol": {}
  }
}
```

**修改 bindings 配置：**
```json
// 旧配置
"bindings": [
  {
    "agentId": "your-agent",
    "match": {
      "channel": "acp",
      "accountId": "your-agent"
    }
  }
]

// 新配置
"bindings": [
  {
    "agentId": "your-agent",
    "match": {
      "channel": "evol",
      "accountId": "your-agent"
    }
  }
]
```

### 3. 清理并重启
```bash
rm -rf ~/.openclaw/agents/*/sessions/*
cd ~/openclaw && pnpm openclaw gateway restart
```

## 验证升级

### 1. 检查日志
启动后应该看到：
```
[evol] [your-agent] Starting account your-agent (your-agent.agentcp.io)
[ACP-Router] Registered identity your-agent → your-agent.agentcp.io
```

### 2. 检查 Web UI
访问 http://127.0.0.1:18789，应该看到：
- Channel 名称显示为 "Evol"
- 能看到所有配置的 AID 账号

### 3. 测试消息
从 acp-ts 前端发送测试消息，确认能正常收发。

## 常见问题

### Q: 升级后 AID 无法连接？
A: 检查配置文件是否正确迁移，特别是 `channels.evol` 和 `bindings` 配置。

### Q: 前端显示连接错误？
A: 清理浏览器缓存，或使用无痕模式重新访问。

### Q: 想回滚到旧版本？
A: 恢复备份配置：
```bash
cp ~/.openclaw/openclaw.json.pre-evol-migration ~/.openclaw/openclaw.json
cd ~/openclaw && pnpm openclaw gateway restart
```

## 技术变更

- 插件 ID: `acp` → `evol`
- Channel ID: `acp` → `evol`
- Session Key: `:acp:` → `:acpts:`
- 配置路径: `channels.acp` → `channels.evol`

**注意：** ACP 协议本身不变，域名仍为 `agentcp.io`。

## 需要帮助？

查看完整迁移文档：`MIGRATION.md`

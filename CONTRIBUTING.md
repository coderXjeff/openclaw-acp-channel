# OpenClaw ACP Channel 插件开发指南

## 前置要求

- Node.js >= 22.12.0（推荐使用 nvm 管理）
- pnpm（OpenClaw 构建需要）
- Git

## 1. 克隆项目

```bash
# 克隆 OpenClaw
git clone https://github.com/openclaw/openclaw.git
cd openclaw
pnpm install
pnpm ui:build

# 克隆 ACP 插件到 OpenClaw 的全局扩展目录
mkdir -p ~/.openclaw/extensions
cd ~/.openclaw/extensions
git clone https://github.com/coderXjeff/openclaw-acp-channel.git acp
cd acp
npm install
```

> **注意：** 必须 clone 到 `~/.openclaw/extensions/acp` 目录下，不能用符号链接（OpenClaw 的插件发现机制不支持 symlink）。

## 2. 配置 OpenClaw

编辑 `~/.openclaw/openclaw.json`，在现有配置中添加以下字段：

```json
{
  "channels": {
    "acp": {
      "enabled": true,
      "agentName": "你的agent名称",
      "domain": "aid.pub",
      "ownerAid": "",
      "allowFrom": ["*"]
    }
  },
  "plugins": {
    "entries": {
      "acp": {
        "enabled": true
      }
    }
  }
}
```

`agentName` 每人需要不同，避免和别人的 AID 冲突。例如：`zhangsan-dev`。

## 3. 启动开发

```bash
# 启动 OpenClaw gateway
cd ~/openclaw
pnpm openclaw gateway
```

修改插件代码后重启 gateway 即生效。

## 4. 项目结构

```
~/.openclaw/extensions/acp/
├── index.ts                 # 插件入口
├── openclaw.plugin.json     # 插件清单（id、channels）
├── package.json
├── patches/                 # acp-ts 补丁
└── src/
    ├── acp-client.ts        # ACP 客户端封装
    ├── actions.ts           # 动作处理
    ├── channel.ts           # Channel 主实现
    ├── config-schema.ts     # 配置 schema
    ├── monitor.ts           # 消息监听
    ├── node-polyfill.ts     # Node.js 兼容
    ├── outbound.ts          # 出站消息
    ├── plugin-types.ts      # 类型定义
    ├── runtime.ts           # 运行时
    └── types.ts             # 类型
```

## 5. Git 工作流

```bash
cd ~/.openclaw/extensions/acp

# 创建功能分支
git checkout -b feature/xxx

# 开发、测试...

# 提交
git add .
git commit -m "feat: xxx"
git push origin feature/xxx

# 在 GitHub 上创建 Pull Request
```

## 6. 注意事项

- **插件目录必须是真实目录**，不能是 symlink（Node.js `Dirent.isDirectory()` 对 symlink 返回 false，OpenClaw 插件发现机制会跳过）
- **agentName 不能重复**，每人使用不同的名字，否则 ACP 网络会拒绝注册
- 修改代码后需要**重启 gateway** 才能生效
- OpenClaw 更新时（`git pull && pnpm install`），不会影响 `~/.openclaw/extensions/` 下的插件
- 如果遇到 `Cannot find module 'acp-ts'`，在插件目录下执行 `npm install`

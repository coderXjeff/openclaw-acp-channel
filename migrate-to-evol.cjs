#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
const backupPath = configPath + '.pre-evol-migration';

console.log('🔄 检查是否需要迁移...\n');

// 读取配置
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// 检查是否需要迁移
const needsMigration =
  config.channels?.acp ||
  config.plugins?.entries?.acp ||
  (Array.isArray(config.bindings) && config.bindings.some(b => b?.match?.channel === 'acp'));

if (!needsMigration) {
  console.log('✅ 配置已经是最新的，无需迁移！');
  process.exit(0);
}

console.log('📝 发现需要迁移的配置项\n');

// 备份（仅在需要迁移时）
if (!fs.existsSync(backupPath)) {
  fs.copyFileSync(configPath, backupPath);
  console.log(`✓ 配置已备份到: ${backupPath}`);
} else {
  console.log(`ℹ️  备份已存在: ${backupPath}`);
}

let changed = false;

// 迁移 channels
if (config.channels?.acp) {
  config.channels.evol = config.channels.acp;
  delete config.channels.acp;
  console.log('✓ channels.acp → channels.evol');
  changed = true;
}

// 迁移 plugins
if (config.plugins?.entries?.acp) {
  config.plugins.entries.evol = config.plugins.entries.acp;
  delete config.plugins.entries.acp;
  console.log('✓ plugins.entries.acp → plugins.entries.evol');
  changed = true;
}

// 迁移 bindings
if (Array.isArray(config.bindings)) {
  let count = 0;
  config.bindings.forEach(binding => {
    if (binding?.match?.channel === 'acp') {
      binding.match.channel = 'evol';
      count++;
    }
  });
  if (count > 0) {
    console.log(`✓ 更新了 ${count} 个 bindings: channel: acp → evol`);
    changed = true;
  }
}

// 写回配置
if (changed) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log('✓ 配置已更新\n');
  console.log('✅ 迁移完成！\n');
  console.log('下一步：');
  console.log('1. 清理旧 session: rm -rf ~/.openclaw/agents/*/sessions/*');
  console.log('2. 启动 Gateway: cd ~/openclaw && pnpm openclaw gateway run');
} else {
  console.log('\n⚠️  未发现需要迁移的内容');
}

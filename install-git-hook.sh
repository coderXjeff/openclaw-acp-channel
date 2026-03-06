#!/bin/bash
# 安装 Git post-merge hook，在 git pull 后自动执行迁移脚本

HOOK_FILE=".git/hooks/post-merge"

cat > "$HOOK_FILE" << 'EOF'
#!/bin/bash
# 在 git pull 后自动执行迁移脚本（仅在需要时）

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATE_SCRIPT="$SCRIPT_DIR/migrate-to-evol.cjs"

if [ -f "$MIGRATE_SCRIPT" ]; then
  node "$MIGRATE_SCRIPT"
fi
EOF

chmod +x "$HOOK_FILE"

echo "✅ Git hook 已安装！"
echo "现在每次 git pull 后会自动检测并执行迁移（已迁移的不会重复执行）"

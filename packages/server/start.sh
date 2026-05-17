#!/usr/bin/env bash
#
# Meta-Agent-Server 一键启动（兼容旧方式）
#
# 实际由 bin/maf-server.mjs 管理。
# 此脚本是 npm start 的入口，等效于 maf-server start + 进入 TUI。
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"  # opencode cwd = 包根目录，确保 scripts/ 和 .opencode/ 可达

# 确保依赖
if [[ ! -d "$SCRIPT_DIR/node_modules" ]]; then
  echo "[Meta-Agent] 首次运行，安装依赖..."
  npm install --prefix "$SCRIPT_DIR"
fi

# 启动 Server（通过 CLI，幂等）
node "$SCRIPT_DIR/bin/maf-server.mjs" start

# 进入 opencode 交互式 TUI（Server 已在后台，TUI 退出不影响 Server）
# cwd 在包根目录，这样 Meta-Agent-Server agent 的 `bash scripts/xxx` 能正常工作
exec opencode --agent Meta-Agent-Server --hostname localhost

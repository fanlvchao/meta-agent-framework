#!/usr/bin/env bash
#
# Meta-Agent-Framework 环境准备
#
# 用法：
#   curl -fsSL https://github.com/dendronmind/meta-agent-framework/releases/download/latest/env_install.sh | bash
#
# 检测 Node.js 版本，不够则自动通过 nvm 安装 Node.js 20。
#

set -euo pipefail

REQUIRED_NODE_MAJOR=18
RECOMMENDED_NODE="20"
NVM_INSTALL_URL="https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh"

info()  { echo -e "\033[32m✓\033[0m $*"; }
warn()  { echo -e "\033[33m⚠\033[0m $*"; }
error() { echo -e "\033[31m✗\033[0m $*"; exit 1; }

echo ""
echo "  Meta-Agent-Framework 环境准备"
echo "  ─────────────────────────────"
echo ""

# 检测当前 Node.js 版本
get_node_major() {
  node --version 2>/dev/null | sed 's/v//' | cut -d. -f1 || echo "0"
}

major="$(get_node_major)"

if [[ "$major" -ge "$REQUIRED_NODE_MAJOR" ]]; then
  info "Node.js $(node --version) 已满足要求，无需操作"
  exit 0
fi

if [[ "$major" -gt 0 ]]; then
  warn "当前 Node.js v${major} 版本过低（需要 >= ${REQUIRED_NODE_MAJOR}）"
else
  warn "未检测到 Node.js"
fi

echo ""
echo "  即将通过 nvm 安装 Node.js ${RECOMMENDED_NODE}..."
echo ""

# 安装 nvm（如果已有则跳过）
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
  curl -o- "$NVM_INSTALL_URL" | bash
fi

# 加载 nvm
# shellcheck source=/dev/null
source "$NVM_DIR/nvm.sh"

# 安装 node
nvm install "$RECOMMENDED_NODE"
nvm use "$RECOMMENDED_NODE"
nvm alias default "$RECOMMENDED_NODE"

# 验证
major="$(get_node_major)"
if [[ "$major" -lt "$REQUIRED_NODE_MAJOR" ]]; then
  error "安装失败，请手动安装 Node.js >= ${REQUIRED_NODE_MAJOR}"
fi

info "Node.js $(node --version) 安装完成"
echo ""
echo "  如果命令找不到，请重新打开终端或执行: source ~/.bashrc"
echo ""

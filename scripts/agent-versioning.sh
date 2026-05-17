#!/usr/bin/env bash
#
# agent-versioning.sh — Agent 配置版本管理
#
# 用法：
#   agent-versioning.sh commit [message]    — 快照当前所有 agent 配置
#   agent-versioning.sh rollback <file> [hash] — 回滚指定 agent 到某版本
#   agent-versioning.sh diff <file>         — 查看指定 agent 未提交的变更
#   agent-versioning.sh history <file>      — 查看指定 agent 的变更历史
#   agent-versioning.sh list                — 列出所有被管理的 agent 文件
#
# 设计原则：确定性操作，每次 agent .md 修改前自动 commit，确保可回滚。
# commit 成功后自动触发 agent-registry-sync（如果存在）。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# agent 文件搜索路径（项目级 + 全局）
AGENTS_DIRS=(
    "$PROJECT_ROOT/agents"
)

# 如果全局目录存在，也纳入管理
GLOBAL_AGENTS_DIR="$HOME/.config/opencode/agents"
if [[ -d "$GLOBAL_AGENTS_DIR" ]]; then
    AGENTS_DIRS+=("$GLOBAL_AGENTS_DIR")
fi

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# 确保在 git 仓库内
ensure_git() {
    if ! git -C "$PROJECT_ROOT" rev-parse --is-inside-work-tree &>/dev/null; then
        log_error "Not a git repository: $PROJECT_ROOT"
        exit 1
    fi
}

# commit: 快照所有 agent 配置
cmd_commit() {
    ensure_git
    local message="${1:-"agent: auto-snapshot before modification"}"

    cd "$PROJECT_ROOT"

    # 添加所有 agent 文件
    local has_changes=false
    for dir in "${AGENTS_DIRS[@]}"; do
        if [[ -d "$dir" ]]; then
            local rel_dir
            rel_dir=$(realpath --relative-to="$PROJECT_ROOT" "$dir" 2>/dev/null || echo "$dir")
            if git -C "$PROJECT_ROOT" add "$rel_dir"/*.md 2>/dev/null; then
                has_changes=true
            fi
        fi
    done

    # 检查是否有变更需要提交
    if git -C "$PROJECT_ROOT" diff --cached --quiet; then
        log_info "No agent changes to commit."
        return 0
    fi

    git -C "$PROJECT_ROOT" commit -m "$message"
    log_info "Committed agent snapshot: $message"

    # 链式触发：agent-registry-sync（如果存在）
    local sync_tool="$SCRIPT_DIR/../tools/agent-registry-sync.ts"
    if [[ -f "$sync_tool" ]]; then
        log_info "Triggering agent-registry-sync..."
        # TODO: 实现后取消注释
        # npx tsx "$sync_tool"
        log_warn "agent-registry-sync not yet implemented, skipping."
    fi
}

# rollback: 回滚指定 agent 文件到某个版本
cmd_rollback() {
    ensure_git
    local file="$1"
    local hash="${2:-""}"

    if [[ -z "$file" ]]; then
        log_error "Usage: agent-versioning.sh rollback <file> [commit-hash]"
        exit 1
    fi

    # 查找文件的实际路径
    local filepath
    filepath=$(find_agent_file "$file")
    if [[ -z "$filepath" ]]; then
        log_error "Agent file not found: $file"
        exit 1
    fi

    local rel_path
    rel_path=$(realpath --relative-to="$PROJECT_ROOT" "$filepath")

    cd "$PROJECT_ROOT"

    if [[ -z "$hash" ]]; then
        # 没指定 hash，回滚到上一个版本
        hash=$(git log -2 --format='%H' -- "$rel_path" | tail -1)
        if [[ -z "$hash" ]]; then
            log_error "No previous version found for: $rel_path"
            exit 1
        fi
    fi

    # 先快照当前版本
    cmd_commit "agent: snapshot before rollback of $file"

    # 执行回滚
    git checkout "$hash" -- "$rel_path"
    git add "$rel_path"
    git commit -m "agent: rollback $file to $hash"

    log_info "Rolled back $file to commit $hash"
}

# diff: 查看指定 agent 文件的未提交变更
cmd_diff() {
    ensure_git
    local file="$1"

    if [[ -z "$file" ]]; then
        # 显示所有 agent 文件的 diff
        cd "$PROJECT_ROOT"
        for dir in "${AGENTS_DIRS[@]}"; do
            if [[ -d "$dir" ]]; then
                local rel_dir
                rel_dir=$(realpath --relative-to="$PROJECT_ROOT" "$dir" 2>/dev/null || echo "$dir")
                git -C "$PROJECT_ROOT" diff -- "$rel_dir"/*.md 2>/dev/null || true
            fi
        done
        return
    fi

    local filepath
    filepath=$(find_agent_file "$file")
    if [[ -z "$filepath" ]]; then
        log_error "Agent file not found: $file"
        exit 1
    fi

    local rel_path
    rel_path=$(realpath --relative-to="$PROJECT_ROOT" "$filepath")
    git -C "$PROJECT_ROOT" diff -- "$rel_path"
}

# history: 查看指定 agent 文件的变更历史
cmd_history() {
    ensure_git
    local file="$1"

    if [[ -z "$file" ]]; then
        log_error "Usage: agent-versioning.sh history <file>"
        exit 1
    fi

    local filepath
    filepath=$(find_agent_file "$file")
    if [[ -z "$filepath" ]]; then
        log_error "Agent file not found: $file"
        exit 1
    fi

    local rel_path
    rel_path=$(realpath --relative-to="$PROJECT_ROOT" "$filepath")
    git -C "$PROJECT_ROOT" log --oneline --follow -- "$rel_path"
}

# list: 列出所有被管理的 agent 文件
cmd_list() {
    for dir in "${AGENTS_DIRS[@]}"; do
        if [[ -d "$dir" ]]; then
            for f in "$dir"/*.md; do
                if [[ -f "$f" ]]; then
                    local name
                    name=$(basename "$f" .md)
                    local mode
                    mode=$(grep -oP '(?<=mode:\s).*' "$f" 2>/dev/null | head -1 || echo "unknown")
                    echo -e "${GREEN}$name${NC}\t$mode\t$f"
                fi
            done
        fi
    done
}

# 辅助：查找 agent 文件
find_agent_file() {
    local name="$1"
    # 补全 .md 后缀
    [[ "$name" != *.md ]] && name="$name.md"

    for dir in "${AGENTS_DIRS[@]}"; do
        if [[ -f "$dir/$name" ]]; then
            echo "$dir/$name"
            return
        fi
    done
    # 直接路径
    if [[ -f "$name" ]]; then
        echo "$name"
    fi
}

# 主入口
main() {
    local cmd="${1:-help}"
    shift || true

    case "$cmd" in
        commit)   cmd_commit "$@" ;;
        rollback) cmd_rollback "${1:-}" "${2:-}" ;;
        diff)     cmd_diff "${1:-}" ;;
        history)  cmd_history "${1:-}" ;;
        list)     cmd_list ;;
        help|--help|-h)
            echo "Usage: agent-versioning.sh <command> [args]"
            echo ""
            echo "Commands:"
            echo "  commit [message]         Snapshot all agent configs"
            echo "  rollback <file> [hash]   Rollback agent to a version"
            echo "  diff [file]              Show uncommitted agent changes"
            echo "  history <file>           Show agent change history"
            echo "  list                     List all managed agent files"
            ;;
        *)
            log_error "Unknown command: $cmd"
            exit 1
            ;;
    esac
}

main "$@"

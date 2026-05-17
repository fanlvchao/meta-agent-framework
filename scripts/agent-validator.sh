#!/usr/bin/env bash
#
# agent-validator.sh — Agent .md 配置文件确定性校验
#
# 用法：
#   agent-validator.sh <file>       — 校验单个 agent 文件
#   agent-validator.sh --all        — 校验 agents/ 目录下所有文件
#
# 校验规则（全部确定性，不依赖 AI）：
#   1. 文件必须以 --- frontmatter 开头
#   2. description 字段必填且非空
#   3. mode 必须是 primary / subagent / all 之一
#   4. permission 中如有 bash，必须有 "*" 默认规则
#   5. temperature 如有，必须在 0.0-1.0 范围
#   6. steps 如有，必须是正整数

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
AGENTS_DIR="$PROJECT_ROOT/agents"

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ERRORS=0
WARNINGS=0

log_pass()  { echo -e "  ${GREEN}✓${NC} $*"; }
log_fail()  { echo -e "  ${RED}✗${NC} $*"; ((ERRORS++)); }
log_warn()  { echo -e "  ${YELLOW}!${NC} $*"; ((WARNINGS++)); }

# 提取 frontmatter（--- 之间的内容）
extract_frontmatter() {
    local file="$1"
    sed -n '/^---$/,/^---$/p' "$file" | sed '1d;$d'
}

# 获取 frontmatter 中的字段值
get_field() {
    local fm="$1"
    local field="$2"
    echo "$fm" | grep -oP "(?<=^${field}:\s).*" | head -1 | xargs 2>/dev/null || true
}

# 校验单个文件
validate_file() {
    local file="$1"
    local name
    name=$(basename "$file" .md)

    echo -e "\n${GREEN}Validating:${NC} $name ($file)"

    # 1. 检查 frontmatter 存在
    local first_line
    first_line=$(head -1 "$file")
    if [[ "$first_line" != "---" ]]; then
        log_fail "Missing frontmatter (file must start with ---)"
        return
    fi

    local fm
    fm=$(extract_frontmatter "$file")
    if [[ -z "$fm" ]]; then
        log_fail "Empty or malformed frontmatter"
        return
    fi

    log_pass "Frontmatter found"

    # 2. description 必填
    local desc
    desc=$(get_field "$fm" "description")
    if [[ -z "$desc" ]]; then
        log_fail "Missing required field: description"
    else
        log_pass "description: $desc"
    fi

    # 3. mode 校验
    local mode
    mode=$(get_field "$fm" "mode")
    if [[ -z "$mode" ]]; then
        log_warn "mode not specified (defaults to 'all')"
    elif [[ "$mode" != "primary" && "$mode" != "subagent" && "$mode" != "all" ]]; then
        log_fail "Invalid mode: '$mode' (must be primary/subagent/all)"
    else
        log_pass "mode: $mode"
    fi

    # 4. temperature 范围校验
    local temp
    temp=$(get_field "$fm" "temperature")
    if [[ -n "$temp" ]]; then
        if echo "$temp" | grep -qP '^\d+(\.\d+)?$'; then
            local valid
            valid=$(echo "$temp >= 0.0 && $temp <= 1.0" | bc -l 2>/dev/null || echo "0")
            if [[ "$valid" == "1" ]]; then
                log_pass "temperature: $temp"
            else
                log_fail "temperature out of range: $temp (must be 0.0-1.0)"
            fi
        else
            log_fail "temperature not a number: $temp"
        fi
    fi

    # 5. steps 正整数校验
    local steps
    steps=$(get_field "$fm" "steps")
    if [[ -n "$steps" ]]; then
        if echo "$steps" | grep -qP '^\d+$' && [[ "$steps" -gt 0 ]]; then
            log_pass "steps: $steps"
        else
            log_fail "steps must be a positive integer: $steps"
        fi
    fi

    # 6. bash permission 检查：如果有 bash 权限配置，应该有 "*" 默认规则
    if echo "$fm" | grep -q "bash:"; then
        if echo "$fm" | grep -qP '"\*":|'\''\*'\'':|^\s+\*:'; then
            log_pass "bash permission has default '*' rule"
        else
            log_warn "bash permission defined but no '*' default rule (recommend: \"*\": deny)"
        fi
    fi

    # 7. 检查 frontmatter 后是否有实际 prompt 内容
    local body_lines
    body_lines=$(awk 'BEGIN{c=0} /^---$/{c++; next} c>=2{print}' "$file" | grep -cP '\S' || true)
    if [[ "$body_lines" -eq 0 ]]; then
        log_warn "No prompt content after frontmatter"
    else
        log_pass "Prompt content: ${body_lines} non-empty lines"
    fi
}

# 主入口
main() {
    local target="${1:-help}"

    case "$target" in
        --all)
            if [[ ! -d "$AGENTS_DIR" ]]; then
                echo -e "${RED}Agents directory not found: $AGENTS_DIR${NC}"
                exit 1
            fi
            local count=0
            for f in "$AGENTS_DIR"/*.md; do
                if [[ -f "$f" ]]; then
                    validate_file "$f"
                    ((count++))
                fi
            done
            echo ""
            echo -e "Validated ${GREEN}$count${NC} files. Errors: ${RED}$ERRORS${NC}, Warnings: ${YELLOW}$WARNINGS${NC}"
            ;;
        help|--help|-h)
            echo "Usage: agent-validator.sh <file|--all>"
            echo ""
            echo "  <file>    Validate a single agent .md file"
            echo "  --all     Validate all files in agents/ directory"
            ;;
        *)
            if [[ -f "$target" ]]; then
                validate_file "$target"
            elif [[ -f "$AGENTS_DIR/$target" ]]; then
                validate_file "$AGENTS_DIR/$target"
            elif [[ -f "$AGENTS_DIR/$target.md" ]]; then
                validate_file "$AGENTS_DIR/$target.md"
            else
                echo -e "${RED}File not found: $target${NC}"
                exit 1
            fi
            echo ""
            echo -e "Errors: ${RED}$ERRORS${NC}, Warnings: ${YELLOW}$WARNINGS${NC}"
            ;;
    esac

    # 有错误则返回非零
    [[ "$ERRORS" -eq 0 ]]
}

main "$@"

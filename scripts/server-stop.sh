#!/usr/bin/env bash
# 停止 Meta-Agent Server
#
# 查找策略：
#   1. 按端口查进程（最可靠）
#   2. PID 文件兜底

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$SCRIPT_DIR/state/server.pid"
PORT="${META_AGENT_PORT:-3000}"

# 收集一个进程及其所有子孙 PID
collect_tree() {
  local root=$1
  echo "$root"
  local children
  children=$(ps --ppid "$root" -o pid= 2>/dev/null | tr -d ' ') || true
  for c in $children; do
    [[ -n "$c" ]] && collect_tree "$c"
  done
}

kill_tree() {
  local pid=$1
  if ! kill -0 "$pid" 2>/dev/null; then
    return 1
  fi

  echo "[Meta-Agent] 停止 Server (PID: $pid)..."

  # 往上找 tsx wrapper 父进程，一起杀
  local root="$pid"
  local ppid
  ppid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ') || true
  if [[ -n "$ppid" && "$ppid" != "1" ]]; then
    local pcmd
    pcmd=$(ps -o comm= -p "$ppid" 2>/dev/null) || true
    if [[ "$pcmd" == *"node"* || "$pcmd" == *"tsx"* || "$pcmd" == *"MainThread"* ]]; then
      root="$ppid"
    fi
  fi

  # 收集整棵进程树
  local pids
  pids=$(collect_tree "$root")

  # SIGTERM
  for p in $pids; do
    kill "$p" 2>/dev/null || true
  done

  # 等主进程退出（最多 5 秒）
  for _ in $(seq 1 10); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.5
  done

  # 还没死就 SIGKILL
  if kill -0 "$pid" 2>/dev/null; then
    echo "[Meta-Agent] 进程未响应，强制终止..."
    for p in $pids; do
      kill -9 "$p" 2>/dev/null || true
    done
  fi

  rm -f "$PID_FILE"
  echo "[Meta-Agent] ✅ 已停止"
  return 0
}

# 方式 1（优先）：按端口查进程 — 最可靠，不依赖 PID 文件
PID=$(ss -tlnp 2>/dev/null | grep ":${PORT} " | grep -oP 'pid=\K\d+' | head -1 || true)
if [[ -n "$PID" ]]; then
  kill_tree "$PID"
  exit 0
fi

# 方式 2：PID 文件兜底
if [[ -f "$PID_FILE" ]]; then
  PID=$(cat "$PID_FILE")
  if [[ -n "$PID" ]] && kill_tree "$PID"; then
    exit 0
  fi
  echo "[Meta-Agent] PID 文件中的进程 ($PID) 已不存在，清理"
  rm -f "$PID_FILE"
fi

# 方式 3：按进程命令行匹配（兜底——e2e 残留等场景）
# 只匹配目标端口的 Server 进程，避免误杀其他端口的 Server（如 e2e 测试的）
for CANDIDATE in $(pgrep -f "tsx.*src/index.ts" 2>/dev/null || true); do
  # 检查该进程的环境变量或命令行中是否包含目标端口
  PROC_ENV=$(tr '\0' '\n' < /proc/$CANDIDATE/environ 2>/dev/null || true)
  PROC_PORT=$(echo "$PROC_ENV" | grep -oP '^PORT=\K\d+' || true)
  if [[ "$PROC_PORT" == "$PORT" || -z "$PROC_PORT" ]]; then
    echo "[Meta-Agent] 通过进程名找到 Server (PID: $CANDIDATE, port: ${PROC_PORT:-default})"
    kill_tree "$CANDIDATE"
    exit 0
  fi
done

echo "[Meta-Agent] Server 未在运行（端口 $PORT 无进程）"

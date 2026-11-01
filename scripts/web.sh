#!/bin/bash
# 网页服务: start（前台终端）| check | cleanup（卸掉旧的开机自启，如有）
set -euo pipefail
WEB_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8765}"
URL="http://127.0.0.1:${PORT}/"
LABEL="com.vanta.esp32-serial-web"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"

export PATH="/opt/homebrew/bin:/usr/local/bin:${HOME}/Library/Python/3.9/bin:${PATH}"
[[ -s "${HOME}/.nvm/nvm.sh" ]] && . "${HOME}/.nvm/nvm.sh"

find_node() {
  local c n=""
  for c in node /usr/local/bin/node /opt/homebrew/bin/node; do
    command -v "$c" >/dev/null 2>&1 && n="$(command -v "$c")" && break
  done
  [[ -n "$n" ]] || { echo "未找到 node，请: brew install node" >&2; return 127; }
  echo "$n"
}

free_port() {
  if lsof -ti ":${PORT}" >/dev/null 2>&1; then
    echo "端口 ${PORT} 已被占用，正在释放..."
    lsof -ti ":${PORT}" | xargs kill 2>/dev/null || true
    sleep 0.4
  fi
}

cmd_start() {
  local NODE
  NODE="$(find_node)" || exit $?
  cd "$WEB_DIR"
  [[ -f index.html ]] || { echo "缺少 index.html" >&2; exit 1; }
  free_port
  echo ""
  echo "  Node: $NODE"
  echo "  启动后请在终端点击链接打开控制页："
  echo "  ${URL}"
  echo "  按 Ctrl+C 停止服务"
  echo ""
  exec "$NODE" server.mjs
}

cmd_check() {
  local ok=0 fail=0
  pass() { echo "[OK] $*"; ok=$((ok + 1)); }
  bad() { echo "[FAIL] $*"; fail=$((fail + 1)); }
  command -v node >/dev/null && pass "node $(node --version)" || bad "node"
  [[ -f "${WEB_DIR}/index.html" ]] && pass "index.html" || bad "index.html"
  if curl -sf "${URL}" >/dev/null 2>&1; then
    pass "服务已在运行 ${URL}"
  else
    echo "[提示] 服务未启动。终端运行任务「启动网页服务」或: npm start"
  fi
  [[ "$fail" -eq 0 ]] && exit 0
  exit 1
}

cmd_cleanup() {
  if [[ -f "$PLIST" ]]; then
    launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    echo "已移除旧的开机自启配置。"
  else
    echo "未发现开机自启配置（无需处理）。"
  fi
}

case "${1:-start}" in
  start) cmd_start ;;
  check) cmd_check ;;
  cleanup) cmd_cleanup ;;
  *)
    echo "用法: $0 {start|check|cleanup}" >&2
    exit 2
    ;;
esac

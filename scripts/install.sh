#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TARGET_DIR="${HOME}/.gemini/config/plugins/context-monitor"

if ! command -v node >/dev/null 2>&1; then
  echo "[Error] Node.js 18+ is required. Please install it from https://nodejs.org"
  exit 1
fi

if [[ ! -f "${REPO_DIR}/dist/server.cjs" || ! -f "${REPO_DIR}/dist/app.html" ]]; then
  echo "[Error] Built assets not found in dist/. Run: npm install && npm run build"
  exit 1
fi

mkdir -p "${TARGET_DIR}/assets" "${TARGET_DIR}/dist"
cp "${REPO_DIR}/plugin.json" "${TARGET_DIR}/plugin.json"
cp "${REPO_DIR}/mcp_config.json" "${TARGET_DIR}/mcp_config.json"
[[ -f "${REPO_DIR}/README.md" ]] && cp "${REPO_DIR}/README.md" "${TARGET_DIR}/README.md"
cp "${REPO_DIR}/assets/logo.svg" "${TARGET_DIR}/assets/logo.svg"
cp "${REPO_DIR}/dist/server.cjs" "${TARGET_DIR}/dist/server.cjs"
cp "${REPO_DIR}/dist/app.html" "${TARGET_DIR}/dist/app.html"

echo "[OK] Installed context-monitor plugin to: ${TARGET_DIR}"
echo "Open Antigravity -> Side pane '+' -> 上下文监控 (no restart required)."

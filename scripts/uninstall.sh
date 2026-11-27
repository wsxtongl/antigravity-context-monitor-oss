#!/usr/bin/env bash
set -euo pipefail

TARGET_DIR="${HOME}/.gemini/config/plugins/context-monitor"

if [[ ! -d "${TARGET_DIR}" ]]; then
  echo "[Info] Plugin not installed at: ${TARGET_DIR}"
  exit 0
fi

rm -rf "${TARGET_DIR}"
echo "[OK] Uninstalled plugin from: ${TARGET_DIR}"

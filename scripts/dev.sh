#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 某些 Electron 宿主（例如 Harness）会设置 ELECTRON_RUN_AS_NODE，
# 这会让 Electron 以 Node 模式启动而不是应用模式。
unset ELECTRON_RUN_AS_NODE

if ! command -v node >/dev/null 2>&1; then
  shopt -s nullglob
  for candidate in "$ROOT"/.node/node-*/bin; do
    if [ -x "$candidate/node" ]; then
      export PATH="$candidate:$PATH"
      echo "using bundled node: $candidate"
      break
    fi
  done
  shopt -u nullglob
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: 没找到 node。请安装 Node.js 22+，或把项目自带的 .node 放好。" >&2
  exit 1
fi

echo "node: $(node -v)  npm: $(npm -v)"
if [ "$#" -gt 0 ]; then
  exec npm run dev -- "$@"
fi
exec npm run dev

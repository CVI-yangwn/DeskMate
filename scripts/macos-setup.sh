#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "== DeskMate macOS setup =="
echo "project: $(pwd)"

NODE_MAJOR=0
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
fi

if [ "$NODE_MAJOR" -lt 22 ]; then
  shopt -s nullglob
  for candidate in "$PWD"/.node/node-*/bin; do
    if [ -x "$candidate/node" ]; then
      export PATH="$candidate:$PATH"
      echo "using bundled node: $candidate"
      NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
      break
    fi
  done
  shopt -u nullglob
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: 没找到 node。请先安装 Node.js 22+（推荐 nvm 或 Homebrew），或把项目自带的 .node 放好。" >&2
  exit 1
fi

if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "ERROR: Node $(node -v) 太旧，需要 22+。" >&2
  exit 1
fi

echo "node: $(node -v)"
echo "npm:  $(npm -v)"

if [ -f native/ocr.swift ]; then
  if [ ! -x native/ocr ] || [ native/ocr.swift -nt native/ocr ]; then
    echo "building native OCR helper..."
    xcrun swiftc -O native/ocr.swift -o native/ocr
  fi
fi

if [ -f native/ax.swift ]; then
  if [ ! -x native/ax ] || [ native/ax.swift -nt native/ax ]; then
    echo "building native accessibility helper..."
    xcrun swiftc -O native/ax.swift -o native/ax
  fi
fi

if [ -f native/gui.swift ]; then
  if [ ! -x native/gui ] || [ native/gui.swift -nt native/gui ]; then
    echo "building native GUI helper..."
    xcrun swiftc -O native/gui.swift -o native/gui
  fi
fi

if [ -f native/axdump.swift ]; then
  if [ ! -x native/axdump ] || [ native/axdump.swift -nt native/axdump ]; then
    echo "building native AX dump helper..."
    xcrun swiftc -O native/axdump.swift -o native/axdump
  fi
fi

if [ ! -f .env.local ]; then
  cp .env.example .env.local
  echo "created .env.local from .env.example"
else
  echo ".env.local already exists"
fi

echo
echo "== npm install =="
npm install

echo
echo "== typecheck =="
npm run typecheck

echo
echo "== test =="
npm test

echo
echo "== build =="
npm run build

echo
echo "== done =="
echo "1. 编辑 .env.local，填入有效的 DEEPSEEK_API_KEY（不要提交）。"
echo "2. 运行 bash scripts/dev.sh（会自动使用项目自带的 Node）。"
echo "3. 首次运行去系统设置授予 屏幕录制 / 辅助功能。"

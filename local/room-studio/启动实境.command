#!/bin/zsh
cd "${0:A:h}"
if [[ ! -d node_modules ]]; then
  npm install --no-audit --no-fund || exit 1
fi
if [[ ! -f .bin/reconstruct || ! -f .models/ggml-small-q5_1.bin ]]; then
  npm run setup || exit 1
fi
if [[ ! -f .venv/bin/python || ! -f .bin/brush/brush-app-aarch64-apple-darwin/brush_app ]]; then
  npm run setup:gsplat || exit 1
fi
echo '实境启动后，在 Codex 的独立浏览器或你选择的浏览器打开下方网址。'
npm start

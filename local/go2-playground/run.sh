#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -x .venv/bin/python ]]; then
  echo "请先运行 ./setup.sh 安装本地环境。" >&2
  exit 1
fi
if [[ ! -f vendor/mujoco_menagerie/unitree_go2/scene.xml ]]; then
  echo "缺少 Go2 模型，请先运行 ./setup.sh。" >&2
  exit 1
fi
exec .venv/bin/python -m uvicorn server:app --host 127.0.0.1 --port "${GO2_PORT:-8766}" --no-access-log

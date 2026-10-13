#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -x .venv/bin/python ]]; then
  interpreter=""
  for candidate in "${GO2_PYTHON:-}" "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3" python3.12 python3.13 python3.14; do
    [[ -n "$candidate" ]] || continue
    if command -v "$candidate" >/dev/null 2>&1; then
      interpreter="$candidate"
      break
    fi
  done
  if [[ -z "$interpreter" ]]; then
    echo "请安装 Python 3.12，或用 GO2_PYTHON=/path/to/python3.12 ./setup.sh 指定解释器。" >&2
    exit 1
  fi
  "$interpreter" -m venv .venv
fi
.venv/bin/python -m pip install --index-url https://pypi.org/simple -r requirements.txt
revision="$(cat model-version.txt)"
if [[ ! -d vendor/mujoco_menagerie/.git ]]; then
  mkdir -p vendor
  git clone --depth 1 --filter=blob:none --sparse https://github.com/google-deepmind/mujoco_menagerie.git vendor/mujoco_menagerie
fi
git -C vendor/mujoco_menagerie sparse-checkout set unitree_go2
if [[ "$(git -C vendor/mujoco_menagerie rev-parse HEAD)" != "$revision" ]]; then
  git -C vendor/mujoco_menagerie fetch --depth 1 origin "$revision"
  git -C vendor/mujoco_menagerie checkout --detach "$revision"
fi
.venv/bin/python benchmark.py
echo "环境准备完成。运行 ./run.sh，打开 http://127.0.0.1:8766"

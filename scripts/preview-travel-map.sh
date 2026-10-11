#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
if [[ ! -f .env.amap.local ]]; then
  echo 'Missing .env.amap.local' >&2
  exit 1
fi

set -a
source .env.amap.local
set +a

if [[ -z "${HUGO_AMAP_WEB_KEY:-}" || -z "${HUGO_AMAP_SECURITY_JSCODE:-}" ]]; then
  echo 'Set HUGO_AMAP_WEB_KEY and HUGO_AMAP_SECURITY_JSCODE in .env.amap.local' >&2
  exit 1
fi

exec hugo server --buildDrafts --bind 127.0.0.1 --port 1313 --disableFastRender

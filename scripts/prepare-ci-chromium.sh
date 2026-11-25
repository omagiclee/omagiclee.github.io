#!/usr/bin/env bash
set -euo pipefail

SECONDS=0
playwright=./node_modules/.bin/playwright

# Keep the browser revision pinned by Playwright. The Ubuntu runner already
# supplies Chrome's shared libraries, so only install dependencies if needed.
"$playwright" install chromium --no-shell
chromium_bin=$(node -p 'require("playwright").chromium.executablePath()')
dependencies=$(ldd "$chromium_bin")
if [[ "$dependencies" == *'not found'* ]]; then
  printf '%s\n' "$dependencies"
  "$playwright" install-deps chromium
  dependencies=$(ldd "$chromium_bin")
  if [[ "$dependencies" == *'not found'* ]]; then
    printf '%s\n' "$dependencies" >&2
    exit 1
  fi
else
  echo 'Reusing the runner Chrome libraries.'
fi

has_cjk_fonts() {
  local language
  for language in zh-cn zh-tw ja ko; do
    [[ -n "$(fc-list --format='%{file}\n' ":lang=$language")" ]] || return 1
  done
}

if ! has_cjk_fonts; then
  # Noto Sans CJK 2.004 provides Chinese, Japanese and Korean in one font file.
  font_revision=523d033d6cb47f4a80c58a35753646f5c3608a78
  font_sha256=b76b0433203017ca80401b2ee0dd69350349871c4b19d504c34dbdd80541690a
  font_temp=$(mktemp -d)
  trap 'rm -rf "$font_temp"' EXIT
  font_dir="${XDG_DATA_HOME:-$HOME/.local/share}/fonts"
  echo 'Installing the pinned Noto Sans CJK font collection.'
  curl --fail --silent --show-error --location --retry 3 \
    "https://raw.githubusercontent.com/notofonts/noto-cjk/$font_revision/Sans/OTC/NotoSansCJK-Regular.ttc" \
    --output "$font_temp/NotoSansCJK-Regular.ttc"
  printf '%s  %s\n' "$font_sha256" "$font_temp/NotoSansCJK-Regular.ttc" | sha256sum --check
  install -D -m 0644 "$font_temp/NotoSansCJK-Regular.ttc" "$font_dir/NotoSansCJK-Regular.ttc"
  fc-cache "$font_dir"
fi

if ! has_cjk_fonts; then
  echo 'The runner is missing Chinese, Japanese or Korean font coverage.' >&2
  exit 1
fi

"$chromium_bin" --version
echo "Chrome preparation took ${SECONDS}s"

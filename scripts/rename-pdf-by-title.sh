#!/usr/bin/env bash
#
# rename-pdf-by-title.sh
# ----------------------
# 将通过 `Markdown PDF: Export (PDF)` 命令导出的 index.pdf 重命名为
# index.md 中 front matter 里 `title` 字段对应的文件名，并可选地移动
# 到指定的输出目录。
#
# 用法（在 .vscode/tasks.json 中调用）：
#   bash scripts/rename-pdf-by-title.sh "${fileDirname}"
#   bash scripts/rename-pdf-by-title.sh "${fileDirname}" "${userHome}/Downloads/export_pdf"
#
# 设计：
# - 会先等待最多 60 秒检测 index.pdf 是否已生成（兼容键绑定链式调用扩展命令的异步场景）。
# - 同时兼容 TOML (+++...+++) 和 YAML (---...---) front matter。
# - 文件名中的非法字符 / : * ? " < > | 会替换成 _。
# - 第二个参数为可选输出目录；不存在会自动创建。
#

set -uo pipefail

DIR="${1:-}"
OUTPUT_DIR="${2:-}"
if [ -z "$DIR" ]; then
  echo "❌ 未传入目录参数。tasks.json 中请使用 \${fileDirname} 作为第 1 个参数。"
  exit 1
fi

# 展开 ~ 为 $HOME（防止用户/调用方传入 ~/Downloads/... 字面量）
case "$DIR" in "~"|"~/"*) DIR="${HOME}${DIR#\~}";; esac
case "$OUTPUT_DIR" in "~"|"~/"*) OUTPUT_DIR="${HOME}${OUTPUT_DIR#\~}";; esac

INDEX_MD="$DIR/index.md"
INDEX_PDF="$DIR/index.pdf"

if [ ! -f "$INDEX_MD" ]; then
  echo "❌ 未找到 $INDEX_MD（请确认当前打开的是 index.md 所在 Page Bundle）"
  exit 1
fi

# ---- 1) 等待 index.pdf 出现（最多 60 秒） ----
if [ ! -f "$INDEX_PDF" ]; then
  echo "⏳ 等待 Markdown PDF 导出 index.pdf ..."
  WAITED=0
  while [ ! -f "$INDEX_PDF" ] && [ "$WAITED" -lt 60 ]; do
    sleep 1
    WAITED=$((WAITED + 1))
  done
fi

if [ ! -f "$INDEX_PDF" ]; then
  echo "❌ 60 秒内未发现 $INDEX_PDF。"
  echo "   请先用 Ctrl+Shift+P → 'Markdown PDF: Export (pdf)' 生成 index.pdf 再重试。"
  exit 1
fi

# ---- 2) 解析 front matter 的 title（TOML 优先，YAML 兜底） ----
TITLE=$(awk '
  BEGIN { inFM = 0; delim = "" }
  NR == 1 && /^\+\+\+[[:space:]]*$/ { inFM = 1; delim = "+++"; next }
  NR == 1 && /^---[[:space:]]*$/    { inFM = 1; delim = "---"; next }
  inFM && $0 == delim { exit }
  inFM && /^[[:space:]]*title[[:space:]]*[=:]/ {
    line = $0
    sub(/^[[:space:]]*title[[:space:]]*[=:][[:space:]]*/, "", line)
    sub(/^["'\'']/, "", line)
    sub(/["'\''][[:space:]]*$/, "", line)
    print line
    exit
  }
' "$INDEX_MD")

if [ -z "$TITLE" ]; then
  echo "❌ 无法从 $INDEX_MD 解析出 title 字段"
  echo "   请确认 front matter 顶部包含形如  title = '...'  或  title: '...'  的字段"
  exit 1
fi

# ---- 3) 清理文件名非法字符 ----
SAFE_TITLE=$(printf '%s' "$TITLE" \
  | sed 's/[\/:*?"<>|]/_/g' \
  | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')

if [ -z "$SAFE_TITLE" ]; then
  echo "❌ title 处理后为空字符串"
  exit 1
fi

# ---- 4) 决定输出目录并重命名 / 移动 ----
if [ -n "$OUTPUT_DIR" ]; then
  mkdir -p "$OUTPUT_DIR"
  NEW_PDF="$OUTPUT_DIR/${SAFE_TITLE}.pdf"
  ACTION="重命名并移动"
else
  NEW_PDF="$DIR/${SAFE_TITLE}.pdf"
  ACTION="重命名"
fi

if [ "$NEW_PDF" = "$INDEX_PDF" ]; then
  echo "✅ title 与 'index' 相同且未指定输出目录，无需变更：$INDEX_PDF"
  exit 0
fi

if [ -e "$NEW_PDF" ]; then
  echo "⚠️  目标文件已存在，将被覆盖：$NEW_PDF"
fi

if ! mv -f "$INDEX_PDF" "$NEW_PDF"; then
  echo "❌ 移动/重命名失败（请检查目标目录是否存在或权限是否足够）"
  exit 1
fi

echo "✅ 已${ACTION}："
echo "   $INDEX_PDF"
echo "→  $NEW_PDF"

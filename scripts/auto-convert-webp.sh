#!/bin/bash
# 自动监听并转换新粘贴的图片为 WebP

echo "🎯 启动图片自动转换监听..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📁 监控目录: content/posts"
echo "⚙️  质量设置: 85"
echo "💡 提示: 使用 Ctrl+C 停止监听"
echo ""

# 检查 cwebp 是否安装
if ! command -v cwebp &> /dev/null; then
    echo "❌ 未安装 cwebp，请先安装："
    echo "   brew install webp"
    exit 1
fi

# 检查 fswatch 是否安装（macOS）
if ! command -v fswatch &> /dev/null; then
    echo "❌ 未安装 fswatch，请先安装："
    echo "   brew install fswatch"
    exit 1
fi

# 监听文件变化
fswatch -0 -r \
  -e ".*" \
  -i "\\.png$" \
  -i "\\.jpg$" \
  -i "\\.jpeg$" \
  content/posts | \
while read -d "" file; do
    # 等待文件写入完成
    sleep 0.5
    
    if [ -f "$file" ]; then
        output="${file%.*}.webp"
        filename=$(basename "$file")
        output_name=$(basename "$output")
        
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "🔔 检测到新图片: $filename"
        echo "📁 路径: $file"
        
        # 检查文件是否为空
        if [ ! -s "$file" ]; then
            echo "⚠️  警告: 文件为空（0字节），跳过转换"
            echo ""
            continue
        fi
        
        # 转换为 WebP（显示错误信息）
        error_msg=$(cwebp -q 85 "$file" -o "$output" 2>&1)
        if [ $? -eq 0 ] && [ -f "$output" ]; then
            echo "✅ 生成 WebP: $output_name"
            
            # 获取图片所在目录
            dir=$(dirname "$file")
            
            # 查找 Markdown 文件（优先同目录的 index.md）
            md_file="$dir/index.md"
            if [ ! -f "$md_file" ]; then
                # 尝试父目录
                md_file="$(dirname "$dir")/index.md"
            fi
            
            if [ -f "$md_file" ]; then
                # 替换路径（支持多种格式）
                sed -i '' "s|images/$filename|images/$output_name|g" "$md_file"
                sed -i '' "s|./$filename|./images/$output_name|g" "$md_file"
                sed -i '' "s|$filename|images/$output_name|g" "$md_file"
                echo "📝 已更新 Markdown: $(basename $(dirname "$md_file"))/$(basename "$md_file")"
            else
                echo "⚠️  未找到 Markdown 文件，请手动更新引用"
            fi
            
            # 删除原图
            rm "$file"
            echo "🗑️  已删除原图: $filename"
            echo "✨ 完成！"
        else
            echo "❌ 转换失败"
            echo "📄 错误信息: $error_msg"
        fi
        echo ""
    fi
done

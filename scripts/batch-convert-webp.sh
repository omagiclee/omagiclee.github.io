#!/bin/bash
# 批量转换现有图片为 WebP

echo "🔄 批量转换现有图片为 WebP..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 检查 cwebp 是否安装
if ! command -v cwebp &> /dev/null; then
    echo "❌ 未安装 cwebp，请先安装："
    echo "   brew install webp"
    exit 1
fi

converted_count=0
skipped_count=0
failed_count=0
empty_count=0

# 查找所有 PNG/JPG/JPEG 图片
find content/posts -type f \( -name "*.png" -o -name "*.jpg" -o -name "*.jpeg" \) | while read file; do
    output="${file%.*}.webp"
    filename=$(basename "$file")
    output_name=$(basename "$output")
    dir=$(dirname "$file")
    
    echo ""
    echo "📁 $file"
    
    # 检查文件是否为空
    if [ ! -s "$file" ]; then
        echo "  ⚠️  空文件（0字节），跳过"
        empty_count=$((empty_count + 1))
        continue
    fi
    
    # 如果 WebP 已存在，跳过
    if [ -f "$output" ]; then
        echo "  ⏭️  WebP 已存在，跳过"
        skipped_count=$((skipped_count + 1))
        continue
    fi
    
    # 转换为 WebP（显示错误信息）
    error_msg=$(cwebp -q 85 "$file" -o "$output" 2>&1)
    if [ $? -eq 0 ] && [ -f "$output" ]; then
        echo "  ✅ 转换成功: $output_name"
        
        # 查找并更新所有引用此图片的 Markdown 文件
        # 在当前博客目录和父目录中查找 index.md
        md_file="$dir/index.md"
        if [ ! -f "$md_file" ]; then
            # 尝试父目录
            md_file="$(dirname "$dir")/index.md"
        fi
        
        if [ -f "$md_file" ]; then
            # 更新引用
            sed -i '' "s|$filename|$output_name|g" "$md_file"
            echo "  📝 已更新 Markdown: $(basename $(dirname "$md_file"))/$(basename "$md_file")"
        else
            # 搜索所有可能引用此图片的 Markdown
            grep -rl "$filename" content/posts --include="*.md" | while read ref_md; do
                sed -i '' "s|$filename|$output_name|g" "$ref_md"
                echo "  📝 已更新 Markdown: $ref_md"
            done
        fi
        
        # 删除原图
        rm "$file"
        echo "  🗑️  已删除原图: $filename"
        
        converted_count=$((converted_count + 1))
    else
        echo "  ❌ 转换失败"
        echo "  📄 错误信息: $error_msg"
        failed_count=$((failed_count + 1))
    fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✨ 批量转换完成！"
echo "📊 统计:"
echo "   ✅ 转换成功: $converted_count"
echo "   ⏭️  跳过已存在: $skipped_count"
echo "   ⚠️  跳过空文件: $empty_count"
echo "   ❌ 失败: $failed_count"

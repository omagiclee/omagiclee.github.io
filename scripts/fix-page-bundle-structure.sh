#!/bin/bash
# 修复 Page Bundle 结构：规范所有博客的图片组织
# 目标：所有图片统一到 index.md 所在目录的 images/ 子目录

echo "🚀 开始修复 Page Bundle 结构..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

total_blogs=0
processed_blogs=0
moved_files=0
updated_mds=0
deleted_dirs=0

# 查找所有包含 index.md 的博客目录
find content/posts -type f -name "index.md" | while read md_file; do
    blog_dir=$(dirname "$md_file")
    total_blogs=$((total_blogs + 1))
    
    echo "📂 处理博客: $blog_dir"
    
    # 标记是否有变更
    has_changes=false
    
    # 创建标准的 images 目录
    target_images_dir="$blog_dir/images"
    mkdir -p "$target_images_dir"
    
    # ===== 步骤1: 处理 image/index/ 目录（Paste Image 插件生成的旧路径）=====
    if [ -d "$blog_dir/image/index" ]; then
        echo "  🔍 发现旧结构: image/index/"
        
        # 移动所有图片文件
        find "$blog_dir/image/index" -type f \( -name "*.webp" -o -name "*.png" -o -name "*.jpg" -o -name "*.jpeg" -o -name "*.gif" -o -name "*.svg" \) | while read img_file; do
            img_name=$(basename "$img_file")
            target_file="$target_images_dir/$img_name"
            
            # 只移动不存在的文件（避免覆盖）
            if [ ! -f "$target_file" ]; then
                mv "$img_file" "$target_file"
                echo "    ➜ 移动: $img_name"
                moved_files=$((moved_files + 1))
                has_changes=true
            else
                # 文件已存在，删除重复文件
                rm "$img_file"
                echo "    🗑️  删除重复: $img_name"
            fi
        done
        
        # 删除空目录
        rmdir "$blog_dir/image/index" 2>/dev/null
        rmdir "$blog_dir/image" 2>/dev/null
        if [ ! -d "$blog_dir/image" ]; then
            echo "    ✅ 清理旧目录: image/"
            deleted_dirs=$((deleted_dirs + 1))
        fi
    fi
    
    # ===== 步骤2: 处理其他非标准位置的图片 =====
    # 查找 image/ 目录（不是 images/）
    if [ -d "$blog_dir/image" ] && [ ! -L "$blog_dir/image" ]; then
        echo "  🔍 发现非标准目录: image/"
        
        find "$blog_dir/image" -type f \( -name "*.webp" -o -name "*.png" -o -name "*.jpg" -o -name "*.jpeg" -o -name "*.gif" -o -name "*.svg" \) | while read img_file; do
            img_name=$(basename "$img_file")
            target_file="$target_images_dir/$img_name"
            
            if [ ! -f "$target_file" ]; then
                mv "$img_file" "$target_file"
                echo "    ➜ 移动: $img_name"
                moved_files=$((moved_files + 1))
                has_changes=true
            else
                rm "$img_file"
                echo "    🗑️  删除重复: $img_name"
            fi
        done
        
        # 清理空目录
        find "$blog_dir/image" -type d -empty -delete 2>/dev/null
        if [ ! -d "$blog_dir/image" ]; then
            echo "    ✅ 清理目录: image/"
        fi
    fi
    
    # ===== 步骤3: 处理 assets/images/ 目录 =====
    if [ -d "$blog_dir/assets/images" ]; then
        echo "  🔍 发现旧结构: assets/images/"
        
        find "$blog_dir/assets/images" -type f \( -name "*.webp" -o -name "*.png" -o -name "*.jpg" -o -name "*.jpeg" -o -name "*.gif" -o -name "*.svg" \) | while read img_file; do
            img_name=$(basename "$img_file")
            target_file="$target_images_dir/$img_name"
            
            if [ ! -f "$target_file" ]; then
                mv "$img_file" "$target_file"
                echo "    ➜ 移动: $img_name"
                moved_files=$((moved_files + 1))
                has_changes=true
            else
                rm "$img_file"
                echo "    🗑️  删除重复: $img_name"
            fi
        done
        
        rmdir "$blog_dir/assets/images" 2>/dev/null
        rmdir "$blog_dir/assets" 2>/dev/null
        if [ ! -d "$blog_dir/assets" ]; then
            echo "    ✅ 清理目录: assets/"
        fi
    fi
    
    # ===== 步骤4: 更新 Markdown 中的图片路径 =====
    if [ -f "$md_file" ] && [ "$has_changes" = true ]; then
        echo "  📝 更新 Markdown 引用..."
        
        # 创建备份
        cp "$md_file" "$md_file.bak"
        
        # 更新各种可能的图片路径格式
        # 1. image/index/xxx.ext -> images/xxx.ext
        sed -i '' 's|image/index/\([^)]*\)|images/\1|g' "$md_file"
        
        # 2. ./image/index/xxx.ext -> images/xxx.ext
        sed -i '' 's|\./image/index/\([^)]*\)|images/\1|g' "$md_file"
        
        # 3. assets/images/xxx.ext -> images/xxx.ext
        sed -i '' 's|assets/images/\([^)]*\)|images/\1|g' "$md_file"
        
        # 4. ./assets/images/xxx.ext -> images/xxx.ext
        sed -i '' 's|\./assets/images/\([^)]*\)|images/\1|g' "$md_file"
        
        # 5. image/xxx.ext -> images/xxx.ext (不是 images/)
        sed -i '' 's|\!\[\([^]]*\)\](image/\([^)]*\))|![\1](images/\2)|g' "$md_file"
        
        # 6. 处理没有 ./ 前缀的相对路径
        # 但要避免已经是 images/ 的路径
        
        echo "    ✅ Markdown 已更新"
        updated_mds=$((updated_mds + 1))
    fi
    
    # ===== 步骤5: 处理博客根目录直接放置的图片 =====
    echo "  🔍 检查根目录的图片文件..."
    find "$blog_dir" -maxdepth 1 -type f \( -name "*.webp" -o -name "*.png" -o -name "*.jpg" -o -name "*.jpeg" -o -name "*.gif" -o -name "*.svg" \) | while read img_file; do
        img_name=$(basename "$img_file")
        target_file="$target_images_dir/$img_name"
        
        # 检查 images/ 目录是否已有该文件
        if [ -f "$target_file" ]; then
            # 比较文件大小，如果相同则删除根目录的副本
            root_size=$(stat -f%z "$img_file" 2>/dev/null || stat -c%s "$img_file" 2>/dev/null)
            target_size=$(stat -f%z "$target_file" 2>/dev/null || stat -c%s "$target_file" 2>/dev/null)
            
            if [ "$root_size" = "$target_size" ]; then
                rm "$img_file"
                echo "    🗑️  删除根目录重复: $img_name"
                has_changes=true
            else
                echo "    ⚠️  警告: 同名文件大小不同，请手动检查: $img_name"
            fi
        else
            # 移动到 images/ 目录
            mkdir -p "$target_images_dir"
            mv "$img_file" "$target_file"
            echo "    ➜ 移动根目录文件: $img_name"
            moved_files=$((moved_files + 1))
            has_changes=true
        fi
    done
    
    # ===== 步骤6: 更新根目录图片的引用（如果有变更）=====
    if [ "$has_changes" = true ] && [ -f "$md_file" ]; then
        # 更新直接引用图片的路径（不带目录前缀）
        # 例如：![](file.webp) -> ![](images/file.webp)
        # 但要避免已经是 images/ 的路径
        
        # 匹配 ![xxx](xxx.webp) 但不匹配 ![xxx](images/xxx.webp) 或 ![xxx](./images/xxx.webp)
        sed -i '' 's|\!\[\([^]]*\)\](\([^/]*\.\(webp\|png\|jpg\|jpeg\|gif\|svg\)\))|![\1](images/\2)|g' "$md_file"
        
        echo "    📝 更新根目录图片引用"
    fi
    
    # ===== 步骤7: 验证并清理空的 images 目录 =====
    if [ -d "$target_images_dir" ]; then
        img_count=$(find "$target_images_dir" -type f | wc -l | tr -d ' ')
        if [ "$img_count" -eq 0 ]; then
            rmdir "$target_images_dir" 2>/dev/null
            echo "  🗑️  删除空的 images 目录"
        else
            echo "  ✅ images/ 目录包含 $img_count 个文件"
            processed_blogs=$((processed_blogs + 1))
        fi
    fi
    
    echo ""
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✨ 修复完成！"
echo ""
echo "📊 统计信息:"
echo "  📂 扫描博客总数: $total_blogs"
echo "  ✅ 处理的博客: $processed_blogs"
echo "  📁 移动的文件: $moved_files"
echo "  📝 更新的 Markdown: $updated_mds"
echo "  🗑️  清理的目录: $deleted_dirs"
echo ""
echo "💡 提示: Markdown 备份文件保存为 *.md.bak"
echo "   如需恢复: find content/posts -name '*.md.bak' -delete"

# 📸 图片管理脚本使用指南

## 🎯 快速开始

### VS Code 任务（推荐）

按 `Cmd+Shift+P` → `Run Task` → 选择：

```
🔧 修复 Page Bundle 结构       ← 修复已有博客
🎯 启动图片自动转换监听         ← 日常写博客
📦 批量转换现有图片为 WebP     ← 处理遗漏
```

---

## 📋 脚本说明

### 1. fix-page-bundle-structure.sh

**功能**：修复 Page Bundle 结构

```bash
./scripts/fix-page-bundle-structure.sh
```

**处理内容**：
- ✅ 合并 `image/index/` → `images/`
- ✅ 合并 `image/` → `images/`
- ✅ 合并 `assets/images/` → `images/`
- ✅ 删除重复文件
- ✅ 更新 Markdown 引用
- ✅ 清理空目录

**输出示例**：
```
📂 处理博客: content/posts/VLMs/Qwen3-VL
  🔍 发现旧结构: image/index/
    🗑️  删除重复: 1764242048425.webp
    ✅ 清理旧目录: image/
  ✅ images/ 目录包含 1 个文件
```

---

### 2. auto-convert-webp.sh

**功能**：自动监听并转换新图片

```bash
./scripts/auto-convert-webp.sh
```

**监听规则**：
- 📁 监控：`content/posts`
- 📄 文件：`*.png`, `*.jpg`, `*.jpeg`
- ⚙️  质量：85

**工作流程**：
```
检测新图片 → 转换 WebP → 更新 Markdown → 删除原图
```

**使用场景**：
- 日常写博客前启动
- 后台持续运行
- `Ctrl+C` 停止

---

### 3. batch-convert-webp.sh

**功能**：批量转换现有图片

```bash
./scripts/batch-convert-webp.sh
```

**处理逻辑**：
- ✅ 扫描所有 PNG/JPG
- ⏭️  跳过已存在的 WebP
- ⚠️  跳过空文件（0字节）
- 🔄 转换并更新引用
- 🗑️  删除原图

---

## 📝 日常工作流

### 每次写博客前

```bash
# 1. 启动监听
Cmd+Shift+P → Run Task → 🎯 启动图片自动转换监听
```

### 粘贴图片

```bash
# 2. 截图
Cmd+Shift+4

# 3. 粘贴到 Markdown
Ctrl+Alt+V

# 4. 自动完成（无需操作）
✨ 自动转换为 WebP
```

---

## 📂 标准结构

### Page Bundle 结构

```
content/posts/blog-name/
├── index.md
└── images/
    └── *.webp
```

### Markdown 引用

```markdown
![图片说明](images/filename.webp)
```

---

## 🔧 配置文件

### Paste Image 配置

位置：`.vscode/settings.json`

```json
{
  "pasteImage.path": "${currentFileDir}/images",
  "pasteImage.basePath": "${currentFileDir}",
  "pasteImage.defaultName": "YYYYMMDDHHmmss",
  "pasteImage.namePrefix": "${currentFileNameWithoutExt}-"
}
```

---

## 📊 验证命令

```bash
# 检查非标准目录（应为 0）
find content/posts -type d -name "image"

# 统计 images 目录数量
find content/posts -type d -name "images" | wc -l

# 统计 WebP 总数
find content/posts -name "*.webp" | wc -l

# 查找未转换的图片
find content/posts -name "*.png" -o -name "*.jpg"
```

---

## ⚙️ 自定义配置

### 修改 WebP 质量

编辑脚本中的 `-q 85` 参数：

```bash
# auto-convert-webp.sh 或 batch-convert-webp.sh
cwebp -q 85 "$file" -o "$output"
      ↑
      改为 90（更高质量，更大文件）
      改为 75（较低质量，更小文件）
```

### 保留原图不删除

注释掉删除命令：

```bash
# rm "$file"  ← 注释这行
```

---

## 🛠️ 依赖安装

```bash
# 安装 WebP 工具
brew install webp

# 安装文件监听工具
brew install fswatch

# 安装 Paste Image 插件
code --install-extension mushan.vscode-paste-image
```

---

## 📄 相关文档

- `IMAGE_MANAGEMENT.md` - 完整管理方案文档
- `.vscode/settings.json` - Paste Image 配置
- `.vscode/tasks.json` - VS Code 任务配置

---

## ✨ 总结

```
启动监听 → 粘贴图片 → 自动转换 → 完成！
```

**🎉 享受高效的博客写作！**

# 模板占位博文备份

本文件夹为「仅含 blog 模板结构、无实质内容」的博文备份，已从 `content/posts` 中删除。

## 判定标准

仅包含以下结构且无正文的占位文章：
- Motivations / Motivation
- Contributions / Contribution
- Method
- Experiments / Experiment（含 "Test content." 等占位）
- References
- Questions / Question

## 已备份并删除的 8 篇（本批）

| 原路径 | 说明 |
|--------|------|
| `content/posts/LLMs/DeepSeeks/DeepSeek-R1/` | DeepSeek R1，仅模板 |
| `content/posts/Fundamentals/DDIM/` | DDIM，仅模板 |
| `content/posts/LLMs/BERT/` | BERT，仅模板 |
| `content/posts/CLIPs/GLIP/` | GLIP，仅模板 |
| `content/posts/E2E/diff-ad/` | DiffAD，仅模板/测试内容 |
| `content/posts/E2E/drive-transformer/` | DriveTransformer，仅模板+图 |
| `content/posts/E2E/diffusion-planner/` | Diffusion Planner，仅模板+图 |
| `content/posts/E2E/sparse-drive/` | SparseDrive，仅模板+图 |

备份包含对应目录下的 `index.md` 及 `images/` 等资源。

## 恢复方式

将对应目录从本备份复制回 `content/posts` 下即可，例如：

```bash
cp -r backup-empty-posts/content/posts/LLMs/DeepSeeks/DeepSeek-R1 content/posts/LLMs/DeepSeeks/
```

+++
date = '2018-06-03T17:10:36+08:00'
draft = false
title = 'uv-pip'
categories = ['Package Management']
tags = ['Package Management', 'uv', 'pip']
+++


## uv
### Installation & Configuration

```bash
conda env create -n uv-pip python=3.12
conda activate uv-pip

# use pipx to install uv in isolated environment.
pip3 install pipx
pipx install uv
pipx ensurepath

# config uv to use the mirror source
vim ~/config/uv/uv.toml
[[index]]
url = "https://mirrors.aliyun.com/pypi/simple/"
default = true
```

### Usage
```
uv pip install ipython
uv pip install vllm --torch-backend=auto --index-url https://mirrors.aliyun.com/pypi/simple/
```




## pip

```bash
# 从 PyPI（pypi.org）安装
pip install diffusers

# 直接从指定 GitHub 拉取源码, 按照仓库中的 setup.py 或 pyproject.toml 安装
pip install git+https://github.com/huggingface/diffusers

# 离线构建 wheel
git clone git@github.com:huggingface/diffusers
pip install build setuptools wheel
# build from setup.py (old)
#python setup.py bdist_wheel  # save to ./dist 
# build from pyproject.toml (new)
python -m build --wheel  # save to ./dist

# 下载
pip download torch torchvision --index-url https://download.pytorch.org/whl/cu130
pip download torch torchvision --find-links https://mirrors.aliyun.com/pytorch-wheels/cu130

```

## `--index-url`

pip 把该 URL 当作**唯一的包索引**去解析依赖并下载包。该地址必须提供符合 **PEP 503** 的简单 API：即一个可列出包名的 HTML 索引页，以及每个包对应的 `/<package_name>/` 目录页，目录页里包含该包各版本的 `.whl` / `.tar.gz` 链接。

- **约束**：镜像或自建源必须实现 PEP 503 规定的目录结构，pip 才能正确解析包名和版本。
- **行为**：使用 `--index-url` 时，pip **不会**再访问默认的 PyPI，所有包（含依赖）都只从该地址拉取。适合「全量走国内镜像」或「内网私有 PyPI」。
- **示例**：`pip install torch --index-url https://download.pytorch.org/whl/cu130`（仅从 PyTorch 官方 wheel 索引安装，不查 pypi.org）。

## `--extra-index-url`
补充源

## `--find-links`

pip 会**额外**去你给的 URL（或本地路径）里扫描页面，收集页面上出现的 `.whl`、`.tar.gz` 等链接，作为候选包来源。不要求该页面符合 PEP 503，只要 HTML 里存在可点击的包文件链接即可。

- **约束**：无标准 API 要求，任意能列出下载链接的网页或本地 `file://` 目录都可以。
- **行为**：**不会**替换默认索引，而是与 PyPI（或当前 `--index-url`）一起使用；pip 在解析版本时会把这里找到的包一并考虑，常用于「部分包用自建/镜像、其余仍走 PyPI」。
- **示例**：`pip install torch --find-links https://mirrors.aliyun.com/pytorch-wheels/cu130`（优先用阿里云上的 wheel，其它依赖照常从 PyPI 拉）。

**对比**：`--index-url` = 只用这一个索引；`--find-links` = 在现有索引之外多一个「链接池」，适合混用公网 PyPI 和少量私有/镜像包。 
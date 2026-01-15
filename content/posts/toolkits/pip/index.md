+++
date = '2025-11-28T17:10:36+08:00'
draft = false
title = 'pip'
organization = []
categories = []
tags = []
+++

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
```

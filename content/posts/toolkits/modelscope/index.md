+++
date = '2025-11-28T11:07:27+08:00'
draft = false
title = 'ModelScope'
organization = []
categories = []
tags = []
+++

## Installation

```bash
# Installation
pip install modelscope  # ModelScope 的核心 hub 支持
# pip install modelscope[framework]  # ModelScope 框架能力，包含数据集的加载，外部模型的使用等
# pip install modelscope[nlp/cv/audio/multi-modal/science]  -f https://modelscope.oss-cn-beijing.aliyuncs.com/release/repo.html  # 分领域模型依赖安装

# Verify
python -c "from modelscope.pipelins import pipeline; print(pipeline('word-segmentation')('今天天气不错，适合 出去游玩！'))"
```


## 模型下载

### 通过命令行工具下载

```bash
# 默认下载路径：`~/.cache/modelscope/hub`
# 修改默认cache 路径
export MODELSCOPE_CACHE = ''

# 下载模型
modelscope download --model 'Qwen/Qwen3-32B'
```

### 通过 ModelScope SDK 下载

```python
from modelscope.hub.snapshot_download import snapshot_download

model_dir = snapshot_download('Qwen/Qwen3-32B')
```

### 通过加载模型触发下载

使用 ModelScope SDK 加载模型时，自动触发下载。

```python
from modelscope.models import Model

model = Model.from_pretrained('Qwen/Qwen3-32B')
```

### 通过 git 下载模型

ModelScope 服务端的模型通过 git 存储。

```bash
git lfs install
git clone https://www.modelscope.cn/Qwen/Qwen3-32B.git
```

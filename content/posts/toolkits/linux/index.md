+++
date = '2018-06-03T11:53:05+08:00'
draft = false
title = 'Linux'
categories = ['Linux']
tags = ['Linux']
+++

## 设置环境变量
- 内联变量赋值（推荐和标准做法）
```bash
VLLM_USE_MODELSCOPE=True python vllm.py  # 仅对当前脚本运行的子进程生效
```
- 使用 `export` 命令
```bash
export VLLM_USE_MODELSCOPE=True  # 对当前 shell 派生的所有子进程生效
python vllm.py
```

- 程序化设置
```python
import os
# 必须在 vllm 库的任何导入语句或调用之前执行
os.environ['VLLM_USE_MODELSCOPE'] = 'True' # 仅对当前脚本运行的子进程生效

import vllm
```

+++
date = '2025-02-11T10:17:16+08:00'
draft = false
title = '大模型 API 开发指南'
categories = ['LLMs']
tags = ['LLMs', 'VLMs', 'aliyun API']
+++

## 阿里云百炼平台

https://bailian.console.aliyun.com/cn-beijing/?spm=a2c4g.11186623.0.0.3bb0394e3JQHXT&tab=api#/api/?type=model&url=2712195

1. 获取 API Key

https://bailian.console.aliyun.com/cn-beijing/?tab=model#/api-key

2. 调用 API Key

- API Key
- Base URL: https://dashscope.aliyuncs.com/compatible-mode/v1
- Model Name: 如 qwen3-max

sample: 
- https://help.aliyun.com/zh/model-studio/claude-code
- https://help.aliyun.com/zh/model-studio/openclaw?spm=a2c4g.11186623.help-menu-2400256.d_0_10_5.79ec69c3Dekn1K&scm=20140722.H_3020785._.OR_help-T_cn~zh-V_1

3. 配置 API Key 环境变量

```zsh
echo "export DASHSCOPE_API_KEY='YOUR_DASHSCOPE_API_KEY'" >> ~/.zshrc
source ~/.zshrc
```

4. 安装 OpenAI-Python SDK
```python
pip3 install -U openai
```
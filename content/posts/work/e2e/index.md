+++
date = '2025-06-16T15:30:51+08:00'
draft = false
title = 'E2E'
categories = []
tags = []
+++

## CityNOA
- tech topic
    - VLA
    - Diffusion
        - 基础学习
    - VLA & Diffusion 合并
    - 大模型蒸馏
    - 强化学习
- Carla
- 实车
    - VLA能否目标在250TOPS 上跑？
    - A2000
    - VLA & E2E 整合
    - 城市地图
- Paper
    - Diffuison
        - DIT
        - 时序
        - joint diffusion (one decoder)
<!-- - Omniverse, NVIDIA DRIVE Sim -->




## Infra
1. A2000 部署摸底【P0】
    - 硬件参数
    - NM Thor 能否尝试部署
    - ORIN-X: VLM? (下下周)
2. 模型压缩: 大模型 -> 小模型【P1】
3. 模型训练加速【P0】
    - 耗时瓶颈分析【P0】
    - DALI【P1】
    - torch 2.0+ 升级【P1】
4. Partial Label【P1】
5. Self-Supervised Learning【P1】
6. 预训练大模型



## VLA
1. HuggingFace + Qwen2.5-VL-72B-Instruct
2. Qwen2.5-VL-72B-Instruct
    - 论文阅读
    - 数据理解
    - 实操测试
3. LLava
4. InternVL

1. 数据
2. 架构
    - 双流
    - VLA

3. 机器人领域调研

**VLA**
- 增强可解释性
- 人机交互
- VLM 预训练知识
- 


**Stage-1: VLM + E2E 双模型**

- T1: 量化部署和推理 Pipeline
- T2: E2E 实车 common sense 认知

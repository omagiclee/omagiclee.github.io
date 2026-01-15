+++
date = '2025-06-16T15:29:16+08:00'
draft = false
title = 'AI-Powered Data-Centric Closed-Loop System'
categories = []
tags = []
+++

## Pipeline

- 数据采集
- 数据清洗
- 数据存储
- 数据挖掘
- 数据标注
- 模型训练
- 仿真验证
- 集成部署

## Data Platform

高效性，稳定性，易用性!

- AgentAI: 自然语言搜索
- Milvus

## Data Mining

- Foundation Models
  - Closed-Set Models
    - 2D 大模型 + 两阶段方案 (结合大模型)
    - 4D 大模型
      - BEV-OD
      - BEV-Map
  - Open-Vocabulary Models
    - 开集检测
    - 开集分割
  - Contrastive Learning
    - CLIPs
  - VQA
- 数据质量评估体系
  - 数据去重
  - 数据蒸馏
  - Active Learning
- Applications
  - 云端:
    - Tag Retrieval System
      - Close-Set Models
      - Open-Vocabulary Models
      - Contrastive Learning
    - Multi-modal Retrieval System
      - Image-level
      - Patch-level
      - Instance-level
        - Close-Set Object BBox + CLIP
        - Open-Vocabulary Object BBox + CLIP
  - 车端: Shadow Mode【暂无需求】

### 开发方向

1. 目标级连续动态行为理解：比如 cutin -> instance-level clip? 两阶段？
2. 跨模块交互理解：比如障碍物压线
3. 3D空间理解：比如近距离 cutin
4. 地面静态元素的开集/闭集大模型
5. 数据挖掘需求 -> image editing 需求

## Auto-GT

- 2D

<!-- - 4D -->

谷歌的Waymo在2021年发表的：《Offboard 3D Object Detection from Point Cloud Sequences》
Uber的ATG（Advanced Technology Group）在2021年发表的：《Auto4D: Learning to Label 4D Objects from Sequential Point Clouds》
Open MMLab在2022年发表的：《MPPNet: Multi-Frame Feature Intertwining with Proxy Points for 3D Temporal Object Detection》
关注数据筛选和标注质量！
Once Detected, Never Lost: Surpassing Human Performance in Offline LiDAR based 3D Object Detection (图森)

## Synthetic Data Generation

### 2D Image Editing

- 要素编辑(inpainting):
  - TSR
  - 儿童
  - 人物换装: 外卖员/警察
- 风格迁移: 雪天/雾天/雨天/雨幕/夜间/沙尘暴
- 图像/视频生成

### 3D Image Editing

3DGS

## Simulator

- World Models
- Carla
- NAVSim
- NAVSim v2

### Applications

- 3D Reconstruction
  - NeRF: 从少量2D图像重建出高保真的3D场景
- World Model
  - Wayve, GAIA
  - Waabi, Waabi World

NVIDIA, Omniverse, DRIVE Sim
Waabi, UniSim
Scale AI

自动聚类（Clustering）： 大模型可以自动将挖掘出的“Bad Case”进行聚类。例如，系统自动生成报告：“本周新增500个问题场景，其中30%是‘近距离切出鬼探头’，20%是‘红绿灯识别错误’……” 这让工程师能迅速定位到模型的核心短板。

仿真评测
基于数据生产创建的海量数据，自动构建功能场景均衡分布的logSim、worldSim数据集，支持MIL/SIL/HIL等多种形态的开环回灌与闭环仿真，并基于worldmodel大模型实现E2E闭环仿真，提供丰富的验证与测试手段促进智能驾驶算法研发提效。

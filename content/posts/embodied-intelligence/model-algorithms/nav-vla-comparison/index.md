+++
date = '2026-05-08T13:30:00+08:00'
draft = false
title = '导航 VLA 基础模型对比：ABot-N0 / UrbanVLA / DualVLN / SocialNav'
categories = []
tags = []
featured = false
+++

近期出现了一批面向具身导航的 VLA 基础模型，本文对四篇代表性工作进行横向对比：**ABot-N0**（AMAP CV Lab）、**UrbanVLA**（PKU EPIC）、**DualVLN / InternVLA-N1**（Shanghai AI Lab × HKU）和 **SocialNav**（AMAP EAI，CVPR 2026）。

## 0. 官方信息一览

| 模型 | 单位 | arXiv | GitHub | Project Page |
| --- | --- | --- | --- | --- |
| **ABot-N0** | AMAP CV Lab (Alibaba) | [arXiv 2602.11598](https://arxiv.org/abs/2602.11598) | [amap-cvlab/ABot-Navigation](https://github.com/amap-cvlab/ABot-Navigation) | [ABot-N0 Page](https://amap-cvlab.github.io/ABot-Navigation/ABot-N0/) |
| **UrbanVLA** | PKU EPIC | [arXiv 2510.23576](https://arxiv.org/abs/2510.23576) | — | [UrbanVLA-Web](https://pku-epic.github.io/UrbanVLA-Web/) |
| **DualVLN** | Shanghai AI Lab × HKU | [arXiv 2512.08186](https://arxiv.org/abs/2512.08186) | [InternRobotics/InternNav](https://github.com/InternRobotics/InternNav) | [InternVLA-N1 / DualVLN](https://internrobotics.github.io/internvla-n1-dualvln.github.io) |
| **SocialNav** | AMAP EAI (Alibaba) × ZJU | [arXiv 2511.21135](https://arxiv.org/abs/2511.21135) | [AMAP-EAI/SocialNav](https://github.com/AMAP-EAI/SocialNav) | [SocialNav Page](https://amap-eai.github.io/SocialNav/) |

## 1. 一句话总结对比

| 模型 | 一句话总结 |
| --- | --- |
| **ABot-N0** | 一个统一 5 类导航任务（Point/Object/Instruction/POI/Person-Following）的"大一统" VLA 基础模型，配套 16.9M 轨迹 + 5M 推理样本的最大规模导航数据引擎。 |
| **UrbanVLA** | 一个面向城市 micromobility 的 **route-conditioned** VLA 框架，将高德式 roadbook 路书显式作为 prompt，"SFT + 离线 RL (IQL)" 联合训练。 |
| **DualVLN** | 首个面向 VLN 的 **双系统**基础模型：System-2（VLM，2 Hz）"慢慢 ground" 像素目标，System-1（DiT，30 Hz）"快快 move" 出连续轨迹，异步推理实现实时动态避障。 |
| **SocialNav** | 首个面向**社会规范**的导航基础模型：Brain-Action 架构 + 首个 flow-based RL（**SAFE-GRPO**）显式奖励社会合规行为，社会合规率较 SOTA +46%。 |

## 2. 解决的导航任务

| 模型 | 任务覆盖 |
| --- | --- |
| **ABot-N0** | 同时统一 5 类任务：① **Point-Goal**（米制坐标点导航）② **Object-Goal**（开放词表物体搜索）③ **Instruction-Following**（自然语言长程指令）④ **POI-Goal**（兴趣点入口的"最后几米"）⑤ **Person-Following**（动态人体跟随）|
| **UrbanVLA** | **城市级 outdoor micromobility 导航**，关注：goal-reaching、collision avoidance、social compliance；输入是高德 API 风格的 roadbook（高层路线 + 距离/方向指令）|
| **DualVLN** | ① **VLN-CE**（离散动作 R2R/RxR）② **VLN-PE**（物理仿真，Humanoid H1）③ **Visual Navigation**（point/image/trajectory goal）④ 提出**Social-VLN** 新基准（动态人体避障 + 任务恢复）|
| **SocialNav** | **Socially-Aware Point-Goal Navigation**：在 indoor + outdoor + 公共空间中遵循社会规范（人行道、斑马线，避开车道、草坪、禁入区）的轨迹生成 |

## 3. Model Architecture

| 维度 | **ABot-N0** | **UrbanVLA** | **DualVLN** | **SocialNav** |
| --- | --- | --- | --- | --- |
| **整体范式** | Brain–Action 单系统 | 单系统 route-conditioned VLA | **双系统**（异步） | Brain–Action 单系统 |
| **VLM 主干** | Qwen3-4B | Qwen2（基于 NavFoM 通用导航基座） | Qwen-VL-2.5 7B | Qwen2.5-VL 3B |
| **视觉编码** | 通用多模态 token 编码器（统一 RGB/历史/Goal） | DINOv2 + SigLIP 通道拼接 → grid pooling → 2× MLP | Qwen-VL 自带 ViT；System-1 用 DepthAnythingV2-Small ViT + Q-Former 压缩到 32 token | Qwen2.5-VL 自带 ViT |
| **Brain 输出** | Reasoning Head（语义/CoT）+ Action Head | 文本 token（VideoQA） + action token | **Pixel Goal** + 视角调整动作 + 4 个可学习 **Latent Queries**（prompt tuning） | 三类文本：可通行 polygon / CoT / VQA |
| **Action Expert** | Flow Matching，输出 5 个 waypoint（位置 + heading） | MLP-based action model 解码 waypoint | DiT（12 层，hidden 384，6 heads）+ Flow Matching，输出 **32** dense waypoints | DiT（12 层，hidden 1536，12 heads）+ Conditional Flow Matching，K=5 步去噪 |
| **关键 prompt 设计** | 多任务统一 token | 40m / 20 waypoints + "30m 后右转"风格 block 指令，对齐高德 API | "Farthest Pixel Goal Grounding" + Self-Directed View Adjustment（Turn ±15°, Look Up/Down 15°） | Socially Traversable Region 多边形预测 |
| **推理频率** | 2 Hz VLA + 10 Hz 控制 | 2 Hz | **2 Hz (Sys-2) + 30 Hz (Sys-1) + 200 Hz 控制** 异步 | 单系统推理（K=5 去噪步） |
| **本体** | Unitree Go2 + Jetson Orin NX 16GB | Unitree Go2 + Jetson Orin（Web-ADK + 远程 4090） | 多机器人 + Humanoid Unitree H1 | Unitree Go2 |

## 4. Data Recipe（按数据来源 / 技术路线分层）

下面按"数据**来自哪里**、**怎么生成**"组织成三张大表（Trajectories / Reasoning / 任务覆盖总览）。每张表都按**技术路线分组**（如：互联网视频 → 3D 重建、3DGS 仿真、真机公开数据、视频生成模型合成 …），层级用粗体彩色行标识。表格容器支持**横向滚动**，所有论文中的关键规模数字、数据集来源、Teacher VLM、pipeline 关键步骤均完整保留。

### 4.1 Trajectories Dataset（按数据生产路线分层）

<div style="overflow-x: auto; margin: 1.2em 0; border-radius: 8px; border: 1px solid #e1e4e8; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
<table style="border-collapse: collapse; width: 100%; min-width: 1180px; font-size: 0.9em; background: white; margin: 0;">
<thead>
<tr style="background: linear-gradient(135deg, #4a90e2 0%, #357abd 100%); color: white;">
<th style="padding: 12px 14px; text-align: left; border: none; min-width: 320px; font-weight: 600;">数据来源 / 技术路线</th>
<th style="padding: 12px 14px; text-align: left; border: none; min-width: 200px; font-weight: 600;">ABot-N0</th>
<th style="padding: 12px 14px; text-align: left; border: none; min-width: 180px; font-weight: 600;">UrbanVLA</th>
<th style="padding: 12px 14px; text-align: left; border: none; min-width: 200px; font-weight: 600;">DualVLN</th>
<th style="padding: 12px 14px; text-align: left; border: none; min-width: 200px; font-weight: 600;">SocialNav</th>
</tr>
</thead>
<tbody>

<tr style="background: #eaf3fc;"><td colspan="5" style="padding: 10px 14px; font-weight: 700; color: #2c5aa0; border-top: 2px solid #4a90e2;">A · 互联网第一人称视频 → 3D 重建 / SfM → 伪轨迹</td></tr>
<tr style="border-bottom: 1px solid #eee;">
<td style="padding: 9px 14px; padding-left: 28px;"><b>A.1</b> π³ 稠密 3D 重建 + MoGe 米制对齐 + 沿相机流形采 (s,g) 对</td>
<td style="padding: 9px 14px;"><b>2.0M</b> Point-Goal pseudo-traj（覆盖全球建筑 / 天气长尾）</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px;"><b>2.0M</b> ETP $D_\text{video}$ 层（与 ABot-N0 完全同流水线）</td>
</tr>
<tr style="border-bottom: 1px solid #eee;">
<td style="padding: 9px 14px; padding-left: 28px;"><b>A.2</b> MegaSaM SfM 从 YouTube walking/drone 视频提取相机轨迹</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px;"><b>Sekai-Real</b> web 视频（用作 SFT route 数据）</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
</tr>

<tr style="background: #eaf3fc;"><td colspan="5" style="padding: 10px 14px; font-weight: 700; color: #2c5aa0; border-top: 2px solid #4a90e2;">B · 高保真 3DGS / 3D 场景 + 物理仿真</td></tr>
<tr style="border-bottom: 1px solid #eee;">
<td style="padding: 9px 14px; padding-left: 28px;"><b>B.1</b> 公开室内场景：HM3D + InteriorGS（residential 2,318 户）</td>
<td style="padding: 9px 14px;">含于 <b>1.7M</b> 3D-scene Point-Goal；同时供 Object-Goal / Instruction-Following 复用</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px;">沿用 MP3D 60 scenes + HM3D 700 scenes（StreamVLN recipe）</td>
<td style="padding: 9px 14px;">含于 <b>1.7M</b> $D_\text{sim}$（公开 indoor 场景）</td>
</tr>
<tr style="border-bottom: 1px solid #eee;">
<td style="padding: 9px 14px; padding-left: 28px;"><b>B.2</b> 自建 3DGS 公共场所：Office / Mall / Station（其中 Mall <b>3.02 km²</b>，多层 + 反光玻璃店面）</td>
<td style="padding: 9px 14px;">含于 1.7M Point-Goal；标注 traversable graph，禁止穿入家具/工位</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px;"><b>SocialGS</b>：3,400 真实场景 3DGS 重建 / <b>4.5 km²</b>（突破 MP3D / InteriorGS 仅 residential）</td>
</tr>
<tr style="border-bottom: 1px solid #eee;">
<td style="padding: 9px 14px; padding-left: 28px;"><b>B.3</b> 户外 LiDAR + 摄影测量重建（路口 + 8 个公园）</td>
<td style="padding: 9px 14px;"><b>37 scenes</b>，路网严格禁止入车道</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
</tr>
<tr style="border-bottom: 1px solid #eee;">
<td style="padding: 9px 14px; padding-left: 28px;"><b>B.4</b> 动态虚拟城市 <b>SocCity</b>（Isaac Sim，<b>3.37 km²</b>，模拟车辆 + 行人 + 分层 occupancy）</td>
<td style="padding: 9px 14px;">含于 1.7M Point-Goal，用于学社会合规 + recovery</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px;">含于 <b>1.7M</b> $D_\text{sim}$；亦作为 SAFE-GRPO RL 训练场</td>
</tr>
<tr style="border-bottom: 1px solid #eee;">
<td style="padding: 9px 14px; padding-left: 28px;"><b>B.5</b> 轨迹合成关键技巧：sample (s,g) + path-finding；<b>注入 off-path / near-collision 起点强制学 recovery</b></td>
<td style="padding: 9px 14px;">✅ 同时用于 5 类任务的轨迹底座</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px;">✅ 与 ABot-N0 完全同方法</td>
</tr>

<tr style="background: #eaf3fc;"><td colspan="5" style="padding: 10px 14px; font-weight: 700; color: #2c5aa0; border-top: 2px solid #4a90e2;">C · 经典程序化 / 物理仿真器（Habitat / MetaUrban）</td></tr>
<tr style="border-bottom: 1px solid #eee;">
<td style="padding: 9px 14px; padding-left: 28px;"><b>C.1</b> Habitat + R2R 最短路径（teacher forcing 拆步 + 数据平衡）</td>
<td style="padding: 9px 14px;"><b>200K</b> R2R（600K → 平衡到 200K）</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px;">含于 990K StreamVLN recipe</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
</tr>
<tr style="border-bottom: 1px solid #eee;">
<td style="padding: 9px 14px; padding-left: 28px;"><b>C.2</b> Habitat + RxR 长程 + 高语言密度</td>
<td style="padding: 9px 14px;"><b>1.3M</b> RxR（1.8M → 1.3M）</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px;">含于 990K StreamVLN recipe</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
</tr>
<tr style="border-bottom: 1px solid #eee;">
<td style="padding: 9px 14px; padding-left: 28px;"><b>C.3</b> Habitat + ScaleVLN（700 个 HM3D 场景，扩多样性）</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px;"><b>300K</b>（StreamVLN recipe 中段）</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
</tr>
<tr style="border-bottom: 1px solid #eee;">
<td style="padding: 9px 14px; padding-left: 28px;"><b>C.4</b> Habitat + <b>DAgger</b> 专家纠错</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px;"><b>240K</b>（含于 990K）</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
</tr>
<tr style="border-bottom: 1px solid #eee;">
<td style="padding: 9px 14px; padding-left: 28px;"><b>C.5</b> Habitat + 人体检测触发 A* 重规划（动态避障数据采集 pipeline）</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px;"><b>763K</b> Social-VLN episodes（60 MP3D 场景）</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
</tr>
<tr style="border-bottom: 1px solid #eee;">
<td style="padding: 9px 14px; padding-left: 28px;"><b>C.6</b> Habitat ObjectNav（HM3D 6 类闭集 + OVON 开放词表）</td>
<td style="padding: 9px 14px;">HM3D <b>0.4M</b>（6 类 × 80 scenes）+ OVON <b>1.4M</b>（145 scenes × 35K episodes）+ OVON-sub <b>0.2M</b>（target 首次入 FoV 截断）</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
</tr>
<tr style="border-bottom: 1px solid #eee;">
<td style="padding: 9px 14px; padding-left: 28px;"><b>C.7</b> InteriorGS 自研 visibility-based 轨迹生成 pipeline</td>
<td style="padding: 9px 14px;"><b>1.6M</b>（1,000 scenes / 700+ obj 类）</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
</tr>
<tr style="border-bottom: 1px solid #eee;">
<td style="padding: 9px 14px; padding-left: 28px;"><b>C.8</b> InteriorGS Door-Traversal（门口附近采起始位姿，强制后向多样化）</td>
<td style="padding: 9px 14px;">6K clip → <b>0.3M</b></td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
</tr>
<tr style="border-bottom: 1px solid #eee;">
<td style="padding: 9px 14px; padding-left: 28px;"><b>C.9</b> 数字人语言-引导搜索（200 个 InteriorGS 3DGS avatar + 2,000 个 Habitat mesh avatar，每场景 2~5 个干扰人，属性组合 + LLM 润色描述）</td>
<td style="padding: 9px 14px;">4K clip → <b>0.2M</b></td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
</tr>
<tr style="border-bottom: 1px solid #eee;">
<td style="padding: 9px 14px; padding-left: 28px;"><b>C.10</b> InteriorGS Short-Horizon 原子动作（旋转/平移/复合：turn 60° / move 1m）</td>
<td style="padding: 9px 14px;">12K clip → <b>0.8M</b>（作为正则化稳定训练）</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
</tr>
<tr style="border-bottom: 1px solid #eee;">
<td style="padding: 9px 14px; padding-left: 28px;"><b>C.11</b> MetaUrban 程序化城市仿真器 + PPO expert（ORCA 全局规划）</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px;"><b>≈ 2,400 episodes / 40h</b>（基础 SFT）</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
</tr>

<tr style="background: #eaf3fc;"><td colspan="5" style="padding: 10px 14px; font-weight: 700; color: #2c5aa0; border-top: 2px solid #4a90e2;">D · 真实机器人公开数据集（统一为 Point-Goal 格式）</td></tr>
<tr style="border-bottom: 1px solid #eee;">
<td style="padding: 9px 14px; padding-left: 28px;"><b>D.1</b> SCAND + HuRoN + Recon + CityWalker teleop（保留非完整约束 + 传感器延迟）</td>
<td style="padding: 9px 14px;"><b>340K</b> real-world Point-Goal</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px;"><b>340K</b> $D_\text{real}$（与 ABot-N0 完全同来源）</td>
</tr>

<tr style="background: #eaf3fc;"><td colspan="5" style="padding: 10px 14px; font-weight: 700; color: #2c5aa0; border-top: 2px solid #4a90e2;">E · 自采真机遥操作（in-house teleoperation）</td></tr>
<tr style="border-bottom: 1px solid #eee;">
<td style="padding: 9px 14px; padding-left: 28px;"><b>E.1</b> Unitree Go2 真人遥操作（urban scenes，作为 sim-real aggregated 数据的 real 端）</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px;"><b>≈ 8 小时</b></td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
</tr>

<tr style="background: #eaf3fc;"><td colspan="5" style="padding: 10px 14px; font-weight: 700; color: #2c5aa0; border-top: 2px solid #4a90e2;">F · 视频生成模型合成（Diffusion I2V）</td></tr>
<tr style="border-bottom: 1px solid #eee;">
<td style="padding: 9px 14px; padding-left: 28px;"><b>F.1</b> 单图 → 分割 + 深度 → 局部 occupancy → A\* 路径 → <b>Wan2.1-I2V Diffusion</b> 合成第一人称导航视频（"静态街景 → 主动导航视频"扩增）</td>
<td style="padding: 9px 14px;"><b>2.5M</b> POI-Goal trajectories</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
</tr>

<tr style="background: #eaf3fc;"><td colspan="5" style="padding: 10px 14px; font-weight: 700; color: #2c5aa0; border-top: 2px solid #4a90e2;">G · 类人仿真轨迹（TrackVLA-style humanoid）</td></tr>
<tr style="border-bottom: 1px solid #eee;">
<td style="padding: 9px 14px; padding-left: 28px;"><b>G.1</b> 基于 TrackVLA 开源 humanoid avatar 轨迹 + A\* 计算最优 waypoint；3 距离（2.0/1.5/1.2m）× 3 类（STT 单目标 / DT 干扰 / AT 模糊）× 400K + 400K target-absent</td>
<td style="padding: 9px 14px;"><b>4.0M</b> Person-Following（含跟随距离 / 干扰 / 目标缺失）</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
</tr>

<tr style="background: #eaf3fc;"><td colspan="5" style="padding: 10px 14px; font-weight: 700; color: #2c5aa0; border-top: 2px solid #4a90e2;">H · 数据后处理（轨迹精炼算法）</td></tr>
<tr style="border-bottom: 1px solid #eee;">
<td style="padding: 9px 14px; padding-left: 28px;"><b>H.1</b> <b>HTL（Heuristic Trajectory Lifting）</b>：① Savitzky-Golay 去噪（web 轨迹）/ ORCA 直用 ② 自相交剔除 ③ corner detection 切段 ④ 高斯位置噪声扰动 ⑤ 平滑合并 + 固定步长重采样 → abstracted route（与高德 API 输出对齐）</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px;">✅ 用于把 sim PPO + real teleop + Sekai web 三源融合成 sim-real aggregated dataset</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
</tr>

<tr style="background: #fff8e1; border-top: 2px solid #f5a623;"><td colspan="5" style="padding: 10px 14px; font-weight: 700; color: #b45309;">⏤ Trajectories 数据小计</td></tr>
<tr>
<td style="padding: 9px 14px; padding-left: 28px;"><b>总规模 / 任务数</b></td>
<td style="padding: 9px 14px;"><b>16.9M</b>（5 任务）</td>
<td style="padding: 9px 14px;"><b>40h sim + 8h real + Sekai web</b>（route-conditioned 单任务）</td>
<td style="padding: 9px 14px;"><b>990K</b>（System-2 VLN）+ <b>≤10%</b> 蒸馏（System-1）+ <b>763K</b> Social</td>
<td style="padding: 9px 14px;"><b>≈ 4.04M</b>（ETP 三层）</td>
</tr>

</tbody>
</table>
</div>

### 4.2 Reasoning / VLM Dataset（按数据生产路线分层）

<div style="overflow-x: auto; margin: 1.2em 0; border-radius: 8px; border: 1px solid #e1e4e8; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
<table style="border-collapse: collapse; width: 100%; min-width: 1180px; font-size: 0.9em; background: white; margin: 0;">
<thead>
<tr style="background: linear-gradient(135deg, #50c878 0%, #3ba864 100%); color: white;">
<th style="padding: 12px 14px; text-align: left; border: none; min-width: 320px; font-weight: 600;">数据来源 / 生产方式</th>
<th style="padding: 12px 14px; text-align: left; border: none; min-width: 200px; font-weight: 600;">ABot-N0</th>
<th style="padding: 12px 14px; text-align: left; border: none; min-width: 180px; font-weight: 600;">UrbanVLA</th>
<th style="padding: 12px 14px; text-align: left; border: none; min-width: 200px; font-weight: 600;">DualVLN</th>
<th style="padding: 12px 14px; text-align: left; border: none; min-width: 200px; font-weight: 600;">SocialNav</th>
</tr>
</thead>
<tbody>

<tr style="background: #e8f5e9;"><td colspan="5" style="padding: 10px 14px; font-weight: 700; color: #2e7d32; border-top: 2px solid #50c878;">I · 人工标注（Polygon / 区域）</td></tr>
<tr style="border-bottom: 1px solid #eee;">
<td style="padding: 9px 14px; padding-left: 28px;"><b>I.1</b> 第一人称户外视频帧 → 人工标注 socially traversable polygon（人行道 / 斑马线 / 公园步道）vs 非可通行（车道 / 草坪）</td>
<td style="padding: 9px 14px;"><b>1.2M</b> Navigable Areas Analysis（输出语义标签 + 多边形坐标）</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px;"><b>1.2M</b> Social Traversability Recognition（与 ABot-N0 完全同方法）</td>
</tr>

<tr style="background: #e8f5e9;"><td colspan="5" style="padding: 10px 14px; font-weight: 700; color: #2e7d32; border-top: 2px solid #50c878;">II · VLM Teacher 蒸馏（自动 CoT / 结构化标注）</td></tr>
<tr style="border-bottom: 1px solid #eee;">
<td style="padding: 9px 14px; padding-left: 28px;"><b>II.1</b> Social Navigation CoT — 第一人称图 + prompt → 结构化 rationale（如"红灯需等待"）</td>
<td style="padding: 9px 14px;"><b>0.8M</b>，Teacher = <b>Qwen-VL-Max</b>（沿用 SocialNav pipeline）</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px;"><b>825K</b>，Teacher = <b>Qwen2.5-VL-72B</b></td>
</tr>
<tr style="border-bottom: 1px solid #eee;">
<td style="padding: 9px 14px; padding-left: 28px;"><b>II.2</b> Instruction-Following milestone Visual CoT — 30K R2R/RxR clip → 拆原子子指令 → 标注 milestone node → 生成 Visual CoT（含当前/历史观测 + 已完成/未来指令 + 动作）；<b>NavForesee</b> pipeline</td>
<td style="padding: 9px 14px;"><b>1.3M</b>，Teacher = <b>Gemini-3 Pro + Qwen3-VL</b></td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
</tr>
<tr style="border-bottom: 1px solid #eee;">
<td style="padding: 9px 14px; padding-left: 28px;"><b>II.3</b> Object-Goal 4 段式 CoT（target 可见性 → 空间关系 → 路径规划 → 原子动作）+ 与 GT 轨迹的<b>一致性过滤</b>（丢弃幻觉）</td>
<td style="padding: 9px 14px;"><b>0.1M</b>（OVON），Teacher = MLLM</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
</tr>
<tr style="border-bottom: 1px solid #eee;">
<td style="padding: 9px 14px; padding-left: 28px;"><b>II.4</b> POI Grounding — BridgeNav 街景 → 自动生成 ⟨POI 名称, 入口像素坐标 (u,v)⟩ 元组</td>
<td style="padding: 9px 14px;"><b>0.5M VQA</b>，Teacher = <b>Qwen3-VL-Plus</b></td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
</tr>

<tr style="background: #e8f5e9;"><td colspan="5" style="padding: 10px 14px; font-weight: 700; color: #2e7d32; border-top: 2px solid #50c878;">III · 公开 VLM 语料（保留通用 vision-language 能力）</td></tr>
<tr style="border-bottom: 1px solid #eee;">
<td style="padding: 9px 14px; padding-left: 28px;"><b>III.1</b> General VQA + EQA（常识 + grounding + 室内具身）</td>
<td style="padding: 9px 14px;"><b>1.1M</b>：Blip3 + COCO2014/2017 + MAmmoTH-VL + RefCOCO + Objects365 + R2R-EnvDrop + ScanQA</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px;"><b>1M</b>（多源公开 VQA）</td>
</tr>
<tr style="border-bottom: 1px solid #eee;">
<td style="padding: 9px 14px; padding-left: 28px;"><b>III.2</b> Real-world VideoQA（长视频时-空理解）</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px;"><b>LongVU + Sekai</b></td>
<td style="padding: 9px 14px;"><b>248K</b> = LLaVA-Video-178K + ScanQA</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
</tr>
<tr style="border-bottom: 1px solid #eee;">
<td style="padding: 9px 14px; padding-left: 28px;"><b>III.3</b> Interleaved Image-Text（多轮 VL 交互）</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
<td style="padding: 9px 14px;"><b>230K</b> MMC4</td>
<td style="padding: 9px 14px; color: #aaa;">—</td>
</tr>

<tr style="background: #fff8e1; border-top: 2px solid #f5a623;"><td colspan="5" style="padding: 10px 14px; font-weight: 700; color: #b45309;">⏤ Reasoning 数据小计</td></tr>
<tr>
<td style="padding: 9px 14px; padding-left: 28px;"><b>总规模</b></td>
<td style="padding: 9px 14px;"><b>5.0M</b>（6 子类）</td>
<td style="padding: 9px 14px;">LongVU + Sekai（VideoQA）</td>
<td style="padding: 9px 14px;"><b>478K</b>（VideoQA + Interleaved）</td>
<td style="padding: 9px 14px;"><b>≈ 3.0M</b>（CAD 三大类）</td>
</tr>

</tbody>
</table>
</div>

### 4.3 数据 → 任务覆盖总览（"哪些数据用在哪些任务"）

<div style="overflow-x: auto; margin: 1.2em 0; border-radius: 8px; border: 1px solid #e1e4e8; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
<table style="border-collapse: collapse; width: 100%; min-width: 900px; font-size: 0.9em; background: white; margin: 0;">
<thead>
<tr style="background: linear-gradient(135deg, #9b59b6 0%, #7d3c98 100%); color: white;">
<th style="padding: 12px 14px; text-align: left; border: none; min-width: 220px; font-weight: 600;">导航任务</th>
<th style="padding: 12px 14px; text-align: center; border: none; font-weight: 600;">ABot-N0</th>
<th style="padding: 12px 14px; text-align: center; border: none; font-weight: 600;">UrbanVLA</th>
<th style="padding: 12px 14px; text-align: center; border: none; font-weight: 600;">DualVLN</th>
<th style="padding: 12px 14px; text-align: center; border: none; font-weight: 600;">SocialNav</th>
</tr>
</thead>
<tbody>
<tr style="border-bottom: 1px solid #eee;"><td style="padding: 9px 14px;"><b>Point-Goal / Route-Goal</b></td><td style="padding: 9px 14px; text-align: center;">✅ 4.0M（A.1 + B + D）</td><td style="padding: 9px 14px; text-align: center;">✅ 40h sim + 8h real + Sekai（A.2 + C.11 + E + H.1）</td><td style="padding: 9px 14px; text-align: center; color: #aaa;">—</td><td style="padding: 9px 14px; text-align: center;">✅ 4.04M（A.1 + B + D）</td></tr>
<tr style="border-bottom: 1px solid #eee;"><td style="padding: 9px 14px;"><b>Instruction-Following（VLN）</b></td><td style="padding: 9px 14px; text-align: center;">✅ ≈2.8M（C.1+C.2+C.7~C.10）</td><td style="padding: 9px 14px; text-align: center; color: #aaa;">—</td><td style="padding: 9px 14px; text-align: center;">✅ 990K（C.1+C.2+C.3+C.4）</td><td style="padding: 9px 14px; text-align: center; color: #aaa;">—</td></tr>
<tr style="border-bottom: 1px solid #eee;"><td style="padding: 9px 14px;"><b>Object-Goal</b></td><td style="padding: 9px 14px; text-align: center;">✅ ≈3.6M（C.6 + C.7）</td><td style="padding: 9px 14px; text-align: center; color: #aaa;">—</td><td style="padding: 9px 14px; text-align: center; color: #aaa;">—</td><td style="padding: 9px 14px; text-align: center; color: #aaa;">—</td></tr>
<tr style="border-bottom: 1px solid #eee;"><td style="padding: 9px 14px;"><b>POI-Goal</b></td><td style="padding: 9px 14px; text-align: center;">✅ 2.5M（F.1）</td><td style="padding: 9px 14px; text-align: center; color: #aaa;">—</td><td style="padding: 9px 14px; text-align: center; color: #aaa;">—</td><td style="padding: 9px 14px; text-align: center; color: #aaa;">—</td></tr>
<tr style="border-bottom: 1px solid #eee;"><td style="padding: 9px 14px;"><b>Person-Following</b></td><td style="padding: 9px 14px; text-align: center;">✅ 4.0M（G.1）</td><td style="padding: 9px 14px; text-align: center; color: #aaa;">—</td><td style="padding: 9px 14px; text-align: center; color: #aaa;">—</td><td style="padding: 9px 14px; text-align: center; color: #aaa;">—</td></tr>
<tr style="border-bottom: 1px solid #eee;"><td style="padding: 9px 14px;"><b>Social-VLN / 动态避障</b></td><td style="padding: 9px 14px; text-align: center; color: #aaa;">—</td><td style="padding: 9px 14px; text-align: center; color: #aaa;">—</td><td style="padding: 9px 14px; text-align: center;">✅ 763K（C.5）</td><td style="padding: 9px 14px; text-align: center; color: #aaa;">—</td></tr>
<tr style="border-bottom: 1px solid #eee;"><td style="padding: 9px 14px;"><b>Socially-Aware Navigation（合规推理）</b></td><td style="padding: 9px 14px; text-align: center;">✅（I.1 + II.1）</td><td style="padding: 9px 14px; text-align: center; color: #aaa;">—</td><td style="padding: 9px 14px; text-align: center; color: #aaa;">—</td><td style="padding: 9px 14px; text-align: center;">✅（I.1 + II.1）</td></tr>
</tbody>
</table>
</div>

### 4.4 几条横向观察

- **Point-Goal pipeline 是公认底座**：ABot-N0 / UrbanVLA / SocialNav 三家都把"点目标 / 路线条件下到达坐标"作为最底层数据范式；其中 **ABot-N0 与 SocialNav 完全共用同一条互联网视频 pseudo-traj pipeline（A.1：π³ + MoGe）+ 同一批真机公开数据（D.1：SCAND / HuRoN / Recon / CityWalker）+ 同一虚拟城市（B.4：SocCity）**——这与两者同属 AMAP 体系一致，ABot-N0 论文中也明确写到 "More details of this pipeline is reported in our SocialNav"。
- **数据生产路线的时代分层**：互联网视频 → 3D 重建 / SfM（A）= 突破 trajectory 数据规模上限；3DGS（B.2 SocialGS）= 突破场景多样性上限（不止 residential）；Diffusion I2V（F.1）= 突破"静态街景如何变成主动导航视频"的数据上限。三者代表了 2026 年具身导航数据生成的三个新方向。
- **数据规模 vs 算法**：UrbanVLA 不堆数据，靠 **HTL（H.1）** 把仿真 PPO + Sekai web + 8h 真实 teleop 三源融合，加上 IQL 离线 RL 替代纯堆数据，是"少数据 + 巧训练"的极简路线代表。
- **DualVLN 的解耦数据哲学**：System-2 沿用 StreamVLN 大数据 recipe（C.1~C.4，990K），System-1 仅靠从 System-2 蒸馏的 ≤ **10% 数据即近饱和**——双系统天然解耦数据需求。
- **Reasoning 数据的"三件套"**：人工 polygon（I.1）+ Social Nav CoT（II.1）+ General VQA（III.1）在 ABot-N0 / SocialNav 中是同一套（ABot-N0 在此基础上加了 II.2 / II.3 / II.4 三类任务特化推理数据）。
- **Teacher VLM 的代际差**：SocialNav 用 Qwen2.5-VL-72B 蒸馏 → ABot-N0 升级到 **Qwen-VL-Max + Gemini-3 Pro + Qwen3-VL/Plus** 多 teacher 配合，反映了 2026 年这一年间 frontier VLM 的快速迭代。

## 5. Training Recipe

| 模型 | 训练流程 |
| --- | --- |
| **ABot-N0** | 多阶段联合训练（Pre-training + SFT），同时优化 Reasoning Head 与 Action Head；多任务统一损失。在 7 个 benchmark 上达到 SOTA。 |
| **UrbanVLA** | **两阶段**：① **SFT** 学习目标到达 / 避障 / 社会合规（MetaUrban + Sekai 轨迹 + VideoQA 协同训练）→ ② **Offline RL（IQL，Implicit Q-Learning）** 在 sim-real 混合数据上做 RFT，专门强化避障 & 处理模糊指令；8× H100 ≈ 12h。 |
| **DualVLN** | **解耦顺序训练**：① System-2 全参 SFT（Qwen-VL-2.5 1 epoch，vision encoder + LLM 全部 unfrozen）→ ② **冻结 System-2**，仅 prompt-tune 4 个 latent queries → ③ 训练 System-1 DiT（Flow Matching loss，输入 latent goal + 当前/历史 RGB）。System-1 数据扩到 10% 即近饱和。 |
| **SocialNav** | **三阶段**：① **Pre-training**（$D_\text{video} + D_\text{sim} + D_\text{cog}$，端到端，96× H20，3 epoch，bs=192，lr=5e-5）→ ② **Fine-tuning**（$D_\text{real}$，**冻结 VLM**，仅训 action expert，32× H20，bs=256，lr=1e-5）→ ③ **SAFE-GRPO**（首个 flow-based RL；ODE → SDE 注入探索噪声；reward = $R_\text{social} + \lambda R_\text{expert} + \lambda R_\text{smooth} + \lambda R_\text{eff}$；16× H20，rollout bs=128，lr=5e-7）。 |

## 6. 一些观察

- **结构演进路线**：从 UrbanVLA 的「单系统 + route prompt」→ ABot-N0 / SocialNav 的「Brain-Action 单体多输出」→ DualVLN 的「真异步双系统」，控制频率从 2 Hz 提升到 30 Hz，对动态场景越来越友好。
- **数据流水线趋同**：四个工作里有三个（ABot-N0 / SocialNav / UrbanVLA）都用了**互联网视频 → 3D 重建（π³ / SfM）→ 米制对齐（MoGe / MegaSaM）→ pseudo-trajectory** 的范式来突破 trajectory 数据规模上限。
- **RL 的位置**：UrbanVLA 用 **离线 IQL** 修补避障/模糊指令；SocialNav 提出 **SAFE-GRPO（flow-based on-policy RL）** 显式对齐社会规范；ABot-N0 / DualVLN 的公开版本主要还是 SFT。
- **任务统一 vs 任务专精**：ABot-N0 走"一个模型五种任务"的统一路线；UrbanVLA / SocialNav 各自专精 outdoor 城市 / 社会合规；DualVLN 通过双系统解耦反而把 VLN-CE / VLN-PE / Social-VLN 都吃下来了。
- **本体几乎一致**：四篇全部以 **Unitree Go2** 为主要部署平台（DualVLN 还覆盖了 Humanoid H1），可见四足在 outdoor / 社会化场景已是事实标准。

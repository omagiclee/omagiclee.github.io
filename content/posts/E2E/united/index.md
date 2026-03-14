+++
date = '2026-03-14T17:45:02+08:00'
draft = false
title = 'UniTeD: Unified Temporal Diffusion for Joint Perception and Planning in Autonomous Driving'
categories = ['E2E']
tags = ['Diffusion-based Planner', 'Unified Perception and Planning']
featured = true
+++

:(fas fa-award fa-fw):<span style="color:gray">ECCV 2026 Submission</span>

## TL;DR

<span style="color:red;">首个将扩散模型同时应用于感知和规划的统一生成式端到端自动驾驶框架。</span>现有 diffusion-based E2E 方法仅将扩散过程限定在规划模块，感知输出作为固定条件传入，导致感知误差单向传播、缺乏跨任务联合优化。UniTeD 提出在共享生成空间中对感知（agent、map）和规划 query 进行联合去噪，实现双向信息交换与互相 refinement。进一步引入 **Temporal Transition Module (TTM)** 解决历史帧与当前帧之间的噪声水平不匹配问题，以及 **Anchor Refresh Strategy (ARS)** 缓解稀疏 diffusion 框架中训练-推理分布偏移。在 NAVSIM v1（90.2 PDMS）、NAVSIM v2（90.1 EPDMS）和 Bench2Drive（87.3 DS）上均达到 SOTA。

## Motivations & Innovations

### 现有范式的四象限分析

论文对 E2E 自动驾驶的现有方法进行了清晰的 2×2 分类：

| | Separate | Unified |
|---|---|---|
| **Discriminative** | UniAD, VAD, SparseDrive | DriveTransformer, HiP-AD |
| **Generative** | DiffusionDrive, DiffRefiner, ResAD | **UniTeD (Ours)** |

**核心问题：**

1. **Separate-Generative 的局限**：现有 diffusion-based 方法（DiffusionDrive、ResAD、DiffRefiner）将扩散过程限制在规划任务，把判别式感知的输出作为固定条件。这种解耦设计导致**感知误差单向传播**至生成过程，增加优化难度、降低鲁棒性，同时阻止了感知与规划之间的联合优化。

2. **忽略时序动态**：现有 diffusion planner 仅使用单帧信息进行生成，忽略了时序上下文。

3. **训练-推理分布偏移**：稀疏 query-based diffusion planning（如 DiffusionDrive、DiffRefiner）在训练时仅对匹配 GT 的少量 planning query 施加监督，其余 query 几乎无梯度信号。推理时所有 query 都参与迭代更新（包括训练中未被充分优化的 query），导致 query 分布逐步偏离 anchor 分布，与扩散模型**迭代精炼**的核心原则相矛盾。

### 创新点

1. **统一扩散框架（Unified-Generative）**：首次将感知与规划 query 放入同一个生成空间进行联合去噪——agent、map、planning query 在每个 decoder layer 中通过 unified self-attention 进行 all-to-all 交互，实现双向信息交换。噪声条件下的多任务训练天然提升了对不完美中间结果的鲁棒性。

2. **Temporal Transition Module (TTM)**：将统一扩散范式扩展到流式（streaming）设定。通过 memory bank 存储历史 task query，TTM 利用 scale & shift 机制将不同噪声水平的历史 query 对齐到当前帧的噪声流形，解决跨帧噪声不匹配。

3. **Anchor Refresh Strategy (ARS)**：推理时根据置信度阈值 $\tau$ 对 query 进行选择性更新——高置信度 query 通过 DDIM reverse 正常去噪，低置信度 query 被刷新为从原始 anchor 分布重采样的噪声 query。兼顾 query 多样性与训练分布对齐。

## Approach

### 整体架构

UniTeD 的完整 pipeline 如下：

1. **Image Backbone**：ResNet-34 提取多视角多尺度特征 $\mathbf{F} = \lbrace F_v \rbrace_{v=1}^{V}$。
2. **Anchor Sampling**：定义联合 anchor 集合 $\mathbf{A} = \lbrace A_a \in \mathbb{R}^{N_a \times D_a}, A_m \in \mathbb{R}^{N_m \times D_m}, A_p \in \mathbb{R}^{N_p \times D_p} \rbrace$，分别对应 agent（900）、map（100）、planning（24）任务。遵循 truncated diffusion，从以 anchor 为中心的高斯分布中采样噪声 anchor $A_{t_k}$。
3. **Anchor Embedding**：将噪声 anchor 投射到共享隐空间，得到 $\mathbf{Q}_k = \lbrace Q_a, Q_m, Q_p \rbrace \in \mathbb{R}^{(N_a+N_m+N_p) \times C}$。
4. **Unified Diffusion Decoder**：$N$ 次迭代去噪，每次经过 $L=6$ 层 stacked block。
5. **Task-Specific Heads**：去噪后的 refined query 经过各任务 head 输出最终预测。

### Unified Diffusion Decoder

每个 decoder block 包含四个核心层：

**1. Conditional Modulation（条件调制）**
- 采用 DiT 的 Adaptive Layer Normalization (AdaLN) 设计
- 将当前 timestep $t_k$ 编码为条件 $C_k$，通过 MLP 生成调制参数 $\lbrace \alpha, \beta, \gamma \rbrace$
- 每个交互层均受 timestep 条件控制，确保去噪过程感知当前生成阶段

**2. Temporal Cross-Attention（时序交叉注意力）**
- 以 TTM 对齐后的历史上下文 $\lbrace \tilde{Q}_{k-i} \rbrace_{i=1}^{n}$ 为 KV
- 当前帧 query $Q_k$ 通过 cross-attention 聚合历史信息
- 实现跨帧时序推理，继承运动和结构先验

**3. Unified Self-Attention（统一自注意力）**
- **核心设计**：将 $Q_k = \lbrace Q_a, Q_m, Q_p \rbrace$ 拼接后做 all-to-all self-attention
- 每个 token 可以 attend 到所有其他 token，无论其任务来源
- 实现跨任务几何推理：ego planning $Q_p$ 和 agent intentions $Q_a$ 对 map reconstruction $Q_m$ 施加空间约束；map topology 反过来正则化多模态轨迹生成
- 单次联合注意力即可促进全局一致的场景合成

**4. Spatial Deformable Attention（空间可变形注意力）**
- 每个 query 关联一个 3D anchor，通过视角变换 $P_v$ 投影到各相机图像平面
- 使用 Multi-Scale Deformable Attention 高效采样并聚合多视角、多尺度图像特征

### 统一扩散过程

**前向扩散**：对所有任务同步施加相同水平的噪声：
$$q(a_{t_k} | a) = \mathcal{N}(a_{t_k}; \sqrt{\bar{\alpha}_{t_k}} a, (1-\bar{\alpha}_{t_k})\mathbf{I}), \quad t_k \in [1, T_{\text{trunc}}]$$

同步噪声注入确保所有任务类别嵌入共享的不确定性尺度，促进跨任务一致的表征学习。

**逆向去噪**：采用 DDIM 采样策略，迭代精炼所有任务状态。Decoder 在每个去噪步接收当前步噪声 anchor $A_{t_k}$、多视角视觉特征 $\mathbf{F}$、以及经 TTM 调制的历史上下文。

### Temporal Transition Module (TTM)

TTM 是实现流式统一扩散框架的关键。核心问题在于：历史帧 query $\lbrace Q_{k-i} \rbrace$ 和当前帧 query $Q_k$ 的去噪 timestep 是随机独立采样的，直接融合存在噪声水平不匹配。

**输入**（第 $k$ 帧，噪声水平 $t_k$）：
- 当前 query $Q_k$
- 当前条件嵌入 $C_k = \text{MLP}(\text{TE}(t_k))$
- 历史 query $\lbrace Q_{k-i} \rbrace_{i=1}^n$（来自 memory bank）
- 历史条件 $C_{k-i} = \text{MLP}[\text{TE}(t_{k-i}), \text{TE}(\Delta t_i), \text{TE}(\Delta k_i)]$，其中 $\Delta t_i = t_k - t_{k-i}$ 为噪声尺度差，$\Delta k_i$ 为帧间隔

**TTM 对齐机制**：通过 scale & shift 变换将历史 query 重新投射到当前噪声流形：
$$\gamma_{k-i}, \beta_{k-i} = \text{MLP}(C_{k-i})$$
$$\tilde{Q}_{k-i} = (1 + \gamma_{k-i}) \odot \text{LayerNorm}(Q_{k-i}) + \beta_{k-i}$$

### Anchor Refresh Strategy (ARS)

**问题**：稀疏 query-based diffusion 在训练时仅监督匹配 GT 的子集 query，推理时却对所有 query 迭代更新。未被充分优化的 query 被反馈进后续迭代，导致 query 分布逐步漂移。

**解决方案**（Algorithm 1）：在第 $j$ 次迭代中：
- **Selective Denoising**：置信度 $s_t^{(i)} > \tau$ 的 query 正常执行 DDIM reverse step
- **Anchor Refresh**：置信度 $s_t^{(i)} \le \tau$ 的 query 丢弃当前输出，重新从原始 anchor $a^{(i)}$ 采样到目标噪声水平 $t-m$：
$$a_{t-m}^{(i)} \sim \mathcal{N}(\sqrt{\bar{\alpha}_{t-m}} a^{(i)}, (1-\bar{\alpha}_{t-m})\mathbf{I})$$

任务特定阈值：detection $\tau=0.30$，mapping $\tau=0.45$，motion & planning $\tau=0.30$。

### Loss Function

多任务端到端优化：
$$\mathcal{L}_{\text{total}} = \lambda_{\text{det}}\mathcal{L}_{\text{det}} + \lambda_{\text{mot}}\mathcal{L}_{\text{mot}} + \lambda_{\text{map}}\mathcal{L}_{\text{map}} + \lambda_{\text{plan}}\mathcal{L}_{\text{plan}}$$

- **Detection**：Focal Loss (cls) + SparseBox3DLoss (reg, 含 $\ell_1$ + CE centerness + Gaussian focal yaw)
- **Mapping**：Focal Loss (cls) + $\ell_1$ (polyline points, weight=10.0)
- **Motion**：Focal Loss (cls, w=0.2) + $\ell_1$ (trajectory waypoints, w=0.2)
- **Planning**：Focal Loss (cls, w=0.5) + $\ell_1$ (waypoints, w=1.0)

### Training & Inference Details

| 配置 | 详情 |
|---|---|
| Backbone | ResNet-34 |
| 输入分辨率 | 640 × 352 |
| 相机数量 | NAVSIM: 8, Bench2Drive: 6 |
| Decoder 层数 | 6 层级联 diffusion decoder |
| Anchor 数量 | 1024 (900 agent + 100 map + 24 planning) |
| 训练扩散步数 | 截断至 50/1000 步 |
| 推理扩散步数 | 2 步 DDIM（step size $m=10$，从 $t=8$ 开始） |
| 训练 GPU | 8 × NVIDIA L40 |
| Batch Size | 64 |
| Optimizer | AdamW, lr = 4×10⁻⁴ |
| Epochs | 100 |

## Experiments

### NAVSIM v1

仅使用 Camera 输入（无 LiDAR），UniTeD 达到 **90.2 PDMS**，超越所有方法：

| Method | Paradigm | Modality | NC↑ | DAC↑ | EP↑ | TTC↑ | COMF↑ | PDMS↑ |
|---|---|---|---|---|---|---|---|---|
| UniAD | Dis-Sep | C | 97.8 | 91.9 | 78.8 | 92.9 | 100.0 | 83.4 |
| Hydra-MDP++ | Dis-Sep | C | 97.6 | 96.0 | 80.4 | 93.1 | 100.0 | 86.6 |
| WoTE | Dis-Sep | C | 98.5 | 96.8 | 81.9 | 94.9 | 99.9 | 88.3 |
| DiffusionDrive | Gen-Sep | C+L | 98.2 | 96.2 | 82.2 | 94.7 | 100.0 | 88.1 |
| DiffRefiner | Gen-Sep | C | 98.4 | 97.4 | 83.4 | 95.3 | 100.0 | 89.4 |
| HiP-AD | Dis-Uni | C | 98.9 | 96.7 | 81.2 | 96.3 | 99.9 | 88.6 |
| **UniTeD** | **Gen-Uni** | **C** | **98.9** | **97.2** | **84.1** | **96.6** | **100.0** | **90.2** |

关键对比：
- vs. DiffRefiner（Gen-Sep）: **+0.8 PDMS** → 统一生成 > 分离生成
- vs. HiP-AD（Dis-Uni）: **+1.6 PDMS** → 生成式 > 判别式（统一框架下）
- 仅用 Camera 即超越所有 C+L 方法

### NAVSIM v2

在更具挑战性的 NAVSIM v2 上，UniTeD 达到 **90.1 EPDMS**，比 DiffRefiner **+3.9**。

### Bench2Drive（闭环评测）

| Method | Training Data | DS↑ | SR(%)↑ |
|---|---|---|---|
| DriveTransformer | B2D (200K) | 63.5 | 35.0 |
| HiP-AD | B2D (200K) | 86.8 | 69.1 |
| DiffRefiner | TF++ (500K) | 87.1 | 71.4 |
| **UniTeD** | **B2D (200K)** | **87.3** | 70.0 |

UniTeD 仅用 200K 数据即超越使用 500K 数据的 DiffRefiner（+0.2 DS）。

### nuScenes 感知能力

| Method | Det mAP↑ | NDS↑ | Map mAP↑ | AMOTA↑ | minADE↓ |
|---|---|---|---|---|---|
| HiP-AD | 0.424 | 0.535 | 0.571 | 0.406 | 0.61 |
| **UniTeD** | **0.424** | **0.537** | **0.596** | **0.419** | **0.58** |

统一扩散不仅提升规划，也显著增强了感知能力（Map mAP +2.5%, AMOTA +1.3%）。

### Ablation Study

**统一扩散范式的有效性**（NAVSIM v1 PDMS）：

| Paradigm | Perc | Plan | PDMS |
|---|---|---|---|
| Sep | Regr | Regr | 84.1 |
| Sep | Regr | Diff | 86.7 |
| Uni | Regr | Regr | 88.5 |
| Uni | Regr | Diff | 89.5 |
| **Uni** | **Diff** | **Diff** | **90.2** |

- Sep → Uni（在 Diff planning 下）: **+2.8** → 统一范式消除信息瓶颈
- Regr → Diff（Planning）: **+2.6**（Sep）/ **+1.0**（Uni）→ 扩散建模更好捕获多模态驾驶行为
- Perc 也用 Diff（Uni-Diff-Diff vs Uni-Regr-Diff）: **+0.7** → 扩散式感知提供更鲁棒的特征表征

**TTM 的有效性**：
- 无 Memory Queue: 88.2 → 加 Memory: 88.5 (+0.3)
- Diffusion + Memory 无 TTM: 89.4 → 加 TTM: **90.2 (+0.8)** → 噪声水平对齐至关重要

**ARS 的有效性**：
- 无 ARS: 88.2 → 有 ARS: **90.2 (+2.0)** → ARS 是稀疏 diffusion 架构中不可或缺的组件

### 与 VLM/RL 方法对比

UniTeD 仅用 6 层 decoder 即达到 90.2 PDMS，在无需 VLM 的 billion-level 参数或 RL 额外监督的条件下，超越多个 VLM-SFT 方法（如 SGDrive 87.4）和 RL 方法（如 DriveDPO 90.0），与 RFT 方法（如 FLARE 91.4、DiffusionDriveV2 91.2）接近。框架具有良好的可扩展性，未来可与 RL 或更大模型结合以进一步提升。

## Key Insights

1. **统一生成式范式的优越性**：将感知和规划放入同一个生成空间进行联合去噪，不仅消除了感知误差的单向传播，更通过噪声条件下的多任务训练天然增强了鲁棒性——每个任务都被训练为在其他任务输出含噪或不完美时仍能给出准确预测。

2. **跨任务互相增强**：通过 unified self-attention 的 all-to-all 交互，map topology 可以正则化轨迹生成，agent motion 可以辅助遮挡区域的 map 重建，ego planning 的空间约束可以提升感知精度——这种协同效应是 separate 范式无法实现的。

3. **时序建模在扩散框架中的必要性**：TTM 通过 scale & shift 机制解决了 diffusion-based streaming 框架中一个被忽视但至关重要的问题——不同帧的噪声水平不一致。这一简洁设计带来了显著的性能提升。

4. **ARS 揭示的深层问题**：稀疏 query-based diffusion 的训练-推理不一致本质上违背了扩散模型的迭代精炼原则。ARS 通过置信度引导的选择性刷新，在保持 query 多样性的同时确保分布对齐，是一个值得在更多 diffusion-based detection/planning 框架中推广的设计。

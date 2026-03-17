+++
date = '2026-03-16T17:05:46+08:00'
draft = false
title = '归一化：BatchNorm、LayerNorm 与 RMSNorm'
categories = ['Basics']
tags = ['归一化', 'BatchNorm', 'LayerNorm', 'RMSNorm', 'Transformer', '量化']
featured = false
math = true
+++

## 为什么需要归一化

深层网络中，每一层的输出尺度会随着层数的增加变得不可控——有些层输出极大，有些极小。这直接导致梯度不稳定，学习率难以调整，训练容易发散。

归一化的本质作用是**把中间表示拉回一个可控的尺度附近**，从而：

- 让 loss landscape 更平滑，梯度更稳定
- 允许使用更大的学习率，加速收敛
- 降低对参数初始化的敏感度

BatchNorm 论文最初将此解释为"缓解 internal covariate shift"，但后续研究表明，归一化真正的价值更多在于**改善优化条件**，而不仅仅是修正分布漂移。

## BatchNorm

### 算法

设输入为 $x$，对某个特征维（或通道），BatchNorm 分四步：

1. **计算 batch 均值**

$$
\mu = \frac{1}{|\mathcal{B}|}\sum_{i \in \mathcal{B}} x_i
$$

2. **计算 batch 方差**

$$
\sigma^2 = \frac{1}{|\mathcal{B}|}\sum_{i \in \mathcal{B}} (x_i - \mu)^2
$$

3. **标准化**

$$
\hat{x}_i = \frac{x_i - \mu}{\sqrt{\sigma^2 + \epsilon}}
$$

4. **仿射变换**

$$
y_i = \gamma\, \hat{x}_i + \beta
$$

其中 $\gamma, \beta$ 是可学习参数，$\epsilon$ 防止除零。

统计维度取决于输入形状：

- **全连接层** $x \in \mathbb{R}^{B \times D}$：对每个特征维 $d$，在 batch 维 $B$ 上统计
- **卷积层** $x \in \mathbb{R}^{B \times C \times H \times W}$：对每个通道 $c$，在 $(B, H, W)$ 上统计

每个特征维（或通道）有独立的一组 $\gamma, \beta$。

### 训练与推理的行为差异

**训练时**，每个 mini-batch 临时计算自己的 $\mu, \sigma^2$ 来做归一化。同时，通过指数滑动平均（EMA）维护全局统计量：

$$
\hat{\mu} \leftarrow m \cdot \hat{\mu} + (1 - m) \cdot \mu_{\text{batch}}
$$

$$
\hat{\sigma}^2 \leftarrow m \cdot \hat{\sigma}^2 + (1 - m) \cdot \sigma^2_{\text{batch}}
$$

其中 $m$ 是 momentum（PyTorch 默认 $0.1$）。

**推理时**，不再使用当前输入的统计量，而是使用训练期间累积的 $\hat{\mu}, \hat{\sigma}^2$。原因很直接：推理时 batch 可能只有 1 个样本，或者不希望同一个样本的输出受同 batch 其他样本影响。

因此 **BatchNorm 训练和推理的归一化来源不同**，切换模式（`model.train()` / `model.eval()`）是必须的。

### 推理时的算子融合

推理时 $\hat{\mu}, \hat{\sigma}^2, \gamma, \beta$ 全部固定。设前一层线性变换输出为 $z = Wx + b$，经过 BN 后：

$$
y = \gamma \frac{z - \hat{\mu}}{\sqrt{\hat{\sigma}^2 + \epsilon}} + \beta
$$

可以整理为新的线性变换参数：

$$
W' = \frac{\gamma}{\sqrt{\hat{\sigma}^2 + \epsilon}} W, \qquad b' = \frac{\gamma}{\sqrt{\hat{\sigma}^2 + \epsilon}}(b - \hat{\mu}) + \beta
$$

这样推理时可以直接去掉 BN 层，零额外开销。这也是 BN 在 CNN 部署和量化中非常友好的原因。

## LayerNorm

### 算法

设输入为 $x \in \mathbb{R}^{B \times D}$（或 Transformer 中 $x \in \mathbb{R}^{B \times T \times D}$），LayerNorm **对每个样本（每个 token）独立**地在最后一维 $D$ 上归一化：

对每个样本（或 token）$(b, t)$：

1. **均值**

$$
\mu_{b,t} = \frac{1}{D}\sum_{d=1}^{D} x_{b,t,d}
$$

2. **方差**

$$
\sigma^2_{b,t} = \frac{1}{D}\sum_{d=1}^{D} (x_{b,t,d} - \mu_{b,t})^2
$$

3. **标准化**

$$
\hat{x}_{b,t,d} = \frac{x_{b,t,d} - \mu_{b,t}}{\sqrt{\sigma^2_{b,t} + \epsilon}}
$$

4. **仿射变换**

$$
y_{b,t,d} = \gamma_d\, \hat{x}_{b,t,d} + \beta_d
$$

$\gamma, \beta$ 在特征维 $D$ 上共享（所有样本和 token 用同一组参数），但**统计量 $\mu, \sigma^2$ 是每个样本/token 自己算的**。

### 关键性质

- **训练和推理完全同构**：无论何时都用当前输入自己的统计量，没有 running statistics
- **不依赖 batch size**：哪怕 batch=1 也完全正常
- **不能像 BN 一样做算子融合**：因为 $\mu, \sigma^2$ 随输入动态变化，无法提前吸收

## BatchNorm vs LayerNorm

两者的数学形式完全相同（减均值、除标准差、仿射变换），**唯一的区别是统计维度**：

| | 统计维度 | 依赖 batch | 推理行为 |
|---|---|---|---|
| **BatchNorm** | 跨样本（batch 维） | 是 | 用 running statistics |
| **LayerNorm** | 单样本内部（特征维） | 否 | 用当前输入自身统计量 |

直觉上：

- **BatchNorm**："这一批样本在同一个特征上对齐"
- **LayerNorm**："每个样本把自己的特征向量做标准化"

## 为什么 Transformer 用 LayerNorm 而非 BatchNorm

**1）Batch 依赖不适合序列建模**

BatchNorm 让每个样本的归一化结果依赖同 batch 其他样本。在 Transformer 中，不同样本的序列长度、语义内容差异很大，这种跨样本耦合是不自然的。LayerNorm 对每个 token 独立归一化，符合 Transformer 逐 token 处理的范式。

**2）小 batch / 变 batch 不稳定**

大模型训练、微调、在线推理中，batch size 经常很小或不固定。BatchNorm 在这些场景下统计量噪声很大，效果显著下降。LayerNorm 与 batch size 无关。

**3）训练/推理一致性**

BatchNorm 训练用 batch 统计量、推理用 running statistics，两者来源不同。LayerNorm 始终使用当前输入的统计量，机制完全一致。

**4）自回归生成**

自回归生成时逐 token 推理，batch 概念不存在。LayerNorm 天然适用，BatchNorm 无法正常工作。

## BatchNorm 能替代 LayerNorm 吗

一般不能直接替代。原因不在于"数学上写不出来"，而在于：

- 归一化维度不同，整个网络的统计假设随之改变
- 引入了样本间耦合，破坏 Transformer 的逐 token 独立性
- 小 batch 下统计量不可靠
- 推理时需要 running statistics，在自回归场景下不自然

反过来也一样：在 CNN 中，BatchNorm 利用了 batch 统计的正则化效果和通道间的语义一致性，换成 LayerNorm 通常也不是最优选择。**不同的归一化方法对应不同的架构假设**。

## LayerNorm 的量化问题

### 为什么 LN 比 BN 更难量化

BN 推理时，$\hat{\mu}, \hat{\sigma}^2, \gamma, \beta$ 全部是固定常数，可以融合进前一层线性变换，最终变成简单的整数乘加——对量化极其友好。

LN 推理时，**每个 token 都要实时计算 $\mu$ 和 $\sigma^2$**，涉及一整条归约-减法-平方-累加-开方-除法的动态计算链。在低精度整数（如 INT8）下，这条链上每一步都容易出问题：

| 环节 | 问题 |
|---|---|
| 减法 $x_i - \mu$ | 若 $x_i$ 与 $\mu$ 接近，量化步长粗糙时差值精度极低 |
| 平方累加 $\sum(x_i - \mu)^2$ | 数值快速膨胀，低位宽累加器容易溢出 |
| 方差估计 | 量化后相近值落入同一桶，方差被系统性低估或高估 |
| 除以标准差 | 标准差偏差会被放大到归一化结果中 |
| 不同 token 动态范围差异大 | 统一 scale 无法同时照顾所有 token |

Transformer 对 LN 的输出非常敏感，即使是微小的归一化偏差也会层层放大，导致模型精度显著下降。

### 解决方案

**方案 1：LN 保留高精度**

最常见也最稳的方案。权重和线性层量化为 INT8，但 LN 本身用 FP16/BF16/FP32 计算。LN 计算量相对全模型占比不大，代价可接受。这是大多数推理框架的默认策略。

**方案 2：高位宽累加器**

即使输入量化为 INT8，归约操作（求和、平方和）使用 INT32 或更高精度累加，或直接反量化到浮点再做归约。

**方案 3：细粒度量化**

使用 per-channel 或 group-wise quantization，为不同维度/不同 token 分配独立的 scale，减轻动态范围不一致的影响。

**方案 4：激活预缩放**

类似 SmoothQuant 的思路：将部分激活尺度迁移到权重侧，压平 activation outlier，降低激活的动态范围，让后续量化更稳定。

**方案 5：用 RMSNorm 替代**

见下一节。

**方案 6：QAT**

后训练量化（PTQ）对 LN 掉点明显时，可通过量化感知训练（QAT）让模型在训练时适应量化误差。

## RMSNorm

RMSNorm 是 LayerNorm 的简化变体，去掉了减均值的操作，只做均方根归一化：

$$
\text{RMS}(x) = \sqrt{\frac{1}{D}\sum_{d=1}^{D} x_d^2 + \epsilon}
$$

$$
y_d = \gamma_d \frac{x_d}{\text{RMS}(x)}
$$

相比 LayerNorm：

- 省去了均值计算和中心化步骤，计算路径更短
- 数值链路更简单，量化相对更友好
- 实验表明在大多数场景下效果与 LN 相当

LLaMA、Gemma 等现代大模型普遍采用 RMSNorm。

## Pre-LN vs Post-LN

LN 在 Transformer 中的放置位置有两种主流方案：

**Post-LN**（原始 Transformer）：

$$
x' = \text{LN}(x + \text{SubLayer}(x))
$$

先做子层计算和残差连接，再做 LN。

**Pre-LN**：

$$
x' = x + \text{SubLayer}(\text{LN}(x))
$$

先做 LN，再进子层计算和残差连接。

两者的核心差异在于**梯度传播路径**：

- **Post-LN** 中，梯度回传必须穿过 LN 层，LN 的 Jacobian 会对梯度做缩放和旋转。深层网络中这种变换层层累积，容易导致梯度消失或训练初期不稳定，通常需要 warmup
- **Pre-LN** 中，残差连接提供了一条从输出直达输入的"干净"梯度通路（$\partial x' / \partial x = I + \cdots$），LN 只作用在子层的分支上，不阻断主路梯度。因此训练更稳定，对 warmup 的依赖更小

实践中，Pre-LN 是当前大模型的主流选择。但也有研究指出 Post-LN 在训练充分的情况下最终性能可能更好——代价是更难训练。

## References

- S. Ioffe and C. Szegedy, *Batch Normalization: Accelerating Deep Network Training by Reducing Internal Covariate Shift*, ICML 2015.
- J. L. Ba, J. R. Kiros, and G. E. Hinton, *Layer Normalization*, arXiv 2016.
- B. Zhang and R. Sennrich, *Root Mean Square Layer Normalization*, NeurIPS 2019.
- G. Xiao et al., *SmoothQuant: Accurate and Efficient Post-Training Quantization for Large Language Models*, ICML 2023.
- S. Sanchit et al., *On the Role of Normalization in Transformers*.
- R. Xiong et al., *On Layer Normalization in the Transformer Architecture*, ICML 2020.

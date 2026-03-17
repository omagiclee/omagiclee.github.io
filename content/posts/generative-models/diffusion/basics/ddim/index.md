+++
date = '2020-10-06T06:15:51+08:00'
draft = false
title = 'DDIM'
categories = []
tags = []
featured = false
+++

:(fas fa-award fa-fw):<span style="color:gray">ICLR 2021</span>
:(fas fa-building fa-fw):<span style="color:gray">Stanford</span>
:(fas fa-file-pdf fa-fw):[arXiv 2010.02502](https://arxiv.org/abs/2010.02502)

DDIM（Denoising Diffusion Implicit Models）可以看作是对 DDPM 的一次关键重解释：**训练阶段几乎不变，但采样阶段可以显著加速**。

如果说 DDPM 的核心思想是“学习一个逐步去噪器”，那么 DDIM 的核心思想则是：

> 在不改变训练目标的前提下，重新设计采样轨迹，让反向过程不必严格沿着 DDPM 那条细粒度、随机的马尔可夫链一步步走回去。

这使得 DDIM 可以在更少的步数下生成高质量样本，同时还引入了一个非常重要的性质：**当随机项取零时，采样过程是确定性的**。

## 1. Pipeline Overview

DDIM 和 DDPM 在训练阶段几乎一致：都从真实样本 $x_0$ 出发，随机采样时间步 $t$，构造带噪样本 $x_t$，再训练网络预测噪声。

真正的变化发生在采样阶段。

在 DDPM 中，采样过程是：

- 从纯高斯噪声 $x_T$ 出发
- 按照反向马尔可夫链一步一步采样
- 每一步都重新注入随机噪声
- 最终得到样本 $x_0$

而在 DDIM 中，采样过程被重新写成一条**非马尔可夫的隐式轨迹**。它仍然从高斯噪声出发，但每一步不再必须严格执行 DDPM 那种局部随机更新，而是可以：

- 沿着更大的步长向前推进
- 甚至完全去掉每一步重新注入的随机性
- 在更少的步数下完成生成

所以从宏观上看，DDIM 的一句话总结是：

> 保留 DDPM 的训练方式，重写 DDPM 的采样方式。

## 2. 从 DDPM 到 DDIM：问题出在哪里

DDPM 的采样质量很高，但有一个非常直接的问题：**太慢**。

原因不是网络单次前向太贵，而是采样时要执行很多次网络前向。以最经典的设置为例，训练时最大时间步通常取 $T = 1000$，原始 DDPM 采样时也往往要走接近 1000 步。

为什么必须这么多步？因为 DDPM 的反向过程被定义成一条**细粒度的随机马尔可夫链**：

$$
p_\theta(x_{t-1} \mid x_t)
$$

也就是说，模型学到的是“从当前状态 $x_t$ 回到前一步 $x_{t-1}$ 的局部更新规则”。这种设计训练稳定，但推理时必须一步一步走，几乎不能跳。

DDIM 的出发点正是这个问题：

> 如果训练目标本身只依赖于边缘分布 $q(x_t \mid x_0)$，而不严格依赖整条 forward joint process 的马尔可夫结构，那么是否可以构造另一类 forward / reverse 过程，在保持训练目标不变的前提下，让采样更快？

DDIM 的答案是：可以。

## 3. 训练目标为什么可以不变

DDIM 最重要的观察是：DDPM 常用的训练目标，本质上只依赖于下面这个边缘分布：

$$
q(x_t \mid x_0)
$$

它的形式仍然是：

$$
q(x_t \mid x_0) =
\mathcal{N}(x_t;\,\sqrt{\bar{\alpha}_t}\,x_0,\,(1-\bar{\alpha}_t)I)
$$

等价地，可以写成：

$$
x_t =
\sqrt{\bar{\alpha}_t}\,x_0 +
\sqrt{1-\bar{\alpha}_t}\,\epsilon,
\quad
\epsilon \sim \mathcal{N}(0, I)
$$

注意这里真正参与训练的是：

- 原始样本 $x_0$
- 当前时间步 $t$
- 构造出的带噪样本 $x_t$
- 对应的噪声 $\epsilon$

也就是说，只要你能保持这个边缘分布不变，那么训练时看到的输入输出对就不变，噪声预测目标也不变。

因此，DDIM 并没有推翻 DDPM 的训练方式，而是指出：

> **同样的边缘分布，可以对应很多不同的联合分布。**

DDPM 选择的是马尔可夫 forward process。  
DDIM 则构造了一类**非马尔可夫**的 forward process，它们和 DDPM 具有相同的 $q(x_t \mid x_0)$，因此会导向同一个训练目标。

这就是为什么 DDIM 可以做到：

> 训练和 DDPM 一样，采样却不一样。

## 4. Training：与 DDPM 相同

{{< pseudocode >}}
\begin{algorithm}
\caption{Training}
\begin{algorithmic}
\REPEAT
    \STATE $x_0 \sim q(x_0)$
    \STATE $t \sim \text{Uniform}(\{1,\ldots,T\})$
    \STATE $\epsilon \sim \mathcal{N}(0, I)$
    \STATE Construct $x_t = \sqrt{\bar{\alpha}_t} x_0 + \sqrt{1-\bar{\alpha}_t}\epsilon$
    \STATE Take gradient descent step on
    $
    \nabla_\theta \left\|
    \epsilon - \epsilon_\theta(x_t, t)
    \right\|^2
    $
\UNTIL{converged}
\end{algorithmic}
\end{algorithm}
{{< /pseudocode >}}

和 DDPM 一样，DDIM 的模型输入仍然是：

- 带噪样本 $x_t$
- 时间步 $t$

模型输出仍然是：

$$
\epsilon_\theta(x_t, t)
$$

即对当前样本中等效整体噪声的预测。

训练损失也保持不变：

$$
L_{\text{simple}} =
\mathbb{E}_{x_0,\epsilon,t}
\left[
\left\|
\epsilon - \epsilon_\theta(x_t, t)
\right\|^2
\right]
$$

所以从训练视角看，DDIM 并不是一个“重新训练的新模型”，而更像是：

> 对同一个噪声预测模型，采用了一种不同的解释和采样方式。

## 5. DDIM Sampling：隐式、非马尔可夫、可加速

真正的变化发生在采样阶段。

DDPM 的反向采样本质上是随机的：每一步先根据模型输出计算一个均值，再重新采样一份高斯噪声，把随机性注入回去。

DDIM 则重新构造了一个满足相同边缘分布的非马尔可夫过程，并由此得到新的采样更新式。它的核心思想可以概括成三步：

1. 先用模型预测当前噪声
2. 再由噪声预测恢复对原始样本 $x_0$ 的估计
3. 然后直接根据这个估计跳到更早的某个时间步

首先，和 DDPM 一样，由噪声预测得到对原始样本的估计：

$$
x_0^{pred} =
\frac{x_t - \sqrt{1-\bar{\alpha}_t}\,\epsilon_\theta(x_t, t)}
{\sqrt{\bar{\alpha}_t}}
$$

然后，DDIM 将下一步样本写成三部分：

$$
x_{t-1} =
\sqrt{\bar{\alpha}_{t-1}}\,x_0^{pred}
+
\sqrt{1-\bar{\alpha}_{t-1}-\sigma_t^2}\,\epsilon_\theta(x_t, t)
+
\sigma_t z
$$

其中：

$$
z \sim \mathcal{N}(0, I)
$$

这个式子的含义很清楚：

- 第一项保留对原始信号的估计
- 第二项保留当前方向上的噪声成分
- 第三项控制是否重新注入随机性

这里的 $\sigma_t$ 不是固定写死的，而是一个可调的噪声强度。DDIM 进一步用参数 $\eta$ 来控制它：

$$
\sigma_t =
\eta
\sqrt{
\frac{1-\bar{\alpha}_{t-1}}{1-\bar{\alpha}_t}
\left(
1-\frac{\bar{\alpha}_t}{\bar{\alpha}_{t-1}}
\right)
}
$$

这个参数非常关键。

- 当 $\eta = 1$ 时，更新更接近 DDPM 那种随机采样风格
- 当 $\eta = 0$ 时，$\sigma_t = 0$，随机项完全消失，采样变成确定性过程

于是，当 $\eta = 0$ 时，更新式退化为：

$$
x_{t-1} =
\sqrt{\bar{\alpha}_{t-1}}\,x_0^{pred}
+
\sqrt{1-\bar{\alpha}_{t-1}}\,\epsilon_\theta(x_t, t)
$$

这就是 DDIM 最经典的确定性采样形式。

## 6. 为什么 DDIM 是确定性的

DDIM 最有辨识度的一个性质，就是：

> **当 $\eta = 0$ 时，整个采样轨迹是确定性的。**

原因并不复杂。

在 DDPM 中，每一步更新都含有新的随机采样项，因此即使起始噪声相同，后续生成轨迹也可能不同。

而在 DDIM 中，当 $\eta = 0$ 时：

- 每一步不再注入新的随机噪声
- 当前状态 $x_t$ 和模型预测 $\epsilon_\theta(x_t,t)$ 唯一决定下一步 $x_{t-1}$

于是，给定：

- 相同的初始噪声 $x_T$
- 相同的模型参数
- 相同的采样时间表

最终生成结果就是唯一的。

因此，DDIM 的“implicit”不是说模型里没有噪声预测，而是说：

> 反向生成过程可以被写成一条显式确定的轨迹，而不是必须在每一步重新采样随机变量。

## 7. 为什么 DDIM 能加速

DDIM 能加速，最根本的原因不是“单步更省算力”，而是：

> **可以用更少的采样步数完成生成。**

原始 DDPM 通常要按 $T, T-1, \ldots, 1$ 一步一步完整走完。  
而 DDIM 允许只选取一个时间步子序列，例如：

$$
\tau = [1000, 980, 960, \ldots, 20, 1]
$$

或者更激进一点：

$$
\tau = [1000, 950, 900, \ldots, 50, 1]
$$

也就是说，采样时不必真的走满 1000 步，而可以只走 50 步、20 步，甚至更少。

为什么这样仍然成立？因为 DDIM 的反向过程不再被严格绑定在“相邻时间步的小随机更新”上，而是可以看作：

> 沿着同一个去噪方向，在离散时间网格上做更大步长的推进。

所以 DDIM 的加速本质就是：

- 训练仍然用细粒度时间步学习去噪器
- 推理时改用稀疏时间网格
- 用更少次网络调用完成生成

这也是为什么 DDIM 常被理解成一种“训练不变、推理加速”的 diffusion sampler。

## 8. Sampling with a Subsequence

{{< pseudocode >}}
\begin{algorithm}
\caption{DDIM Sampling}
\begin{algorithmic}
\STATE Choose a timestep subsequence $\tau = [\tau_1, \tau_2, \ldots, \tau_S]$, where $\tau_1 < \cdots < \tau_S = T$
\STATE $x_{\tau_S} \sim \mathcal{N}(0, I)$
\FOR{$i = S, S-1, \ldots, 2$}
    \STATE $t = \tau_i,\quad s = \tau_{i-1}$
    \STATE Predict noise $\epsilon_\theta(x_t, t)$
    \STATE Compute
    $
    x_0^{pred} =
    \frac{x_t - \sqrt{1-\bar{\alpha}_t}\,\epsilon_\theta(x_t, t)}
    {\sqrt{\bar{\alpha}_t}}
    $
    \STATE Sample $z \sim \mathcal{N}(0, I)$
    \STATE Update
    $
    x_s =
    \sqrt{\bar{\alpha}_s}\,x_0^{pred}
    +
    \sqrt{1-\bar{\alpha}_s-\sigma_t^2}\,\epsilon_\theta(x_t, t)
    +
    \sigma_t z
    $
\ENDFOR
\RETURN $x_{\tau_1}$
\end{algorithmic}
\end{algorithm}
{{< /pseudocode >}}

这个伪代码里最关键的是“选取一个时间步子序列 $\tau$”。  
它直接说明了 DDIM 和 DDPM 在采样层面的差别：

- DDPM：默认走完整的密集时间网格
- DDIM：可以只走一个稀疏子序列

当子序列更短时，采样更快；但与此同时，图像质量通常也会受到一定影响。因此 DDIM 提供的是一种非常实用的 trade-off：

> 用步数换速度，用速度和质量之间做平衡。

## 9. DDIM 和 DDPM 的关系

理解 DDIM，最好的方式不是把它看成“和 DDPM 完全不同的新模型”，而是把它看成：

> **DDPM 的一个更广义的采样框架。**

二者关系可以总结为：

### 9.1 相同点

- 都基于同样的噪声预测网络
- 都使用相同的训练目标
- 都从高斯噪声出发生成样本
- 都在学习从带噪样本恢复数据的过程

### 9.2 不同点

- DDPM 的采样是随机的、马尔可夫的、细粒度逐步推进的
- DDIM 的采样可以是确定性的、非马尔可夫的、可跳步推进的

所以 DDIM 不是在否定 DDPM，而是在说明：

> **DDPM 学到的去噪器，并不只对应一种采样轨迹。**

## 10. 为什么 DDIM 对后续工作很重要

DDIM 的价值不只是“更快”这么简单，它实际上改变了大家理解 diffusion sampling 的方式。

在 DDPM 的视角下，反向过程更像是在模拟一条随机马尔可夫链。  
而在 DDIM 的视角下，反向过程更像是在一条连续或半连续的去噪轨迹上做离散推进。

这种观点带来了两个重要后果：

第一，它让“少步采样”变得自然。  
因为一旦你把采样理解成轨迹推进，就不必拘泥于每一个相邻时间步。

第二，它为后续的高阶 ODE / solver 类采样器铺平了道路。  
很多后来的快速采样方法，本质上都延续了 DDIM 这条思路：训练目标不变，改进采样器。

所以从扩散模型发展史上看，DDIM 是一个非常关键的转折点：

> 它第一次清楚地把“训练扩散模型”和“如何高效采样”这两件事分开了。

## 11. Summary

DDIM 的核心逻辑可以概括为下面四句话：

1. DDIM 与 DDPM 保持相同的训练目标，仍然训练一个噪声预测网络  
2. 它重新构造了一类与 DDPM 共享相同边缘分布的非马尔可夫 diffusion process  
3. 它将采样过程改写为一条可确定、可跳步、可调随机性的隐式去噪轨迹  
4. 因此，DDIM 能够在明显减少采样步数的同时，保持较好的生成质量  

如果说 DDPM 解决的是“扩散模型能不能稳定训起来”，那么 DDIM 解决的则是：

> 扩散模型训好了之后，能不能更快地用起来。

## References
- [Denoising Diffusion Implicit Models](https://arxiv.org/abs/2010.02502)
- [DDIM (OpenReview)](https://openreview.net/forum?id=St1giarCHLP)
- [What are Diffusion Models? (Lilian Weng)](https://lilianweng.github.io/posts/2021-07-11-diffusion-models/)
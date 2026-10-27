+++
date = '2026-10-23T00:00:00+08:00'
lastmod = '2026-10-23T00:00:00+08:00'
draft = false
isCJKLanguage = true
contentLanguage = 'zh-CN'
title = '三维重建技术综述与影像画质数据生成'
description = '系统梳理 SfM、MVS、RGB-D、NeRF、神经表面、3D Gaussian Splatting、前馈重建与动态场景，并专题讨论逆渲染、重打光和 RAW 成像仿真如何生产可信的影像画质训练数据。'
summary = '从几何恢复到可重打光的数字场景，理解三维重建各条路线的能力边界。重点拆解 3DGS，并讨论如何在固定场景下改变光源、曝光、景深和运动，生成可追溯的影像画质数据对。'
categories = ['Spatial Intelligence', '影像画质']
tags = ['三维重建', '3DGS', 'NeRF', '逆渲染', '重打光', '合成数据', 'Auto-GT']
featured = true
+++

用一组照片重建一个场景，再移动灯光、改变光源大小，最后重新生成图像，是一条已经有研究基础的技术路线。对于影像画质，它尤其有吸引力：**同一人物、同一构图可以在不同条件下反复成像，从而得到真实拍摄中难以严格配对的数据。**

这条路线需要把三种能力接起来：恢复三维结构，建立可改变照明的外观模型，再模拟相机如何把光变成图像。**普通 NeRF 和 3D Gaussian Splatting（3DGS）主要解决新视角合成；要支持可靠的重打光，需要进一步建模材质、入射光和光传输。** GS-IR、Relightable 3D Gaussians 等方法已经沿这一方向扩展，Lumos、SynthLight 则展示了物理渲染数据用于训练人像重打光的可行性。[GS-IR](https://lzhnb.github.io/project-pages/gs-ir.html)、[Relightable 3D Gaussian](https://nju-3dv.github.io/projects/Relightable3DGaussian/)、[Lumos](https://research.nvidia.com/labs/cosmos-lab/lumos/)、[SynthLight](https://vrroom.github.io/synthlight/)

本文覆盖截至 **2026 年 10 月 23 日**可核对的代表性研究，先建立三维重建技术地图，再独立讨论影像画质数据生成。方法表解释能力与输入条件，实验部分给出可执行的验证方案；论文结果和方案建议分别表述。

{{< codex-table label="按问题选择阅读入口" compact="true" >}}
| 想解决的问题 | 阅读入口 |
| --- | --- |
| 三维重建有哪些主要路线 | 第 1 至 3 节 |
| 3DGS 的原理和后续发展 | 第 4 至 5 节 |
| 重建以后怎样换光 | 第 6 节 |
| 能生成哪些影像画质数据 | 第 7 至 8 节专题 |
| 怎样证明数据有用并开始实验 | 第 9 至 11 节 |
{{< /codex-table >}}

<!--more-->

## 1 三维重建究竟要恢复什么

三维重建通常指从图像、视频、深度或其他测量中恢复场景的三维信息。工程里最容易混淆的是输出目标：一个能够转动观看的场景，未必能准确测量尺寸；一个尺寸准确的网格，也未必有正确的材质和光照。

{{< codex-table label="三维重建的四种输出目标" >}}
| 目标 | 需要恢复的内容 | 典型输出 | 主要验收问题 |
| --- | --- | --- | --- |
| 几何重建 | 位置、形状、表面、相机 | 点云、深度、网格、SDF | 尺寸、轮廓和表面是否准确 |
| 外观重建 | 从不同方向看到的颜色 | 纹理、辐射场、Gaussians | 未参与拟合的视角是否逼真 |
| 可重打光重建 | 材质与光照响应 | BRDF、光传输、可重打光资产 | 换光后阴影和高光是否合理 |
| 动态重建 | 随时间变化的结构与外观 | 形变场、4D Gaussians、动态网格 | 运动、遮挡和时序是否一致 |
{{< /codex-table >}}

这里的 **SDF** 是有符号距离函数，零值面表示物体表面；**BRDF** 是双向反射分布函数，描述某个入射方向的光如何反射到观察方向；**辐射场** 则描述空间位置与观察方向对应的辐射亮度。后者可以拟合已经形成的光影，而不显式恢复前者。

下面按输出能力组织技术关系。分支可以组合，例如用前馈模型提供相机与深度初值，再优化 Gaussians；用 Gaussians 恢复表面，再接物理渲染。

{{< mermaid >}}
flowchart TD
  A[照片 视频 深度或扫描] --> B[相机与几何恢复]
  B --> C[SfM 与 MVS<br/>RGB-D 融合或前馈模型]
  C --> F[点云 网格或神经表面]
  C --> G[NeRF 或 3DGS 外观拟合]
  G --> H[原照明下的新视角]
  F --> I[材质 光照与光传输建模]
  G --> I
  I --> J[换灯光 换材质 重渲染]
  J --> K[相机成像与任务配对]
  K --> L[影像画质训练和评测数据]
{{< /mermaid >}}

另一个独立维度是**求解方式**：传统优化与逐场景神经优化，会为当前场景反复调整参数；前馈模型利用预训练知识，一次或少量网络计算预测场景。它们都可以输出点云或 Gaussians。“3DGS”说明表示与渲染方式，“前馈”说明怎样得到参数，两者并不冲突。

## 2 几何路线从多视图约束开始

### SfM 与 MVS

经典摄影测量通常分两步：**SfM（Structure from Motion）恢复相机和稀疏结构，MVS（Multi-View Stereo）进一步恢复稠密表面。** COLMAP 将特征匹配、几何验证、相机注册、三角化、束调整和稠密重建组织成完整流程，是理解这条路线的实用入口。[COLMAP 官方教程](https://colmap.github.io/tutorial.html)

{{< mermaid >}}
flowchart LR
  A[重叠照片] --> B[特征匹配与几何验证]
  B --> C[相机位姿与稀疏点]
  C --> D[束调整]
  D --> E[多视图深度与法线]
  E --> F[融合点云和网格]
{{< /mermaid >}}

束调整（Bundle Adjustment，BA）联合调整相机和三维点，让三维点投影回各张照片的位置尽量接近真实匹配点。MVS 则利用已知相机关系，为更多像素寻找一致的深度。学习方法可以替换其中的部件：例如 MVSNet 通过可微单应变换构造代价体，再学习深度估计。[MVSNet 原论文](https://arxiv.org/abs/1804.02505)

对采集而言，**视角覆盖和有效视差比单纯增加照片张数更重要**。只在原地转动相机，通常缺少可靠的平移视差；纹理重复、反光、透明、严重模糊和动态物体，都可能让匹配失效。单目重建的尺度还需要已知尺寸、标尺或其他传感器约束，不能默认点云单位就是米。

### RGB-D 与主动测量

深度相机、结构光、ToF 和 LiDAR 提供额外的距离观测。多帧融合可以把有噪声的局部观测累积成表面；KinectFusion 是使用移动深度相机进行实时跟踪与稠密表面融合的经典例子。[KinectFusion](https://www.microsoft.com/en-us/research/publication/kinectfusion-real-time-dense-surface-mapping-tracking/)

这类输入适合给尺寸、遮挡关系与相机轨迹提供锚点。具体效果仍取决于传感器距离范围、标定与材质响应。**测到几何不等于测到反射属性**：深度扫描得到的杯子，可以有准确轮廓，却仍缺少釉面粗糙度与透射信息。

### 神经表面

如果交付物是可用表面，可以直接优化隐式表面。NeuS 用 SDF 表示几何，通过专门的体渲染形式从多视角图像学习零值面；NeuS2 进一步研究加速。这类方法为“从图像到高质量网格”提供另一条路线。[NeuS](https://lingjie0206.github.io/papers/NeuS/index.htm)、[NeuS2](https://arxiv.org/abs/2212.05231)

{{< codex-table label="几何重建路线的选择" >}}
| 路线 | 适合的输入和目标 | 常见困难 |
| --- | --- | --- |
| SfM 加 MVS | 多视图照片，需要相机、点云和网格 | 弱纹理、反光、匹配断裂 |
| RGB-D 或扫描融合 | 可主动采集，需要尺度与表面约束 | 深度噪声、材质响应、设备标定 |
| 学习式 MVS | 已标定多视角，学习跨视图深度 | 代价体开销、跨域泛化 |
| 神经 SDF | 更关注连续表面和网格质量 | 优化成本、薄结构、不可见区域 |
{{< /codex-table >}}

上述判断按任务需求归纳，不构成跨数据集的性能排名。

## 3 NeRF 把照片变成可查询的辐射场

NeRF 的基本思路是：输入空间位置和观察方向，预测体密度与颜色，再沿相机射线积分得到像素。通过比较渲染图与输入照片，优化这个连续场景函数。[NeRF 原论文](https://arxiv.org/abs/2003.08934)

可以把它理解为“从某个位置向某个方向看，会收到什么颜色的光”。这对新视角合成非常自然，但原始模型没有把光源作为独立输入，因此不能仅靠修改一个灯光参数，就正确重算整个场景。

{{< codex-table label="NeRF 代表性进展" >}}
| 方法 | 主要推进方向 | 对影像数据生成的意义 |
| --- | --- | --- |
| [NeRF，2020](https://arxiv.org/abs/2003.08934) | 连续辐射场与可微体渲染 | 建立多视图外观重建范式 |
| [Instant-NGP，2022](https://nvlabs.github.io/instant-ngp/) | 多分辨率哈希编码和高效实现 | 降低逐场景拟合成本 |
| [Mip-NeRF 360，2022](https://jonbarron.info/mipnerf360/) | 无界场景、多尺度采样与正则化 | 改善复杂场景的新视角质量 |
| [Zip-NeRF，2023](https://jonbarron.info/zipnerf/) | 网格表示结合抗混叠 | 减少相机移动或尺度变化时的闪烁与细节丢失 |
| [RawNeRF，2022](https://bmild.github.io/rawnerf/) | 在线性 RAW 域重建 HDR 辐射场 | 支持曝光、色调映射和合成离焦等后续操作 |
{{< /codex-table >}}

RawNeRF 对画质领域尤其有启发：JPEG 中的高光裁剪、降噪与色调映射，会改变原始信号；从线性 RAW 开始，可以保留更多动态范围和噪声统计信息。它证明了三维重建可以深入相机成像链，但**调整曝光与焦点，仍需和改变场景照明分别讨论**。[RawNeRF](https://bmild.github.io/rawnerf/)

## 4 3DGS 用显式高斯基元拟合场景

### 表示与优化

3D Gaussian Splatting 用大量可优化的三维高斯基元表示场景。每个基元具有中心、空间形状、不透明度，以及随观察方向变化的颜色；将它们投影到屏幕，再按深度关系混合，就能得到图像。[3DGS 原论文](https://arxiv.org/html/2308.04079v1)

{{< codex-table label="一个 3D Gaussian 保存的参数" compact="true" >}}
| 参数 | 直观含义 |
| --- | --- |
| 中心 | 基元在三维空间的位置 |
| 协方差 | 椭球的大小、朝向和各方向伸展程度 |
| 不透明度 | 对后方内容的遮挡与当前像素贡献 |
| 球谐颜色系数 | 从不同观察方向看到的颜色变化 |
{{< /codex-table >}}

训练时，先用相机与初始点建立场景，再反复执行渲染、计算图像误差和更新参数。同时增密、分裂或移除基元，让表示容量分配到需要的区域。高效的 GPU 光栅化使它适合快速查看和大量渲染。[3DGS 项目](https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/)

<details>
<summary>展开看高斯与像素混合公式</summary>

三维高斯的空间权重可以写为：

$$
G_i(x)=\exp\left[-\frac{1}{2}(x-\mu_i)^T\Sigma_i^{-1}(x-\mu_i)\right].
$$

其中 $\mu_i$ 为中心，$\Sigma_i$ 为协方差。旋转与正尺度的参数化有助于让协方差保持合法。

对已按前后关系排序的屏幕投影，像素颜色可简写为：

$$
\begin{aligned}
C(p)&=\sum_i T_i(p)\alpha_i(p)c_i(d)\\
&\quad+T_{\mathrm{bg}}(p)c_{\mathrm{bg}},\\
T_i(p)&=\prod_{j\lt i}(1-\alpha_j(p)).
\end{aligned}
$$

$\alpha_i(p)$ 包含不透明度与投影高斯在像素处的贡献；$c_i(d)$ 是观察方向 $d$ 下的颜色；$T_i$ 表示前方基元尚未遮掉的比例。原始 splatting 的投影和排序带有近似，这个表达也没有包含材质与光源之间的完整光传输。[3DGS 方法部分](https://arxiv.org/html/2308.04079v1)

</details>

### 3DGS 和 NeRF 怎样比较

{{< codex-table label="NeRF 与 3DGS 的结构性差异" >}}
| 维度 | NeRF 家族 | 3DGS 家族 |
| --- | --- | --- |
| 基础表示 | 连续函数，可结合网格或哈希特征 | 显式高斯集合，可结合网络预测 |
| 典型渲染 | 沿射线采样并累积 | 投影基元并混合 |
| 优势来源 | 连续查询与灵活的场函数 | 局部显式表示与高效光栅化 |
| 资源开销 | 受网络、特征网格和采样数影响 | 受基元数、屏幕覆盖与排序影响 |
| 几何交付 | 需要表面约束或网格提取 | 需要表面约束或专门转换 |
| 原生换光 | 通常需要扩展 | 通常需要扩展 |
{{< /codex-table >}}

实践中应比较具体实现与相同设置，不能把原始 NeRF 的速度代表整个家族，也不能把某个 3DGS 场景的 FPS 外推到所有分辨率。对数据生产，更有意义的是**每个合格场景的建模成本、每张合格图的成本和可覆盖的条件范围**。

### 普通 3DGS 的能力边界

**球谐颜色记录的是方向相关的外观，不是一个完整的可换灯材质系统。** 已拍下的阴影、反射与曝光差异可能被外观参数吸收。移动观察相机能够看到高光变化，不意味着移动光源也能得到正确结果。

还有几类与画质数据直接相关的问题：

{{< codex-table label="3DGS 的常见问题及其数据影响" >}}
| 现象 | 对数据的影响 | 应对方向 |
| --- | --- | --- |
| 漂浮点与拉长基元 | 边缘污染、遮挡错误 | 补充覆盖、几何先验与正则化 |
| 放大后结构变薄或细节闪烁 | 将渲染伪影混入超分或视频数据 | 抗混叠与多尺度验证 |
| 深度或法线不稳定 | 虚化轮廓、阴影方向错误 | 表面表示与几何约束 |
| 大幅偏离采集视角 | 暴露缺失表面与未观测区域 | 限定渲染范围或补拍 |
| 光影留在颜色中 | 换光后出现双重阴影 | 材质和照明分解 |
{{< /codex-table >}}

这些问题推动了不同分支，不能只靠增加 Gaussian 数量解决。

### 表面与采样方面的改进

{{< codex-table label="3DGS 的几何与成像扩展" >}}
| 方法 | 核心变化 | 适合关注的任务 |
| --- | --- | --- |
| [SuGaR，2024](https://arxiv.org/abs/2311.12775) | 约束高斯贴合表面，提取网格并可绑定优化 | 网格交付与传统编辑流程 |
| [2DGS，2024](https://surfsplatting.github.io/) | 用三维空间中的定向二维圆盘表示表面 | 多视图一致的深度、法线与表面 |
| [Mip-Splatting，2024](https://niujinshuchong.github.io/mip-splatting/) | 三维平滑与二维 Mip 滤波 | 改变焦距、距离和输出尺度时的稳定性 |
| [HDRGS，2024](https://arxiv.org/abs/2408.06543) | 从多曝光 LDR 图像恢复 HDR 辐射场 | HDR 与曝光相关数据 |
{{< /codex-table >}}

2DGS 中的“2D”指基元是一张定向表面片，它仍然构成三维场景。SuGaR 等方法得到网格，也不代表自动获得了去除光照的 base color；表面、材质和成像信息仍要分别检查。

## 5 前馈重建和动态重建扩大输入范围

### 从逐场景求解到预训练几何模型

{{< codex-table label="前馈几何与 Gaussian 重建代表路线" >}}
| 方法 | 输入与输出的重点 | 使用时需要分清什么 |
| --- | --- | --- |
| [DUSt3R，2024](https://arxiv.org/abs/2312.14132) | 无需预先给定标定的图像对，预测点图，多图进行全局对齐 | 两图预测与多图对齐是不同步骤 |
| [MASt3R，2024](https://arxiv.org/abs/2406.09756) | 在点图模型上强化局部特征匹配 | 匹配质量、几何精度与下游优化共同决定结果 |
| [VGGT，2025](https://vgg-t.github.io/) | 联合预测相机、深度、点图与点轨迹 | 预测几何需要在目标场景上验证 |
| [Depth Anything 3，2025](https://depth-anything-3.github.io/) | 用深度与射线表示统一多视图几何，并扩展 Gaussian 预测 | 几何模型与新视角渲染头的职责不同 |
| [pixelSplat，2024](https://davidcharatan.com/pixelsplat/) | 从图像对前馈预测 Gaussians | 稀疏观测限制可恢复内容 |
| [MVSplat，2024](https://donydchen.github.io/mvsplat/) | 结合多视图代价体预测 Gaussians | 原方法以带相机信息的多视图为输入 |
| [SHARP，2025](https://apple-aiml-research.github.io/ml-sharp/) | 从单张照片预测用于邻近视角的 Gaussian 场景 | 邻近视角能力不能扩大成完整物体扫描 |
| [VGG-T³，2026](https://research.nvidia.com/labs/dvl/projects/vgg-ttt/) | 以测试时训练压缩全局信息，改善多图重建的扩展性 | 大规模几何聚合不直接解决材质和照明 |
{{< /codex-table >}}

这条路线降低了相机恢复和场景初始化的门槛。对于离线高质量资产，一个值得验证的组合是：**前馈预测初值，再用实际多视图观测优化，最后做独立几何与画质检查。** 前馈速度快，仍需要计算标定、数据清理和后续筛选的成本。

单图输入尤其需要区分“观测恢复”和“先验补全”。照片没有看到的背面，其具体纹理与形状不能由这张照片唯一确定。模型补得合理，适合内容制作；若用于像素真值，则要保留其推断来源。

### 动态与在线重建

动态场景需要额外的时间维度。一类 4D-GS 用三维高斯加形变预测，另一类工作直接使用时空四维高斯基元。这些同名或近名方法的表示并不相同。[Wu 等的 4D-GS](https://arxiv.org/abs/2310.08528)、[Yang 等的 4D Gaussian Splatting](https://arxiv.org/abs/2310.10642)

在线重建还需要边采集边估计相机与地图。Gaussian Splatting SLAM 把高斯表示用于跟踪、建图和渲染，代表这一方向。[Gaussian Splatting SLAM](https://arxiv.org/abs/2312.06741)

对视频画质，动态重建可为视角、运动和时序一致性提供条件。不过，**能够渲染连续时间，不自动意味着已经准确模拟曝光期间的运动模糊**。去模糊数据还需要对快门开启期间的相机与物体运动进行积分；动态重打光还需要照明与运动解耦。

## 6 从外观拟合走向可重打光重建

### 换光为什么需要逆渲染

逆渲染试图从图片反推形成图片的因素：几何、材质、照明以及相机响应。对于不考虑介质与透射的表面，反射可概括为：

$$
L_o(x,\omega_o)=L_e(x,\omega_o)
+\int_{\Omega^+} f_r(x,\omega_i,\omega_o)
L_i(x,\omega_i)\max(0,n\cdot\omega_i)\,d\omega_i.
$$

这里 $L_o$ 是朝相机方向离开的光，$f_r$ 是材质反射，$n$ 是法线，$L_i$ 是到达表面的光，$L_e$ 是自发光。入射光已经受到遮挡和其他表面反射影响；更一般的模型还要处理透射、次表面散射与参与介质。[PBRT 光传输方程](https://pbr-book.org/4ed/Light_Transport_I_Surface_Reflection/The_Light_Transport_Equation)

这解释了为什么重打光不能只给已有颜色乘一个明暗系数。灯光变化会改变阴影、高光、反射和反弹光；若把旧阴影保留在 albedo 中，再计算新阴影，就容易出现不合理的叠加。

<details>
<summary>展开看逆渲染的不确定性</summary>

在简化的漫反射模型中，观测大致由反照率与照明的乘积决定。深色材质加亮光，可能与浅色材质加暗光接近；错误法线也可能被错误光照补偿。相机曝光与白平衡又增加了自由度。

因此，低重建误差只能说明当前参数解释了输入，不能证明各项物理参数唯一正确。可增加的信息包括已知照明、多个照明条件、HDR 观测、标定色板、几何扫描和适用的材质先验。它们各自消除一部分歧义，不能保证任意场景完全可解。

TensoIR 在展示 albedo 时明确说明使用颜色尺度对齐；OpenIllumination 的评测也讨论了材质与光强尺度歧义。若要生产绝对曝光或颜色数据，应额外建立标定，不能沿用一个仅适合相对比较的评测设置。[TensoIR](https://haian-jin.github.io/TensoIR/)、[OpenIllumination 补充材料](https://oppo-us-research.github.io/OpenIllumination/files/supp.pdf)

</details>

### 从普通多视角照片恢复可编辑因素

{{< codex-table label="逆渲染与可重打光重建的代表方法" >}}
| 方法 | 主要表示或机制 | 对选型的启发 |
| --- | --- | --- |
| [NeRFactor，2021](https://arxiv.org/abs/2106.01970) | 法线、可见性、albedo 与 BRDF 神经场 | 明确拆开反射属性与照明 |
| [NVDiffRec，2022](https://nvlabs.github.io/nvdiffrec/) | 联合优化网格、材质纹理和环境光 | 输出适合传统图形引擎的资产 |
| [NVDiffRecMC，2022](https://nvlabs.github.io/nvdiffrecmc/) | 蒙特卡洛渲染与降噪参与优化 | 更完整的光传输有助于材质与光照分离 |
| [TensoIR，2023](https://haian-jin.github.io/TensoIR/) | 张量分解与物理渲染，支持单个或多个未知照明 | 可作神经场逆渲染基线 |
| [GS-IR，2024](https://lzhnb.github.io/project-pages/gs-ir.html) | 法线约束与烘焙遮挡，恢复材质和环境光 | Gaussian 逆渲染的基础路线 |
| [Relightable 3D Gaussians，2024](https://arxiv.org/abs/2311.16043) | 高斯附加法线、BRDF 和入射光，点式光追查询可见性 | 研究 Gaussian 材质分解与阴影 |
| [GaRe，2025](https://baihyyut.github.io/GaRe/) | 分解户外太阳光、天空光与间接光 | 面向自然光变化的户外照片集合 |
| [RadioGS，2026](https://arxiv.org/abs/2603.01491) | 用辐射一致性约束改善未观测方向的间接光 | 换光包含适配步骤，需计入生产成本 |
| [GHPT，2026](https://nwu-vislab.github.io/GHPT/) | Gaussian 表面重建结合网格光追与逆渲染 | 混合表示可利用成熟的可见性和间接光计算 |
{{< /codex-table >}}

GaussianShader 也是相关工作，但重点是给高斯加入着色函数以改善反光表面的新视角质量。**反光拟合得更好，与完成任意照明下的物理重打光，是不同的验收目标。** [GaussianShader](https://arxiv.org/abs/2311.17977)

### 受控多光照采集提供更强约束

另一条路线是主动改变采集条件，让模型看到同一场景在不同灯光下的响应。OLAT（One Light At a Time）逐次点亮单个光源；在场景固定、响应线性且没有饱和等条件下，光照基底可以组合成新的照明。

{{< codex-table label="受控光照下的可重打光 Gaussian 方法" >}}
| 方法 | 采集或监督特点 | 适用价值 |
| --- | --- | --- |
| [GS³，2024](https://gsrelight.github.io/) | 多视图点光照输入，结合空间与角度高斯 | 复杂外观与自阴影的自由视点重打光 |
| [BiGS，2025](https://desmondlzy.github.io/publications/bigs/) | OLAT 数据，光照和视角相关的散射表示 | 模糊表面、次表面散射等复杂材质响应 |
| [BecomingLit，2025](https://jonathsch.github.io/becominglit/) | 动态灯光台人脸采集，混合神经着色 | 可重打光、可驱动的头部数字人 |
{{< /codex-table >}}

这些方法说明，可靠重打光不一定只能依靠显式 BRDF；也可以学习光传输响应。代价是需要相应的采集覆盖与条件控制。读取论文时，应把“普通固定光照照片”与“多光照灯光台数据”单独列出，避免只比较渲染效果。

### 生成式重打光与三维一致性

IllumiNeRF 先用照明条件扩散模型重打光多张输入，再把结果整合到 NeRF 中。这条路线可以借助生成先验处理难以显式分解的外观，同时让输出在三维视角之间更一致。[IllumiNeRF](https://illuminerf.github.io/)

对数据生产，三维一致性提供了有用的约束，但仍需检查原物体细节是否保持。把生成图拟合成一个一致场景，不会自动获得被生成过程改写的真实纹理。它适合产生候选、困难条件与偏好数据；像素级监督需要额外验证。

## 7 专题 三维重建能生成哪些影像画质数据

### 先确定需要改变的变量

答案是**可以，而且能够覆盖多种任务；每个任务需要的场景与相机模型不同**。可以把生成过程概括为：

$$
I=\mathcal{C}_{\psi}\!\left(\mathcal{R}(G,M,L,P,t)\right).
$$

$G$ 为几何，$M$ 为材质，$L$ 为照明，$P$ 为相机位姿，$t$ 为场景时间；$\mathcal{R}$ 计算光传输，$\mathcal{C}_{\psi}$ 表示光学、传感器与 ISP 成像。实际的曝光与孔径积分发生在成像过程中，这个公式是分工示意。

**重打光改变 $L$，曝光调整改变成像参数，换视角改变 $P$。** 只有把变量分清，才能知道一对图片究竟监督什么。

{{< codex-table label="光照编辑与相机编辑的区别" >}}
| 操作 | 典型变化 | 是否要求可重打光场景 |
| --- | --- | --- |
| 渲染后调曝光 | 整体信号缩放，再做显示映射 | 通常不要求，但要有合适的线性动态范围 |
| 调整白平衡 | 相机或处理流程中的颜色适配 | 通常不要求 |
| 移动主光源 | 阴影方向、高光位置、受光面改变 | 要求光照响应与可见性模型 |
| 改变面光源大小 | 阴影软硬、高光形状改变 | 要求能表达光源面积和遮挡 |
| 改变光源光谱 | 材质颜色响应可能改变 | 准确研究需要光谱材质和传感器响应 |
| 改光圈与焦距 | 景深、视场和像差等变化 | 要求相应相机模型与足够场景覆盖 |
{{< /codex-table >}}

一张环境 HDRI 通常按远场照明使用。它适合描述天空或远处光源，但不能自动表达贴近人脸的柔光箱距离、室内各位置不同的照明，以及移动灯具产生的近场变化。此时需要局部光源与周围几何。RGB 照明近似也不能完整区分同色异谱现象；跨传感器色彩研究要考虑光谱信息。[PBRT 成像与光谱响应](https://pbr-book.org/4ed/Cameras_and_Film/Film_and_Imaging)

### 按画质任务判断可行性

下表是基于成像机制的工程判断，不代表每项都已经具有可直接部署的统一方案。

{{< codex-table label="三维场景生成影像画质数据的可行性" >}}
| 任务 | 可以生成的配对或标签 | 额外需要的能力 | 主要风险 |
| --- | --- | --- | --- |
| 人像或物体重打光 | 同机位不同灯光图像，光源参数 | 可重打光材质、阴影、必要的散射 | 身份细节与材质分解错误 |
| 低照增强与去噪 | 干净辐射参考与低光子数观测 | 线性辐射、标定噪声与 ISP | 加噪分布偏离真实传感器 |
| HDR 与曝光融合 | 多曝光输入、线性 HDR 目标 | 足够动态范围、饱和与运动模型 | 高光已丢失，融合数据缺少真实鬼影 |
| 白平衡与色彩恒常 | 同材质不同照明及目标颜色 | 颜色标定，必要时光谱渲染 | 光源、材质、相机响应互相混淆 |
| 背景虚化与重聚焦 | 同场景不同孔径或焦平面 | 孔径积分、遮挡与细结构 | 发丝和前后景交界错误 |
| 去运动模糊 | 曝光积分图与指定时刻清晰图 | 相机轨迹、动态场景、快门模型 | 动态插值和滚动快门不准确 |
| 超分与多帧融合 | 多尺度、多亚像素位移图像 | 足够高频的源资产、光学采样与退化 | 将重建伪纹理当作真实细节 |
| 去反光或眩光 | 分量图、含反射或杂散光的观测 | 反射分离或镜头杂散光模型 | 材质反射与镜头眩光被混为一谈 |
| 视频一致性 | 同一场景的连续帧与运动条件 | 动态模型、遮挡、时间一致的照明 | 渲染闪烁污染监督 |
| 画质评价与偏好学习 | 因素可控的质量梯度与候选组 | 人类标注或真实任务评价 | 参数强度不能直接替代主观质量分 |
{{< /codex-table >}}

其中，重打光、景深、遮挡变化和多帧运动最能体现三维的价值。如果只是给静态图片添加 JPEG 压缩，二维处理已经足够；三维资产的建设成本应由额外控制能力来证明。

### 人像重打光已有数据生产先例

**Lumos** 使用虚拟灯光台构造物理渲染人像对，提供约 30 万样本，每个样本对应两种 HDR 照明，并输出 albedo、normal 等属性；训练结合合成到真实的适配。[Lumos](https://research.nvidia.com/labs/cosmos-lab/lumos/)

**SynthLight** 将人像重打光视为学习重新渲染，用三维头部资产与物理渲染器制造不同环境照明下的监督，再结合真实肖像的训练策略处理域差异。[SynthLight](https://vrroom.github.io/synthlight/)

这两项工作直接支持“3D 渲染可以帮助训练影像模型”，但其合成资产路线与“把任意实拍人物重建后准确换光”仍有不同难点。前者掌握资产定义，后者必须先解决逆问题。两种数据可以互补：前者提供控制，后者增加接近实拍的内容分布。

## 8 专题 怎样把重建场景变成可信的数据对

### 选择三条生产路线

{{< codex-table label="三维画质数据的三条生产路线" >}}
| 路线 | 输入与生产方式 | 建议承担的角色 |
| --- | --- | --- |
| 已知资产物理渲染 | 已定义几何与材质，控制灯光和相机 | 建立可控的机制验证与合成监督基线 |
| 实拍重建后重渲染 | 采集真实场景，估计几何、材质和光传输 | 增加真实内容覆盖，输出带置信度的模型参考 |
| 三维条件加生成模型 | 用几何、法线或粗渲染约束生成 | 扩展困难场景、产生候选与偏好监督 |
{{< /codex-table >}}

对首轮实验，建议同时保留一组已知资产和一组实拍重建资产。这样能分辨失败来自灯光或成像配方，还是来自重建误差。全部从未知真实照片开始，容易把几何、材质、照明与相机的问题混在一起。

### 重打光配对怎样构造

固定场景几何、材质、人物姿态、相机与处理流程，仅替换照明：

$$
I_{\mathrm{in}}=\mathcal{C}_{\psi}(\mathcal{R}(G,M,L_a,P,t)),\qquad
I_{\mathrm{target}}=\mathcal{C}_{\psi}(\mathcal{R}(G,M,L_b,P,t)).
$$

这样的配方能保证两个渲染分支使用同一场景坐标与视点。目标照明 $L_b$ 也应作为条件或标签保存；若任务是“更好看”，则允许多个目标，并用偏好标注表达选择。

{{< mermaid >}}
flowchart TD
  A[真实多视图采集或已知资产] --> B[几何 材质与光传输]
  B --> C[冻结身份 姿态 相机与场景版本]
  C --> D[输入照明 La]
  C --> E[目标照明 Lb]
  D --> F[线性渲染输入]
  E --> G[线性渲染目标]
  F --> H[任务指定的相机成像]
  G --> I[目标成像或线性参考]
  H --> J[图像对 条件图与生成记录]
  I --> J
  J --> K[配对 物理 内容与画质检查]
  K --> L[进入训练并在真实数据上验证]
{{< /mermaid >}}

例如，同一个静态人像在机位不变时，从硬顶光改为左前方柔光。应检查鼻影是否随灯移动、眼球高光是否合理、发丝轮廓是否保持、衣服与脸之间的反弹光是否自然。不能只检查脸部平均亮度增加了多少。

### 实拍输入和渲染目标不天然严格对齐

有两种容易混用的配对：

{{< codex-table label="渲染到渲染与实拍到渲染的区别" >}}
| 配对方式 | 能保证什么 | 仍需检查什么 |
| --- | --- | --- |
| 同模型渲染输入与目标 | 场景、机位和控制变量一致 | 资产是否接近真实，渲染是否有偏差 |
| 原始实拍输入与重建后的目标 | 使用相同或估计对应的相机 | 重投影、畸变、轮廓、纹理及人物微动 |
{{< /codex-table >}}

第二种更接近业务输入，但像素配对更脆弱。即使重建图看起来相似，嘴角、发丝、文字边缘偏了几个像素，也会污染恢复监督。可先渲染原照明，检查它与实拍的局部残差，再决定是否采用像素损失、区域 mask 或更宽松的监督形式。

### RAW 数据需要完整的成像定义

线性 EXR 可以保存 HDR 渲染值，但 **EXR 不是某台相机的 RAW**。若目标模型接收 Bayer RAW，还需定义镜头模糊、相机 RGB 或光谱响应、CFA 采样、光子与读出噪声、增益、黑电平、饱和和量化。若最终输入是 JPEG，还要经过规定的 ISP 与编码。

{{< mermaid >}}
flowchart TD
  A[场景与光传输] --> B[镜头 孔径 时间和像素积分]
  B --> C[期望传感器信号]
  C --> D[光子噪声 读出噪声与设备效应]
  D --> E[增益 黑电平 饱和 量化]
  E --> F[模拟 RAW]
  F --> G[去马赛克 白平衡 色彩与色调处理]
  G --> H[输出 RGB 或 JPEG]
{{< /mermaid >}}

这是生产环节的示意，具体噪声项和增益顺序按目标设备标定。即使是物理渲染器，也不一定默认模拟传感器噪声、CFA 或滚动快门；PBRT 就明确列出了其简化范围。Unprocessing 则说明，合成 RAW 去噪数据除了噪声，还要考虑处理链对信号的改变。[PBRT 传感器模型](https://pbr-book.org/4ed/Cameras_and_Film/Film_and_Imaging)、[Unprocessing](https://arxiv.org/abs/1811.11127)

低照数据尤其要区别“减灯光”“缩短曝光”和“提高增益”。它们可能得到相近的输出亮度，却有不同的阴影、运动模糊与信噪比。把最终 sRGB 乘暗后加固定高斯噪声，只能代表一种简单的图像退化。

### 输出哪些附加标签

除了输入与目标图，可按任务保存深度、法线、材质参数、直接光与间接光分量、对象 mask、可见性、运动向量和目标光源参数。它们可以用于辅助监督与失败定位，但**重建估计出的法线与材质，仍然是估计值**。

阴影面积会随着照明改变，透明物体和发丝又可能具有连续覆盖；这类 mask 不宜全部压成一个粗糙的二值前景。光流也应区分几何对应与真实像素外观变化，照明改变后亮度一致性未必成立。

<details>
<summary>展开看一份数据配方记录示例</summary>

以下字段是工程示例。实际项目应以不可变的文件哈希与配置记录替换示例 ID，并把输入、目标和附加标签绑定到同一配方。

```yaml
task: portrait_relighting
source_origin: real_multiview_capture
reference_origin: reconstructed_scene_render
pairing: render_to_render
scene_version: portrait_scene_001_v1
capture_session: capture_001
subject_id: subject_001
split: train

fixed:
  geometry_version: geometry_v1
  material_version: material_v1
  pose_id: pose_001
  camera_id: camera_003
  time_state: static
  exposure_and_isp: fixed_profile_v1

changed:
  illumination_input: hard_top_light_v1
  illumination_target: soft_front_left_v1

outputs:
  input: input.exr
  target: target.exr
  preview_transform: display_transform_v1
  auxiliary: [depth, normal, foreground_coverage]

provenance:
  reconstruction_config: reconstruction_config_hash
  renderer_config: renderer_config_hash
  lighting_assets: lighting_asset_hashes
  camera_profile: camera_profile_hash
  sampling_seed: 173
  review_status: pending
```

重建版本、资产来源、坐标系、尺度、颜色空间、曝光单位、采样数、降噪设置与软件版本都应有记录。图像名里的 `target` 只表示训练角色，不表明它是实测真值。

</details>

### 参考可信度按来源保留

{{< codex-table label="三维数据中的参考来源" >}}
| 来源 | 可以怎样使用 | 不能自动推导的结论 |
| --- | --- | --- |
| 已知合成场景 | 在指定渲染模型下构建配对参考 | 与真实相机像素完全一致 |
| 实拍场景重建后渲染 | 模型预测参考，可结合置信度训练 | 恢复了真实世界唯一的材质与照明 |
| 生成式重打光结果 | 伪参考、偏好或受限条件监督 | 所有细节忠实于原场景 |
| 受控实拍配对 | 在标定与配准精度范围内检验真实变化 | 人物绝对静止或传感器没有噪声 |
{{< /codex-table >}}

高采样渲染通常比低采样更接近设定的渲染积分，但仍可能存在采样残差。渲染器降噪可能改变细节；如果训练目标是去噪或超分，应单独核查目标是否已经被平滑。更大的输出分辨率也不会自动增加输入重建中不存在的真实高频信息。

## 9 怎样评估重建与合成数据

### 评估四个不同的问题

{{< codex-table label="重建到数据的四层评估" >}}
| 层面 | 主要检查 | 常见误判 |
| --- | --- | --- |
| 几何 | 深度、法线、表面误差、完整度和尺度 | 只看渲染图是否好看 |
| 新视角 | 留出机位的图像误差与感知质量 | 用参与优化的视角证明泛化 |
| 重打光 | 留出照明下的阴影、高光、颜色与参考一致性 | 只评价原照明重建误差 |
| 下游画质 | 真实测试集的任务指标、局部回归与盲评 | 仅看合成测试集进步 |
{{< /codex-table >}}

PSNR、SSIM 和感知距离需要可靠的参考与一致的处理域。重打光的输出应与目标照明参考比较，不能拿原图相似度替代任务完成度。对于人像，应单独看身份、皮肤纹理、眼镜、牙齿、发丝和衣服图案；对于视频，再看运动补偿后的稳定性与遮挡边界。

### 使用与问题匹配的数据集

{{< codex-table label="用于三维与重打光验证的公开资源" >}}
| 资源 | 可检验的内容 | 使用边界 |
| --- | --- | --- |
| [Mip-NeRF 360](https://jonbarron.info/mipnerf360/) | 复杂无界场景的新视角合成 | 不能直接代替换光 benchmark |
| [TensoIR 的合成数据](https://haian-jin.github.io/TensoIR/) | 几何、材质与新照明下的分解和渲染 | 合成材质覆盖与真实域不同 |
| [Stanford-ORB](https://stanfordorb.github.io/) | 真实物体的几何、新视角和新环境重打光 | 各参考量的测量或估计来源需分别看 |
| [OpenIllumination](https://oppo-us-research.github.io/OpenIllumination/) | 多材质真实物体、多视图与多照明 | 受控采集和业务人像存在域差异 |
| [RawNeRF 数据](https://bmild.github.io/rawnerf/) | RAW、多视图低照与 HDR 场景 | 不能代表所有传感器噪声与 ISP |
{{< /codex-table >}}

Stanford-ORB 把新视角、换环境光和几何评价分别设置；OpenIllumination 提供真实多光照对象。这类设计能检验“在原来的照片上拟合得很好，换光却出错”的情况，而非只验证模型记住了原照明。[Stanford-ORB 评测设计](https://stanfordorb.github.io/)、[OpenIllumination](https://oppo-us-research.github.io/OpenIllumination/)

### 防止场景泄漏和指标自证

建议采用三种独立的划分轴：

1. **场景或身份留出**：同一个人物的不同相机、灯光和衣服变体按实验目标分组管理；不能随机按帧切分后宣称泛化到新身份。
2. **照明留出**：保留未用于恢复或调参的灯光，检查真正的换光能力。
3. **设备留出**：评估新的相机、传感器或 ISP，判断成像模拟是否过拟合。

所有比较应预先固定曝光归一化、裁剪区域和颜色变换。某些论文允许 albedo 尺度对齐，这适合其研究协议；实际数据工厂若要声称绝对亮度可控，就不能靠每张测试图单独调颜色来掩盖误差。

## 10 面向影像画质的首轮实验

### 先用静态物体验证机制

第一阶段建议使用可固定的漫反射物体，再加入金属、玻璃、织物与毛发等困难材质。它们便于重复采集和换灯，有助于定位系统性错误。人像随后加入，重点检查微表情、皮肤和头发；需要严格多视图对应时，优先考虑同步采集。

最小验证闭环可以这样组织：

{{< codex-table label="首轮重建重打光验证步骤" >}}
| 步骤 | 具体工作 | 通过条件 |
| --- | --- | --- |
| 采集 | 固定主体，获取多视角、原始曝光与独立换光参考 | 图像清晰、标定可用、参考条件可追溯 |
| 几何基线 | 相机恢复与表面重建 | 留出视角的轮廓与深度合理 |
| 外观基线 | 训练普通 3DGS 或 Splatfacto | 原照明下的未见视角达到预定要求 |
| 可重打光基线 | TensoIR、GS-IR 或合适的材质分解流程 | 已知目标灯光下优于简单曝光调整 |
| 物理资产对照 | 使用已知材质资产跑相同灯光配方 | 确认配方、坐标系和颜色链无系统错误 |
| 数据试产 | 冻结场景，生成少量受控图像对 | 配对、细节、阴影与来源检查通过 |
| 下游训练 | 加入候选数据并做消融 | 独立真实测试上出现可重复收益 |
{{< /codex-table >}}

若重打光参考在这一步就出现明显轮廓漂移、双重阴影或反射错误，应先改善采集和分解。扩大生成数量只会放大同一类误差。

### 用消融回答三维数据是否值得

以下是实验设计，尚不是测量结果。各组应控制训练预算，并报告独立场景数、图像数量、合成比例与质量通过率。

{{< codex-table label="下游训练数据的建议对照组" >}}
| 组别 | 数据设置 | 回答的问题 |
| --- | --- | --- |
| A | 现有真实训练数据 | 当前基线是多少 |
| B | A 加二维增强或退化 | 收益是否来自普通数据扩增 |
| C | A 加已知资产物理渲染 | 精确控制条件是否有帮助 |
| D | A 加实拍重建重渲染 | 真实内容覆盖是否进一步改善 |
| E | D 加生成式候选并筛选 | 额外多样性是否抵消内容漂移风险 |
{{< /codex-table >}}

不同任务可以调整组别。重打光重点看目标照明和内容保持；去噪看真实噪声下的纹理与伪色；虚化看细边缘和前后遮挡；超分看真实细节与幻觉；视频看时序和运动边界。收益应按场景或人物汇总，避免把同一场景的大量近似帧当作独立样本夸大显著性。

同时记录合格样本成本：

$$
\text{合格样本成本}=\frac{\text{采集与资产成本}+\text{重建成本}+\text{渲染与筛选成本}}{\text{通过检查且符合任务要求的样本数}}.
$$

这比单独比较渲染 FPS 更贴近实际价值。还应报告独立资产数量与困难条件覆盖，避免把同一人物的一万次灯光旋转当作一万个不同人物。

## 11 工具选择与实施顺序

{{< codex-table label="三维画质数据流程的工具分工" >}}
| 环节 | 可考虑的工具或方法 | 交付物 |
| --- | --- | --- |
| 相机与经典几何 | [COLMAP](https://colmap.github.io/tutorial.html) | 相机、点云与表面 |
| 前馈几何初始化 | [VGGT](https://vgg-t.github.io/)、[Depth Anything 3](https://depth-anything-3.github.io/) | 相机、深度或点图初值 |
| Gaussian 基线 | [Nerfstudio Splatfacto](https://docs.nerf.studio/nerfology/methods/splat.html) | 可查看、渲染与导出的场景 |
| 自定义高斯算子 | [gsplat](https://docs.gsplat.studio/main/) | 可微光栅化与批量渲染能力 |
| 材质与光照分解 | TensoIR、GS-IR、NVDiffRecMC 等 | 带假设与适用范围的可重打光资产 |
| 物理渲染与相机研究 | [Mitsuba 3](https://www.mitsuba-renderer.org/)、[PBRT](https://pbr-book.org/4ed/Cameras_and_Film/Film_and_Imaging)；资产制作可结合 Blender | 线性渲染、分量与成像参考 |
| 数据管理与评测 | 场景版本、配方、质量检查、真实域消融 | 可追溯的数据集发布物 |
{{< /codex-table >}}

Splatfacto 是 Nerfstudio 的 Gaussian 实现，gsplat 是底层可微渲染库。它们可以承担基础设施，但是否支持某种灯光、物理材质或相机效应，要看接入的具体方法。导出一个 `.ply` 文件，也不等于已经交付完整的可重打光资产。[Splatfacto 文档](https://docs.nerf.studio/nerfology/methods/splat.html)、[gsplat 文档](https://docs.gsplat.studio/main/)

实施上建议先验证 **静态场景的几何与换光**，再补充 **RAW／ISP 或景深模型**，最后扩展到 **人像与动态视频**。每增加一个自由度，都保留能定位误差的简单对照场景。代码、权重、源图和资产各自的使用条件也应随版本记录，便于数据集后续复现和使用。

平台上的采集、生成、审核和训练反馈，可衔接[影像画质 Auto GT 生成方案与数据平台设计]({{< relref "/posts/data-flywheel/image-quality-auto-gt/index.md" >}})；批量候选筛选与真实域验证，可接着看[Cosmos Data Factory 调研与 AutoGT 数据筛选设计]({{< relref "/posts/data-flywheel/cosmos-data-factory/index.md" >}})。

## 12 按研究目标继续阅读

<details>
<summary>几何与新视角合成</summary>

- [COLMAP](https://colmap.github.io/tutorial.html)：理解相机恢复、稀疏重建与 MVS 的关系。
- [NeRF](https://arxiv.org/abs/2003.08934) → [Instant-NGP](https://nvlabs.github.io/instant-ngp/) → [Zip-NeRF](https://jonbarron.info/zipnerf/)：连续场、加速与采样。
- [NeuS](https://lingjie0206.github.io/papers/NeuS/index.htm) → [2DGS](https://surfsplatting.github.io/)：把表面质量作为独立目标。
- [3DGS](https://arxiv.org/html/2308.04079v1) → [Mip-Splatting](https://niujinshuchong.github.io/mip-splatting/)：显式表示、光栅化与多尺度伪影。
- [DUSt3R](https://arxiv.org/abs/2312.14132) → [VGGT](https://vgg-t.github.io/) → [VGG-T³](https://research.nvidia.com/labs/dvl/projects/vgg-ttt/)：从图像对几何走向多图聚合。

</details>

<details>
<summary>可重打光资产与光传输</summary>

- [NeRFactor](https://arxiv.org/abs/2106.01970)、[TensoIR](https://haian-jin.github.io/TensoIR/)：理解分解变量与可辨识性。
- [NVDiffRecMC](https://nvlabs.github.io/nvdiffrecmc/)：理解光传输近似怎样影响材质分解。
- [GS-IR](https://lzhnb.github.io/project-pages/gs-ir.html)、[Relightable 3D Gaussians](https://arxiv.org/abs/2311.16043)：Gaussian 逆渲染基础。
- [GS³](https://gsrelight.github.io/)、[BiGS](https://desmondlzy.github.io/publications/bigs/)、[BecomingLit](https://jonathsch.github.io/becominglit/)：理解多光照采集带来的信息。
- [RadioGS](https://arxiv.org/abs/2603.01491)、[GHPT](https://nwu-vislab.github.io/GHPT/)：进一步研究间接光与混合表示。

</details>

<details>
<summary>影像画质数据生产与验证</summary>

- [Lumos](https://research.nvidia.com/labs/cosmos-lab/lumos/)、[SynthLight](https://vrroom.github.io/synthlight/)：物理渲染人像数据用于重打光训练。
- [RawNeRF](https://bmild.github.io/rawnerf/)、[Unprocessing](https://arxiv.org/abs/1811.11127)：理解线性信号与相机处理链。
- [IllumiNeRF](https://illuminerf.github.io/)：生成先验与三维一致性的组合。
- [Stanford-ORB](https://stanfordorb.github.io/)、[OpenIllumination](https://oppo-us-research.github.io/OpenIllumination/)：用独立真实照明检验换光能力。
- [PBRT 成像](https://pbr-book.org/4ed/Cameras_and_Film/Film_and_Imaging)：把镜头、时间积分与传感器响应纳入模型。

</details>

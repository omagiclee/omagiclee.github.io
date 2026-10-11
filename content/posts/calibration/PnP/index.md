+++
date = '2022-10-01T14:05:14+08:00'
draft = false
title = 'PnP 与外参标定：从数学原理到 EOL 工程实践'
categories = ['Calibration']
tags = ['Calibration', 'EOL', 'PnP']
featured = false
math = true
+++

## 一句话理解外参标定

外参标定要解决的问题极其明确：**求相机坐标系到车体坐标系（或世界坐标系）的刚体变换 \$(R, t)\$**。

刚体变换意味着只有旋转和平移、没有形变，6 个自由度（3 旋转 + 3 平移）。一旦拿到这组参数，就能把任意一个世界坐标系下的 3D 点投影到图像像素，或者反过来从像素方向推算出射线在世界中的朝向。

## 相机投影模型

PnP 的前置知识是相机投影模型——理解一个 3D 点如何经过针孔投影、归一化、像素化，最终变成图像上的 \$(u, v)\$。完整推导见 [相机投影模型：从针孔到像素]({{< ref "/posts/calibration/camera-projection-model" >}})。

这里只列最终结论。世界点 \$\mathbf{P}_w\$ 到像素的完整投影方程：

$$
Z_c \begin{pmatrix} u \\\\ v \\\\ 1 \end{pmatrix}
= K \begin{pmatrix} R & t \end{pmatrix} \begin{pmatrix} X_w \\\\ Y_w \\\\ Z_w \\\\ 1 \end{pmatrix}
$$

其中 \$Z_c\$ 是该点在相机坐标系下的深度（齐次因子），内参矩阵 \$K = \begin{pmatrix} f_x & 0 & c_x \\\\ 0 & f_y & c_y \\\\ 0 & 0 & 1 \end{pmatrix}\$，外参 \$(R, t)\$ 描述世界坐标系到相机坐标系的刚体变换。**内参管"相机怎么看"，外参管"相机在哪看"**。

在 EOL 场景中，**内参 \$K\$ 和畸变参数通常由供应商在实验室阶段标定完成**，产线上视为已知量。外参标定要解的，就是 \$R\$ 和 \$t\$。

## PnP 问题的数学定义

### 问题设定

回到上面的投影方程，把已知量和未知量标清楚：

$$
Z_c \begin{pmatrix} u \\\\ v \\\\ 1 \end{pmatrix}
= \underset{\text{已知}}{K} \Big( \underset{\text{未知}}{R} \; \underset{\text{已知}}{\mathbf{P}_w} + \underset{\text{未知}}{t} \Big)
$$

- **已知**：内参 \$K\$（供应商提供）、\$n\$ 组 3D-2D 对应——世界坐标 \$\mathbf{P}_i\$ 和像素坐标 \$(u_i, v_i)\$，\$i = 1, 2, \dots, n\$
- **未知**：外参 \$R\$ 和 \$t\$

这就是 **Perspective-n-Point（PnP）** 问题：给定 \$n\$ 组 3D-2D 点对和已知内参，求相机外参。

### 从投影方程到核心约束

对第 \$i\$ 个点，投影方程展开为：

$$
Z_{c,i} \begin{pmatrix} u_i \\\\ v_i \\\\ 1 \end{pmatrix}
= K (R \mathbf{P}_i + t)
$$

两边同时左乘 \$K^{-1}\$，消掉内参：

$$
Z_{c,i} \begin{pmatrix} x_i \\\\ y_i \\\\ 1 \end{pmatrix}
= R \mathbf{P}_i + t
\quad \text{其中} \quad
\begin{pmatrix} x_i \\\\ y_i \\\\ 1 \end{pmatrix}
= K^{-1} \begin{pmatrix} u_i \\\\ v_i \\\\ 1 \end{pmatrix}
$$

令归一化坐标为 \$(x_i, y_i, 1)^T = K^{-1}(u_i, v_i, 1)^T\$，深度记为 \$\lambda_i = Z_{c,i}\$，得到 PnP 的核心约束：

$$
\lambda_i \begin{pmatrix} x_i \\\\ y_i \\\\ 1 \end{pmatrix}
= R \mathbf{P}_i + t, \quad \lambda_i > 0
$$

\$\lambda_i > 0\$ 保证点在相机前方。

### 自由度分析

这个约束是三维向量等式，但 \$\lambda_i\$ 是额外未知数，消去它后每个点只提供 **2 个独立方程**。外参共 6 个未知数（3 旋转 + 3 平移），因此 **最少需要 3 个不共线的点**（即 P3P）。实际工程中用更多的点，通过最小二乘获得鲁棒估计。

## 经典 PnP 求解方法

### DLT（Direct Linear Transform）

最直接的方法。对每个点对 \$(\mathbf{P}_i, (u_i, v_i))\$，消去齐次因子后可以写出两个线性方程。\$n\$ 个点叠在一起，得到 \$2n \times 12\$ 的线性系统：

$$
A \mathbf{p} = 0
$$

其中 \$\mathbf{p}\$ 是投影矩阵 \$M = K[R|t]\$ 展平后的 12 维向量。通过 SVD 分解 \$A\$，取最小奇异值对应的右奇异向量即为解。

DLT 的缺点是 **没有强制 \$R\$ 的正交约束**，解出来的旋转部分需要额外做一次 SVD 投影到 \$SO(3)\$。

### P3P

P3P 只用 3 个点，利用三角形几何关系（余弦定理）列出三个四次方程，通过代数消元求解。最多有 4 组解，需要第 4 个点来消歧义。

P3P 常配合 RANSAC 使用：从 \$n\$ 个点中随机抽 3 个点求解，再用全部点验证，迭代多次去除外点。

### EPnP（Efficient PnP）

EPnP 是目前工程中最常用的方法之一（OpenCV 中 `cv::SOLVEPNP_EPNP`）。核心思想：

1. **选取 4 个控制点**（通常取 3D 点的质心 + PCA 三个方向），将所有 3D 点表示为这 4 个控制点的重心坐标（barycentric coordinates）
2. 问题转化为：**求 4 个控制点在相机坐标系下的坐标**，只有 12 个未知数
3. 构建线性系统，取 SVD 的零空间，再通过距离约束（控制点间距不变）求解线性组合系数

EPnP 的计算复杂度是 \$O(n)\$，且对大量点非常稳定。

### 迭代优化（Levenberg-Marquardt）

上述方法得到的初始解，通常还会送入非线性优化器做精化。定义 **重投影误差**：

$$
E(R, t) = \sum_{i=1}^{n} \left\| \pi(R \mathbf{P}_i + t) - \begin{pmatrix} u_i \\\\ v_i \end{pmatrix} \right\|^2
$$

其中 \$\pi(\cdot)\$ 是相机投影函数（pinhole 下就是除以 \$Z\$ 再乘内参）。

用 Levenberg-Marquardt（LM）算法，对旋转的参数化（通常用 Rodrigues 向量或四元数）做迭代梯度下降，最小化上式。这就是 OpenCV 中 `cv::SOLVEPNP_ITERATIVE` 的做法——先用 DLT 初始化，再用 LM 精化。

> OpenCV 的 `solvePnP` 默认就是 `SOLVEPNP_ITERATIVE`，内部先 DLT 再 LM。如果对初始值有信心，也可以直接给 `useExtrinsicGuess=True` 跳过 DLT，从指定初始值开始迭代。

## 重投影误差：标定精度的核心度量

重投影误差的物理含义非常直观：**用当前估计的外参把 3D 点投影回图像，看投影落点和实际检测到的 2D 点差多远**。

$$
e_i = \left\| \pi(K, R, t, \mathbf{P}_i) - (u_i, v_i)^T \right\|_2
$$

在 EOL 产线上，典型的验收指标是 **平均重投影误差 < 0.5–1.0 pixel**（取决于相机分辨率和 FOV）。

重投影误差同时也是 PnP 非线性优化的目标函数。最小化它，本质上是在 \$SE(3)\$ 流形上做最大似然估计（假设像素检测噪声为各向同性高斯分布）。

## EOL 外参标定的完整流程

把上述数学放到 EOL（End-of-Line）产线场景中，流程如下：

### Step 1：建立世界坐标系与 3D 点获取

产线上使用高精度测量设备（全站仪、激光跟踪仪等）预先标定出 **标定板上每个特征点在全局坐标系下的 3D 坐标** \$\mathbf{P}_1^{w}, \mathbf{P}_2^{w}, \dots\$。全局坐标系可以是车间坐标系，也可以是车位坐标系。

### Step 2：坐标系链传递

EOL 标定不是直接求"相机到全局"的变换，而是要求 **"相机到车体"** 的变换。坐标系链为：

$$
T_{cam}^{body} = T_{global}^{body} \cdot T_{cam}^{global}
$$

其中：

- \$T_{cam}^{global}\$：相机到全局坐标系的变换，由 PnP 直接求出
- \$T_{global}^{body}\$：全局到车体坐标系的变换，由 **四轮定位仪** 提供（四轮定位仪测出车辆在工位上的精确位姿）

这条坐标系链是 EOL 标定的关键设计——它解耦了车辆停放误差，使得每次标定不要求车辆停在完全相同的位置。

### Step 3：图像采集与 2D 特征提取

相机拍摄标定板图像，算法检测特征点（棋盘格角点、圆形网格中心、ArUco 标记角点等），得到 \$(u_i, v_i)\$。

对于棋盘格，OpenCV 的 `findChessboardCorners` + `cornerSubPix` 可以达到亚像素精度。对于 ArUco，则用 `detectMarkers` 检测角点。

### Step 4：PnP 求解

将已知的 3D 点（转换到合适的坐标系后）和提取的 2D 点送入 PnP 求解器：

```python
import cv2
import numpy as np

success, rvec, tvec = cv2.solvePnP(
    objectPoints=points_3d,   # (n, 3) 世界坐标系下的 3D 点
    imagePoints=points_2d,    # (n, 2) 像素坐标
    cameraMatrix=K,           # 内参矩阵
    distCoeffs=dist_coeffs,   # 畸变参数
    flags=cv2.SOLVEPNP_EPNP  # 或 SOLVEPNP_ITERATIVE
)

R, _ = cv2.Rodrigues(rvec)   # Rodrigues 向量 -> 旋转矩阵
```

如果存在外点（误检测的特征点），则用 `solvePnPRansac`：

```python
success, rvec, tvec, inliers = cv2.solvePnPRansac(
    objectPoints=points_3d,
    imagePoints=points_2d,
    cameraMatrix=K,
    distCoeffs=dist_coeffs,
    reprojectionError=2.0,    # RANSAC 内点阈值（像素）
    iterationsCount=1000,
    flags=cv2.SOLVEPNP_EPNP
)
```

### Step 5：精化与验证

PnP 得到的初始解，通常再用 `solvePnPRefineLM` 做一轮 LM 精化。最终计算所有点的重投影误差：

```python
projected, _ = cv2.projectPoints(points_3d, rvec, tvec, K, dist_coeffs)
errors = np.linalg.norm(projected.squeeze() - points_2d, axis=1)
mean_error = errors.mean()
```

如果 `mean_error` 超过阈值，则判定标定失败，触发产线报警或重新标定。

### Step 6：坐标系合成与写入

将 PnP 求得的 \$T_{cam}^{global}\$ 与四轮定位提供的 \$T_{global}^{body}\$ 合成，得到最终的 \$T_{cam}^{body}\$，写入车辆 ECU。

## 为什么 PnP 而不是 Homography

EOL 标定中有时也会用到 Homography（单应矩阵），尤其是 AVM 环视场景。两者的适用条件不同：

| 方法 | 适用条件 | 自由度 |
|------|---------|--------|
| **PnP** | 3D 点分布在三维空间中 | 求解 \$R, t\$（6 DoF） |
| **Homography** | 所有点共面（如地面标定板） | 求解 3×3 矩阵（8 DoF） |

当标定板是一块平面地垫时，3D 点的 \$Z=0\$，投影方程退化为：

$$
s \begin{pmatrix} u \\\\ v \\\\ 1 \end{pmatrix}
= K \begin{pmatrix} r_1 & r_2 & t \end{pmatrix} \begin{pmatrix} X \\\\ Y \\\\ 1 \end{pmatrix}
= H \begin{pmatrix} X \\\\ Y \\\\ 1 \end{pmatrix}
$$

此时 PnP 和 Homography 在数学上是等价的。但如果标定板有高度变化（如立体标靶），或者 3D 点来自不同平面，就必须用 PnP。

对于 AVM 环视的 EOL 标定，地垫方案本质上就是在用 Homography——每颗相机对地面的映射是一个单应矩阵，BEV 拼接就是把四路 Homography 对齐到同一个地面坐标系。

## PnP 求解的数值稳定性

工程中影响 PnP 精度的几个关键因素：

**1. 点的数量与分布**

点越多、分布越均匀，解越稳定。如果所有点都集中在图像的一个角落，\$R\$ 中某些旋转分量的可观性（observability）会很差。一般建议特征点覆盖图像面积的 60% 以上。

**2. 点的共面性**

当所有 3D 点近似共面时，DLT 的线性系统会接近秩亏，解不稳定。EPnP 和 P3P 对此有更好的鲁棒性，但最好的做法是使用非共面的 3D 点（或者在共面情况下直接用 Homography 分解）。

**3. 噪声与外点**

像素检测噪声直接传播到外参误差。角点检测的亚像素精度（通常 0.1–0.3 pixel）是标定精度的上限。外点（误匹配、遮挡导致的误检测）必须用 RANSAC 剔除。

**4. 内参精度**

PnP 假设内参已知且精确。如果内参本身有偏差（尤其是畸变参数不准），重投影误差会有系统偏移，外参解会吸收这个偏差。这就是为什么供应商端的内参标定质量直接决定了 EOL 外参标定的天花板。

## 多相机 EOL 标定的工程考量

### 环视（AVM）

四路鱼眼相机分别标定外参后，需要在重叠区域检查一致性。如果两颗相机对同一个地面点的 BEV 投影位置差异超过阈值，说明至少有一颗相机的外参有问题。这个交叉验证是 AVM EOL 标定的标准 pass/fail 判据之一。

### 多焦前视

如果 120° 广角和 30° 长焦共用一个 housing，更合理的做法是：

1. 供应商端标定两个通道的 **相对位姿**（channel-to-channel）
2. EOL 只标定 housing 到车体的外参（用广角通道，因为视场大、特征点多、可观性好）
3. 长焦通道的外参通过坐标链传递：\$T_{tele}^{body} = T_{housing}^{body} \cdot T_{tele}^{housing}\$

这样做的好处是：窄视场相机（30°）在产线上很难直接标定（标定板只能覆盖图像很小的区域，可观性差），通过坐标链间接获得外参反而更准、更快。

## 小结

PnP 是外参标定的数学核心，整个过程可以浓缩为：

1. **输入**：\$n\$ 组 3D-2D 点对 + 已知内参
2. **求解**：最小化重投影误差，得到 \$(R, t)\$
3. **输出**：相机到目标坐标系的刚体变换

EOL 标定在此基础上加了两层工程包装：一是通过四轮定位引入车体坐标系，完成坐标系链传递；二是通过产线节拍、pass/fail 判据、多相机交叉验证等保证量产一致性。底层的数学，始终是 PnP。

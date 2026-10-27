+++
date = '2026-10-23T00:00:00+08:00'
lastmod = '2026-10-23T00:00:00+08:00'
draft = false
isCJKLanguage = true
contentLanguage = 'zh-CN'
title = '可控生成与编辑调研 FLUX.3 与 MOSS-Image'
description = '从 FLUX.3 Image Klein 的多参考编辑与 MOSS-Image 的文字布局控制出发，比较模型能力、坐标接口和 ComfyUI 工作流，并建立兼顾指令遵循、内容保持与影像画质的评估方法。'
summary = '可控生成开始把参考图、布局框和精确文字纳入输入。本文核对 FLUX.3 Image Klein 与 MOSS-Image 的公开能力，解释布局约束和像素保持的区别，并给出连接 Qwen、ComfyUI 与影像画质评测的实验方案。'
categories = ['AIGC']
tags = ['图像编辑', 'FLUX', 'MOSS-Image', '影像画质']
math = false
+++

给一张人像换背景，人物的发丝和衣服纹理能否保留？把三张参考图中的商品放到同一张海报里，能否指定位置，并正确写出中文标题？这些问题把图像生成的要求，从“画面合理”推进到“修改可指定、结果可核验”。

2026 年 10 月 23 日的 [Hugging Face 模型趋势页](https://huggingface.co/models?sort=trending)同时出现了 **FLUX.3 Image Klein、MOSS-Image Base / SFT 及其 ComfyUI 权重包**。趋势是关注度的入口，模型是否适用，还要看它接受什么条件、保持什么内容，以及输出经过了哪些处理。

**FLUX.3 Image Klein 更值得沿着参考图编辑深入；MOSS-Image 更值得沿着文字与版式生成深入。对于影像画质，两条路线都需要把任务完成度、内容保真和视觉质量分开评估。** 本文是截至 **2026-10-23** 的公开资料调研；下文的小规模实验是待执行方案，未给出自测画质排名。

<!--more-->

## 1 可控生成到底控制什么

“可控”可以发生在不同层次。一个模型擅长构图，不代表它能保持输入照片；能保持人物身份，也不代表皮肤微纹理逐像素不变。

{{< codex-table label="可控生成的控制目标" >}}
| 控制层次 | 典型要求 | 应检查的结果 |
| --- | --- | --- |
| 语义 | 将红杯子改成蓝杯子 | 对象和属性是否正确 |
| 参考内容 | 图一的人拿着图二的商品 | 人物、商品是否混淆或变形 |
| 空间布局 | 标题在上方，商品在右下角 | 元素是否出现，位置和尺度是否符合要求 |
| 图中文字 | 写出“自然光影”，保留指定换行 | 字符、顺序、标点和排版是否正确 |
| 编辑范围 | 只改背景，保留主体 | 主体纹理和区域边界是否被连带修改 |
| 成像属性 | 柔化脸部阴影，保留自然肤色 | 光影、色彩、纹理、噪声和高光是否协调 |
{{< /codex-table >}}

最后两项尤其接近画质工作：用户希望改动一个属性，同时维持大量未明说的属性。编辑系统因此需要一份明确的**变化约定**：允许什么变化、哪些区域必须保留、哪些内容可以重新生成。

下面是理解这些系统的功能视图，框内表示职责，并不意味着每个模型都有独立的对应模块。

{{< mermaid >}}
flowchart TB
    accTitle: 可控生成与编辑的条件和验收
    accDescr: 用户意图经过提示词与布局准备，结合可用的参考图生成候选，最终分别检查任务完成、内容保持和影像画质。
    U["用户意图<br/>改什么 · 保留什么"] --> P["条件准备<br/>完整描述 · 精确文字 · 布局"]
    R["参考图片<br/>仅支持图像输入的模型"] --> G["图像生成或编辑"]
    P --> G
    G --> O["候选图像"]
    O --> T["任务完成<br/>对象 · 位置 · 文字"]
    O --> F["内容保持<br/>几何 · 材质<br/>保护区域"]
    O --> Q["影像画质<br/>肤色 · 纹理<br/>边缘 · 光影"]
{{< /mermaid >}}

## 2 两个新模型的能力边界

FLUX.3 Image Klein 于 **10 月 15 日**发布；MOSS-Image 的 Base 与 SFT 于 **10 月 16 日**公布。两者都提供可下载权重，但任务范围和许可不同。发布日期见 [BFL 发布说明](https://bfl.ai/blog/flux-3-image-klein)与 [OpenMOSS 发布记录](https://github.com/OpenMOSS/MOSS-Image#news)。

{{< codex-table label="FLUX.3 Image Klein 与 MOSS-Image 的公开能力" >}}
| 维度 | FLUX.3 Image Klein | MOSS-Image Base / SFT |
| --- | --- | --- |
| 生成主干规模 | 5.6B，另有文本编码器 | 5B，另有文本编码器 |
| 已发布的主要任务 | 文生图、单图编辑、多参考合成 | 文生图、文字渲染、布局引导生成 |
| 参考图 | 最多 10 张 | 当前基础发布以文字条件为主；不按通用参考图编辑模型计入对比 |
| 布局输入 | 场景描述加元素框；编辑可指定来源框与目标框 | JSON 场景、元素描述、文字和边界框 |
| 检查点 | Base 与步数蒸馏版 | Base 与精选数据监督微调的 SFT |
| 采样起点 | 蒸馏版 16 步，无 CFG；Base 50 步，有 CFG | 50 步、CFG 3、shift 5，含跳层引导设置 |
| 权重许可 | FLUX Kommunity License | Apache-2.0 |
{{< /codex-table >}}

能力与配置依据：[FLUX 模型卡](https://huggingface.co/black-forest-labs/flux-3-image-klein)、[MOSS Base 模型卡](https://huggingface.co/OpenMOSS-Team/MOSS-Image-Base)、[MOSS SFT 模型卡](https://huggingface.co/OpenMOSS-Team/MOSS-Image-SFT)。表中的参数量都不能直接当作整个推理管线的内存需求。

MOSS 文档中的“通过修改 layout 编辑内容”，指的是修改条件后重新生成。它与“输入一张照片，保持主体只改背景”的编辑接口需要区分。其用户指南把参考图生成列在后训练探索中；社区适配器、蒸馏和控制扩展，也应作为单独配置评估。[MOSS 用户指南](https://github.com/OpenMOSS/MOSS-Image/blob/main/USERGUIDE.md#post-training)

已有的 [Qwen-Image-Edit-2509 笔记]({{< relref "/posts/aigc/image-editing/qwen/qwen-image-edit-2509/index.md" >}})可以接到一条明确的编辑基线上：**Qwen-Image-Edit-2511**。该版官方强调减少图像漂移、人物一致性和光照增强，适合用于检查“新模型能否改善旧工作流中的实际失败”。这里将 2511 作为历史基线，不代表它是 Qwen 当前最新型号。[Qwen 2511 模型卡](https://huggingface.co/Qwen/Qwen-Image-Edit-2511)

## 3 FLUX.3 的参考图和提示词如何一起工作

### 3.1 参考图进入生成过程

FLUX.3 Image Klein 的生成过程使用文字、带噪目标图和可选参考图三类 token。参考图经 VAE 编码后参与模型计算；不同流先独立处理，再进入联合注意力。这解释了它如何在同一模型中结合参考内容与文字意图，也说明增加参考图会增加计算量。[Hugging Face 架构说明](https://huggingface.co/blog/flux-3#the-architecture)

工程上应把参考图分配成明确角色。例如，图一只提供人物外观，图二提供商品，图三提供色彩氛围。否则“参考这三张图”没有说明冲突如何解决：应该沿用哪一张的构图、光源或背景？

### 3.2 扩写器也是结果的一部分

BFL 推荐先将简短请求扩成完整场景描述。官方 Prompt Upsampler 是由 Qwen3.5-9B 微调的独立模型；它与生成器使用的 Qwen3-VL-4B-Instruct 文本编码器承担不同职责。扩写器负责组织描述，编码器负责把描述转换成生成条件。[Prompt Upsampler 模型卡](https://huggingface.co/black-forest-labs/flux-3-image-klein-pup)

对于“只把衣服改成蓝色”，完整描述应覆盖原本的人物、姿态、构图和环境，再嵌入颜色变化。扩写也可能引入多余细节，因此需要同时保存**用户原始指令和最终送入生成器的提示词**。这能区分两类失败：模型没有遵循条件，或条件本身已经偏离用户意图。

官方扩写器会缩放参考图，小字与细小物件存在描述错误的可能。画质实验可以先人工核对扩写结果，再评估生成器；端到端实验则保留自动扩写，将它的错误计入系统表现。[扩写器限制](https://huggingface.co/black-forest-labs/flux-3-image-klein-pup#limitations)

### 3.3 布局框不保证像素保持

Klein 模型卡明确指出：边界框引导位置与尺度，不是硬 mask；编辑可能改变目标区域之外的内容。BFL API 另提供 pixel restoration 来保持未编辑区域，不能把 API 的整体能力直接归因于本地权重。[Klein 限制](https://huggingface.co/black-forest-labs/flux-3-image-klein#limitations)、[BFL API 发布说明](https://bfl.ai/blog/flux-3-image-klein#get-started)

因此，“请保持其他内容不变”是一项待验证的要求。如果工作流另有遮罩合成或原图回填，必须分别查看原始生成结果和合成结果：回填可以提高保护区域的保持程度，也可能在发丝、半透明物体和光影过渡处形成接缝。

## 4 MOSS-Image 如何把文字和布局写进条件

### 4.1 从描述场景到描述版面

MOSS-Image 支持自然语言、标签序列和 JSON layout。布局通过文本条件进入生成器，可以写清标题、正文、物体以及各自的位置；SFT 延续 Base 的架构与推理接口。这让“中文标题放在画面上方，商品置于下半部”的任务有了更明确的表达方式。[MOSS 项目页](https://openmoss.ai/MOSS-Image/)

结构化条件带来的价值，是让错误更容易定位。标题消失，可以检查元素有没有进入输入；标题位置错，可以核对坐标；文字正确但版面拥挤，则应检查留白和字号层级。JSON 合法仅说明输入格式成立，排版是否成功仍要看输出。

### 4.2 同一只框的三种坐标表示

两个模型都使用 `yxyx` 顺序，但坐标空间不同。以下是一个**自行构造的格式示例**：1024 × 1024 画布中，标题框左上角为 `(128, 128)`，右下角为 `(896, 256)`。

{{< codex-table label="同一个标题框在不同接口中的坐标" >}}
| 接口位置 | 坐标规则 | 标题框 |
| --- | --- | --- |
| 普通像素标注 | 左上角原点，`[y1, x1, y2, x2]` | `[128, 128, 256, 896]` |
| FLUX 最终提示词 | 左上角原点，各轴归一化到 0–1000 | `[125, 125, 250, 875]` |
| FLUX 参考代码的 `boxes.json` | 左上角原点，各轴归一化到 0–1 | `[0.125, 0.125, 0.25, 0.875]` |
| MOSS layout | 画布中心原点，绝对像素坐标 | `[-384, -384, -256, 384]` |
{{< /codex-table >}}

接口依据：[FLUX 提示词边界框文档](https://docs.bfl.ai/flux_3/flux3_image_bounding_boxes#format)、[FLUX 参考代码的 boxes 输入](https://github.com/black-forest-labs/flux-3-image-klein#bounding-boxes)、[MOSS layout 格式](https://github.com/OpenMOSS/MOSS-Image/blob/main/USERGUIDE.md#layout-prompts-experimental)。**准备给扩写器的框，与最终拼入提示词的框，不能混用数值范围。**

MOSS 的转换方法是从 x 坐标减去画布宽度的一半，从 y 坐标减去高度的一半。更换输出尺寸时，要同步调整布局；不能把一个 1024 方图的绝对坐标直接套到竖版海报。

<details>
<summary>展开查看对应的 MOSS JSON 输入示例</summary>

下面的自拟示例沿用官方字段，目标是生成一张标题为“自然光影”的海报。它展示输入结构，不是已验证的出图结果；生成尺寸设置为 1024 × 1024。

```json
{
  "summary": {
    "meta": ["poster"],
    "canvas": "single",
    "caption": "A minimalist photography poster with a warm white background, a dark blue Chinese title at the top, and one blue ceramic cup below. Soft daylight from the left."
  },
  "items": [
    {
      "label": "text",
      "caption": "Large dark blue Chinese title, centered on one line.",
      "text": "自然光影",
      "bbox": [-384, -384, -256, 384]
    },
    {
      "label": "object",
      "caption": "One blue ceramic cup with a soft contact shadow.",
      "bbox": [-128, -192, 384, 192]
    }
  ],
  "bbox_format": "yxyx",
  "bbox_coord_space": "abs_centralized"
}
```

Python 中将对象用 `json.dumps(layout, ensure_ascii=False)` 序列化后作为 prompt。官方指南将 layout 标为实验性能力，不能将框坐标理解为排版引擎的严格几何保证。

</details>

### 4.3 文字分数需要看评分方法

MOSS 技术报告区分了基础生成器和带提示增强的完整系统。作者在 LongLongTextBench 上报告 **96.3 Mean-6**，其评分基于 OCR 与词／字符多重集合召回，再对六个语言与长度分组等权平均。它不是“96.3% 的海报完全没有错字”，也不直接验证字符顺序和设计可用性。[技术报告第 5 节](https://arxiv.org/html/2610.23374v1#S5)

对于实际海报，还应检查逐字准确、行序、标点、字号、对齐和留白。文章、菜单、包装说明等长文本任务尤其不能只看缩略图。若业务要求精确字体和零错字，可让模型生成底图，再用确定性的排版工具叠加文字，并把这种组合工作流单独记录。

## 5 从影像画质看编辑结果

### 5.1 将任务完成 内容保持和画质分开

“脸更亮了”可以是任务成功，同时伴随肤色偏移、皮肤蜡化或睫毛重绘。TIEdit 的评价框架也分别处理感知质量、编辑对齐和原图内容保持，说明一个笼统的偏好分无法完整表达编辑效果。[TIEdit 论文](https://arxiv.org/abs/2603.19775)

下面是面向摄影图像的审核建议。先在适屏尺寸检查整体，再查看原生分辨率的局部裁切，避免缩图掩盖问题。

{{< codex-table label="生成编辑的画质审核维度" >}}
| 维度 | 重点看哪里 | 应记录的失败 |
| --- | --- | --- |
| 曝光与动态范围 | 脸部暗侧、窗边、反光物体 | 提亮导致高光剪切，暗部被虚构纹理填满 |
| 色彩与肤色 | 脸与脖子、中性背景、产品颜色 | 肤色分区、白平衡漂移、颜色越界 |
| 纹理与噪声 | 皮肤、头发、织物、平滑墙面 | 蜡化、重复纹理、噪声不连续、条带 |
| 边缘与透明度 | 发丝、眼镜、纱、物体轮廓 | 光晕、重影、锯齿、前后景粘连 |
| 光照与空间 | 接触阴影、镜面高光、焦内外关系 | 阴影方向矛盾、悬浮、虚化跨越主体 |
| 内容保真 | 五官轮廓、衣服图案、商品标识 | 形状改变、漏字、材质或商品细节被替换 |
{{< /codex-table >}}

这里最容易误判的是**把更强的高频当成更多真实细节**。一根被重新生成的发丝可能很锐利，但未必与原图对应。图像恢复中的 perception–distortion 研究讨论了感知真实性与参考失真的权衡；在编辑实验中，也应分别测“看起来是否自然”和“要求保留的内容是否忠实”。[Perception–Distortion 原论文](https://arxiv.org/abs/1711.06077)

### 5.2 指标必须和可变化区域配套

{{< codex-table label="不同评估问题对应的指标与限制" >}}
| 要回答的问题 | 可采用的方法 | 解释边界 |
| 文字是否正确 | OCR、字符错误率 CER、整段完全匹配率 | OCR 也会漏识；保留顺序和标点，人工核查小字 |
| 布局是否符合要求 | 元素检出率、匹配后 IoU、中心偏差 | 漏掉的元素必须计为失败，不能只算检测成功者 |
| 保护区域是否改变 | 对齐后的像素差、SSIM、局部 LPIPS | 仅用于明确要求保持且具有对应关系的区域 |
| 编辑区域是否自然 | 隐去模型名的 A/B 评审、局部缺陷标注 | 允许平局和两者都差，避免强迫选出赢家 |
| 多次编辑是否累积劣化 | 每轮与原图、上一轮分别比较 | 按轮次记录漂移，不能只挑最终一张好图 |
{{< /codex-table >}}

LPIPS 衡量深层特征上的感知距离，可以补充像素差，但它不负责判断指令完成或文字正确。[LPIPS 原论文](https://arxiv.org/abs/1801.03924) 对“把白天改成夜晚”的结果直接算整图 PSNR，会把预期的亮度变化算成误差；对“只改衣服颜色”的结果，则应重点检查脸、背景和非目标衣物区域。

评测前还要统一尺寸、颜色空间与裁切规则。若任务要求几何不变，额外配准可能掩盖模型造成的位移，应同时保留未配准结果。保护区域与编辑区域之间可单列一圈过渡带，专门观察接缝与光晕，而不是让它在全图平均分里消失。

## 6 在 ComfyUI 中组织可复查的比较

已有的 [ComfyUI 架构文章]({{< relref "/posts/aigc/comfyui/architecture/index.md" >}})解释了画布、执行图与模型运行层。本次可以沿着同一结构，把“准备条件、执行生成、验收输出”串成一条实验工作流。

{{< mermaid >}}
flowchart TB
    accTitle: ComfyUI 可控生成与画质比较流程
    accDescr: 固定任务与输入，保存提示词和布局，按不同模型模板采样，再保存原始结果、后处理结果及版本信息用于盲评。
    A["固定任务与输入<br/>原图 · 编辑目标 · 保护区域"] --> B["准备条件并留档<br/>提示词 · 扩写结果 · 布局"]
    B --> C["模型各自的官方工作流<br/>编码器 · 采样器 · VAE"]
    C --> D["保存原始生成结果"]
    D --> E["可选后处理<br/>合成 · 超分 · 锐化"]
    D --> F["统一审核<br/>全图 · 局部裁切 · 差异图"]
    E --> F
    F --> G["报告通过率与失败类型<br/>同时记录耗时和峰值内存"]
{{< /mermaid >}}

### 6.1 从匹配的模型包与模板起步

FLUX 官方提供 [Klein ComfyUI 权重包](https://huggingface.co/black-forest-labs/flux-3-image-klein-comfy)，包含生成主干、文本编码器、扩写器与 VAE 的相应文件。优先从该包链接的工作流开始，确认扩写步骤是否执行，不把一个缺少扩写器的简单采样图当成完整官方配置。

MOSS 已有 [Comfy-Org 权重与布局模板](https://huggingface.co/Comfy-Org/MOSS-Image)。OpenMOSS 当前安装文档要求使用包含原生支持的 ComfyUI 版本；旧的 HF 目录加载插件仍可使用，但两类工作流的采样设置不能直接互换。迁移时应导入对应模板，而不是只换一个模型加载节点。[MOSS ComfyUI 指南](https://github.com/OpenMOSS/MOSS-Image/blob/main/comfyui/README.md)

### 6.2 不用同一个步数假装公平

先按各模型推荐配置比较可交付效果，再增加相近耗时或内存预算下的比较。蒸馏版 16 步与带 CFG 的 50 步，每步计算开销和训练目标不同，单看步数没有统一含义。同一个 seed 也只是各管线中的随机性记录，不能保证跨模型、跨后端得到对应的初始条件或内容。

内存同样要按完整管线测量。BFL 的 5.6B 生成器 BF16 权重约为 11.2 GB，但这未包含编码器、VAE、扩写器和运行时张量；官方展示的 8 GB 显卡路径依赖特定量化与工作流。不能据此承诺任意平台、多参考图或高分辨率都能在同一预算下运行。[BFL 硬件说明](https://bfl.ai/blog/flux-3-image-klein)

<details>
<summary>展开查看建议保存的实验记录</summary>

| 记录组 | 必要内容 |
| --- | --- |
| 输入 | 原图哈希、参考图顺序与角色、目标文字、编辑约定 |
| 条件 | 原始 prompt、扩写后 prompt、扩写器版本、布局与坐标空间 |
| 运行 | 模型 revision、量化方式、编码器、VAE、工作流 JSON、软件版本 |
| 参数 | seed、分辨率、步数、CFG、采样器、shift、offload 设置 |
| 输出 | 原始结果、后处理结果、裁切位置、失败与重试记录 |
| 成本与审核 | 冷启动和热运行耗时、峰值内存、盲评结果、问题标签 |

若复用文本编码缓存，应把输入条件和组件版本纳入缓存键。比较端到端体验时将扩写、编码和解码纳入耗时；比较采样器时单独报告采样时间，两种统计不要混在一起。

</details>

## 7 一组可以开始执行的实验

### 7.1 将布局生成和参考图编辑分成两组

下面设计 **48 个任务，每个配置每题生成 4 次**，用于发现失败类型和建立首轮通过率，不用于宣称普遍的模型排名。

{{< codex-table label="首轮实验任务和比较对象" >}}
| 分组 | 任务构成 | 比较对象 | 首轮输出量 |
| --- | --- | --- | --- |
| 文字与布局 | 中文短标题、双语多行、三物体布局、文字物体混排，各 6 题 | FLUX.3 Klein 蒸馏版与 MOSS-Image-SFT | 24 题 × 2 配置 × 4 次 = 192 张 |
| 参考图编辑 | 局部改色、背景替换、人像光照调整、多参考合成，各 6 题 | FLUX.3 Klein 蒸馏版与 Qwen-Image-Edit-2511 | 24 题 × 2 配置 × 4 次 = 192 张 |
{{< /codex-table >}}

先选不依赖复杂增强的任务，再逐步增加细字、发丝、反光材料和强逆光。对于局部改色，指定必须保持的区域；对于重打光，允许亮度与阴影变化，但仍检查几何和材质。多参考合成按对象一一对应审核，不能因为整体画面合理就忽略商品细节被替换。

两组都保留全部输出。每题记录四次中的通过次数，另列最佳候选结果和挑选成本；两种口径分别对应稳定交付与人工选片。比较提示策略时，可以固定语义要求后适配各自格式，也可以比较各自完整默认流程，但应分别报告，不能把更好的提示规划全算成生成主干的提升。

### 7.2 用验收门槛确定后续投入

建议先判断任务和保真是否达标，再在合格结果中比较画质与成本。例如，海报标题有错字就不能因色彩漂亮而获得通过；“保留商品标识”的任务若重绘了标识，也应单列失败。

首轮之后，再挑困难子集测试 Base / SFT、量化前后、扩写前后和连续三轮编辑。这样能回答具体的工程问题：降低精度是否损害小字，后处理是否引入边缘光晕，反复编辑是否使肤色与纹理逐轮漂移。

### 7.3 接到画质数据生产前再检查监督目标

生成模型适合制造候选和暴露边界案例。若把候选用于 [影像画质 Auto GT]({{< relref "/posts/data-flywheel/image-quality-auto-gt/index.md" >}})，应保持“生成式伪参考”的来源标记：人觉得更好看，不会把补出的毛孔、布纹或高光变成真实观测。用于训练的参考与用于验证的实拍／受控参考要分开组织。

还要检查具体权重的用途条款。FLUX Kommunity License 第 4.b 条限制使用模型、派生物及输出改进具有相似功能的其他 AI 模型，因此不能把可下载、可生成图片直接推导为可自由用于训练另一个图像模型。MOSS 的权重和随附推理代码标为 Apache-2.0，也仍需分别核对第三方组件与输入素材。[FLUX 许可原文](https://huggingface.co/black-forest-labs/flux-3-image-klein/blob/main/LICENSE.md)、[MOSS 许可说明](https://huggingface.co/OpenMOSS-Team/MOSS-Image-Base#license-and-acknowledgements)

这条研究线可以从已有的 [FLUX.2-dev]({{< relref "/posts/aigc/image-editing/black-forest-labs/flux2-dev/index.md" >}})、[Qwen-Image]({{< relref "/posts/aigc/qwen-image/index.md" >}})继续推进：用新模型扩展可表达的编辑条件，用 ComfyUI 固定流程，再用画质审核判断它在真实任务中保住了什么、改坏了什么。下一轮最有价值的产物，是带输入、配置和局部裁切的失败案例集，以及每类任务可复查的通过率。

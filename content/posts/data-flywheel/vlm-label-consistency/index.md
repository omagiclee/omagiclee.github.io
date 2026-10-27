+++
date = '2026-10-23T00:00:00+08:00'
draft = false
isCJKLanguage = true
contentLanguage = 'zh-CN'
title = 'VLM 标签为什么会变化及数据闭环检索的稳定性设计'
description = '调研 VLM 重复推理的采样、数值计算、动态批处理和视觉预处理差异，解释 temperature 与 seed 的边界，以及固定词表、结构化输出、版本化标签、混合检索和人工复核如何共同构建稳定的数据闭环。'
summary = 'VLM 可以在受控环境中实现可复现推理，但 temperature=0 和固定 seed 并非通用保证。数据闭环平台应把推理复现、标签正确和检索稳定分别验收，用固定标签定义、不可变预测记录与版本化发布管理模型波动。'
categories = ['数据飞轮']
tags = ['VLM', '自动标注', '数据闭环', '标签检索']
featured = false
+++

同一张图片，第一次被打上“低照度、噪声明显”，第二次变成“夜景、轻微模糊”，第三次又没有噪声标签。对于聊天，这可能只是回答不同；对于数据闭环平台，它会改变筛选数量、训练集组成和实验结果。

**能不能让 VLM 每次输出一样？可以在明确的环境边界内做到，但只固定 prompt、`temperature=0` 和 seed，不能得到跨服务、跨硬件、跨版本的通用保证。** 当前推理框架已经提供更强的确定性机制，不能简单归结为“大模型本来就是随机的”。[vLLM 可复现性文档](https://docs.vllm.ai/en/latest/usage/reproducibility/)

**数据闭环更应保证：同一标签发布版本，对同一批数据提供稳定、可追溯的检索语义。** 为此，需要同时处理标签定义、推理配置、预测保存、质量验收和索引发布。新一轮推理产生不同判断，可以进入候选版本，再经过比较和发布。

本文以图片与视频打标为主，结合影像画质场景。框架能力按 **2026 年 10 月 23 日**可见官方文档理解；平台结构和实验规模是实施建议。

<!--more-->

## 1 先区分四种一致性

“每次一样”至少包含四个目标。前两个是模型与标注问题，后两个直接关系到平台使用。

{{< codex-table label="VLM 打标的一致性层次" >}}
| 目标 | 怎样才算一样 | 应怎样检查 |
| --- | --- | --- |
| 输出一致 | 生成的 token 或文本完全相同 | 对比 token 序列或原始输出哈希 |
| 标签一致 | 归一化后，标签 ID、状态、对象和时间范围相同 | 比较结构化标签，忽略无关顺序和措辞 |
| 发布一致 | 指定版本中的正式标签保持不变 | 冻结标签快照，修改产生新版本 |
| 检索一致 | 同一数据快照和查询得到相同集合及约定排序 | 固定索引、查询解释、排序策略和分页快照 |
{{< /codex-table >}}

“噪点明显”和“明显噪声”可能映射到同一个标签；“夜景”和“低照度”则不应直接合并：夜间场景可以很明亮，室内白天也可能照度很低。

还必须单独评估**正确性**。一个模型可以十次都错得一样；十次一致不能证明标签真实。POPE 的研究表明，视觉语言模型可能在描述中生成图像不存在的对象，且提示中的对象和共现关系会影响这类幻觉。[POPE 原论文](https://arxiv.org/abs/2305.10355v3)

对检索平台，合理的目标组合是：**尽量提高重复推理的标签一致率，通过独立真值验证标签质量，并由平台保证已发布数据不被后台重跑悄悄改写。**

## 2 同一张图片为什么会得到不同标签

### 采样随机性只是其中一层

生成式 VLM 通常逐 token 产生回答。开启采样时，会根据概率分布选择下一个 token；贪心解码则选当前得分最高的 token。Transformers 中，普通贪心解码对应 `do_sample=False`、`num_beams=1`。[Transformers 解码策略](https://huggingface.co/docs/transformers/generation_strategies)

因此，第一件事是核对**实际生效的生成配置**。应用代码、模型自带的 generation config、推理服务默认值和网关都可能参与配置；只看到客户端写了一个参数，并不能证明最终路径已经按预期执行。

固定 seed 控制的是伪随机数序列。它不能固定图片预处理、模型权重、GPU 数值路径或服务端升级。反过来，如果所有计算与随机数使用方式都可复现，非零温度也能复现同一组采样；“采样”不等于“原则上无法重复”。[SGLang 确定性推理](https://docs.sglang.io/docs/advanced_features/deterministic_inference)

### 贪心解码仍然依赖计算出来的分数

可以把一次标签变化理解为下面的路径。这里描述的是一种可能机制，具体请求仍需通过日志和对照实验定位。

{{< mermaid >}}
flowchart TD
  A[同一输入与权重] --> B[服务负载改变动态批次]
  B --> C[矩阵与注意力计算采用不同归约路径]
  C --> D[浮点舍入使候选 token 得分略有差异]
  D --> E{前两名是否足够接近}
  E -->|接近| F[贪心选择可能改变]
  E -->|间隔较大| G[选择仍相同]
  F --> H[后续生成条件改变]
  H --> I[最终标签可能变化]
{{< /mermaid >}}

浮点数加法不严格满足结合律，改变求和顺序可能改变末位结果。**但 GPU 并行不意味着每次都随机**：同一算子、同一形状和同一实现可以是确定的；当请求被放进不同大小的批次，算子采用的计算路径却可能发生变化。

Thinking Machines Lab 在 2025 年的实验中，对 Qwen3-235B-A22B-Instruct-2507 使用温度 0 重复生成 1,000 次，得到 80 种回答；启用其批次不变算子后，1,000 次回答相同。这说明这种波动可以通过实现改进消除。该实验使用特定文本任务，不能直接当作任意 VLM 的波动率。[实验与机制分析](https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference/)

<details>
<summary>展开看贪心解码为什么会翻转</summary>

设某一步的两个最高 logit 为 `z1`、`z2`，间隔 `Δ = z1 - z2 > 0`。若两者受到的数值扰动分别为 `δ1`、`δ2`，当 `δ2 - δ1 > Δ` 时，原来的第二名就会超过第一名。

如果每个扰动的绝对值都不超过 `ε`，那么 `Δ > 2ε` 是该步前两名顺序保持不变的充分条件。这个简化推导用于解释边界敏感性；它不是对真实模型误差上界的测量。

一旦某个 token 不同，后面的回答就建立在不同上下文上，差异可能放大。强制固定输出字段、缩短无关叙述，可以减少可变表达，但不能据此保证每个字段判断都正确或相同。

</details>

### VLM 还必须固定它实际看到的图像

同一个文件名或 URL，不代表每次传给模型的像素相同。视觉链路有独立的变化来源。

{{< codex-table label="VLM 打标变化来源与排查证据" >}}
| 来源 | 典型变化 | 需要保存或固定什么 |
| --- | --- | --- |
| 媒体输入 | URL 内容更新、不同截图或编辑版本 | 原始内容哈希、对象版本 |
| 图像处理 | 自动旋转、缩放、裁剪、颜色转换、压缩 | processor 版本、尺寸、裁剪坐标、变换配置 |
| 视频处理 | 抽帧位置、解码、帧顺序和时间戳变化 | 实际帧清单、PTS、帧内容哈希 |
| 提示上下文 | 聊天历史、示例顺序、动态检索内容变化 | 完整渲染后消息、模板与词表版本 |
| 模型与运行环境 | 权重、量化、精度、内核和并行配置变化 | 权重 revision、部署镜像、硬件与引擎版本 |
| 解码与后处理 | 采样、截断、JSON 修复、同义词映射变化 | 生效参数、结束原因、解析与映射版本 |
{{< /codex-table >}}

Qwen3-VL 官方实现允许调整视觉像素预算，也允许按 `fps` 或 `num_frames` 控制视频抽帧。这些都是模型输入定义的一部分。对于噪声、振铃、细小文字和局部失焦，缩略图与原尺寸局部图还可能支持不同判断。[Qwen3-VL 官方输入说明](https://github.com/QwenLM/Qwen3-VL)

**语义模糊则属于任务定义问题。** “画质差”到底指曝光、噪声、失焦，还是审美不佳？即便推理完全确定，不同提示或标签规范仍可能得到不同的合理答案。语义模糊本身不会让一个严格确定的函数自发变化，却会让微小输入变化更容易越过分类边界。

## 3 怎样控制每次推理尽量一致

### 自部署与托管 API 的控制边界不同

{{< codex-table label="不同部署方式的可复现能力" >}}
| 场景 | 可以控制的重点 | 保证边界 |
| --- | --- | --- |
| 自部署单机基线 | 输入、权重、精度、贪心解码、算子与软件版本 | 在已验证的固定环境内争取完全复现 |
| 自部署并发服务 | 额外控制批次不变计算、并行方式和请求级随机数 | 必须覆盖并发、批次、重启等测试 |
| 托管 API | 固定可用模型版本、请求、支持的解码参数与 seed | 取决于服务明确承诺，不能控制其全部后端 |
| 平台读取已保存结果 | 按内容与配方找到已验收产物 | 可以稳定返回指定产物，但这是复用结果 |
{{< /codex-table >}}

Google 的生成参数文档明确写到，固定 seed 只是尽力提供相同响应，不能保证确定性。因此，不能把“API 接受 seed”解释为服务承诺字节级复现。[Google 官方参数说明](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/content-generation-parameters)

### 按这个顺序建立基线

1. **冻结实际输入。** 将媒体、固定抽帧、局部裁剪和完整消息保存下来；本地可进一步比对进入模型的张量与 token ID。
2. **冻结模型配方。** 权重使用不可变 revision；同时固定 tokenizer、processor、聊天模板、标签定义、量化与推理配置。
3. **使用明确的解码路径。** 支持时采用贪心解码；固定必要的 seed、输出长度、停止条件和 reasoning 配置。参数支持范围以具体模型为准。
4. **建立简单运行基线。** 先测试固定硬件、固定软件环境、单请求和明确批次，再逐项打开并发与性能优化。
5. **启用引擎提供的确定性能力。** 测试视觉编码器、投影层、语言模型和后处理的完整链路。
6. **记录并验证。** 重启服务、改变批次组成和请求顺序后重跑；任何环境升级都重新验收。

这里的“冻结”包括最后实际生效的配置。对于不开放 temperature 或 seed 的模型，不应照搬其他模型的参数模板。

### vLLM 和 SGLang 已有专门机制

截至核验日期，vLLM 默认不保证可复现性；其文档给出两条路径：离线模式可固定调度或启用 batch invariance，在线模式使用 batch invariance。文档同时限定为相同硬件和相同 vLLM 版本。[vLLM 可复现性说明](https://docs.vllm.ai/en/latest/usage/reproducibility/)

`VLLM_BATCH_INVARIANT=1` 用于启用批次不变模式。该能力仍标注为 beta，官方已验证列表包含 **Qwen3-VL-2B-Instruct 和 Qwen3-VL-4B-Instruct 的单图与视频输入**。这个范围不能自动扩展成所有 VLM、所有量化方式或多图组合都已得到同样验证。[vLLM Batch Invariance](https://docs.vllm.ai/en/latest/features/batch_invariance/)

SGLang 提供 `--enable-deterministic-inference`，并列出 FlashInfer、FA3、Triton 后端的兼容矩阵；例如文档中的 FlashInfer 确定性路径不支持 Radix Cache。选择引擎时，应把模型适配、吞吐、显存和功能兼容一起测试。[SGLang 官方说明](https://docs.sglang.io/docs/advanced_features/deterministic_inference)

<details>
<summary>展开看 Transformers 基线与引擎配置示意</summary>

下面是固定模型和输入已经加载后的局部示意，不是覆盖全部 VLM 的可运行部署脚本。

```python
import random
import numpy as np
import torch

random.seed(42)
np.random.seed(42)
torch.manual_seed(42)

torch.backends.cudnn.benchmark = False
torch.use_deterministic_algorithms(True)
model.eval()

with torch.inference_mode():
    output_ids = model.generate(
        **frozen_inputs,
        do_sample=False,
        num_beams=1,
        max_new_tokens=256,
    )
```

`model.eval()` 控制 dropout 等模块的推理行为；`inference_mode()` 关闭梯度相关开销，不能替代前者。`use_deterministic_algorithms(True)` 对受支持操作选择确定性算法，遇到已知且没有确定性实现的操作可能报错；它不会自动约束所有第三方自定义内核。[PyTorch 可复现性文档](https://docs.pytorch.org/docs/stable/notes/randomness.html)

还应检查模型继承的 generation config，处理不适用于贪心模式的采样参数，并按标签 schema 分配足够输出长度。截断、拒答和解析失败必须成为明确状态，不能被当作“没有标签”。[Transformers GenerationConfig](https://huggingface.co/docs/transformers/main_classes/text_generation)

vLLM 的配置入口示意如下，实际使用前需要核对安装版本、硬件和模型支持：

```sh
VLLM_BATCH_INVARIANT=1 vllm serve /models/frozen-vlm
```

只切到 FP32、只固定 batch size 或只设置 seed，都不是完整的确定性证明。PyTorch 也明确不保证跨版本、跨平台，乃至 CPU 与 GPU 之间的相同结果。[PyTorch 官方边界](https://docs.pytorch.org/docs/stable/notes/randomness.html)

</details>

## 4 主流工程路线解决的是不同层的问题

公开工具和研究支持的是一组可组合能力，不能用“全行业都采用某一套架构”概括。对数据闭环，最有参考价值的是以下路线。

{{< codex-table label="稳定标签与检索的工程路线" >}}
| 路线 | 解决什么 | 代表依据与边界 |
| --- | --- | --- |
| 确定性推理 | 同配方重复执行的波动 | vLLM、SGLang；受环境和适配范围约束 |
| 固定词表与约束解码 | 标签名称、字段、格式漂移 | vLLM Structured Outputs；格式正确不等于视觉判断正确 |
| 固定类别评分或专用模型 | 减少开放生成自由度，适合高频属性 | CLIP、Q-Align；仍需领域验证和阈值校准 |
| 预测与人工标注分离 | 保留模型来源并支持纠错 | Label Studio；预测不直接等同于真值 |
| 数据与产物版本化 | 可追溯、回滚和复用 | DVC；保存产物不代表重新计算一定相同 |
| 向量检索加结构化过滤 | 兼顾长尾概念发现与精确筛选 | FiftyOne、Elasticsearch；检索相似度不能证明标签成立 |
| 多信号融合与复核 | 处理冲突、边界和缺失信息 | Snorkel 等弱监督方法；需考虑错误相关性 |
{{< /codex-table >}}

这些机制可以逐层接入。下面把它们落实为一个适合标签检索平台的设计。

## 5 用固定标签定义约束 VLM

### 将开放描述与正式标签分开

自由描述适合帮助人理解画面，也能为长尾检索提供文本。正式标签则应使用稳定 ID、明确的判断对象与固定取值。

例如“人像发虚”可以拆成：主体是否清晰、背景是否虚化、失焦位置和观察尺度。“背景虚化”不应自动推导成画质缺陷，“皮肤平滑”也不应直接推导成“过度磨皮”。

{{< codex-table label="影像画质标签的定义示例" >}}
| 字段 | 示例取值 | 需要在规范中写清楚 |
| --- | --- | --- |
| `scene.night` | present / absent / unknown | 夜间场景证据，不能只用整体亮度判断 |
| `lighting.low_light` | present / absent / unknown | 观察依据与适用图像域 |
| `quality.noise` | present / absent / unknown | 看哪个区域、什么显示尺度和最低可辨条件 |
| `quality.subject_blur` | present / absent / unknown | 主体定义，排除预期背景虚化 |
| `rendering.background_bokeh` | present / absent / unknown | 描述成像效果，是否为缺陷由任务决定 |
| `quality.severity` | none / mild / moderate / severe / unknown | 使用锚点样例定义等级边界 |
{{< /codex-table >}}

每个标签还应有定义、正例、反例、边界例、父子关系和版本。修改中文显示名可以不改变 ID；修改“什么算噪声”的判定语义，则需要新版本和迁移规则。

### 不要把所有缺失都写成 false

至少分清以下状态：

- **present**：在约定范围和观察尺度下，有支持标签成立的证据。
- **absent**：在满足可判断条件的输入中，没有达到该标签定义的证据。
- **unknown**：已经判断，但信息不足或处于边界。
- **not evaluated**：本轮没有检查该字段，这是流水线状态。
- **failed**：调用、解析或处理失败，不能作为模型的否定判断。

对视频，“抽到的帧里没有看到”也不能直接推出整段视频不存在。应记录覆盖的帧或时间区间，以及片段标签采用“任一帧命中”“持续一定时长”还是其他规则。规则改变会改变片段语义。

### 用 schema 限制形状 用规范限制含义

vLLM 的结构化输出支持 choices、JSON Schema、正则与语法约束，适合固定字段和枚举值。[官方结构化输出文档](https://docs.vllm.ai/en/latest/features/structured_outputs/)

但“请输出 JSON”与真正的约束解码不同，后者对允许生成的结构施加限制。即便输出满足 schema，仍可能把噪声判错；Google 的结构化输出文档也要求应用继续验证值，并处理语义错误。[结构化输出的边界](https://ai.google.dev/gemini-api/docs/structured-output)

<details>
<summary>展开看提示模板与一条候选标签</summary>

可以从这样的任务模板开始，标签定义与锚点示例需由业务数据补齐：

```text
任务：按指定标签规范判断图片属性。
输入：全图，以及带固定坐标和 ID 的原尺寸局部图。

对每个要求的字段：
1. 只输出允许的枚举，不新增标签名称。
2. 按该字段的定义、观察范围和锚点样例判断。
3. 看不清、证据不足或边界无法区分时输出 unknown。
4. 区分主体模糊、预期背景虚化和纹理本身的柔软。
5. 证据引用只能选择输入中已有的视图 ID。
6. 输出符合服务端提供的 JSON Schema。
```

下面是一条**数据结构示例**。来源和版本字段应由平台写入，不能让 VLM 自己编造运行身份。

```json
{
  "asset_id": "image-001",
  "asset_sha256": "<完整内容哈希>",
  "recipe_id": "vlm-tags-v4",
  "taxonomy_version": "iq-tags-v2",
  "status": "candidate",
  "attributes": [
    {
      "tag_id": "quality.noise",
      "state": "present",
      "severity": "mild",
      "evidence_view_id": "crop-02",
      "calibrated_score": null
    }
  ]
}
```

`evidence_view_id` 可以让审核者定位模型看过的区域，但证据引用本身仍需核对。`calibrated_score` 留空，避免把模型随口输出的“0.93 置信度”当成已经校准的概率。

应用层还需要检查必需字段是否齐全、ID 是否有效、证据视图是否存在，以及 `absent` 与 `severity=severe` 等组合是否矛盾。通过校验只表示符合契约，之后仍要检查标注质量。

</details>

## 6 高频标签可以使用更受约束的模型

当标签集合稳定、数据规模很大时，不一定需要每张图都生成长篇描述。

**固定候选评分。** 给定一组类别或属性定义，计算候选得分，再由固定规则决定状态。CLIP 通过图文共同表征支持自然语言定义的零样本分类，为这条路线提供了基础。[CLIP 原论文](https://arxiv.org/abs/2103.00020)

**领域分类或质量模型。** 对噪声、失焦、压缩损伤等高频属性，收集复核数据，训练多标签分类头或专用模型；VLM 继续承担场景解释、长尾候选和困难样本分析。Q-Align 用文本定义的离散等级训练视觉评分，并由等级分布形成评分，提供了比任意生成一个数字更受约束的研究路线。[Q-Align 原论文](https://arxiv.org/abs/2312.17090)、[作者评分实现](https://github.com/Q-Future/Q-Align)

**多信号融合。** 元数据、测量指标、专用模型与 VLM 可以共同产生候选。Snorkel 研究的弱监督框架处理多个可能带噪且相关的标注函数；借鉴到这里，需要在领域数据上检验各信号的可靠性与相关错误。[Snorkel 原论文](https://arxiv.org/abs/1711.10160)

这几条路线都不会自动消除数值非确定性。它们的价值是减少表达自由度、降低成本，并让决策边界更容易测量。用于画质任务时，原尺寸局部信息、设备域和成像处理链差异仍然重要。

<details>
<summary>展开看候选评分与微调的两个边界</summary>

如果用生成式 VLM 对固定答案计算 log-probability，需要处理候选的 token 长度、措辞、顺序和归一化方式。候选集合内的 softmax 分数，不能直接当作该属性在真实世界中的正确概率；多标签任务也不能随意让互相独立的标签争夺一个总和为 1 的概率。

微调或蒸馏可以学习统一规范，并改善领域准确率。它不负责固定输入预处理、服务端调度或底层内核，因此“做一次 LoRA 就不会变”不成立。应同时评估微调后的质量、稳定性和拒判行为。

</details>

## 7 把预测记录与正式标签发布分开

这是平台最值得优先建立的能力。Label Studio 将预标注放在 `predictions` 中，并保存 `model_version`；DVC 则通过依赖、参数和输出追踪数据流水线产物。二者分别提供了来源区分和版本追踪的参考。[Label Studio 预标注](https://labelstud.io/guide/predictions.html)、[DVC 流水线](https://doc.dvc.org/user-guide/pipelines/defining-pipelines)

下面是面向标签检索的架构建议。

{{< mermaid >}}
flowchart TD
  A[媒体与输入视图版本] --> B[固定标签与推理配方]
  B --> C[模型运行并追加原始预测]
  C --> D[结构校验与标签归一化]
  D --> E[质量评测与冲突处理]
  E -->|需要复核| F[人工检查与修正]
  F --> G[候选标签快照]
  E -->|满足验收规则| G
  G --> H[构建候选索引并验证查询]
  H --> I[发布标签与索引版本]
  I --> J[检索和冻结训练集]
  J --> K[失败样本与新标签需求]
  K --> B
{{< /mermaid >}}

### 每次预测可以保存 正式版本只能显式更新

建议至少区分五种记录：

{{< codex-table label="标签平台的数据记录" >}}
| 记录 | 保存内容 | 变化规则 |
| --- | --- | --- |
| 媒体与视图 | 内容哈希、帧、裁剪、预处理配置 | 输入变化产生新版本 |
| 推理配方 | 模型、提示、词表、schema、解码、部署配置 | 任何影响结果的变化均留痕 |
| 预测运行 | 原始响应、结构化结果、状态、耗时、来源 | 每次运行追加记录 |
| 审核与修正 | 原预测引用、修正值、原因、适用规范 | 保留修正历史，不被自动重跑覆盖 |
| 发布快照 | 每条数据采用的标签记录、索引和规则版本 | 发布后保持不变，纠错产生新发布 |
{{< /codex-table >}}

人工修正优先于同一规范下的自动候选；规范语义改变时，旧修正应重新判断适用性。不能让一个历史 override 永久跨越不同标签定义。

检索标签、训练伪标签和评测真值也应分别管理。用于“找出可能有噪声的图”的候选标签，通常不满足评测集真值的质量要求。

### 缓存需要包含完整配方

一个便于实现的产物身份可以写为：

```text
artifact_key = SHA256(canonical_json({
  asset_content_hash,
  input_view_manifest_hash,
  preprocessing_revision,
  model_and_adapter_revision,
  deployment_revision,
  rendered_messages_hash,
  taxonomy_and_schema_revision,
  decoding_config,
  parser_and_normalizer_revision
}))
```

哈希字段应使用无歧义的规范化序列化。托管服务暴露的信息不全时，保存请求中的模型标识、服务返回的可用版本信息与请求 ID，并保留实际结果；不要假装拥有不可见的后端配置。

同一 `artifact_key` 可以对应多次审计运行。平台另外维护一个**已选定产物指针**：重复任务命中已验收产物时复用；主动重跑产生新记录，再由验收规则决定是否成为新候选。并发写入需用唯一约束或事务控制，不能采用“最后完成的覆盖前一个”。

这能让业务稳定读取同一结果，但不能证明一次新的模型计算必然相同。保存错误标签也会稳定返回错误，因此缓存与质量验收必须配合。

### 发布时同时冻结标签和检索依赖

新版本先在旁路构建、比较标签变化和查询质量，再切换线上指向。Elasticsearch 的 alias API 支持在一次操作中切换别名，为索引发布提供了机制；应用仍需检查操作回执与目标索引。[Elasticsearch 别名切换](https://www.elastic.co/docs/manage-data/data-store/aliases)

如果结构化库、向量库和文本索引是多个系统，单独切一个别名不能保证它们共同一致。可以先构建所有目标，再发布一个统一的 `release_id → 各组件版本` manifest；一次查询始终绑定同一个 release，避免读取过程中混用新旧标签。

## 8 精确标签检索与语义检索应协同工作

只有固定标签，长尾概念容易漏掉；只有自然语言描述或向量相似度，精确筛选又难以解释。FiftyOne 支持基于图像或对象局部的相似度索引，也支持兼容模型上的自然语言查询，展示了多种检索入口可以共存。[FiftyOne 相似度检索](https://docs.voxel51.com/user_guide/similarity.html)

适合数据闭环的一种查询结构如下。

{{< mermaid >}}
flowchart TD
  A[查询与指定数据发布版本] --> B[解析硬约束与软需求]
  B --> C[权限与元数据范围]
  C --> D[结构化标签候选]
  C --> E[图文向量候选]
  C --> F[描述与文本索引候选]
  D --> G[合并候选并执行约束]
  E --> G
  F --> G
  G --> H[固定排序或重排]
  H --> I[结果及命中证据]
  I --> J[保存样本清单用于训练]
{{< /mermaid >}}

例如检索“暗光人像，主体清晰，背景有散景”，需要把条件分开：数据权限、采集时间和设备范围通常是硬约束；“有氛围感”更适合语义排序；“主体清晰”可以使用结构化属性，但要决定是否允许未知状态。

建议提供两种明确行为：

- **精确筛选**：只返回已发布且满足指定标签状态的数据，适合统计和构造受控数据集。
- **探索挖掘**：保留 unknown 或缺少标签的数据，用向量和文本扩大召回，再对候选复核。

如果一开始就用高精度但低召回的自动标签做硬过滤，真正的困难正样本可能永远进不了后续召回。权限与数据范围必须严格执行；模型预测属性是否作为硬门槛，应由检索目的决定。

BM25、向量和其他候选列表可以用 RRF 等方法融合排名，避免把不同量纲的原始分数直接相加。RRF 本身只是合并排名的方法，不会判断“这张图确实有噪声”。[Elasticsearch RRF](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion)

**向量检索也需要版本化。** 图像与文本编码器、预处理、距离函数、近似索引参数和 reranker 都可能改变结果。稳定重放还需要固定查询改写、同分排序和分页快照；严格复现实验时，直接保存最终样本 ID 清单及其内容版本。只保存一句自然语言查询，无法保证以后仍选中同一批训练数据。

## 9 用不确定性安排复核 而不是无限重跑

### 自报置信度和真实正确率不同

VLM 生成的“置信度 0.9”、某个 token 的概率、同一答案的重复占比，以及在标注验证集上校准后的正确概率，是四种不同量。

Guo 等人的研究讨论了神经网络概率与真实正确率不匹配的问题，并研究温度缩放等校准方法。这里的校准温度与生成时用于采样的 temperature 用途不同。[概率校准原论文](https://proceedings.mlr.press/v70/guo17a.html)

对多标签平台，可以逐标签建立验证集，用可用的模型分数校准或选择阈值；必要时按设备域、分辨率和场景分别分析。一个“统一置信度大于 0.8”不能自动适用于所有标签。

### 多次投票什么时候值得做

重复采样与一致性选择是一条研究路线；Self-Consistency 原论文在推理任务中采样多条路径后聚合答案。[Self-Consistency 原论文](https://arxiv.org/abs/2203.11171v4)

用于 VLM 标注时，需要注意三点：

1. **完全确定的同一次计算，重复十遍没有新增信息。** 想评估不确定性，需要有设计的不同 seed、视图或模型，并保存这个实验配方。
2. **相同错误会相关。** 同一模型、相近提示的五票，并不等于五个独立专家。多数票仍可能一起漏掉小物件或误判噪声。
3. **只能聚合语义相同的判断。** 裁剪前后可见范围不同，不能把“局部存在”与“全图不可辨”当作两个可直接投票的答案。

如果使用多路结果，应固定路数、输入、聚合规则与平票处理，不要“重试到得到想要的标签”。更经济的方式是常规样本单次推理，只将边界、冲突和高价值样本升级到专用模型、放大检查或人工审核。

复核队列也要保留随机抽检份额。只看模型认为不确定的样本，会漏掉它自信但错误的部分。对罕见标签，还应主动抽查未命中样本，估计漏检。

## 10 怎样设计一轮能定位问题的实验

先分别回答三件事：**同配方是否稳定、标签是否准确、检索是否好用。** 不要只报告一个整体一致率。

### 控制变量的实验矩阵

以下规模是起步示例，可以按预算缩小。选择 1,000 张具有场景、设备和质量分层的图像；视频按片段另建集合，避免把同一段的相邻帧当成独立样本。为关键标签建立独立复核子集。

{{< codex-table label="VLM 标签稳定性排查实验" >}}
| 实验 | 固定与改变的条件 | 回答的问题 |
| --- | --- | --- |
| A 重复执行 | 同一配方每张运行 10 次，绕过结果缓存 | 当前重复波动有多大 |
| B 解码对照 | 保持其余条件，比较当前配置与支持的贪心路径 | 采样贡献了多少差异 |
| C 输入冻结 | 保存并重复使用完全相同的视图与帧 | 预处理是不是变化来源 |
| D 服务负载 | 比较单请求、混合长度批次、不同并发和顺序 | 是否存在批次敏感性 |
| E 确定性模式 | 保持模型和数据，开关引擎确定性能力 | 稳定收益与吞吐代价如何 |
| F 重启与升级 | 同环境重启，另行比较硬件或版本变化 | 运行复现与版本漂移分别多大 |
| G 发布回归 | 对旧、新标签版本执行固定查询集 | 标签变化怎样影响检索与选数 |
{{< /codex-table >}}

单个“1,000 张 × 10 次”的实验就是 10,000 次图像推理，多组对照需要另计预算。测试重复推理时必须绕过**最终结果缓存**；prompt 或 KV 缓存是否启用则作为引擎配置记录。只有缓存命中时一致，不能算推理复现证据。

### 分开记录稳定性和质量指标

{{< codex-table label="标签与检索的验收指标" >}}
| 维度 | 建议指标 | 防止误读 |
| --- | --- | --- |
| 输出结构 | schema 成功率、截断率、调用失败率 | 失败不计为负标签 |
| 重复稳定性 | 原始输出完全一致率、规范化标签一致率 | 不将措辞变化等同于语义变化 |
| 标签波动 | 每标签翻转率、状态转移表、标签集合 Jaccard | 单独统计 unknown，分解稀有标签 |
| 标签正确性 | 每标签 precision、recall、F1 与混淆情况 | 全部输出 absent 也可能获得很高一致率 |
| 拒判能力 | 自动处理覆盖率与已处理部分错误率 | 允许 unknown 后，需同时报告覆盖率 |
| 检索质量 | Precision@K、Recall@K、nDCG 与结果集合变化 | 需要固定查询和独立相关性标注 |
| 运行成本 | 单图成本、吞吐、延迟与人工复核量 | 确定性模式的代价必须实际测量 |
{{< /codex-table >}}

<details>
<summary>展开看翻转率与 Jaccard 的定义</summary>

若某个标签在样本 `i` 的两次有效判断为 `s(i,r)`、`s(i,t)`，可用全部有效重复对中 `s(i,r) != s(i,t)` 的比例定义成对翻转率。`present`、`absent`、`unknown` 都属于有效状态；调用失败单列，不填成 absent。

对正标签集合 `A`、`B`，Jaccard 为 `|A ∩ B| / |A ∪ B|`。两者都为空时，需要提前约定统计方式并单独报告空集合比例，否则大量无标签图片可能掩盖困难样本上的不稳定。

建议另外输出 `present→absent`、`present→unknown` 等状态转移表。不同转移对精确过滤、召回和审核的影响不同。

有限测试中零翻转，只能说明在已覆盖条件下没有观察到变化。上线后仍要监控环境变化和新数据分布；稳定性测试也不能替代独立真值上的准确率评测。

</details>

版本比较时，应进一步区分“新模型纠正了错误”“标签定义改变”和“无法解释的随机变化”。降低所有版本之间的变化率并不是合理目标，应该允许经过验证的质量改进。

## 11 数据闭环平台的实施顺序

对于已经用 VLM 生产标签的平台，建议先把运行证据和发布边界补齐，再决定是否需要更换模型或推理引擎。

{{< codex-table label="VLM 标签检索平台的实施优先级" >}}
| 阶段 | 先完成什么 | 完成后可以验证什么 |
| --- | --- | --- |
| 第一阶段 | 固定输入、配方和词表；保存原始预测；增加 unknown 与失败状态 | 能定位一次标签变化发生在哪层 |
| 第二阶段 | JSON Schema、确定性归一化、产物复用、发布快照 | 重跑不会直接改变正式检索结果 |
| 第三阶段 | 人工复核集、重复实验、并发对照、确定性模式评估 | 同时量化准确率、稳定性和成本 |
| 第四阶段 | 精确筛选与探索检索分开；加入图文向量；固定查询回归集 | 发现长尾，同时保持筛选可解释 |
| 第五阶段 | 高频标签专用模型、分标签校准、主动复核与版本对照 | 降低单位成本，并从错误中持续改进 |
{{< /codex-table >}}

第一轮最具体的交付可以是一套冻结样本、一份逐标签差异报告和一个不可变标签 release。它们足以判断：问题主要来自采样、输入、服务数值路径，还是标签定义，并让下一次改进有可比较的基准。

标签发布随后可以接入[数据闭环平台研究]({{< relref "/posts/data-flywheel/closed-loop-platform-research/index.md" >}})中的选数与评测流程；涉及画质训练时，再按[影像画质 Auto GT 方案]({{< relref "/posts/data-flywheel/image-quality-auto-gt/index.md" >}})区分检索候选、伪监督与评测参考。

<details>
<summary>按问题继续阅读原始资料</summary>

- 推理为何会变：[Thinking Machines Lab](https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference/)、[PyTorch Reproducibility](https://docs.pytorch.org/docs/stable/notes/randomness.html)。
- 自部署如何控制：[vLLM Reproducibility](https://docs.vllm.ai/en/latest/usage/reproducibility/)、[vLLM Batch Invariance](https://docs.vllm.ai/en/latest/features/batch_invariance/)、[SGLang Deterministic Inference](https://docs.sglang.io/docs/advanced_features/deterministic_inference)。
- 标签如何约束：[Qwen3-VL 输入处理](https://github.com/QwenLM/Qwen3-VL)、[vLLM Structured Outputs](https://docs.vllm.ai/en/latest/features/structured_outputs/)、[Q-Align](https://arxiv.org/abs/2312.17090)。
- 平台如何组织：[Label Studio 预测数据](https://labelstud.io/guide/predictions.html)、[DVC Pipelines](https://doc.dvc.org/user-guide/pipelines/defining-pipelines)、[FiftyOne Similarity Search](https://docs.voxel51.com/user_guide/similarity.html)。
- 质量与不确定性：[POPE](https://arxiv.org/abs/2305.10355v3)、[概率校准](https://proceedings.mlr.press/v70/guo17a.html)、[Snorkel](https://arxiv.org/abs/1711.10160)。

</details>

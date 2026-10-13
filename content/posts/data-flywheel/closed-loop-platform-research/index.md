+++
date = '2026-10-13T00:00:00+08:00'
lastmod = '2026-10-13T00:00:00+08:00'
draft = false
isCJKLanguage = true
contentLanguage = 'zh-CN'
title = '数据闭环平台深度研究：数据算法、GT、检索挖掘与多轮迭代'
description = '基于原始论文、官方文档与公开实现，逐模块研究 LLM、VLM、具身、智驾、世界模型和空间智能的数据闭环，并给出架构、产品工作台与多轮迭代设计。'
summary = '数据从哪里来，GT 如何成立，检索挖掘怎样选出有效样本，训练评测又怎样推动下一轮？本文逐模块拆解可核查的代表方案，最后汇总完整闭环、产品设计与三轮迭代。'
categories = ['数据飞轮']
tags = ['数据闭环', '数据飞轮', 'Data-centric AI', 'LLMs', 'VLMs', '具身智能', '自动驾驶']
featured = true
+++

一个数据闭环平台，应当能回答一条样本的完整来历：为什么采它，如何处理，标签从哪里来，为什么进入这个数据集，用于哪次训练，最后修复了什么问题。进入第二轮时，还应能解释：这次为什么改变采集、标注或配方，以及变化是否有效。

本文属于[数据飞轮专题]({{< relref "/posts/data-flywheel/_index.md" >}})。先逐模块研究数据来源、清洗、GT、检索挖掘、配方、训练和评测，再讨论平台架构、产品工作台与多轮迭代。研究覆盖 LLM、VLM、具身与智驾，也把世界模型和空间智能中的时空结构、物理约束与可观测性纳入讨论。

资料核验日期为 **2026 年 10 月 13 日**。论文结果按原始实验条件理解；动态文档按访问时的版本理解。本文使用三类依据：**论文与公开实现**、**企业公开工程描述**、**本文设计建议**。后两类在文中明确标注。文末给出资料索引，重要论断在附近直接链接原始来源。

代表方案按公开程度、可复现机制与实际技术贡献选择。Llama、Qwen、Waymo、NVIDIA 的公开材料适合研究不同链路；FiftyOne、Argilla、CVAT、Rerun 等适合研究具体工作台。它们覆盖的边界不同，本文不建立跨领域的品牌总榜，也不将未公开的企业内部机制补写成事实。

<!--more-->

## 1 闭环对象：问题、样本、标签和版本

### Pipeline 如何表达工作

Pipeline 是一组具有数据依赖、输入输出与执行顺序的处理步骤。以视频数据为例，下载、解码、切分、过滤、描述、向量化、去重、分片可以组成一条管线。NVIDIA Cosmos Curator 的公开实现把 Split-Annotate、Dedup 和 Shard-Dataset 分开，允许不同阶段输出中间产物。[Cosmos Curator：视频管线](https://github.com/NVIDIA/cosmos-curator/blob/main/docs/curator/reference/video-pipelines.md)

在产品中，pipeline 还要表达一次运行使用的配置、处理模型、版本与产物。已有的[流水线与算子插件需求文档]({{< relref "/posts/data-flywheel/pipeline-operator-requirements/index.md" >}})讨论执行契约；本文进一步研究这些产物怎样进入标注、训练和反馈。

**本文设计建议：** 把下面这些对象作为平台中可追踪的实体。它们可以有不同实现，但各自的身份、状态与关联要明确。

{{< codex-table label="闭环核心对象与关联" >}}
| 对象 | 回答的问题 | 主要关联 |
| --- | --- | --- |
| 能力问题与场景 | 要提升什么，怎样判断修复 | 失败证据、验收条件、数据需求 |
| 原始资产与采集事件 | 从哪里来，是否完整 | 来源、设备、时间、授权、标定 |
| 样本、片段、episode | 训练或分析的基本单位是什么 | 原始资产、事件、对象、任务 |
| 标签与 GT 版本 | 谁根据什么证据给出参考答案 | 标注规范、教师、审核、质量报告 |
| 数据集快照 | 某次实验究竟用了什么 | 样本、标签、筛选和划分规则 |
| 配方、训练与模型 | 数据怎样被使用 | 数据集、采样、损失、训练配置 |
| 评测与发布 | 是否达到目标，是否有回归 | 模型、评测集、环境、结果 |
| 下一轮任务 | 结果怎样改变行动 | 归因、负责人、补采或修订、验证 |
{{< /codex-table >}}

这个对象模型是本文对多种公开机制的整合：LeRobot 保留 episode 与文件位置，lakeFS 固定数据提交，实验管理工具记录数据与运行关系。后文分别核查这些机制。整合后的对象模型不代表任何一家公司的完整内部实现。

### 各领域的基本单位

{{< codex-table label="不同领域的数据单位与闭环反馈" >}}
| 领域 | 主要单位与监督 | 关键关联 | 迭代时应观察什么 |
| --- | --- | --- | --- |
| LLM／智能体 | 文档、指令、偏好对、交互轨迹 | 对话、工具环境、任务结果 | 失败类型、可验证结果、偏好变化 |
| VLM／视频 | 图文对、对象、片段、时序问答 | 帧、区域、时间、描述 | 定位、幻觉、事件顺序与长视频表现 |
| 具身／VLA | episode、状态—动作、示教与干预 | 时间、机器人形态、任务与接触 | 实机成功、恢复行为、策略访问状态 |
| 智驾 | 多传感器事件、track、轨迹与地图 | 时间、坐标、对象、交互 | 感知、预测、规划和真实运行反馈 |
| 世界模型 | 初始状态、控制与未来序列 | 动作、状态转移、rollout | 控制响应、长期漂移、物理与交互 |
| 空间智能 | 多视角、点云、几何与动态对象 | 标定、坐标、拓扑、时间 | 重建、关联、尺度与可观测性 |
{{< /codex-table >}}

这是综合分析表，依据包括 [Llama 3 的后训练](https://arxiv.org/html/2407.21783v3)、[Qwen3-VL 的数据构建](https://arxiv.org/html/2511.21631v1)、[Open X-Embodiment](https://robotics-transformer-x.github.io/) 和 [Waymo 标签规范](https://github.com/waymo-research/waymo-open-dataset/blob/master/docs/labeling_specifications.md)。这些单位可以共用资产与版本机制，时间、动作、空间语义则需要专门处理。

## 2 数据怎么来：来源、采集与生产

### 文本和多模态数据的产生

文本预训练常见公开路径是网页抓取后提取正文、识别语言、清洗、去重和筛选。FineWeb 从 Common Crawl 建立并评估可复现的策展流程；DCLM 则在固定训练与评测框架中比较数据处理策略。它们适合研究“什么处理带来什么效果”，而不是仅统计最终 token 数。[FineWeb 论文](https://arxiv.org/abs/2406.17557)、[DCLM 论文](https://arxiv.org/abs/2406.11794)

多模态数据还需要生成或整理对象、区域和时间监督。Qwen3-VL 报告的 box grounding 管线先用 Qwen2.5-VL 提取候选，再结合 Grounding DINO 与 VLM 定位，最后过滤低置信或不准确注释。视频部分使用密集描述、时空 grounding、来源平衡和随上下文长度变化的采样。这是作者公开的训练数据构建方式，过滤效果仍应按具体实验理解。[Qwen3-VL，§3.2.4–3.2.7](https://arxiv.org/html/2511.21631v1)

语音可以从 manifest 接入，经 ASR 产生转写，再做时长、格式与转写质量检查，接入文本策展。NeMo Curator 公开了这条链路，ASR 示例包含 Parakeet 模型。自动转写属于模型候选；用 WER/CER 判断正确性时，要核查参考转写的来源。[NeMo 音频策展](https://docs.nvidia.com/nemo/curator/curate-audio)、[ASR 模型说明](https://docs.nvidia.com/nemo/curator/curate-audio/process-data/asr-inference/nemo-models)

这里已经包含模型算法：采集到的视频可以衍生描述、区域、事件和问答。平台应保存衍生产物的生成模型与处理版本，让后来发现的教师错误能够回溯。

### 真实机器人数据

DROID 使用统一机器人工作台和遥操作，在多种环境录制示教；项目还公布过语言注释与相机标定更新。这个例子说明原始数据发布后，注释和几何质量仍可能继续修订。示教动作表达专家采取的行为，并不意味着每个状态只有一个最优动作。[DROID 项目与更新记录](https://droid-dataset.github.io/)

Open X-Embodiment 将多机构、多机器人数据转成统一格式，并研究 RT-X 的跨机器人训练。统一的 episode/step 封装便于组合，但动作空间、单位、相机和机器人形态仍需适配。[OXE／RT-X 论文与项目](https://robotics-transformer-x.github.io/)

**本文设计建议：** 采集任务要说明目标场景、成功失败定义、观测与动作单位、校准要求和验收条件。采集页面除进度外，应展示缺失流、时间偏移、失败原因、操作员备注和任务覆盖。数据进入平台时先检查这些条件，再进入自动策展。

### 端侧事件如何进入云端

Waymo 的 SimulationCity 工程文章公开描述了利用车队经验不断更新仿真环境，并扩展到整段行程测试。它支持“真实经验回流仿真”的机制；该文章没有公开完整上传规则、挖掘排序、自动 GT 与产品 UI。[Waymo SimulationCity，2021](https://waymo.com/blog/2021/07/simulation-city/)

Tesla 香港隐私声明则披露了采集边界：相关外部摄像头功能默认在车内处理；严重安全事件可自动捕捉最长 30 秒片段；Fleet Learning 回传需要用户同意。两类记录的用途和匿名性说明不能混用。这个地区页面支持采集与回传边界，不能据此重建其云端选样算法。[Tesla 香港 Privacy Notice，Autopilot Data](https://www.tesla.com/en_hk/legal/privacy)

Waymo 2026 年 8 月的工程文章进一步公开反馈链路：道路或仿真中的 Critic，以及乘客和社区反馈发现改进机会，随后提取检查数据、自动标注、重训、仿真与安全框架验证。Critic 的具体网络、采集阈值和各轮混合配方没有在该文公开。[Waymo：10 AI Lessons，§6、§9](https://waymo.com/blog/2026/08/10ailessons/)

下面是基于事件采集需求提出的参考设计：端侧检测触发信号，保存前后时间窗口及关联流；上传后先检查完整性与时间、标定关系；云端合并同一事件并关联模型、任务和场景；挖掘结果再形成补采任务或端侧触发策略更新。具体触发可以来自接管、任务失败、模型分歧或新场景，但阈值需要在真实工作负载中验证。

{{< mermaid >}}
flowchart TD
  A[端侧观测与任务执行] --> B[事件触发和前后窗口]
  B --> C[原始数据与来源记录]
  C --> D[云端完整性与同步检查]
  D --> E[事件合并和场景关联]
  E --> F[检索、挖掘和人工复核]
  F --> G[补采、标注或数据集任务]
  G --> H[训练与独立验证]
  H --> I[更新模型和触发策略]
  I --> A
{{< /mermaid >}}

图为本文设计建议。保留原始观测和触发理由，才能在发现端侧漏采或误采时检查采样偏差。

## 3 接入与资产：文件、样本和时间轴

LeRobotDataset v3 把低维状态、动作与时间戳存入 Parquet，把视频存入 MP4，再用元数据记录 episode 边界和文件位置。多个 episode 可以共享较大的文件，用户仍按 episode 访问。这把存储组织与逻辑样本分开。[LeRobotDataset v3，Format design](https://huggingface.co/docs/lerobot/lerobot-dataset-v3)

因此，一个样本详情页可能读取多个文件，同一个物理文件也可能服务多个样本。删除 episode、改任务标签或更新标定，不一定意味着重写所有媒体文件。产品需要同时表达逻辑对象与实际资源的关系。

### 时间同步和坐标关系

Foxglove 文档说明，跳转时间时会利用每个 topic 的 last-seen 消息更新显示。它解决播放器在任意时刻显示可用状态的问题；这个显示行为不能证明相机、点云和控制流是在同一时刻采集的。[Foxglove：Playback](https://docs.foxglove.dev/docs/visualization/playback)

**本文设计建议：** 区分采集时间、接收时间与播放器时间。详情页应允许检查每个流的时间偏移、插值方式和缺失区间，空间视图应显示坐标系与标定版本。把“看起来同步”作为检查起点，进一步核查实际对齐。

对于点云和多视角，几何模型可以产生重建结果。VGGT 的公开实现预测相机、深度、点图和点轨迹，适合作为空间表征或辅助重建的研究依据；这些预测仍须与观测、尺度和几何约束核对。[VGGT 官方实现](https://github.com/facebookresearch/vggt)

## 4 清洗与质量：先定义要保留什么

### 精确、近似与语义去重

精确去重比较规范化内容的哈希。近似去重可把文档转成 n-gram 集合，用 MinHash 近似 Jaccard 相似度，再通过 LSH 缩小候选比较范围。设两个集合为 $A,B$：

$$
J(A,B)=\frac{|A\cap B|}{|A\cup B|},\qquad
P_{\mathrm{candidate}}\approx 1-(1-J^r)^b.
$$

后一式是独立哈希近似下的 banding 候选概率，$b$ 为 band 数，$r$ 为每 band 行数。它表达召回曲线，不能当作最终重复判定。候选还要经过阈值、聚类与保留策略；相似关系并不具备传递性，连通簇中的任意两项未必都相似。[BigCode：大规模近似去重](https://huggingface.co/blog/dedup)

语义去重改为比较 embedding，能够发现字面不同但语义接近的数据；模型、聚类和阈值会改变“接近”的含义。Cosmos Curator 的视频去重使用 clip 表征、聚类和簇内关系，连接视频策展与检索。[Cosmos Curator：Dedup pipeline](https://github.com/NVIDIA/cosmos-curator/blob/main/docs/curator/reference/video-pipelines.md)

### 筛选复杂度与收益

DCLM 对数据过滤做了对照：在论文给定设置中，基于 fastText 的筛选表现有竞争力，复杂质量模型和 SemDedup 没有自动带来额外收益。FineWeb 的消融也显示，跨 crawl 全局去重需要谨慎，其效果未必优于所采用的逐 crawl 策略。这里的结论只适用于各自数据、阈值和训练设置。[DCLM，数据过滤实验](https://arxiv.org/abs/2406.11794)、[FineWeb，去重消融](https://arxiv.org/abs/2406.17557)

筛选器学到的是某种“质量定义”。百科风格、低重复、清晰美观、可信来源、训练收益和长尾价值是不同维度。雨夜、模糊、遮挡或失败片段可能正好包含任务缺口；视频美学分数不能替代任务价值判断。

**本文设计建议：** 质量工作台保存规则命中、模型分数、处理理由和处理前后分布；支持修复、隔离、降权与复核。每次改变规则，都检查保留率、误删样本和关键场景覆盖，并用固定训练对照评估其作用。

## 5 GT 怎么做：参考答案的来源和误差

### 先区分监督来源

{{< codex-table label="GT与监督信号的来源及验证边界" >}}
| 来源 | 可提供的监督 | 主要误差 | 应核查的证据 |
| --- | --- | --- | --- |
| 传感器观测与人工参考 | 可见对象、测量、任务标签 | 噪声、遮挡、规范歧义 | 原始流、规范、审核与测量条件 |
| 专家示教与干预 | 状态下采取的动作、恢复行为 | 专家差异、迟延、非唯一动作 | 状态对齐、操作记录、真实结果 |
| 教师预测与伪标签 | 框、mask、描述、偏好或轨迹 | 教师偏差、分布外错误 | 教师版本、独立金标准、分桶准确性 |
| 几何或时序重建 | 深度、3D关联、跨帧轨迹 | 标定、尺度、关联与动态误差 | 重投影、多视角、可观测性与独立观测 |
| 仿真状态与 annotator | 虚拟场景的对象和状态 | 资产、物理与语义配置 | 场景状态、语义、传感器模型 |
| 可验证任务结果 | 测试通过、答案匹配、任务完成 | 测试不充分、规则覆盖不足 | 独立验证器、环境、测试集 |
{{< /codex-table >}}

表是基于 [Waymo 标注规范](https://github.com/waymo-research/waymo-open-dataset/blob/master/docs/labeling_specifications.md)、[DROID](https://droid-dataset.github.io/)、[Isaac Sim 数据录制](https://docs.isaacsim.omniverse.nvidia.com/latest/replicator_tutorials/tutorial_replicator_recorder.html)和 [DeepSeek-R1 奖励机制](https://arxiv.org/html/2501.12948v1)作出的分类。一个平台可以同时保留多种监督，标签名称相同不意味着证据强度相同。

Waymo 的规范对可见点、遮挡、2D 可见边界和 No Label Zones 作出约定。现实 GT 因而要和任务规则、可观测范围一起解释，未标注区域不能直接视为负样本。仿真 annotator 则根据已定义场景产生标签，正确表达虚拟状态也不意味着真实世界分布与动力学已经匹配。

### 自动标注的模型链路

SAM 2 使用可提示分割与视频记忆机制传播对象 mask；其 data engine 将模型辅助与人工修正结合。它能减少重复操作，视频关联和分割仍需验证。[SAM 2 论文与公开实现](https://arxiv.org/abs/2408.00714)

SAM4D 给出了更具体的跨模态研究链路：开放词汇检测与分割建立图像候选，SAM 2 传播 masklets，再结合 LiDAR、3D 框、4D 重建和跨视图处理产生点云伪标签。论文将产物称为 pseudo-GT；已有框、标定和教师错误都会影响结果。它是研究代表，本文不将其写成已经普遍采用的生产标准。[SAM4D，§4–5](https://arxiv.org/html/2506.21547v1)

TCS 在 NVIDIA 工程博客公开的实施报告使用图像序列、2D/3D 检测与车道模型、跟踪和半自动审核，并按 track ID 将单帧纠错传播到后续帧。它给出了实际工程链路，具体自研网络、独立 GT 准确性和长期收益仍未充分公开；传播后还需检查对象关联。[TCS：端到端自动标注 pipeline，2023](https://developer.nvidia.com/blog/?p=61526)

{{< mermaid >}}
flowchart TD
  R[原始观测和标注规范] --> T[教师预测或规则候选]
  T --> C[时序、几何与跨模态检查]
  C --> Q[分桶质检和独立参考集]
  Q --> H[人工纠错与争议仲裁]
  H --> V[标签版本和质量报告]
  V --> D[训练数据或评测参考]
  H --> F[教师错误与规范修订]
  F --> T
{{< /mermaid >}}

图为本文参考设计。对评测参考集，应提高独立审核要求，并隔离训练与标签模型调优使用的数据。

### 怎样验证自动标签

CVAT 的质量机制使用 ground-truth job 对比注释，也支持 consensus。当前自动 QA 文档限定了产品版本与 2D 支持范围，不能直接套到全部 3D/4D 任务。共识衡量标注之间的一致程度，无法单独证明真实准确性。Argilla 将 suggestion 与 response 分开保存，有助于保留预测和审核的区别；字段名本身仍不能证明标签来源和正确性。[CVAT 自动 QA](https://docs.cvat.ai/docs/qa-analytics/auto-qa/)、[Argilla Suggestion](https://docs.argilla.io/latest/reference/argilla/records/suggestions/)

**本文设计建议：** GT 工作台同时显示来源、生成模型、规范版本、审核状态、质量报告与可观测性。按场景、模态、遮挡和难度抽样验证，检查接受、修正和拒绝的分布；对可能共享偏差的多个模型，增加独立人工或测量证据。模型分数很高时也保留复核路径。

## 6 表征和检索：语义相似之后还要检查什么

检索通常经历解析查询、结构化过滤、候选召回、重排和证据检查。双编码器把图像或视频与文本映射到相容空间，使文本查视觉数据成为可能。SigLIP 2 在图文学习基础上加入定位相关与自监督目标、在线数据策展；Cosmos-Embed1 面向视频与物理场景检索，用时序特征与 QFormer 汇聚视频表征。具体检索表现仍取决于任务和标注方式。[SigLIP 2](https://arxiv.org/abs/2502.14786)、[Cosmos-Embed1 官方研究页](https://research.nvidia.com/labs/cosmos-lab/cosmos-embed1/)

对归一化向量，常见相似分数为 $s(q,x)=e(q)^\top e(x)$。这个分数表达编码空间中的接近程度；“抓取后滑落”还包含对象身份、动作顺序和任务结果，可能需要事件分段、轨迹与结构化约束。

索引解决候选搜索的效率与近似误差。Faiss 的 Flat、HNSW、IVF 和 PQ 分别提供精确遍历、图近邻、粗分桶与压缩等机制。评价时应把编码器的语义相关性与近似索引召回分开：索引更精确无法补救错误表征，语义结果好看也不能证明候选召回充分。[Faiss 索引说明](https://github.com/facebookresearch/faiss/wiki/Faiss-indexes)

FiftyOne 的 DatasetView 可组合过滤、排序与视图操作，相似索引可对样本或对象 patch 查询。对象级索引适合找相似局部目标，片段级索引适合语义召回，track 或事件结构再补足时间关系。[FiftyOne：Dataset views](https://docs.voxel51.com/user_guide/using_views.html)

**本文设计建议：** 检索页展示命中来源、语义相似、时间条件、对象关系和模型版本；结果同时能进入样本查看、复核、挖掘集合或数据集草稿。对“雨夜遮挡后出现的行人”，先用天气、时间和模态缩小范围，再语义召回，最后检查出现时刻与遮挡关系。检索评测要用有标注的查询集衡量召回和相关性，而不是只看结果是否像。

## 7 挖掘和选样：数据为什么值得进入训练

规则挖掘适合已知事件，聚类有助于检查覆盖，异常检测发现偏离，不确定性和模型分歧用于挑选值得验证的候选。它们的输出需要结合代表性、重复度、标签可靠性和实际目标。

分类熵 $H(p)=-\sum_k p_k\log p_k$ 可以给出不确定性信号。BatchBALD 则以批量互信息考虑样本之间的冗余，避免只按单样本分数挑选近似候选。其假设、后验近似和任务设置必须保留。[BatchBALD 原始论文](https://arxiv.org/abs/1906.08158)

LESS 用梯度相似性做目标能力导向的指令数据选择；它需要目标示例与模型相关信息。此类方法的效果应与同预算随机、质量筛选和多样性基线比较，不能由一次目标任务提升推导全面能力提升。[LESS 原始论文](https://arxiv.org/abs/2402.04333)

ICML 2026 的复验拆开表征与选择器，发现排名依赖任务、预算、模型和候选池。目标损失或相似分数改善，也未必转成下游收益。这给平台的实验设计提供了直接理由：保留强基线、多个随机种子和独立目标评测。[A Critical Look at Targeted Instruction Selection](https://proceedings.mlr.press/v306/nayak26a.html)

### 从失败簇到数据任务

NVIDIA DRIVE 的历史公开说明提供了实际模型挖掘路径：已有标注数据训练 DNN，扫描未标注数据，选择模型不易识别的帧，人工审核标注后加入训练池。这支持离线数据上的主动学习机制，不能据此声称车端触发、排序与多样性规则都已公开。[NVIDIA：Active Learning，2020](https://blogs.nvidia.com/blog/what-is-active-learning/)

**本文设计建议：** 挖掘首先固定问题定义，再汇集失败候选，按根因和场景聚类，检查已有数据覆盖与标签可靠性。随后在可用候选中选择代表样本，并明确进入补采、标注、清洗修复或训练哪条路径。

例如抓取后滑落，可能需要失败恢复轨迹，也可能是时间对齐错误或接触模型问题。把所有高损失片段直接加入训练，会混入数据错误和系统问题。因此选样页面要呈现“选择理由”和“下一步用途”。

适合平台比较的选样方案包括随机、规则、质量、分桶多样性、模型分歧和目标能力方法。共同评价条件是固定数据预算、训练配置与独立验证；结果还要报告旧能力和未目标化场景的变化。

## 8 合成数据与仿真：覆盖如何扩大，证据如何保留

NVIDIA 2026 年 3 月公布的 Physical AI Data Factory 参考架构包含策展与搜索、增强生成、评估验证，并由工作流系统编排。这是厂商公开的架构描述；物理正确、成本和最终任务收益需要相应实验验证。[Physical AI Data Factory 官方公告](https://nvidianews.nvidia.com/news/nvidia-announces-open-physical-ai-data-factory-blueprint-to-accelerate-robotics-vision-ai-agents-and-autonomous-vehicle-development/)

Isaac Sim 的 Synthetic Data Recorder 使用 writer 与 annotator 输出图像和注释，语义标签取决于场景资产配置。这样得到的 GT 对应虚拟场景。生成式外观修改后，原 mask、对象边界和几何是否仍有效，也需要重新核查。[Isaac Sim Recorder](https://docs.isaacsim.omniverse.nvidia.com/latest/replicator_tutorials/tutorial_replicator_recorder.html)

Waymo 2026 年介绍的 World Model 展示了相机与 LiDAR 生成，以及行动、布局和语言条件控制。公开演示能够说明其所展示的能力，但不能据此推断完整训练数据、全部场景 GT 或独立的真实安全收益。[Waymo World Model](https://community.waymo.com/blog/2026/02/the-waymo-world-model-a-new-frontier-for-autonomous-driving-simulation/)

SplatAD 则研究另一条路线：从带位姿的传感器日志重建动态场景，以 3D Gaussian Splatting 渲染相机与 LiDAR。渲染质量与新视角一致性是有价值的指标，交通参与者行为、动力学和闭环策略效果仍需分别验证。[SplatAD，CVPR 2025](https://arxiv.org/abs/2411.16816)

**本文设计建议：** 合成任务从覆盖缺口开始，保留种子、生成器、场景、控制与筛选记录；将视觉质量、语义正确、几何一致、物理约束和下游任务收益分开评价。真实与合成比例进入配方实验，使用独立真实环境验证其作用。

## 9 数据集构建：工作视图怎样变成训练资产

FiftyOne 的 DatasetView 保存视图操作，底层 Dataset 改变时，视图结果也可能改变。它适合持续分析与筛选，却不能仅凭视图名称重建旧实验。lakeFS 的 commit 则提供不可变的逻辑数据检查点，并复用未改变的数据块。[FiftyOne views](https://docs.voxel51.com/user_guide/using_views.html)、[lakeFS 数据模型](https://docs.lakefs.io/concepts/internals/)

**本文设计建议：** 从动态候选集合发布数据集时，固定成员、内容、标签、规范、划分与变换。对象存储的提交还应关联外部标签、标定、索引和配方版本。检索索引用于重现候选发现过程；训练实际消费哪些成员应另有固定清单。

### 划分单位要跟任务一致

SAM 2 使用作者和地点等信息划分数据，并让验证、测试的标注方式减少对待测模型的依赖。这个做法提示：连续帧、同一场景和同一采集来源不能简单随机拆散后就假定独立。[SAM 2，§5.2 与附录](https://arxiv.org/html/2408.00714v2)

在参考设计中，机器人按 episode、环境或对象分组，智驾按事件、地点和时间核查重叠，智能体按任务与交互轨迹分组。最终选择取决于要测量同分布表现、跨环境迁移还是长期变化。数据集页面要展示划分依据、重叠检查和成员差异。

这里值得增加一个发布闸门：检查状态可以是通过、失败、告警或未知。“还没有检查”应保留为未知。标签修订形成新版本；若评测 GT 改变，要重新评测比较模型，并记录参考变化。

## 10 配方搜索：数据组合如何改变能力

数据配方包含域比例、质量阈值、权重、难度、课程、真实与合成比例、序列长度和增强。训练配方包含目标、阶段、损失和优化设置。把二者分别记录，才方便判断哪类改变产生作用。

### DoReMi：学习域权重

DoReMi 先训练小 reference，再用小 proxy 做 Group DRO；相对 reference 的 excess loss 驱动域权重更新，所得比例用于更大模型。原文还有多轮权重迭代。高原始 loss 可能来自噪声，因此算法使用相对量。公开实验针对语言模型域混合，迁移到机器人任务混合需要重新验证。[DoReMi，算法与消融](https://arxiv.org/html/2305.10429v3)

其目标可概括为：

$$
\min_\theta\max_{\alpha\in\Delta}\sum_d\alpha_d\,
\mathbb{E}_{x\sim D_d}\!\left[\ell_\theta(x)-\ell_{\mathrm{ref}}(x)\right].
$$

公式省略实现中的 token 聚合、平滑与训练期平均；实际 Algorithm 1 还将每 token excess loss 截断为非负，即 `max(excess, 0)`。原文明确说明，这使实际优化与展示的 minimax 目标并不完全相同。公式帮助理解方向，复现应按完整算法核查。

### RegMix：预测配方效果

RegMix 对多种混合比例训练小模型，以配方到验证 loss 的回归预测排序候选，再进行目标规模实验。论文比较线性与 LightGBM 等模型，跨规模结论有 tokenizer、词表和训练设置条件。代理预测应与实际目标训练结果并列展示。[RegMix，§3 与 tokenizer 假设](https://arxiv.org/html/2407.01492v2)

**本文设计建议：** 配方工作台展示来源比例、目标能力、搜索方法、reference/proxy、候选、预测和已测收益。每个实验关联数据 release。对多能力目标，报告分桶收益和旧能力回归；先做可解释的对照，再扩大联合搜索。

## 11 训练：样本如何变成监督信号

同一资产可以被转换成不同训练单位。文本预训练使用 token 序列；SFT 使用指令与回答；DPO 使用 prompt、偏好回答与非偏好回答。DPO 根据 policy/reference 的相对概率优化偏好，其标签表达特定规则下的比较，不能当作事实正确性的统一 GT。[DPO 原始论文](https://arxiv.org/abs/2305.18290)

DeepSeek-R1 的公开管线结合冷启动、推理 RL、拒绝采样生成 SFT 数据和后续 RL。数学答案或代码测试等提供可验证信号，其他任务使用模型奖励。验证器覆盖不足和奖励偏差仍是数据质量问题。[DeepSeek-R1，§2.2–2.3](https://arxiv.org/html/2501.12948v1)

在机器人训练中，状态、图像、动作和任务描述按时间构成样本，可能使用动作窗口、归一化与图像变换。LeRobot 的加载机制公开了 episode 访问、流式读取与变换，说明数据格式之外还需要记录训练时如何采样。[LeRobotDataset v3](https://huggingface.co/docs/lerobot/lerobot-dataset-v3)

### 具身策略：从动作示教到连续动作分布

Diffusion Policy 将示教动作序列作为条件扩散目标：给动作加噪，模型在观测条件下学习去噪；推理从噪声迭代产生动作序列，执行其中一段后，再依据新观测规划。这把观测窗口、预测窗口与执行窗口分开，也使闭环中的执行状态影响下一次输入。[Diffusion Policy，RSS 2023](https://diffusion-policy.cs.columbia.edu/)

π₀ 在预训练 VLM 上增加 action expert，用观测、语言、机器人状态与带噪动作块学习条件向量场；推理积分生成连续动作。它用跨机器人混合数据训练，再以高质量任务数据后训练。这里的监督需要明确动作单位、时序、形态与任务，训练 loss 仍须由实机结果验证。[π₀，§III–V，2024](https://arxiv.org/html/2410.24164v1)

两种路线都建模动作分布，但视觉条件、动作块和执行策略不同。平台的训练数据构建器应保留这些差异，避免把动作窗口、归一化与丢失流处理藏在不可追溯的加载脚本中。

### 世界模型：视频预测与想象中的策略学习

Cosmos 的 2025 技术报告公开连续／离散视频 tokenizer，以及扩散和自回归两条训练路线：视频先压缩成 latent，再学习条件去噪或 token 预测；面向具体任务的后训练加入相机、动作、轨迹或指令条件。它提供未来观测生成，是否正确响应控制和保持物理一致还需专门验证。[Cosmos WFM，§4–6](https://arxiv.org/html/2501.03575v1)

DreamerV3 面向环境交互：从 replay 中读取观测、动作、奖励和 continuation，以 RSSM 学习 latent 状态转移，联合重建观测、预测奖励和持续状态，并在想象轨迹上训练 actor/critic。策略执行得到的新经验继续进入 replay。它给出了世界模型参与策略学习的实际算法闭环；论文环境与现实机器人之间的迁移需要另行验证。[DreamerV3，Learning algorithm](https://arxiv.org/html/2301.04104v2)

从数据角度看，前者常以条件—视频对构建训练样本，后者需要交互序列及结果信号。**本文设计建议：** 世界模型工作台分别保存生成条件、真实未来、动作与奖励，评测页区分重建、长时预测、控制响应和最终任务收益。

### 训练日志怎样回到数据

Confident Learning 利用样本外预测和类别噪声假设识别可能的标签问题，可用于安排复核。它给出疑错排序而非最终真值，分类假设也不能原样覆盖轨迹与连续几何。[Confident Learning](https://research.google/pubs/confident-learning-estimating-uncertainty-in-dataset-labels/)、[cleanlab 对预测输入的说明](https://docs.cleanlab.ai/v2.6.0/cleanlab/classification.html)

**本文设计建议：** 训练页关联数据 release、采样与变换、标签、配方和模型。高 loss、分歧或异常样本回到样本详情复核；保留采样权重与出现次数，区分难例、噪声、重复和模型能力不足。训练成功后进入评测，执行状态和质量判断分别记录。

## 12 评测：总分怎样变成可行动的问题

DataComp 与 DCLM 用固定训练框架比较数据策略，为数据干预的受控验证提供范式。模型、训练量与评测条件变化时，应明确哪些结果仍可比较。[DataComp 原始研究](https://papers.neurips.cc/paper_files/paper/2023/hash/56332d41d55ad7ad8024aac625881be7-Abstract-Datasets_and_Benchmarks.html)、[DCLM](https://arxiv.org/abs/2406.11794)

FiftyOne 可以把检测评测的 TP、FP、FN 变成对象级 patch 视图，再筛选、查看并关联源样本。FP/FN 是相对于当前参考和协议的结果，先核查 GT 才能归因。[FiftyOne detection evaluation](https://docs.voxel51.com/user_guide/evaluation/detections.html#evaluation-patches-views)

### 物理系统中的评测层次

Waymax 基于 WOMD 提供对象级多智能体行为仿真，支持交互 rollout。它用对象框而非原始传感器作为状态，因此不能单靠它验证相机曝光、LiDAR 缺失或感知误差。WOSAC 进一步研究模拟参与者的真实性；参与者 realism 与 ego 策略成功仍是不同问题。[Waymax](https://github.com/waymo-research/waymax)、[WOSAC 原始研究](https://waymo.com/research/the-waymo-open-sim-agents-challenge/)

Alpamayo-R1 的历史技术报告分别讨论开环、闭环仿真和实车评测，并公开决策片段选择、教师与人工协作等数据构建方式。论文中决策解释是有观测约束的监督，不能据此测量驾驶员内在心理因果；分层评测也不能直接证明完整量产安全。[Alpamayo-R1，§4–6，v1](https://arxiv.org/html/2511.00088v1)

**本文设计建议：** 评测页按“离线输出、交互行为、传感器仿真、真实运行”分层。用户从总分进入场景桶、对象或 episode，检查失败证据、GT、协议与版本，再生成问题。世界模型分别检查生成质量、控制响应、长期一致性及下游策略；空间智能分别检查几何、尺度、动态关联与新视角。

### 有效的收益验证

以下为基于受控数据实验范式提出的验证设计：固定模型、训练条件与独立验证，比较原始基线、仅改数据、仅改配方及联合变化；使用多个 seed，并报告分桶结果和不确定性。补数据、重标、调整阈值和换模型同时发生时，结论应保留混杂因素。

持续迭代还需要保留最终测试的独立性。用于定向选样和配方搜索的开发集应与最终验证分开；反复围绕同一测试失败修复后，应增加未参与开发的新环境或时间切片。

## 13 架构：数据流、任务流和反馈流如何衔接

### 公开系统提供了什么机制

Dagster 用 asset 表达产物与依赖，用 run 表达执行；asset sensor 可在产物事件后触发任务，或记录 SkipReason。质量 check 是否真正阻断下游取决于 blocking 等执行语义，仅有红色状态不等于闸门。[Dagster pipeline](https://dagster.io/docs/getting-started/quickstart)、[asset sensors](https://dagster.io/docs/guides/automate/asset-sensors)、[asset checks](https://dagster.io/docs/api/dagster/asset-checks)

MLflow 可以记录数据名称、来源、digest、schema/profile，并将数据和运行关联。digest 的计算方式因数据对象而异，不能统一解释成全量内容哈希。对象快照与实验 tracking 因而承担不同职责。[MLflow Dataset Tracking](https://mlflow.org/docs/latest/ml/dataset/)

### 一套参考整合架构

下图为本文设计建议，整合前述局部机制，不是单一厂商的部署图。

{{< mermaid >}}
flowchart TD
  subgraph D[数据与算法]
    A[采集与原始资产] --> B[清洗和质量检查]
    B --> C[表征、索引和挖掘]
    B --> G[GT候选与人工审核]
    C --> G
    C --> R[数据集草稿与冻结]
    G --> R
    R --> T[配方搜索与训练]
    T --> E[分层评测与真实运行]
  end
  subgraph P[共享平台能力]
    M[元数据、本体和血缘]
    V[数据、标签、配方、模型版本]
    O[编排、事件、状态和质量闸门]
    U[角色权限、协作和审计]
  end
  M -.关联.-> A
  M -.关联.-> C
  V -.固定.-> R
  V -.固定.-> T
  O -.执行.-> B
  O -.执行.-> E
  U -.授权.-> G
  E --> I[问题、证据和归因]
  I --> N{下一轮行动}
  N -->|补采| A
  N -->|修标签| G
  N -->|调整组合| R
  N -->|改配方| T
  N -->|修系统或评测| E
{{< /mermaid >}}

数据平面承载媒体、标签、向量与训练数据；控制平面承载定义、版本、任务、权限和状态。前端通过这些对象呈现工作，不应把大规模处理过程混进页面请求中。这个划分是参考架构，可根据已有系统调整。

运行状态至少区分依赖等待、排队、执行、失败、跳过与完成。质量与发布另有状态；关键检查未运行时显示未知。重试保留原始意图与尝试记录，取消说明哪些产物已经产生，恢复说明哪些处理可复用。

内部平台重视实验可追溯和专家效率；外部产品在同一对象关系上增加客户、workspace 和项目边界，以及配置、本体、引导、导出与审计。这是产品要求，不能由按钮可见性证明后端隔离已经充分实现。

## 14 产品：把算法结果变成可以操作的工作

### 从公开产品借鉴局部机制

FiftyOne 将视图、相似检索和错误对象连接，Argilla 区分建议与反馈，CVAT 表达审核与参考比较，Rerun 把 recording 与显示 blueprint 分开。它们分别提供可核查的交互或数据机制。本文核查官方文档，未将所有产品操作都视为实测。[FiftyOne views](https://docs.voxel51.com/user_guide/using_views.html)、[Argilla](https://docs.argilla.io/latest/reference/argilla/records/suggestions/)、[CVAT](https://docs.cvat.ai/docs/qa-analytics/auto-qa/)、[Rerun blueprints](https://docs.rerun.io/dev/concepts/visualization/blueprints/)

真实采用也有公开案例。FiftyOne 的匿名汽车客户案例描述自建 pipeline 接入、查询策展、标注纠错和 Azure ML 衔接。CVAT 的命名客户 FERNRIDE 案例介绍点云/视频标注，以及精细 cuboid 旋转、数值尺寸输入和多视角方向箭头。这些是厂商发布的客户采用证据，不能单靠它们证明市场份额或独立模型收益。[FiftyOne 汽车客户案例](https://voxel51.com/customers/global-fortune-500-automotive-leader)、[CVAT／FERNRIDE 案例](https://www.cvat.ai/case-study/fernride)

**以下页面和工作台均为本文设计建议。** 每个页面围绕一个决策组织信息，并让关键产物能进入下一模块。

{{< codex-table label="产品工作台与数据流转设计" >}}
| 页面／使用者 | 要完成的工作 | 核心交互与输出 | 需要看见的证据 |
| --- | --- | --- | --- |
| 问题与场景／算法、运营 | 把失败变成可验证需求 | 复现、归因、创建行动与验收 | 失败样本、模型、协议、假设 |
| 数据资产／数据工程 | 判断来源与可用性 | 检查流、版本、处理和隔离 | 来源、时间、授权、血缘 |
| 检索挖掘／算法 | 建立候选集合 | 种子查询、条件筛选、选样 | 命中理由、模型、索引、覆盖 |
| 样本播放器／多领域 | 检查事件与跨模态关系 | 逐帧、3D、轨迹与信号联动 | 原始流、时间差、标定、缺失 |
| 清洗／数据、算法 | 决定删、修、降权或复核 | 预览影响、修订规则 | 命中理由、原样本、分布变化 |
| GT 审核／标注、质检 | 建立可信监督 | 预测对照、盲审、纠错、仲裁 | 来源、规范、金标准、质量 |
| 数据集／算法 | 发布可复现实验资产 | 成员差异、划分检查、冻结 | 内容、标签、覆盖、泄漏检查 |
| 配方／研究员 | 比较组合和训练阶段 | 生成候选、代理实验、实测 | 条件、预测、已测收益、回归 |
| Pipeline／工程 | 定位执行卡点 | 节点详情、重试、取消、恢复 | 输入、输出、尝试、质量状态 |
| 评测／测试、算法 | 从总分定位原因 | 桶、对象、证据与问题 | 协议、GT、版本、分层结果 |
| 迭代复盘／跨团队 | 判断行动是否解决问题 | 版本链、差异、结案或再迭代 | 改动、验证、回归、真实反馈 |
{{< /codex-table >}}

### 界面布局、组件和视觉语义

检索工作台可采用左侧条件、中部结果、右侧选样理由与队列。GT 页把观测、教师建议和人工参考放入可切换图层，避免颜色相同造成来源混淆。迭代页以问题为入口，展示版本链和不同实验的改变。

视觉上区分对象类型、执行状态和质量状态：中性颜色表示类型，状态色附文字，未知与失败具有不同含义；不确定内容保留原因与检查入口。密集结果可用表格，时间关系使用播放器和时间轴，空间关系使用 3D 视图。必要时保留相同数据的不同布局，借鉴 Rerun blueprint 的数据与显示分离机制。

交互上，选择项在筛选后仍保留；切换页面应保留查询上下文；长任务显示阶段和跳过理由；有未保存修改时说明恢复方式。键盘焦点、按钮标签、移动端横向表格和无脚本阅读都应成为设计验收的一部分。这些是本文的产品与可访问性建议。

下面的交互工作台把检索选样、GT 证据和三轮版本链放在同一个示意中。样本与任务均为演示，没有连接真实模型，也没有模拟效果数字。

{{< data-loop-workbench >}}

## 15 第一轮、第二轮、第三轮：反馈如何改变行动

### 三条有公开依据的迭代机制

SAM 2 的 Phase 3 更新模型五次，并有独立审核和失败返工；数据引擎实际改变标注模型与数据。Llama 3 的 §4.1.6 报告六轮后训练，每轮收集新的偏好和 SFT 数据，并从最新模型生成候选；随能力提升调整标注任务。DAgger 则迭代收集当前策略访问状态上的专家动作，聚合数据并更新策略。[SAM 2，§5](https://arxiv.org/html/2408.00714v2)、[Llama 3，§4.1.6–4.2](https://arxiv.org/html/2407.21783v3)、[DAgger 原始论文](https://proceedings.mlr.press/v15/ross11a.html)

三者分别提供标注、后训练和顺序决策的公开迭代依据。DAgger 的专家可查询等假设需要保留；现实干预数据不自动等同完整专家监督。

### 整个平台的参考三轮流程

下表是本文设计案例，版本符号用于说明关系，不代表真实企业项目。

{{< codex-table label="完整闭环的三轮设计案例" >}}
| 轮次 | 数据和模型变化 | 用户与系统动作 | 决策条件 |
| --- | --- | --- | --- |
| 第一轮：建立基线 | 原始资产 A1、标签 L1、数据集 D1、配方 C1、模型 M1 | 检查来源与 GT，固定划分，训练与分层评测，记录失败 | 建立有证据的问题 I1 和明确验收条件 |
| 第二轮：验证修复 | 新增或修订 A2/L2/D2，配方 C2，模型 M2 | 检索已有样本、补采或修 GT；分别做数据与配方对照 | 独立验证改善，旧能力复测，保留未确定归因 |
| 第三轮：检查迁移与复发 | A3/L3/D3/C3/M3，必要时改教师或索引 | 核查真实反馈、剩余失败和新场景；更新触发、选样或标注 | 目标、回归和真实任务均有证据，再决定结案或继续 |
{{< /codex-table >}}

如果第二轮只是修正评测漏标，应把两个模型都放到相同新 GT 上重评；如果只修复传感器对齐，不应把变化归因于训练数据增量。第三轮也可以作出“暂不训练”的决策，先补证据或修系统。

### 各领域怎样落到真实问题

下面都是带假设的设计案例，其组成机制来自前文资料，实际效果需要实验。

LLM／智能体从失败任务进入问题分类，检索相似指令或交互轨迹，核查工具环境和验证器，再构建 SFT、偏好或可验证任务数据。第二轮测目标任务和旧能力，第三轮检查新任务及环境变化。LLM 生成候选与拒绝采样的机制可参考 DeepSeek-R1，具体工单与产品流程由本文提出。

VLM 从小目标漏检或事件顺序错误开始，先检查 GT 与采样。第二轮分别补区域、时序监督或采样覆盖，第三轮验证新分辨率、长视频和旧能力。Qwen3-VL 的 grounding 与视频数据构建提供局部机制，不能因此宣称其内部采用本例全部步骤。

机器人“抓取后滑落”先建立示教基线和真实任务结果。第二轮核查同步、物体材质、策略访问状态与恢复行为，再补采纠正。第三轮验证新物体和环境，并检查力觉、接触与仿真差距。数据组织可参考 DROID/LeRobot，状态纠正可参考 DAgger；成功率不由离线动作 loss 代替。

智驾“遮挡处出现两轮车”先核查标签与原始事件。第二轮区分漏检、预测、规划和仿真参与者问题，组合相似场景与受控变体。第三轮分别做行为、传感器与真实条件验证，保持旧场景回归。Waymax、重建与世界模型分别支撑不同层次。

世界模型从控制不服从或长期漂移开始。第二轮检查初始状态、动作条件、序列长度与生成质量，第三轮比较新条件和下游策略。控制式生成演示可以提供线索，最终需要独立的时序、物理和任务测试。

空间智能从尺度、动态关联或新视角误差开始。第二轮核查标定、可观测性和重建监督，再决定补观测或修改模型。第三轮检查新场景和地图变化。几何预测与直接测量的差异应始终可见。

## 16 怎样判断闭环真的有效

**以下是本文综合设计的指标与验收建议。** 它们对应前述模块，具体阈值应由任务定义和数据验证确定。

{{< codex-table label="数据闭环的决策指标" >}}
| 层次 | 应观察的结果 | 容易误解的信号 |
| --- | --- | --- |
| 来源与覆盖 | 可用来源、场景覆盖、有效新增、采样偏差 | 总数据量与采集时长 |
| GT 与质量 | 独立参考下的准确性、误删、分桶错误、返工 | 置信度、多人一致、统一质量总分 |
| 检索与挖掘 | 有标注查询上的召回、相关性、覆盖增量 | 相似分数或候选数量 |
| 数据集与实验 | 可重建版本、划分独立、受控对照 | 只保存查询名或可变链接 |
| 模型与任务 | 目标能力、回归、不确定性与真实成功 | 训练完成、单一总分、裁判偏好 |
| 迭代 | 问题复现、归因、修复、复发及下一轮决策 | pipeline 成功次数 |
{{< /codex-table >}}

平台的发布检查可以从一条实际问题开始：能否找到原始证据，解释 GT，重建训练输入，比较相同条件下的模型，追踪下一轮动作，并确认目标问题和旧能力的变化。闭环的价值最终落在这些可核查关系上。

## 17 资料索引与证据边界

### 为什么选择这些代表

“主流工程”和“领先研究”需要分别判断。下表给出可核查的入选理由；原始论文的对比只支持相应研究版本和实验条件，不代表 2026 年所有任务的实时冠军。采用案例支持具体使用，尚不足以计算全球采用占比。

{{< codex-table label="代表方案的成熟度与入选依据" >}}
| 类别 | 代表 | 可核查的依据 | 在本文中的位置 |
| --- | --- | --- | --- |
| 公开大型模型实践 | Llama 3、Qwen3-VL、DeepSeek-R1 | 技术报告公开数据、训练和评测机制：[Llama](https://arxiv.org/html/2407.21783v3)、[Qwen](https://arxiv.org/html/2511.21631v1)、[R1](https://arxiv.org/html/2501.12948v1) | 研究真实 pipeline，不推断全部内部系统 |
| 规模化驾驶实践 | Waymo | [2026 工程文章](https://waymo.com/blog/2026/08/10ailessons/)披露实际反馈、自动标注、重训与验证循环 | 企业工程自述，未独立审计全部效果 |
| 策展与实验基准 | FineWeb、DataComp／DCLM | 公开处理与固定训练对照：[FineWeb](https://arxiv.org/abs/2406.17557)、[DCLM](https://arxiv.org/abs/2406.11794) | 可复现研究与方法比较 |
| 标注引擎与视觉表征 | SAM 2、SigLIP 2 | [SAM 2](https://arxiv.org/html/2408.00714v2)公开多轮数据引擎；[SigLIP 2](https://arxiv.org/html/2502.14786v1)公开任务对比与模型 | 有实证的研究方案，保留任务边界 |
| 空间理解研究 | VGGT | [CVPR 官方确认其获 2025 Best Paper](https://cvpr.thecvf.com/Conferences/2025/BestPapersDemos)，论文和模型公开 | 领先研究依据，不视为完整空间平台 |
| 具身与世界模型 | OXE、DROID、π₀、DreamerV3、Cosmos | 跨机构数据、真实机器人任务和原始训练/评测公开，见下方资料 | 各自路径的代表，不做统一排名 |
| 有采用证据的工程工具 | FiftyOne、CVAT | [汽车客户工作流](https://voxel51.com/customers/global-fortune-500-automotive-leader)、[FERNRIDE](https://www.cvat.ai/case-study/fernride)及官方功能文档 | 产品机制与具体采用，非行业份额结论 |
| 研究候选 | BatchBALD、LESS、SAM4D、DoReMi、RegMix | 原始论文、公开实验及选样复验 | 用于理解算法和设计实验，生产适用性另验 |
| 厂商参考架构 | Physical AI Data Factory | 官方公布模块与编排关系 | 架构线索；效果和完整交付范围分别验证 |
{{< /codex-table >}}

闭源系统未公开的采样、GT、配方和 UI 保持未知。平台方案优先借鉴可核查机制；需要研究模型的新能力时，把“候选方法”和“已验证适用”分别呈现。

### 按模块查阅来源

下面按模块列出本次核查的一手资料。论文年份表示其公开研究版本；`文档`指 2026 年 10 月 13 日核查的动态资料。企业官方介绍支持其公开描述，不作为独立效果验证。产品功能以所链接文档和版本边界为准。

{{< codex-table label="一手资料与证据用途" >}}
| 模块 | 一手资料 | 本文使用的证据与边界 |
| --- | --- | --- |
| 数据来源与清洗 | [FineWeb，2024](https://arxiv.org/abs/2406.17557)；[官方技术报告](https://huggingfacefw-blogpost-fineweb-v1.static.hf.space/index.html) | 网页策展、逐 crawl 去重与消融；不外推全部领域 |
| 受控数据实验 | [DCLM，2024](https://arxiv.org/html/2406.11794v1)；[DataComp，2023](https://papers.neurips.cc/paper_files/paper/2023/hash/56332d41d55ad7ad8024aac625881be7-Abstract-Datasets_and_Benchmarks.html) | 固定训练与评测比较数据；基准条件需保持 |
| 去重算法 | [BigCode，2023](https://huggingface.co/blog/dedup) | MinHash、LSH 与保留策略；候选关系不等于语义或真值 |
| 视频策展 | [Cosmos Curator 文档](https://github.com/NVIDIA/cosmos-curator/blob/main/docs/curator/reference/video-pipelines.md) | 切分、描述、embedding、去重、分片；可选步骤与版本相关 |
| 语音策展 | [NeMo 音频策展](https://docs.nvidia.com/nemo/curator/curate-audio)；[ASR 文档](https://docs.nvidia.com/nemo/curator/curate-audio/process-data/asr-inference/nemo-models) | manifest、模型转写、质量与文本集成；参考转写需核查 |
| 语言模型 | [Llama 3，2024](https://arxiv.org/html/2407.21783v3)；[DeepSeek-R1，2025](https://arxiv.org/html/2501.12948v1) | 后训练迭代与验证信号；不重建未公开企业系统 |
| 多模态数据 | [Qwen3-VL，2025](https://arxiv.org/html/2511.21631v1) | grounding、视频与监督构建；论文报告条件 |
| 真实具身数据 | [OXE／RT-X，2023–2024](https://robotics-transformer-x.github.io/)；[DROID，2024](https://droid-dataset.github.io/) | 跨机器人、多环境示教与数据修订；非完整生产运营闭环 |
| 动作与世界模型训练 | [Diffusion Policy，2023](https://diffusion-policy.cs.columbia.edu/)；[π₀，2024](https://arxiv.org/html/2410.24164v1)；[Cosmos WFM，2025](https://arxiv.org/html/2501.03575v1)；[DreamerV3，2023–2025](https://danijar.com/project/dreamerv3/) | 条件动作分布、视频 latent 与交互世界模型；各自任务与训练假设不同 |
| 时序数据组织 | [LeRobotDataset v3 文档](https://huggingface.co/docs/lerobot/lerobot-dataset-v3) | episode、Parquet、视频、元数据与加载；格式不证明质量 |
| 现实标注规范 | [Waymo 标签规范](https://github.com/waymo-research/waymo-open-dataset/blob/master/docs/labeling_specifications.md) | 可见范围、遮挡与标签规则；未披露内部标注模型 |
| 视觉表征 | [SigLIP 2，2025](https://arxiv.org/html/2502.14786v1)；[Cosmos-Embed1 研究页](https://research.nvidia.com/labs/cosmos-lab/cosmos-embed1/) | 图文与视频表征；相似不证明所有时空条件 |
| 定位与分割 | [Grounding DINO，2023–2024](https://arxiv.org/abs/2303.05499)；[SAM 2，2024–2025](https://arxiv.org/html/2408.00714v2) | 候选检测、分割传播与数据引擎；需审核 |
| 4D 伪标签 | [SAM4D，2025](https://arxiv.org/html/2506.21547v1) | 跨模态重建与 pseudo-GT；研究代表、依赖已有监督 |
| 标签疑错 | [Confident Learning，2021](https://research.google/pubs/confident-learning-estimating-uncertainty-in-dataset-labels/)；[cleanlab 2.6](https://docs.cleanlab.ai/v2.6.0/cleanlab/classification.html) | 样本外概率与疑错排序；保留噪声模型假设 |
| 主动选样 | [BatchBALD，2019](https://arxiv.org/abs/1906.08158)；[LESS，2024](https://proceedings.mlr.press/v235/xia24c.html)；[2026 复验](https://proceedings.mlr.press/v306/nayak26a.html) | 信息增益、梯度表征与适用边界；无通用赢家结论 |
| 向量索引 | [Faiss 文档](https://github.com/facebookresearch/faiss/wiki/Faiss-indexes) | 近似索引的精度与效率取舍；非完整检索平台 |
| 配方与偏好 | [DoReMi，2023](https://arxiv.org/html/2305.10429v3)；[RegMix，2024](https://arxiv.org/html/2407.01492v2)；[DPO，2023](https://arxiv.org/abs/2305.18290) | 域权重、代理搜索、偏好优化；条件和标签含义不同 |
| 合成数据 | [Isaac Sim Recorder 文档](https://docs.isaacsim.omniverse.nvidia.com/latest/replicator_tutorials/tutorial_replicator_recorder.html)；[Physical AI Data Factory，2026](https://nvidianews.nvidia.com/news/nvidia-announces-open-physical-ai-data-factory-blueprint-to-accelerate-robotics-vision-ai-agents-and-autonomous-vehicle-development/) | 虚拟状态标签与厂商参考架构；真实收益需验证 |
| 交互仿真 | [Waymax](https://github.com/waymo-research/waymax)；[WOSAC，2023](https://waymo.com/research/the-waymo-open-sim-agents-challenge/) | 对象行为与参与者真实性；不覆盖所有感知或真实安全 |
| 世界模型与重建 | [Waymo World Model，2026](https://community.waymo.com/blog/2026/02/the-waymo-world-model-a-new-frontier-for-autonomous-driving-simulation/)；[SplatAD，2025](https://arxiv.org/abs/2411.16816)；[VGGT，2025](https://github.com/facebookresearch/vggt) | 生成、渲染与几何预测；分别验证控制、物理、几何 |
| 驾驶数据与评测 | [Alpamayo-R1，2025，v1](https://arxiv.org/html/2511.00088v1)；[SimulationCity，2021](https://waymo.com/blog/2021/07/simulation-city/) | 决策监督、分层评测、经验回流；保留历史与公开范围 |
| 真实采集与反馈 | [Tesla 香港隐私声明](https://www.tesla.com/en_hk/legal/privacy)；[Waymo，2026](https://waymo.com/blog/2026/08/10ailessons/)；[NVIDIA Active Learning，2020](https://blogs.nvidia.com/blog/what-is-active-learning/) | 采集边界、反馈循环和模型挖掘；地区、历史与未公开机制分别说明 |
| 工程与客户采用 | [TCS 自动标注，2023](https://developer.nvidia.com/blog/?p=61526)；[FiftyOne 客户](https://voxel51.com/customers/global-fortune-500-automotive-leader)；[CVAT／FERNRIDE](https://www.cvat.ai/case-study/fernride) | 实施与具体采用；厂商效果自述不作为独立收益保证 |
| 顺序决策迭代 | [DAgger，2011](https://proceedings.mlr.press/v15/ross11a.html) | 策略访问状态的专家监督；专家可查询等假设 |
| 分析与标注产品 | [FiftyOne views](https://docs.voxel51.com/user_guide/using_views.html)；[detection evaluation](https://docs.voxel51.com/user_guide/evaluation/detections.html#evaluation-patches-views)；[Argilla Suggestion](https://docs.argilla.io/latest/reference/argilla/records/suggestions/)；[CVAT QA](https://docs.cvat.ai/docs/qa-analytics/auto-qa/) | 文档确认的局部机制；未声称全部界面实测 |
| 回放与显示 | [Foxglove Playback](https://docs.foxglove.dev/docs/visualization/playback)；[Rerun blueprints](https://docs.rerun.io/dev/concepts/visualization/blueprints/) | 时间游标与布局；不证明采集同步 |
| 版本与实验记录 | [lakeFS internals](https://docs.lakefs.io/concepts/internals/)；[MLflow datasets](https://mlflow.org/docs/latest/ml/dataset/) | 数据检查点与 run 输入记录；仍需绑定外部版本 |
| 编排与闸门 | [Dagster quickstart](https://dagster.io/docs/getting-started/quickstart)；[sensors](https://dagster.io/docs/guides/automate/asset-sensors)；[checks](https://dagster.io/docs/api/dagster/asset-checks) | 产物、运行、事件和阻断语义；不代替模型收益 |
{{< /codex-table >}}

平台实施时，可将本文的模块与对象关系对照[流水线与算子插件设计评审]({{< relref "/posts/data-flywheel/pipeline-plugin-design-review/index.md" >}})，检查哪些已有执行机制可以复用，哪些 GT、数据集、评测和反馈能力需要另行定义。两篇文章的设计建议都需要用真实任务验证后再进入交付结论。

+++
date = '2026-10-01T00:00:00+08:00'
draft = false
isCJKLanguage = true
title = '数据飞轮'
description = '研究数据从产生、清洗、GT、检索挖掘到训练评测和多轮迭代的完整闭环，并记录平台架构、产品设计、流水线与算子插件的实践。'
categories = []
tags = []
+++

这个专题研究数据如何产生、流转和进入模型，又如何依据评测与真实反馈继续迭代。文章区分公开研究、现有代码和设计建议，保留每项结论的依据与适用范围。

建议先读[数据闭环平台深度研究：数据算法、GT、检索挖掘与多轮迭代]({{< relref "/posts/data-flywheel/closed-loop-platform-research/index.md" >}})。它按模块拆解 LLM、VLM、具身、智驾、世界模型与空间智能中的代表方案，再汇总架构、产品工作台和第一轮到后续迭代的流程。

工程实践从**流水线编排与算子插件**开始：开发者交付可复用的处理能力，使用者将能力组合成流程，运行人员核对版本、执行状态和数据产物。

第一份文档是[流水线编排与算子插件需求文档草案]({{< relref "/posts/data-flywheel/pipeline-operator-requirements/index.md" >}})，供产品与工程共同确认范围。后续设计和交付记录应引用其中的需求与验收编号。

进一步的[流水线与算子插件设计评审]({{< relref "/posts/data-flywheel/pipeline-plugin-design-review/index.md" >}})结合 DeepSeek Harness、ComfyUI 和数据闭环平台，讨论前后端改进、执行契约与分阶段验收。

编排底座的比较见[Airflow Argo Dagster 对比与数据飞轮平台选型]({{< relref "/posts/data-flywheel/workflow-orchestration-selection/index.md" >}})，覆盖十个代表框架，并结合平台已有执行链、影像 AutoGT 和数据集交付给出推荐架构与验收路线。

合成数据生产可接着阅读[影像画质 Auto GT 生成方案与数据平台设计]({{< relref "/posts/data-flywheel/image-quality-auto-gt/index.md" >}})与[Cosmos Data Factory 调研与 AutoGT 数据筛选设计]({{< relref "/posts/data-flywheel/cosmos-data-factory/index.md" >}})：前者讨论参考数据如何生产，后者聚焦生成候选如何筛选、审核并用真实任务验证价值。

三维路线详见[三维重建技术综述与影像画质数据生成]({{< relref "/posts/spatial-intelligence/3d-reconstruction-survey/index.md" >}})，覆盖几何重建、NeRF、3DGS、逆渲染，以及重打光、HDR、虚化等任务的数据配对与验证。

自动标注与检索可阅读[VLM 标签为什么会变化及数据闭环检索的稳定性设计]({{< relref "/posts/data-flywheel/vlm-label-consistency/index.md" >}})，了解推理可复现性的控制边界，以及固定词表、标签版本和混合检索如何共同稳定数据选取。

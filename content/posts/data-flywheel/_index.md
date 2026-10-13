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

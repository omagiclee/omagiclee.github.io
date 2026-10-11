+++
date = '2026-10-01T00:00:00+08:00'
draft = false
isCJKLanguage = true
title = '数据飞轮'
description = '数据飞轮的需求、设计与交付记录，聚焦流水线编排、算子插件及可追踪的数据处理。'
categories = []
tags = []
+++

这个 topic 用于记录数据飞轮的需求、设计和交付依据。先明确用户要完成的工作与验收标准，再讨论技术方案和实现。

当前从**流水线编排与算子插件**开始：开发者交付可复用的处理能力，使用者将能力组合成流程，运行人员核对版本、执行状态和数据产物。

第一份文档是[流水线编排与算子插件需求文档草案]({{< relref "/posts/data-flywheel/pipeline-operator-requirements/index.md" >}})，供产品与工程共同确认范围。后续设计和交付记录应引用其中的需求与验收编号。

进一步的[流水线与算子插件设计评审]({{< relref "/posts/data-flywheel/pipeline-plugin-design-review/index.md" >}})结合 DeepSeek Harness、ComfyUI 和数据闭环平台，讨论前后端改进、执行契约与分阶段验收。

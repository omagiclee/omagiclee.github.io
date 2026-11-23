+++
date = '2026-11-23T23:25:00+08:00'
draft = false
title = 'Codex /review 与新开会话审代码，有什么区别？'
description = '对照 Codex 内置 Review Agent 与独立会话审查，拆解审查标准、上下文、模型与行内评论，并给出可以直接使用的提示词。'
summary = '固定标准、上下文隔离和行内评论，是 /review 相对新开 Codex 会话的主要区别。用同一份 diff 看两种方式各适合什么任务。'
categories = ['Codex']
tags = ['Codex', 'Code Review', 'AI Coding']
topic = true
contentLanguage = 'zh-CN'
isCJKLanguage = true
math = false
+++

在一个新开的 Codex 会话里说「审一下这个分支」，和直接运行 `/review`，都会让 Codex 读 diff、追相关调用链、检查可能的回归。**同一个模型拿到同一份 diff 和同样的背景，两种方式可以做很接近的审查。** `/review` 把审查标准、单独执行和结果展示做成了内置流程。手动开会话则方便把需求、设计决策和验证步骤一起交给审查者。

本文所说的 **Review Agent** 是本地 `/review` 调用的审查器。实现细节以 Codex CLI **0.171.0** 为准，桌面端展示依据官方文档。 [CLI 审查实现](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/core/src/tasks/review.rs) · [Codex Code Review 文档](https://learn.chatgpt.com/docs/code-review)

<!--more-->

## 同一份 diff，两种审查方式

{{< codex-table label="Codex 内置审查与独立会话审查对照" >}}

| 比较项 | 内置 `/review` | 新开 Codex 会话 |
| :--- | :--- | :--- |
| **审查范围** | 从基准分支、未提交改动、单次 commit 或自定义指令中选。 | 在提示词里指定分支、commit、文件或具体 Git 命令。 |
| **判断标准** | 加载内置规则，聚焦本次变更新引入、可定位、值得修复的问题。 | 可以采用同样的标准，也可以围绕产品契约、上线条件或指定风险调查。 |
| **会话上下文** | CLI 启动单独的审查任务，已有聊天记录默认不会传入。 | 新会话同样从独立上下文开始，可以主动附上需求、设计决策和测试结果。 |
| **模型与工具** | CLI 默认沿用当前模型，可用 `review_model` 单独指定。审查任务关闭了内置网页搜索和多 Agent 协作。 | 模型和可用工具由新会话的设置、权限与项目环境决定。 |
| **交付结果** | Codex 解析带优先级和代码位置的结构化发现。桌面端可把评论挂在对应的 diff 行上，CLI 在会话记录里展示。 | 一般以聊天回复呈现。可以要求同样的字段，也可以要求按调用路径、测试结果或验收条件组织。 |

{{< /codex-table >}}

决定审查质量的一个变量是**审查者拿到了什么信息**。如果“旧版客户端依然会调用这个字段”只在实现会话里聊过，独立审查时就要把这条契约写进审查指令，或指向记录它的仓库文档。打开另一个会话也要确认工作目录和 Git 版本，两个窗口里的 checkout 可能不同。 [CLI 审查实现](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/core/src/tasks/review.rs) · [桌面端与 CLI 的结果展示](https://learn.chatgpt.com/docs/code-review#work-with-review-results)

## 内置标准会怎样影响结果

内置规则要求指出**触发条件、实际影响和与 diff 重叠的代码位置**。它倾向于报告能够沿调用链查证的问题，结合相关的 `AGENTS.md` 等仓库指令，并用 `P0` 到 `P3` 标出优先级。第四项 **Custom review instructions** 仍然使用这套规则，你输入的指令负责指定本次审查的范围和重点。 [内置审查标准原文](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/prompts/templates/review/rubric.md) · [四个选项对应的请求](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/prompts/src/review_request.rs)

假设一个 PR 改了批次导入的重试逻辑，导致写入成功、状态更新失败时重试会再写一遍。下面模拟桌面端在触发重试的改动行下方呈现的评论。

> **[P1] 避免状态更新失败后重复写入批次**\
> `backend/import/worker.py:84`\
> 写入成功后，如果状态更新超时，任务仍会进入重试。重试路径使用新的批次 ID，已有的去重逻辑因此无法识别这批数据。

实际优先级取决于触发频率和数据影响。桌面端根据审查结果里的代码位置，将评论贴到对应的 diff 行。 [官方界面示例](https://learn.chatgpt.com/docs/code-review#work-with-review-results)

如果任务是判断「这次重试方案是否满足历史批次兼容、补数和回滚要求」，我会开一个独立会话，把这些契约连同相关测试入口一起交给 Codex，再根据它找到的证据继续追问。这样的审查可以覆盖 diff 之外仍会影响上线的行为，比如历史批次的重放路径。

## 怎样发起同一范围的审查

如果两边都要**只审相对基准分支已经提交的改动**，可以在 `/review` 里选 **Custom review instructions**，也可以在同一 checkout 的新会话里发送下面这段话。把 `main` 换成实际使用的基准分支或 ref。

```text
以 git diff main...HEAD 为审查范围，检查这次改动引入的行为回归。
沿相关调用链和测试追查，重点看失败重试、幂等性和历史数据兼容。
每条发现给出优先级、文件和行号、触发条件，以及实际影响。
只做审查，不改代码。把已验证的发现与仍待验证的假设分开。
```

这里显式写出 `git diff main...HEAD`，是为了让两边使用同一个比较范围。CLI 0.171.0 的 **PR Style** 预设会让审查器运行以共同祖先为参数的 `git diff`，工作区里已跟踪文件的未提交改动可能也会进入比较。工作区干净时，直接使用 PR Style 做整条分支的审查更省事。 [基准分支预设源码](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/prompts/src/review_request.rs) · [Git diff 文档](https://git-scm.com/docs/git-diff)

提交前想快速拿到一轮可定位的回归检查，我会用 `/review`。如果结论依赖项目背景，或需要边读实现边确认验收条件，我会开独立会话，把证据和审查问题一起交进去。

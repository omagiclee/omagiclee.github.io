+++
date = '2026-10-23T00:00:00+08:00'
lastmod = '2026-10-23T00:00:00+08:00'
draft = false
isCJKLanguage = true
contentLanguage = 'zh-CN'
title = '让 GPT 与 Claude 讨论到达成共识：多模型 Agent 如何交叉验证方案？'
description = '调研 Microsoft Agent Framework、Karpathy LLM Council 与 Anthropic Evaluator–Optimizer，设计 GPT 与 Claude 独立提案、交叉质疑、证据验证和共同验收的多模型工作流，并分析共识失真、版本绑定与评测方法。'
summary = '两个强模型意见不同，怎样把分歧变成更好的方案？对照三个主流参考，用流程图、影像质检案例和可复用协议，解释多模型辩论如何运行、何时停止，以及怎样验证它值得额外成本。'
categories = ['AgentAI']
tags = ['Multi-Agent', 'GPT', 'Claude', 'LLM Council']
+++

同一个需求交给 GPT 和 Claude，得到两套各有道理的方案，是使用强模型时很常见的体验。接下来可以让它们交换意见、查证分歧、修订设计，最终分别审查同一份方案。

这类机制通常称为 **Multi-Agent Debate（多智能体辩论）**、**Council（模型议事会）**，工程上可以用 Group Chat 编排。微软已将讨论、迭代评审与共识构建列入正式的 Agent 架构模式。[微软架构指南](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns/)

**值得追求的结果是：关键异议有了处理依据，最终方案通过既定检查，并得到双方对同一版本的认可。** “两个模型都说同意”只完成了其中一部分。

> **阅读范围**：资料截至 **2026 年 10 月 23 日**。核心参考为 Microsoft Agent Framework、Karpathy LLM Council 和 Anthropic Evaluator–Optimizer。下文的 GPT‑6.1 Sol 与 Claude Opus 流程及影像案例是工程设计示例；研究结果保留各自使用的模型和任务范围。

<!--more-->

## 1 三个参考分别提供了什么

这三个名字对应不同层次：**Agent Framework 是编排框架，LLM Council 是可运行的实验应用，Evaluator–Optimizer 是工作流模式。** 它们可以共同启发设计，但需要补充的能力不同。

{{< codex-table label="三个多模型评审参考的能力对照" >}}
| 参考 | 原生机制 | 最终由谁结束 | 要实现双方认可还需补什么 |
| --- | --- | --- | --- |
| **Microsoft Agent Framework** | Group Chat 管理发言、同步历史、支持多轮修订 | 编排器与停止条件 | 独立首轮、分歧记录、外部验证、双重验收 |
| **Karpathy LLM Council** | 独立回答 → 匿名互评排序 → 主席汇总 | 主席给出最终答案 | 针对分歧继续讨论的循环、共同稿复审 |
| **Anthropic Evaluator–Optimizer** | 生成 → 评价 → 根据反馈修订 | 根据评价标准结束循环 | 双方独立提案、双向审查与版本绑定 |
{{< /codex-table >}}

### Microsoft Agent Framework 负责组织讨论

Group Chat 由一个编排器决定下一个发言者，支持轮流发言、模型选择发言者或自定义逻辑。每个参与者有自己的会话，框架在轮到它之前同步讨论历史；也能设置最大轮次和自定义终止条件。[Group Chat 官方文档](https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/group-chat)

它适合承载 GPT 与 Claude 的往返讨论。框架有 Anthropic 模型客户端，应用可以分别配置模型提供方；直接使用 `AnthropicClient` 时，应用负责 Agent 循环，与使用 Claude Agent SDK 管理的编码运行时是两条不同接入路线。[Anthropic 集成文档](https://learn.microsoft.com/en-us/agent-framework/integrations/by-component/model-providers/anthropic)

**首轮独立提案需要放在共享讨论之外。** 如果一开始就让 GPT 发言、再让 Claude 读取完整历史回答，第二份方案已经受第一份影响。可以先并行收集两份提案，冻结后再送进 Group Chat。

另一个容易忽略的细节是证据传递：当前 Python 文档说明，非用户消息在同步时保留文本，工具调用、工具结果等控制内容会被过滤。因此，测试执行器应把关键结果导出成可引用的证据记录，不能假设另一位参与者自动看到了工具日志。[上下文同步说明](https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/group-chat#context-synchronization)

### LLM Council 提供直观的多模型互评原型

Karpathy 的 LLM Council 是一个本地 Web 应用，通过 OpenRouter 连接多个模型。原版分成三个阶段，用户可以看到各模型的回答及互评结果。[项目 README](https://github.com/karpathy/llm-council/blob/92e1fccb1bdcf1bab7221aa9ed90f9dc72529131/README.md)

{{< mermaid >}}
flowchart LR
  Q[同一个问题] --> P[各模型独立回答]
  P --> R[匿名评价与排序]
  R --> S[主席读取回答和评语]
  S --> O[合成最终答案]
  class Q client
  class P,R engine
  class S service
  class O storage
{{< /mermaid >}}

源码揭示了几个重要边界：互评阶段用 Response A、B 等标签隐藏模型名，参与者评价的是全部候选，包含自己的回答；主席汇总时重新看到模型名称。`run_full_council` 顺序执行三阶段，之后没有要求所有成员重新批准主席稿。[编排源码](https://github.com/karpathy/llm-council/blob/92e1fccb1bdcf1bab7221aa9ed90f9dc72529131/backend/council.py)

因此，**主席汇总表达的是综合判断，尚未取得成员对最终文本的共同认可。** 要满足“讨论后形成双方接受的完善方案”，需要在第三阶段之后加上复审、修订与停止条件。

原仓库配置使用 GPT‑5.1、Gemini 3 Pro Preview、Claude Sonnet 4.5 和 Grok 4；接入 GPT‑6.1 或 Opus 时，要核实路由服务实际提供的模型标识。[原始配置](https://github.com/karpathy/llm-council/blob/92e1fccb1bdcf1bab7221aa9ed90f9dc72529131/backend/config.py) 作者将项目定位为周末实验，并明确表示不计划维护。它适合学习交互与机制，长期服务需要另行承担维护工作。[项目定位](https://github.com/karpathy/llm-council/blob/92e1fccb1bdcf1bab7221aa9ed90f9dc72529131/README.md)

### Anthropic Evaluator–Optimizer 提供反馈循环

Anthropic 的模式让一次模型调用生成结果，另一次调用提供评价，再把反馈交回生成方继续修订。官方强调两个适用条件：**有明确的评价标准，迭代能带来可判断的改善。** 文学翻译和需要反复检索的任务是其举例场景。[Evaluator–Optimizer](https://www.anthropic.com/research/building-effective-agents)

这一模式本身没有要求两个不同品牌的模型，也没有规定双方必须先各提一案。将它用于 GPT 与 Claude 时，可以让双方轮流承担提案者与审查者，再加入独立的最终验收。

它给我们的设计启发是：每轮反馈都应指向一个可修改的问题。例如“缺少断点恢复设计”能转化为修订任务；“我觉得你的方案不够优雅”则需要进一步说明具体影响。

## 2 GPT 与 Claude 如何从分歧走到共同方案

建议先采用 **两个参与模型，加一个程序编排器**。程序维护版本、预算与状态；需要合并文本时调用其中一个模型。只有任务确实需要额外判断时，再增加独立裁判。

{{< mermaid >}}
flowchart TD
  T[冻结任务与验收标准] --> A[GPT 独立提案]
  T --> B[Claude 独立提案]
  A --> D[交换提案并登记具体分歧]
  B --> D
  D --> E[查资料、运行测试或做对照实验]
  E --> M[合并修订并冻结候选版本]
  M --> V[双方独立审查同一候选]
  V --> C{共同验收通过}
  C -->|是| F[交付共同方案与证据]
  C -->|否| L{还有验证预算}
  L -->|是| D
  L -->|否| U[交付已确定部分与未解决分歧]
  class T client
  class A,B,V engine
  class D,M service
  class E,L runtime
  class F,U storage
{{< /mermaid >}}

### 先对齐目标 再保留独立判断

两个模型需要相同的任务说明、约束、已有材料和验收标准。否则，一方优化速度、另一方优化准确率，看起来在争论技术，实际上解决的是不同问题。

首轮分别交付方案、关键假设、证据和验证办法。交换后，每方先指出对方值得保留的部分，再提交有影响的异议。可以隐藏模型名、调整候选展示顺序，减少品牌与位置带来的影响；文字风格仍可能泄露来源，匿名并不保证判断独立。

### 把异议变成可处理的条目

{{< codex-table label="不同分歧对应的处理方式" >}}
| 分歧类型 | 示例 | 解决方式 |
| --- | --- | --- |
| 事实 | 某接口是否支持批量请求 | 查固定版本文档，必要时做最小验证 |
| 推导 | 重试是否可能造成重复写入 | 构造失败路径，检查幂等性 |
| 实验 | 局部裁剪能否改善缺陷识别 | 在固定数据集上比较，保留失败样本 |
| 取舍 | 提升一点质量是否值得更高成本 | 根据事先约定的质量与预算优先级选择 |
| 信息缺失 | 目标硬件与峰值负载未知 | 保留条件化方案，明确需要补充的信息 |
{{< /codex-table >}}

每条异议记录“针对哪项设计、为什么重要、什么证据能解决它”。另一方明确回应接受、反驳或待验证，并说明依据。编排器只把仍然有效的关键分歧带入下一轮，避免重复讨论已经关闭的问题。

外部资料、另一模型的回答和工具结果都作为待核查材料进入讨论。它们不能改写既定验收条件，也不能自行授予执行权限。对于代码任务，测试记录应绑定代码版本；对于调研任务，引用应定位到真正支持结论的段落。

### 双方必须批准同一个版本

合并后的方案可能产生任何一方原稿都没有的问题。因此，需要再次把完整候选交给双方，并让它们独立提交审查结果。审查期间不展示对方这次的批准意见，以减少最后一轮的跟随。

批准记录至少绑定 **方案版本、任务约束版本和证据集合版本**。只要其中之一变化，就要重新检查受影响部分。GPT 批准 v2、Claude 批准 v3，不能合并成“双模型通过”。

<details>
<summary>可复用的审查记录格式</summary>

以下是应用层协议示例，不是某个 SDK 的内置字段。`status` 允许 `approve`、`request_changes`、`unresolved`；只有第一种计为通过。

```json
{
  "reviewer": "reviewer_b",
  "model_snapshot": "固定的实际模型版本",
  "task_revision": "task-v1",
  "plan_revision": "plan-v3",
  "plan_sha256": "候选文件摘要",
  "evidence_revision": "evidence-v2",
  "status": "request_changes",
  "issues": [
    {
      "id": "D02",
      "severity": "blocking",
      "claim": "当前方案尚未处理意图性背景虚化",
      "evidence_refs": ["sample-017", "case-analysis-02"],
      "resolution": "增加主体区域约束，并在固定样本上复核"
    }
  ]
}
```

程序校验记录结构、参与者身份、版本一致性和证据引用。任何参与者超时、返回空内容或格式错误，都应作为未完成处理。模型在正文里写出“approve”这个单词，不构成结构化批准。

</details>

## 3 以影像自动质检方案为例

假设要设计一个自动质检流程：发现照片中的明显画质缺陷，保留主观审美判断，控制人工复核量和运行成本。下面是一个**推演案例**，不对应实际模型对话或测量结果。

首轮中，方案 A 倾向于用 VLM 统一诊断；方案 B 倾向于组合专用指标与分类模型。双方可以先保留两种方案各自的优势：前者能描述语义与缺陷，后者便于限定输出和测量延迟。讨论随后聚焦到四个问题。

{{< codex-table label="影像质检示例中的分歧与修订" >}}
| 分歧 | 需要检查什么 | 共同稿可以怎样修订 |
| --- | --- | --- |
| 缩略图是否漏掉细小缺陷 | 小字、发丝、局部振铃的漏检 | 全图判断场景，疑似区域再取原分辨率裁剪 |
| 模糊是否都属于坏图 | 主体失焦与意图性景深的混淆 | 结合主体位置、用户意图与局部证据 |
| 是否每张图都调用两个大模型 | 固定吞吐下的成本和尾延迟 | 先做便宜筛查，再将疑难样本送入交叉复核 |
| 自动质量分是否可靠 | 过锐、过平滑和肤色偏移的误判 | 引入独立盲评，记录指标与人评冲突 |
{{< /codex-table >}}

此时得到的共同稿可以是：**轻量筛查 → 场景与主体判断 → 必要的局部检查 → 分歧样本复核 → 人工反馈回流。** 这只是待验证的候选架构，是否优于单 VLM 方案，要看同一数据集上的误检、漏检、延迟与成本。

两类共识也要分别记录：模型可以先认可“这个实验设计值得执行”；只有实验结果满足约定条件后，才能认可“这个方案已通过验收”。批准实验计划并不提前批准实验结论。

## 4 研究证据说明了什么

2023 年的 Multiagent Debate 研究已探索多模型实例独立回答，再通过多轮讨论形成共同答案，并在其测试任务中观察到推理和事实性改善。这证明该机制值得研究，但具体模型、任务和协议会影响结果。[原始论文](https://arxiv.org/abs/2305.14325)

### 加一位审查者也可能让结果变差

2026 年的一项交叉审查研究，在 **116 道中等与困难 LiveCodeBench 完整配对任务**上比较 Claude Opus 4.7 与 Codex GPT‑5.5。审查者可以读题和改写草稿，但不能运行测试；这是单次代码审查实验。[论文实验设置与结果](https://arxiv.org/html/2607.21656v1)

{{< codex-table label="交叉审查研究中的通过率" compact="true" >}}
| 初稿生成者 | 不追加审查 | 同模型审查 | 另一模型审查 |
| --- | --- | --- | --- |
| GPT‑5.5 | 71.6% | 84.5% | Opus 4.7 审查后 89.7% |
| Opus 4.7 | 91.4% | 91.4% | GPT‑5.5 审查后 82.8% |
{{< /codex-table >}}

最强单模型基线仍然是 91.4%，双模型流程没有超过它。这个结果提示我们，**审查带来的收益要与更强模型直接作答、同模型二次修订一起比较**。该实验也不能直接外推到 GPT‑6.1、其他 Opus 版本、仓库级开发或多轮方案讨论。

### 一致率会掩盖讨论中的失败

CONSENSAGENT 在六个推理数据集、三个模型的实验中研究了迎合行为：参与者可能强化彼此答案，缺少实质质疑；作者通过调整交互提示改善其评测结果。[ACL 2025 论文](https://aclanthology.org/2025.findings-acl.1141/)

另一项 ICML 2026 诊断研究指出，只看共识、多数票或裁判分数，会遗漏支配、迎合和过早收敛。它同时观察参与程度、回应质量、影响不对称和稳定性，强调讨论过程也需要评价。[ICML 2026 研究](https://proceedings.mlr.press/v306/pitre26a.html)

对于 GPT 与 Claude 的实际工作流，可以从这些结果推导出一条设计要求：**允许保留有证据的异议，并记录观点改变的原因。** 更换提供方可能带来不同视角，但不能据此假设错误相互独立。

## 5 怎样知道讨论值得额外成本

先固定任务集、模型版本、工具权限和质量标准，再运行对照。任务集应含双方首轮一致、首轮分歧，以及一个模型初稿正确而另一个错误的情况；否则很难看清讨论究竟修复了什么。

{{< codex-table label="建议比较的实验条件" >}}
| 条件 | 用来回答的问题 |
| --- | --- |
| GPT 单独完成、Claude 单独完成 | 当前最强的单模型基线是什么 |
| 同模型二次审查 | 改善是否只是来自多一次机会 |
| 双模型独立回答后直接汇总 | 独立候选是否已经足够 |
| 双模型讨论与验证循环 | 交流和外部验证新增了多少价值 |
| 同预算的单模型多次尝试 | 相同成本用在其他方式上会怎样 |
{{< /codex-table >}}

除了最终通过率，还要统计**修复数、回归数、共同认可但未通过验收的比例、未解决分歧、耗时与总成本**。对开放式设计题，使用预先定义的评分标准和独立盲评，并把关键结论尽量转成原型或小实验。

<details>
<summary>讨论预算与调用次数怎样估算</summary>

一个便于起步的预算是：2 次独立提案；每轮 2 次交叉审查和 1 次合并；结束前再做 2 次独立最终审查。假设执行 2 轮修订，则主要调用数为 `2 + 2 × 3 + 2 = 10` 次，尚未包含检索、工具循环和失败重试。这是流程估算，不是任何项目的实测成本。

总费用应累计输入、缓存、输出、工具和重试用量。双方同时发言可以缩短等待时间，但不会消除用量。持续累积的完整聊天历史还会增加后续调用输入，宜保留冻结需求、当前方案、有效异议和证据索引，并将完整记录留作回溯。

本文所说“一轮”是一次双向评审和修订周期；框架里的轮数、消息数或发言次数可能采用不同定义。配置时要按实际执行次数核对。

</details>

## 6 落地时需要哪些组件

对于 GPT‑6.1 Sol 与 Claude Opus 的组合，可以在应用层分别调用两家模型，将提案、异议、证据和候选版本交给编排器流转。固定实际使用的 Opus 版本，并记录模型标识与推理设置，便于复现。

**OpenAI Responses 原生 Multi-agent 当前的子代理共享请求模型。** 它支持 GPT‑6.1 Sol，但仅开启该功能不会自动连接 Claude；跨提供方协作仍要由外层客户端或框架组织。[OpenAI Docs](https://developers.openai.com/api/docs/guides/responses-multi-agent)

{{< mermaid >}}
flowchart LR
  U[任务与验收条件] --> H[程序编排器]
  H <--> G[OpenAI 客户端<br/>GPT Agent]
  H <--> C[Anthropic 客户端<br/>Claude Agent]
  H <--> S[方案版本与分歧记录]
  H <--> X[检索与验证执行器]
  X --> E[可引用的证据]
  E --> H
  H --> F[最终稿或未解决事项]
  class U client
  class H service
  class G,C engine
  class S,E,F storage
  class X runtime
{{< /mermaid >}}

从选择上看，LLM Council 适合先观察各模型回答和互评；已有单模型系统可以先加 Evaluator–Optimizer；需要多轮讨论、持久状态与工具验证时，再用 Agent Framework 等编排框架实现完整协议。框架负责组织执行，**“怎样才算共同通过”仍属于应用规则。**

<details>
<summary>一个有边界的共识协议</summary>

下面是框架无关的设计伪代码，省略具体模型与工具适配。验证证据冻结之后，双方再审查同一候选。

```text
固定任务、验收条件、模型版本和总预算
并行生成两份独立提案

在讨论预算内重复：
    双方分别评价候选，提交可核查的异议
    验证器处理关键事实与实验问题
    合并已接受的改动，保留未解决项
    冻结候选方案和对应证据
    双方独立提交结构化最终审查

    如果任一模型失败或审查记录无效：
        按预算重试，否则返回 incomplete
    如果版本相同、双方批准、必要检查通过、关键异议清零：
        返回 consensus_pass
    如果仍有预算且存在可执行的修订或验证步骤：
        继续下一轮
    否则：
        返回 unresolved，附条件化方案与所需证据
```

开始时可以限定最多 3 轮修订，同时设置总用量、工具执行时间和重复异议阈值。这些是待评估的初始配置。对于已经明确的事实，优先查证；只有真实取舍才值得继续讨论。

最终交付包含四部分：完整方案、被采纳的关键修订及依据、双方针对同一版本的审查记录、尚存条件与风险。把失败和未完成状态如实返回，才能让“通过”保留含义。

</details>

## 7 适合从哪类任务开始

跨模块架构设计、实验方案审查、存在明显取舍的技术选型，以及重要代码修改，都适合试验这套流程。它们有足够的复杂度让另一种视角发挥作用，也有机会通过文档、测试、原型或盲评检查结论。

对于有明确权威答案的简单问题，直接检索往往更有效。对于目标尚未确定的问题，应先澄清目标。**共同方案的价值来自解决了哪些真实分歧、通过了哪些检查，以及为此付出了多少成本。**

相关主题可继续阅读：[Harness Engineering](/posts/vibe-coding/harness-engineering/)、[Subagents 与 Memory](/posts/vibe-coding/codex-subagents-memory/)、[RSI 递归自我改进](/posts/agent-ai/recursive-self-improvement/)。

<details>
<summary>原始资料与继续阅读</summary>

- [Microsoft Agent Framework Group Chat](https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/group-chat)：发言协调、历史同步和停止条件。
- [Microsoft Agent Framework Anthropic 集成](https://learn.microsoft.com/en-us/agent-framework/integrations/by-component/model-providers/anthropic)：模型客户端与 Claude Agent SDK 的区别。
- [Microsoft Agent 编排模式](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns/)：Group Chat、Council 与多智能体辩论的适用范围。
- [LLM Council 固定版本](https://github.com/karpathy/llm-council/tree/92e1fccb1bdcf1bab7221aa9ed90f9dc72529131)：本文源码分析所对应的版本，含 README、编排和模型配置。
- [Anthropic Building effective agents](https://www.anthropic.com/research/building-effective-agents)：2024 年发布的工作流模式文章，本文引用 Evaluator–Optimizer 的机制。
- [OpenAI Responses Multi-agent](https://developers.openai.com/api/docs/guides/responses-multi-agent)：支持范围与子代理共享模型规则。
- [Improving Factuality and Reasoning through Multiagent Debate](https://arxiv.org/abs/2305.14325)：独立回答与多轮讨论的早期研究。
- [Cross-Model LLM Code Review](https://arxiv.org/html/2607.21656v1)：116 道任务上的审查方向、收益与回归。
- [CONSENSAGENT](https://aclanthology.org/2025.findings-acl.1141/)：多 Agent 讨论中的迎合与缓解。
- [A Diagnostic Study of Multi-Agent LLMs for Real-World Debates](https://proceedings.mlr.press/v306/pitre26a.html)：同时评价最终结果和讨论过程。

</details>

+++
date = '2026-11-18T00:00:00+08:00'
draft = false
title = 'Stripe Minions 如何每周交付 1300 多个 PR'
description = '以 Stripe 2026 年 2 月的 Minions 工程披露为起点，解析无人值守编程的自动化边界、隔离开发环境、任务并发、Blueprint 编排、上下文工具与质量控制，并结合后续 CI 实践讨论成本和落地方法。'
summary = '每周 1300 多个已合并 PR 背后，是隔离且预热的开发环境、Agent 与固定步骤混合的 Blueprint、按需上下文和有限重试的质量反馈。拆解 Stripe 如何让工程师同时委派多个任务，并保留人工评审。'
categories = ['Vibe Coding']
tags = ['Stripe', 'AI Agents', 'Harness Engineering']
contentLanguage = 'zh-CN'
isCJKLanguage = true
math = false
+++

**2026 年 2 月 19 日，Stripe 披露：每周超过 1,300 个已合并的 Pull Request，代码完全由其内部编程 Agent Minions 生成，并经过人工评审。** 这个数字对应当时的交付规模。[Stripe Minions Part 2](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents-part-2)

对使用 AI 编程的人来说，更值得研究的是这套系统怎样工作：工程师如何放心地同时委派多个任务，Agent 怎样获得项目知识，代码出错后如何修复，以及自动化在哪一步交回人手。

我的判断是，Stripe 的经验说明了一件事：**无人值守编程的效率，取决于整个开发系统能否支持 Agent 独立执行、获得反馈和交付可审查的结果。** 模型写出代码只是其中一环。

> 本文以 Stripe **2026 年 2 月**的两篇 Minions 工程文章为主；另引入 **4 月**的测试基础设施文章，以及后续公开演示。不同时间和统计口径分别标注，资料核验日期为 **2026-11-18**。

<!--more-->

## 1 先看清楚 1300 个 PR 的含义

Stripe 在 2 月分两次介绍了 Minions：

| 披露日期 | 每周已合并 PR | 重点 |
| :--- | :--- | :--- |
| [2026-02-09](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents) | 超过 1,000 个 | 工程师的使用方式与总体流程 |
| [2026-02-19](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents-part-2) | 超过 1,300 个 | 开发环境、编排、上下文和反馈机制 |

这里同时包含两个条件：PR 已经合并；其中没有人工编写的代码。人工仍参与需求和评审。由此可以确认 Minions 已经用于实际工程交付，但还不能算出任务成功率、节省的人时或缺陷率，因为这些指标还需要尝试总数、任务难度和质量数据。

阅读这类案例时，我更关心的是：工程师为一个最终可接受的改动，究竟投入了多少注意力。如果生成很快，却需要人反复解释上下文、收拾环境和重写实现，产出数量就很难代表效率。

## 2 自动化延伸到哪里

工程师在 Slack 线程或其他内部入口委派任务，Minions 利用上下文执行修改、准备 PR，随后由工程师检查并发起评审。完成后也能追加指令或人工接手。[使用流程](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents)

因此，它的自动化边界可以理解为：

| 阶段 | 工程师应关注什么 |
| :--- | :--- |
| 委派之前 | 目标、限制和验收标准是否足够清楚 |
| 独立执行期间 | 通过运行记录了解进度，处理真正需要人的例外 |
| 结果交接时 | 检查差异和验证结果，决定是否继续修改 |
| 评审与合并时 | 判断业务语义、设计和维护成本是否可接受 |

Stripe 所说的 **one-shot**，描述的是一次委派完成任务的目标。任务内部仍可能发生多次模型调用、工具执行和修复。“无人值守”也保留了交付端的人工判断。

一个具体例子来自后来的 **Stripe Sessions 2026**：主讲人在演讲开始时委派文档修改，结束时查看 Minion 提出的差异，确认文档中已移除产品的 public preview 可用性字段，随后表示将合并 PR。这类边界明确、结果容易核对的工作，很适合观察异步委派的价值。[官方演示与文字稿](https://stripe.com/sessions/2026/developer-keynote)

这会改变日常工作顺序：问题一旦描述清楚，就可以进入执行；工程师继续处理其他事情，在结果需要判断时回来。节省的注意力来自减少中途陪跑。

## 3 多并发如何实现

### 每个任务有独立的开发环境

Stripe 使用基于 AWS EC2 的 devbox，以预热池提前准备代码、缓存和服务，目标是在约 **10 秒**内提供可用环境。[开发环境设计](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents-part-2)

这使并发有了清晰的执行单元。下面按三个独立任务画出结构，数量仅用于说明：

{{< mermaid >}}
flowchart TB
    E["工程师定义独立任务"] --> A["任务 A 的 devbox<br/>独立目录与状态"]
    E --> B["任务 B 的 devbox<br/>独立目录与状态"]
    E --> C["任务 C 的 devbox<br/>独立目录与状态"]
    A --> PA["改动 A 与验证结果"]
    B --> PB["改动 B 与验证结果"]
    C --> PC["改动 C 与验证结果"]
    PA --> R["工程师检查与评审"]
    PB --> R
    PC --> R
{{< /mermaid >}}

隔离首先解决的是工作区干扰：一个任务改动依赖、生成文件或启动服务时，其他任务可以保持自己的执行状态。预热则降低领取任务后的准备成本。两者结合，才容易让短任务也值得委派。

这种机制实现的是**多个独立任务之间的并行**。公开披露不足以还原单个任务内部的多 Agent 协作，也没有给出整个系统的同时运行上限。每周交付量与同时运行数量之间，还隔着任务耗时、排队和评审等待。

### 环境隔离之后 还要处理依赖与资源

根据这一架构，可以推导出两项落地要求。

第一，工作区互不干扰，并不消除改动之间的逻辑冲突。假设任务 A 修改接口，任务 B 使用这个接口，它们仍需要先确定契约，或按依赖顺序执行。适合并行的工作，应有相对独立的目标和文件范围。

第二，启动能力需要和下游容量匹配。即使能够快速创建更多环境，模型服务、CI 和人工评审也可能形成队列。增加执行中的任务，如果只让等待评审的 PR 越积越多，就没有相应提高交付速度。

这些是本文对并发系统的工程分析；Stripe 没有在上述文章中公开完整的排队、配额与合并调度实现。

## 4 Blueprint 怎样组织一次运行

Minions 的执行框架由 Block 的 **goose** 分支演进而来。[执行框架](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents)

Stripe 用 **Blueprint** 编排模型决策和固定步骤：Agent 实现任务、修复失败，程序执行指定 linter 和推送等操作。[Blueprint](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents-part-2)

要理解这种组合，可以借用 Anthropic 对两种机制的区分：Workflow 以预定义代码路径组织执行，Agent 则由模型动态决定过程和工具使用。前者提供可预测的步骤，后者处理难以提前穷举的情况。[Building effective agents](https://www.anthropic.com/research/building-effective-agents)

例如，修复一个测试失败，需要理解原因并选择修改方式，适合交给 Agent；“提交前必须运行指定检查”已经有确定答案，应由执行程序保证。这样既减少重复决策，也让检查是否执行变得容易核对。

下面依据公开机制整理一次运行的反馈关系，省略了内部节点细节：

{{< mermaid >}}
flowchart TD
    A["任务与上下文"] --> B(["Agent 实现修改"])
    B --> C["固定步骤<br/>运行本地检查"]
    C -->|需修复| B
    C -->|通过| D["推送并运行第一轮 CI"]
    D -->|通过| H["工程师检查与人工评审<br/>决定后续处理"]
    D -->|失败| E["修复阶段<br/>自动修复，按需调用 Agent"]
    E --> F["再次推送与第二轮 CI"]
    F -->|交接真实结果| H
{{< /mermaid >}}

修复阶段先应用可用的自动修复，剩余问题再交给 Agent。第二轮 CI 后即交回人手，结果也可能仍然失败。

Blueprint 对工程团队的价值，是把“每次都该做的事情”从提示要求变成执行规则。一个可复用的运行框架，还应让人能看清它停在哪个节点、检查了哪个版本、为什么进入下一步。

## 5 怎样让 Agent 理解项目

Stripe 按目录加载规则，通过内部 MCP 服务 **Toolshed** 获取动态信息。[上下文入口](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents) 2 月 19 日披露时，Toolshed 已有近 **500 个工具**，每个 Agent 默认只获得经过筛选的子集。[工具配置](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents-part-2)

这种安排值得从两个角度理解。

**规则要出现在需要它的地方。** 一个支付模块的约束、一个前端目录的组件规范，应该与相关代码一起被找到。将所有团队的规定塞进全局提示，会同时增加阅读负担和不相关信息。

**工具要帮助 Agent 找到可核对的事实。** 文件、工单、文档和构建状态散落在不同系统中；稳定的工具接口，能让运行过程直接取回所需信息。工具目录再大，单次任务仍应聚焦于少量相关能力。

对团队而言，更有用的优化问题是：某类错误是否源于缺少一份明确文档、找不到现有实现，或者工具结果不够清楚？这些问题往往能够通过知识维护和接口改进持续解决。

## 6 如何控制质量与失败成本

### 尽早反馈 并限制自动重试

Minions 先运行本地检查，再进入 CI。Stripe 当时的测试库超过 **300 万项**，CI 会选择相关测试；失败时先应用可用的自动修复，再让 Agent 处理剩余问题，标准流程最多进行 **两轮 CI**，随后交回人手。[本地检查与 CI 策略](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents)

这样的安排同时影响速度和成本。格式、规则等确定性问题越早暴露，越少占用共享 CI；对于持续失败的任务，设置退出点则能避免把长时间重试当成进展。

这里的“两轮”约束的是自动 CI 循环。工程师收到结果后，可以重新判断问题、修正需求或继续处理。自动化需要有一个清晰的交接位置。

### 测试基础设施也必须能够扩容

Stripe 在 **2026 年 4 月 9 日**进一步介绍了 Ruby 单仓的 Selective Test Execution（STE）。它记录测试运行时访问的文件，根据新改动与这些依赖的交集选择测试。该仓库每次构建平均运行约 **5%** 的测试集，中位数为 **0.5%**。[STE 官方文章](https://stripe.dev/blog/selective-test-execution-at-stripe-fast-ci-for-a-50m-line-ruby-monorepo)

这套选择机制还保留了边界处理：此前失败的测试会重跑；依赖目录枚举等、无法仅靠文件打开记录覆盖的测试被列为必跑；公共基础依赖的变化可以触发全量测试。选择测试所使用的基准也被保存，以便复现。[选择规则与可靠性设计](https://stripe.dev/blog/selective-test-execution-at-stripe-fast-ci-for-a-50m-line-ruby-monorepo)

这个例子补全了并发的一半：Agent 提高改动产出后，验证系统需要以合理成本提供反馈。测试选择依赖可靠的数据和兜底规则，不能简单理解为固定抽取 5% 的测试。

两篇文章的测试数量也应分别阅读：2 月 Minions 文章谈整体测试库，4 月文章谈 Ruby 单仓，后者约有 10 万个测试文件、120 万个测试单元。这些范围和单位不同。[Ruby 单仓统计口径](https://stripe.dev/blog/selective-test-execution-at-stripe-fast-ci-for-a-50m-line-ruby-monorepo)

### 隔离限制影响 人工评审承担最终判断

Stripe 将 Minions 运行在 QA 环境，限制生产服务、真实用户数据和任意网络出口的访问，并对工具的破坏性操作设置控制。这样才能在限定环境中减少逐次确认。[运行边界](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents-part-2)

从质量控制的角度，这些机制各有职责：

| 机制 | 主要能解决什么 | 仍需要关注什么 |
| :--- | :--- | :--- |
| 本地检查 | 快速发现明确的规则问题 | 业务目标是否正确 |
| 自动化测试 | 验证已有用例覆盖的行为 | 未覆盖的场景和需求遗漏 |
| 环境与工具限制 | 缩小执行错误的影响范围 | 改动本身的正确性 |
| 人工评审 | 判断语义、设计与维护成本 | 审查所需的时间和信息质量 |

质量由这些机制共同支撑。一次 CI 通过，是重要证据；对测试之外的行为和设计，仍需要工程师判断。

## 7 怎样衡量这套系统是否高效

每周合并 PR 数可以观察采用规模。评估是否值得扩展时，我会再记录下面几项指标：

| 指标 | 要回答的问题 |
| :--- | :--- |
| 从发起到验收的成功比例 | 有多少任务最终交付了可接受的结果 |
| 每个成功任务消耗的人时 | 委派、澄清、评审和接手共花了多久 |
| 首次检查通过率与返工次数 | 反馈能否帮助系统稳定收敛 |
| 每个成功任务的总成本 | 模型、环境、CI 和失败尝试花费多少 |
| 合并后的回滚与缺陷 | 质量是否随产出扩大而变化 |
| 执行与评审的排队时间 | 系统瓶颈究竟在哪里 |

这些是本文建议的度量方式。比较时，应将相似难度和风险的任务放在一起，并计入失败尝试。一个复杂修复和一次文案调整各算一个 PR，直接相加会掩盖实际工作量。

还应分清三个容易混用的量：**有 AI 辅助的 PR、完全由 Agent 编写的 PR、代码行数占比**。它们的定义和分母不同。本文开头的 1,300 多个，沿用的是 2026 年 2 月 Stripe 对 Minions 已合并 PR 的披露口径。

## 8 小团队可以先落实哪些能力

Stripe 的实现依赖长期建设的开发基础设施。小团队可以从一个范围明确、反馈容易验证的任务类型开始，逐步建立同样清晰的执行关系。

1. **先明确交付条件。** 写清楚要改变的行为、不能改变的行为，以及验证入口。
2. **提供可重复使用的环境。** 检查代码能否在干净环境中启动和测试，再扩展独立任务的并发。
3. **将必要步骤写进程序。** 自动执行固定检查、保存结果和处理超时，让模型专注于需要判断的部分。
4. **按任务供给知识和工具。** 优先补齐经常缺失的文档、代码检索和测试反馈。
5. **根据实际交付扩容。** 同时观察成功率、人时、成本和评审等待，再决定增加多少执行中的任务。

<details>
<summary>展开一个可以直接改写的任务说明示例</summary>

下面是本文设计的示例，用于说明委派时需要哪些信息。

```text
目标
修复工单列表在结果为空时显示加载动画的问题。

范围
修改列表组件与对应测试，保留接口和权限行为。

验收
1. 首次请求期间显示加载状态。
2. 请求完成且结果为空时显示空状态。
3. 请求失败时保留已有错误提示。
4. 相关测试通过，并提供三种状态的验证结果。

交付
提供改动说明、检查结果和仍未解决的问题，交由维护者评审。
```

这类说明也方便定位失败：目标不明确需要补需求，缺少资料需要补上下文，执行失败需要修环境。清楚地区分原因，才有机会让下一次任务更顺利。

</details>

如果已经在维护 Agent 工作流，可以结合本站的 [Harness Engineering]({{< relref "/posts/vibe-coding/harness-engineering/" >}}) 继续设计状态记录、验证证据和失败恢复。

Stripe 提供的启发，是将工程师已有的开发能力变成 Agent 能稳定使用的执行条件。**任务边界清楚、环境可重复、反馈及时、结果容易评审，才有条件让更多工作同时推进。**

## 参考资料

1. Alistair Gray，Stripe，2026-02-09：[Minions: Stripe’s one-shot, end-to-end coding agents](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents)。
2. Alistair Gray，Stripe，2026-02-19：[Minions: Stripe’s one-shot, end-to-end coding agents—Part 2](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents-part-2)。
3. Aditya Anchuri，Stripe，2026-04-09：[Selective Test Execution at Stripe: Fast CI for a 50M-line Ruby monorepo](https://stripe.dev/blog/selective-test-execution-at-stripe-fast-ci-for-a-50m-line-ruby-monorepo)。
4. Stripe Sessions 2026：[Developer keynote 与官方文字稿](https://stripe.com/sessions/2026/developer-keynote)。
5. Anthropic，2024-12-19：[Building effective agents](https://www.anthropic.com/research/building-effective-agents)。

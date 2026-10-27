+++
date = '2026-10-23T00:00:00+08:00'
draft = false
title = 'Harness Engineering：让 AI 持续完成任务，需要怎样的运行框架？'
description = '结合 OpenAI、Anthropic、LangChain、SWE-agent 与持久执行文档，拆解长任务 Agent 的运行闭环、状态交接、工具设计、权限边界、失败恢复与评测方法，并以 Hugo 博客维护给出最小落地方案。'
summary = '让 AI 持续完成任务，需要可恢复的状态、可执行的验收条件和有边界的行动循环。三张图拆解 Harness Engineering，并给出个人项目可采用的最小方案。'
categories = ['Vibe Coding']
tags = ['Harness Engineering', 'AI Agents', 'Codex']
contentLanguage = 'zh-CN'
isCJKLanguage = true
math = false
+++

让 AI 修改一段代码，通常很快就能看到结果。让它完成一个跨文件、需要查资料、启动服务、验证界面，还可能中途断开的任务，困难就会逐渐显现：它可能漏掉要求，反复尝试同一种失败方案，或者在真正验证之前宣布完成。

这些问题涉及模型能力，也涉及模型周围的运行系统：**目标如何保存，工具如何执行，结果如何验证，中断之后如何接着做。** Harness Engineering 关注的正是这一层。

我的判断是：对于已经在用 AI 做实际项目的人，最值得投入的工程工作，是把“请继续”“你还没测”“这个已经做过了”背后的要求，变成运行框架能够执行和检查的机制。

> **阅读范围**：以软件与本地工具任务为主，资料核验截至 **2026-10-23**。先看运行闭环与博客示例即可把握主线；恢复机制和评测方法适合准备搭建 Agent 系统的读者。

<!--more-->

## 1 Harness 到底负责什么

本文把 **Harness** 理解为围绕模型建立的执行与控制系统：它组织上下文、调用模型、执行工具、保存状态、检查结果，并决定何时继续、等待或结束。

这个词的使用范围并不完全统一。LangChain 的定义很宽，涵盖模型之外的代码、配置与执行逻辑；OpenAI 的工程实践还把仓库知识、架构约束和反馈机制纳入讨论。因此，理解它时最好同时看到两层：**运行时如何工作，以及项目是否为这种工作方式提供条件。** [LangChain 的定义](https://www.langchain.com/blog/the-anatomy-of-an-agent-harness)、[OpenAI 的工程实践](https://openai.com/index/harness-engineering/)

| 概念 | 主要解决的问题 | 例子 |
| :--- | :--- | :--- |
| Prompt Engineering | 这一轮怎样表达要求 | 明确目标、格式、约束 |
| Context Engineering | 这一轮应该给模型看什么 | 检索相关文件，压缩旧日志 |
| Harness Engineering | 整个任务怎样可靠地运行 | 状态保存、工具执行、验证、恢复 |
| Workflow | 哪些步骤按什么关系执行 | 调研后写作，通过检查后交付 |

这些工作会相互重叠。一个固定工作流可以承载 Agent，也可以完全由普通程序执行；只有步骤需要动态判断时，才有必要让模型参与决策。

**MCP 与 Skills 则是可接入的组成部分。** MCP 提供连接外部工具和数据的标准接口；Skills 将操作知识、脚本和参考资料打包，供 Agent 按需使用。接通工具和装好技能之后，任务的验收、权限与恢复仍需要运行系统负责。[MCP 官方说明](https://modelcontextprotocol.io/docs/2026-07-28/getting-started/intro)、[Agent Skills 规范](https://agentskills.io/home)

## 2 一手案例揭示了哪些问题

不同团队选择的实现不一样，但公开经验可以对应到几个具体的工程问题。

| 来源与时间 | 实践或发现 | 对工程设计的启发 |
| :--- | :--- | :--- |
| [SWE-agent，2024](https://arxiv.org/abs/2405.15793) | 专门设计 Agent 与计算机之间的操作接口，研究其对软件任务表现的影响 | 文件查看、编辑和反馈方式本身值得设计 |
| [Anthropic，2025-11](https://www.anthropic.com/research/effective-harnesses-for-long-running-agents) | 通过初始化阶段、功能清单、进度记录和逐步实现，支持跨上下文工作 | 每次接班都要能恢复任务状态 |
| [OpenAI，2026-02](https://openai.com/index/harness-engineering/) | 将仓库文档、可观察的运行环境与机械化架构检查纳入 Agent 工作方式 | 项目必须让 Agent 找得到信息、看得到结果 |
| [LangChain，2026-02](https://www.langchain.com/blog/improving-deep-agents-with-harness-engineering) | 固定模型，调整提示、工具和中间件，在 Terminal Bench 2.0 上改善成绩 | 更换模型之外，运行框架也是优化变量 |
| [Anthropic，2026-03](https://www.anthropic.com/research/harness-design-long-running-apps) | 引入生成与评估分工，随后随模型升级移除部分流程 | 每个组件都应证明收益，复杂度需要定期削减 |

其中，LangChain 报告使用同一 **GPT-5.2-Codex**，将 Terminal Bench 2.0 成绩从 **52.8% 提高到 66.5%**，增加 **13.7 个百分点**。改动包含验证提醒、环境上下文、循环检测和推理预算安排。这说明 Harness 可以显著影响该实验中的结果；它不能直接推出业务项目也会提高同样幅度，也不能把全部收益归因于某一个组件。[实验设置与结果](https://www.langchain.com/blog/improving-deep-agents-with-harness-engineering)

由这些案例，我更关心一个可以迁移的设计原则：**每遇到一种反复出现的失败，就补上能检测或阻止它的机制，再用真实任务检验收益。**

## 3 让任务形成有证据的闭环

一个可持续工作的 Agent，至少要围绕下面这个循环组织起来。图中模型负责提出下一步；框架负责执行边界、状态和退出条件。

{{< mermaid >}}
flowchart TD
    G["目标、范围与验收条件"] --> R["恢复任务状态<br/>核对当前环境"]
    R --> M["组装上下文<br/>模型选择下一步"]
    M --> T["在权限与预算内执行<br/>处理行动或完成候选"]
    T --> S["保存结果、产物和检查点"]
    S --> V{"独立检查验收证据"}
    V -->|通过| D["完成并交付"]
    V -->|未完成且可推进| R
    V -->|无法继续| W["等待外部条件<br/>或按预算与取消要求停止"]
    W -->|满足恢复条件| R
{{< /mermaid >}}

这里有三个容易混淆的判断：

- **模型的一轮输出结束**，只说明本次生成结束。
- **一个执行进程退出**，只说明这次运行停止。
- **任务完成**，要求验收条件有对应证据，且不存在必须完成的剩余工作。

例如，“页面已修复”应对应修改后的页面、构建结果和浏览器行为；一句总结不能替代这些证据。

验证也应分层：工具调用后检查返回状态，功能完成后检查行为，交付前运行必要回归。每次读取文件都触发全量测试，只会增加开销。

框架还应允许正常地等待：用户尚未给出必要选择、外部服务不可用、预算已经用完，都可能让任务停在一个可恢复状态。**持续完成任务，包含正确保存和等待的能力。** 单纯拦截退出、不断重发“继续”，无法区分有效推进与原地打转。

### 先把完成条件写清楚

以“修复博客手机端目录遮挡正文”为例：

| 需要明确的内容 | 可执行的约定 |
| :--- | :--- |
| 目标 | 在指定手机视口下，目录可以展开和关闭，正文可正常阅读 |
| 修改范围 | 项目级样式和模板；保留已有未提交修改 |
| 验收行为 | 打开文章、展开目录、点击锚点、关闭目录，逐项观察结果 |
| 回归范围 | 桌面目录和主题切换仍正常 |
| 交付物 | 修改文件、检查结果、截图、未解决项 |

“改善体验”需要转成可观察的行为。计划可以随发现调整，但降低验收门槛必须作为需求变更处理，不能悄悄变成通过测试的捷径。

<details>
<summary>展开一个任务契约示例</summary>

下面是本文设计的 YAML 示意，不是某个 SDK 的配置格式。预算是示例参数，需要按任务校准。

```yaml
task_id: blog-mobile-toc
objective: 修复手机端目录遮挡正文
status: active
scope:
  writable: [assets/css/site, layouts]
  protected: [themes/LoveIt]
  preserve_existing_changes: true
acceptance:
  - id: mobile-navigation
    check: 390x844 视口下展开目录、跳转锚点、关闭目录
  - id: desktop-regression
    check: 桌面目录和主题切换保持正常
  - id: production-build
    check: 生产构建和站点检查通过
budget:
  max_wall_minutes: 30
  max_tool_calls: 80
  max_attempts_per_failure: 3
delivery:
  required: [patch, validation_report, screenshots, remaining_work]
```

执行器需要真的检查预算，权限层需要真的限制写入，验收器需要真的运行检查。只把这些字段放进上下文，还没有实现控制。

</details>

## 4 把任务状态放到上下文之外

长任务会同时经历两种中断：**上下文不够用**，以及**运行进程消失**。前者可以通过压缩与重新读取材料缓解；后者要求状态已经持久保存。

持久状态也不会自行唤醒 Agent。跨进程续跑还需要执行器或调度器读取未完成任务，重新建立运行环境并恢复会话；它要区分等待用户、等待重试和主动暂停，避免把所有未完成任务都立即重启。

Anthropic 将上下文压缩、结构化笔记和子任务隔离列为长任务的不同策略；压缩时必须选择保留哪些信息，过度压缩会丢掉之后才显得关键的细节。[Context Engineering](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents)

因此，我会把信息分成四类保存：

| 信息 | 保存位置示例 | 更新方式 |
| :--- | :--- | :--- |
| 稳定规则 | `AGENTS.md`、权限配置 | 随项目约定和授权改变 |
| 项目知识 | 架构文档、接口说明、决策记录 | 跟随代码版本维护 |
| 当前任务状态 | 任务清单、检查点、待办与阻塞原因 | 每个有意义的步骤后更新 |
| 证据与产物 | 测试报告、工具回执、截图、差异文件 | 关联任务和被验证的版本 |

这四类信息的可信度也不同。“上轮总结说测试通过”是一条线索；能找到报告、对应代码版本和执行条件，才方便核对。代码再次修改后，旧测试结果还在，但已经不能直接证明新版本通过。

OpenAI 的仓库实践采用短 `AGENTS.md` 指向结构化知识库，并用检查工具约束文档和架构。这比不断向入口文件追加所有历史经验更容易维护。[仓库知识与机械化约束](https://openai.com/index/harness-engineering/)

### 接班时先检查现场

恢复任务时，建议固定做四件事：读取目标和剩余项，核对工作区差异，检查关键产物是否存在，再运行最小的健康检查。随后选择下一项可验证的小任务。

这一顺序可以发现“记录说服务已启动，但进程其实已经退出”之类的偏差。Anthropic 的跨会话案例也强调启动时阅读进度、查看 Git 历史，并先检查应用基本功能。[长任务 Harness 案例](https://www.anthropic.com/research/effective-harnesses-for-long-running-agents)

<details>
<summary>展开最小目录与交接记录</summary>

```text
project/
├── AGENTS.md                  # 简短规则与文档入口
├── docs/
│   ├── architecture.md        # 项目结构与约束
│   └── decisions.md           # 重要决策及依据
├── tasks/
│   └── mobile-toc.yaml        # 目标、范围、验收
├── scripts/
│   └── verify-task           # 稳定的验证入口
└── .agent-runs/               # 本地运行记录，通常不发布
    └── mobile-toc/
        ├── state.json
        ├── events.jsonl
        └── artifacts/
```

一条有用的交接记录可以很短：

```text
目标：修复手机端目录遮挡正文。
已完成：定位覆盖层样式，修改项目级 CSS。
已验证：生产构建通过；报告绑定当前工作区内容哈希。
未完成：手机端交互和桌面回归尚未验证。
现场：预览服务已停止；用户原有修改已保留。
下一步：重新启动预览，执行目录展开与锚点跳转检查。
证据：artifacts/build.log、当前差异文件。
```

文件记录适合单执行者的小项目。多个执行者并发写入、需要跨机器恢复时，应升级到带事务和并发控制的存储，不能依赖多个 Agent 同时改同一个 JSON 文件。

</details>

## 5 工具要提供可行动的反馈

给 Agent 一个 shell 已经能做很多事情，但接口设计仍会影响它如何工作。SWE-agent 的研究把模型视为一类有特殊需求的软件使用者，专门研究文件导航、编辑和执行接口。[SWE-agent 论文](https://arxiv.org/abs/2405.15793)

对自己的工具，最值得明确的是这几项：

| 接口部分 | 应该提供的信息 |
| :--- | :--- |
| 输入 | 明确参数类型、路径范围、默认值与前置条件 |
| 输出 | 机器可读状态、必要摘要、完整产物的位置 |
| 错误 | 区分参数错误、权限拒绝、临时故障与业务失败 |
| 副作用 | 是否写文件或改变外部状态，能否安全重试 |
| 长任务 | 返回运行标识，支持查询、取消和超时 |

例如，图片分析工具不应只返回“已处理”。它应返回处理对象、成功与失败数量、失败原因、输出文件位置；读不清的小字应保留为未确认，而不是由下游流程当成确定事实。

大型输出则应该留在文件或存储中，返回给模型的是摘要、检索入口和必要片段。这样既能减少上下文拥挤，也保留了重新核对原始证据的能力。

工具的错误反馈最好直接帮助下一步决策：`permission_denied` 应引向权限处理，`invalid_argument` 应引向参数修正。把它们全部包装成“执行失败，请重试”，会制造无效循环。

## 6 恢复任务时要处理已经发生的副作用

检查点保存了“执行到哪里”，却不一定知道外部世界发生了什么。

假设 Agent 调用发布接口，服务已经创建文章，但网络断开导致回执丢失。重启后，框架看到最后一条记录是“准备发布”，便再次调用创建接口，结果可能出现两篇文章。

{{< mermaid >}}
sequenceDiagram
    participant H as Harness
    participant D as 持久状态
    participant S as 外部服务
    H->>D: 保存操作意图和稳定操作 ID
    H->>S: 执行操作并携带幂等键
    S->>S: 完成操作
    S--xH: 回执丢失，进程中断
    Note over H: 重启并读取检查点
    H->>D: 发现操作结果未知
    H->>S: 按操作 ID 查询结果
    S-->>H: 返回已完成结果
    H->>D: 补记回执，继续后续任务
{{< /mermaid >}}

图中的恢复路径依赖外部服务提供查询或幂等支持。**只有本地生成一个 ID，并不能阻止服务重复执行。** 若服务不支持这些能力，而且无法确定操作结果，应保留 `unknown` 状态并核对，不能直接按“失败”重做。

幂等意味着重复执行不会增加额外效果。AWS 的持久执行文档明确区分重放、重试和副作用，并指出其单次尝试的执行语义并不自动保证整个工作流只执行一次。[幂等与重试](https://docs.aws.amazon.com/durable-execution/patterns/best-practices/idempotency/)

对于本地工作，也需要类似意识：Git 能帮助恢复受版本管理的文件，但不能自动回滚外部数据库、已发布内容或工作区之外的修改。检查点、代码快照和外部操作回执应分别管理。

| 遇到的情况 | 合适的恢复动作 |
| :--- | :--- |
| 临时网络错误 | 对可安全重试的操作进行有限次数退避重试 |
| 确定性的测试失败 | 读取失败证据，修改实现后重测 |
| 工具参数不正确 | 修正输入，不重复发送同一调用 |
| 权限不足 | 保存可审查的操作，等待必要授权 |
| 外部操作结果未知 | 查询真实状态或对账，避免重复副作用 |
| 多轮没有新证据或进展 | 改变方案、缩小任务或报告具体阻塞点 |

LangGraph 等运行库提供检查点和故障恢复能力，适合承载状态流程；工具副作用是否可重试，仍然需要应用自己定义。[LangGraph Checkpointers](https://docs.langchain.com/oss/python/langgraph/checkpointers)

## 7 权限边界让自主执行更实用

如果每次读文件、构建和检查都需要人点一次确认，长任务会被打断；如果所有操作都直接放行，误操作的影响范围又太大。

更实用的方式是预先明确授权范围，让范围内的工作自动推进。Anthropic 的沙箱方案将文件系统和网络访问都纳入约束，用系统边界减少对逐次确认的依赖。[沙箱设计](https://www.anthropic.com/research/claude-code-sandboxing)

在个人项目中，可以把这个原则落到三处：

1. **隔离执行环境**：使用任务工作区、临时数据库和独立无头浏览器，减少与日常工作状态的相互影响。
2. **限制工具能力**：按任务授予目录、网络和服务权限；外部写入在执行前核对目标与参数。
3. **记录授权范围**：已经明确允许的动作不重复询问；超出范围的动作展示具体变更后再处理授权。

网页、仓库内容和工具输出都可能包含不可信指令。来源标注、内容隔离有助于模型判断，但真正的边界还要由工具执行器、操作系统权限和服务端鉴权落实。不能让一段检索到的文字改变框架权限。

权限同样需要随恢复过程保留语义：用户批准某一组对象、某个版本的发布内容，不代表批准后来新增的对象或发生变化的内容。执行前核对授权与当前操作是否仍然匹配，可以同时减少重复确认和越界执行。

## 8 验证当前任务与评测整个框架

这两种检查解决不同的问题：

- **任务验证**：这次交付是否满足要求。
- **Harness 评测**：一批代表性任务中，这个版本的系统是否更可靠、更省成本。

Anthropic 的评测指南强调，Agent 的最终环境状态与它在对话中的宣称需要分开检查；评分可以结合代码规则、模型判断和人工评价。[Agent Evals](https://www.anthropic.com/research/demystifying-evals-for-ai-agents)

### 验证要尽量接近用户真正使用的结果

对于网页任务，构建成功之后仍要检查实际页面；对于数据处理，需要核对输出记录；对于报告，需要核对事实是否被来源支持。自动检查擅长明确条件，模型审查适合语义问题，主观质量仍需要经过校准的评价标准。

负责实现的 Agent 可以提出测试、补充测试，但不应独自控制全部验收规则。否则它可能通过修改预期值或删掉失败条件获得“全绿”。关键检查可由受保护的脚本、CI 或外部验收集执行，变更验收规则本身需要被审查。

### 用运行轨迹找到该改哪一层

{{< mermaid >}}
flowchart TD
    A["代表性任务<br/>固定初始环境"] --> B["运行模型与 Harness"]
    B --> C["记录轨迹、结果<br/>耗时与成本"]
    C --> D["归类失败<br/>定位缺失机制"]
    D --> E["针对性修改<br/>提示、工具或流程"]
    E --> F["回归与保留集验证"]
    F -->|收益成立| G["采用新版本"]
    F -->|收益不成立| D
    G --> A
{{< /mermaid >}}

最小轨迹可以记录任务标识、模型与框架版本、工具名、输入摘要、执行状态、耗时、产物引用和错误类型。注意脱敏；调试信息本身也有访问边界。

我会优先观察下面几个指标，口径由自己的任务集固定下来：

| 指标 | 能发现的问题 |
| :--- | :--- |
| 验收通过率 | 系统究竟能完成多少真实任务 |
| 错报完成率 | 宣称完成的任务中，有多少实际没过验收 |
| 人工介入次数与时间 | 自主执行是否真的节省注意力 |
| 恢复成功率 | 人为中断之后，能否正确继续且不重复副作用 |
| 每个成功任务的总成本 | 包括失败尝试后，完成一件事要花多少资源 |
| 完成耗时的中位数与 P95 | 大多数任务及较慢任务的体验如何 |

不要只展示多次尝试里最好的一次。`pass@k` 关注多次尝试中至少一次成功，`pass^k` 关注多次全部成功，两者衡量的可靠性不同。[重复试验的指标解释](https://www.anthropic.com/research/demystifying-evals-for-ai-agents)

比较两个 Harness 版本时，应尽量固定模型、初始环境、任务集与资源预算，重复运行，报告样本量和波动。为调参使用的任务与最终检验收益的保留集也要分开；否则，修好的可能只是已经看过的题目。

<details>
<summary>展开一组适合个人项目的故障注入任务</summary>

| 人为制造的条件 | 应观察的行为 |
| :--- | :--- |
| 工具成功后、状态写回前终止进程 | 恢复时核对结果，不重复外部操作 |
| 提供一个不存在的文件路径 | 明确报告缺失，定位真实路径或停止依赖步骤 |
| 在工作区保留其他人的修改 | 只处理自己负责的差异 |
| 测试失败但模型输出完成候选 | 验收门槛阻止任务进入完成状态 |
| 工具输出要求扩大权限 | 不把外部文本当作授权 |
| 执行中收到用户的新限制 | 更新任务范围，使后续行动遵循新要求 |
| 达到时间或调用预算 | 保存进度和未完成项，停止新增工作 |

这类测试直接检查框架行为。一次普通内容修改不需要为所有机制新建测试，但运行框架本身值得有可重复的故障用例。

</details>

## 9 用这个博客搭起最小 Harness

这个 Hugo 博客已经具备一些很有用的基础：项目级模板与样式有明确来源，维护文档记录内容规范，仓库有静态检查脚本和独立无头浏览器测试。这些设施让 AI 的工作能够被实际检查。

以“新增一篇带流程图的技术文章”为例，可以把任务组织成下面的流水线。这里给出的是落地设计，具体命令应服从项目现有文档。

| 阶段 | Agent 的工作 | 框架应保留的结果 |
| :--- | :--- | :--- |
| 读取约定 | 检查维护文档、现有文章、工作区差异 | 范围与需要保留的现状 |
| 调研 | 读取一手资料，核对日期与关键结论 | 来源链接与事实依据 |
| 写作 | 生成正文、图表、元数据 | 可审查的文件差异 |
| 构建 | 生成干净的生产输出 | 构建日志与产物 |
| 验证 | 检查链接、图示、桌面与手机页面 | 检查报告和截图 |
| 交付 | 对照请求说明结果与剩余限制 | 文件入口和完成状态 |

仓库已有的生产检查入口是：

```sh
hugo --environment production --gc --minify --cleanDestinationDir
python3 scripts/check-site.py public
npm run test:site -- public
```

这些检查分别覆盖构建、静态产物和浏览器行为，但仍需要针对新文章查看实际页面，确认图能读、表不溢出、折叠内容可用。**测试套件通过与新页面完成验收，各有自己的范围。**

对个人项目，我会按下面的顺序投入，而不是先搭一套庞大的编排系统：

1. **明确入口与验收**：简短的仓库规则、稳定的构建命令、可观察的完成条件。
2. **保存任务与证据**：待办、检查报告、截图、当前工作区版本，能够在新会话重新读取。
3. **增加恢复与边界**：预算、错误分类、权限策略，以及有副作用工具的回执处理。
4. **收集失败形成评测**：让每次改动都能与过去的真实问题比较。

已有的 Agent 产品通常已经实现一部分运行时，不必全部重写。例如 OpenAI 将 Codex 的会话、工具循环与审批事件通过 SDK、app-server 等接口提供给应用；应用仍负责自己的业务上下文、规则和工具。[Codex 作为可复用 Harness](https://developers.openai.com/blog/codex-as-a-platform)

选型时可以据此判断：单仓库任务先完善现有编码 Agent 的工作环境；需要自定义工具和循环时使用 Agent SDK；出现跨进程恢复、人类等待、并发与外部副作用时，再引入持久状态和工作流基础设施。产品名称没有替代这些责任划分。

## 10 多 Agent 和更多流程何时值得增加

多 Agent 可以提供独立上下文和并行探索，但也会增加交接、重复阅读、冲突处理和总用量。适合先拆的是边界清楚的独立工作，例如多份资料的分析、互不重叠的模块探索；最终仍需要有人对整体交付负责。

如果只是一个局部样式修复，单 Agent 配合浏览器检查可能已经足够。若多个执行者都能修改同一文件，还要明确所有权、合并顺序和冲突处理方式。共享文件系统本身不会自动产生有效协作。

Anthropic 在 2026 年 3 月的案例中，随着模型能力提升，移除了原先的 sprint 分段，并把评估从每个 sprint 调整到运行末尾。作者强调逐个移除组件、观察结果，而不是凭感觉一次重写整个框架。[Harness 的简化实验](https://www.anthropic.com/research/harness-design-long-running-apps)

这也给 Harness 的长期维护划出了边界：权限、审计、状态与副作用管理是系统责任；为某个模型弱点增加的提醒、任务切分和审查轮数，则应随模型升级重新评测。

我希望一个运行框架最终能清楚回答五个问题：**现在要完成什么，已经完成什么，依据在哪里，接下来做什么，什么情况下应该停下。** 当这些答案可以从系统状态和实际产物中读出来，AI 才更有机会持续、可检查地完成工作。

## 参考资料与延伸阅读

入门优先读下面三篇，分别理解仓库环境、跨会话执行和可测量的改进：

- [OpenAI — Harness engineering](https://openai.com/index/harness-engineering/)（2026-02-11）：项目环境如何支持 Agent 工作。
- [Anthropic — Effective harnesses for long-running agents](https://www.anthropic.com/research/effective-harnesses-for-long-running-agents)（2025-11-26）：初始化、进度交接与功能验证。
- [LangChain — Improving Deep Agents with harness engineering](https://www.langchain.com/blog/improving-deep-agents-with-harness-engineering)（2026-02-17）：固定模型后的 Harness 实验。

<details>
<summary>展开其余一手资料与站内相关文章</summary>

**概念与接口**

- [LangChain — The Anatomy of an Agent Harness](https://www.langchain.com/blog/the-anatomy-of-an-agent-harness)（2026-03-10）。
- [SWE-agent — Agent-Computer Interfaces Enable Automated Software Engineering](https://arxiv.org/abs/2405.15793)（2024，论文）。
- [MCP — What is the Model Context Protocol](https://modelcontextprotocol.io/docs/2026-07-28/getting-started/intro)。
- [Agent Skills — Overview](https://agentskills.io/home)。
- [OpenAI — Codex as a platform](https://developers.openai.com/blog/codex-as-a-platform)（2026-08-19）。

**上下文与持久执行**

- [Anthropic — Effective context engineering for AI agents](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents)（2025-09-29）。
- [LangGraph — Checkpointers](https://docs.langchain.com/oss/python/langgraph/checkpointers)。
- [AWS — Idempotency and retries](https://docs.aws.amazon.com/durable-execution/patterns/best-practices/idempotency/)。

**验证与边界**

- [Anthropic — Demystifying evals for AI agents](https://www.anthropic.com/research/demystifying-evals-for-ai-agents)（2026-01-09）。
- [Anthropic — Harness design for long-running application development](https://www.anthropic.com/research/harness-design-long-running-apps)（2026-03-24）。
- [Anthropic — Beyond permission prompts](https://www.anthropic.com/research/claude-code-sandboxing)（2025-10-20）。

站内可继续阅读：[Codex 配置实战与 Memory 分层]({{< relref "/posts/vibe-coding/codex-subagents-memory/" >}})。

</details>

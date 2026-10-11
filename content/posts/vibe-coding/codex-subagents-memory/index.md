+++
date = '2026-09-06T12:00:00+08:00'
draft = false
title = 'Codex 配置实战：Subagents 分工与 Memory 分层'
description = '从独立 TOML 角色配置到 AGENTS.md 与本地 memories，构建职责清晰、知识可追溯的 Codex 工作流。包含三类 subagent 模板、记忆配置、验证步骤与官方参考文献。'
summary = '用独立 TOML 配置探索、实现与审查角色；用 AGENTS.md 固化约束、项目文档保存事实、本地 memories 辅助跨会话回忆。'
categories = ['Vibe Coding']
tags = ['Codex', 'Subagents', 'Memory', 'AGENTS.md', 'AI Coding']
+++

配置 Codex，需要同时设计两件事：**任务如何分工，知识如何保留。** 前者决定执行效率，后者决定不同会话中的一致性。本文给出一套可落地的配置：三个职责明确的 subagent，加上持久指令、项目知识与自动记忆三层信息管理。

> **适用范围**：本地 Codex 客户端；官方文档核验日期为 **2026-09-06**。文中的角色、提示词与知识目录是工程示例，配置字段依据官方文档。不同客户端及版本的功能入口可能不同。

<!--more-->

## 1. 先区分分工、指令与记忆

| 机制 | 解决的问题 | 本文的使用方式 |
| :--- | :--- | :--- |
| **Subagent** | 谁执行一个边界明确的子任务 | 探索、实现、审查分别承担职责 |
| **`AGENTS.md`** | 每次工作应遵循哪些约定 | 保存构建入口、模块约束与协作规则 |
| **项目知识文档** | 哪些事实和决策应可追溯 | 保存架构决策、已验证经验及其证据 |
| **本地 memories** | 如何在未来会话中复用历史上下文 | 辅助回忆偏好、背景与工作经验 |

`AGENTS.md` 属于持久指令；本地 memories 属于回忆机制。团队必须遵守的规则，应写入前者或纳入版本管理的文档，不能只依赖自动记忆。[〔1〕](https://learn.chatgpt.com/docs/customization/memories)

## 2. 配置三个职责明确的 Subagent

### 2.1 文件放在哪里

个人配置使用 `~/.codex/config.toml`，项目配置使用仓库内的 `.codex/config.toml`；项目层仅在项目受信任时加载。常见覆盖顺序为：命令行参数、项目配置、选定的 profile、用户配置、系统配置、内置默认值。[〔2〕](https://learn.chatgpt.com/docs/config-file/config-basic)

本文采用以下布局：

```text
my-project/
├── .codex/
│   ├── config.toml
│   └── agents/
│       ├── repo_mapper.toml
│       ├── implementer.toml
│       └── risk_reviewer.toml
├── AGENTS.md
└── docs/
    └── agent-knowledge/       # 本文约定的知识目录
        ├── index.md
        └── decisions.md
```

当前文档支持在 `.codex/agents/` 或 `~/.codex/agents/` 中放置独立 TOML 文件；每个角色必填 `name`、`description`、`developer_instructions`。名称以 `name` 字段为准。[〔3〕](https://learn.chatgpt.com/docs/agent-configuration/subagents#custom-agents)

### 2.2 设置并发上限

将以下配置合并到项目的 `.codex/config.toml`：

```toml
[agents]
enabled = true
max_concurrent_threads_per_session = 3
```

该上限只计算同时打开的子 agent 线程，不含主线程。`agents.max_threads` 是旧名称的兼容别名；当前版本默认启用多 agent 工具。[〔4〕](https://learn.chatgpt.com/docs/config-file/config-reference)

**本文建议先限制为三个子任务槽位**，并测量任务耗时、返工次数和用量。一个函数的局部修改通常不值得拆分；跨模块定位、独立审查或多份材料分析更适合并行。

### 2.3 为角色分别配置模型和职责

下面以 Luna 承担明确的检索任务、Terra 承担实现、Sol 承担复杂审查，展示异构模型配置。模型 ID 与可用 reasoning effort 应以当前客户端的模型选择器为准；CLI 可用 `/model` 查看。此分配是起点，实际选择应由代表性任务的效果决定。[〔5〕](https://learn.chatgpt.com/docs/models)

**探索角色：`.codex/agents/repo_mapper.toml`**

```toml
name = "repo_mapper"
description = "定位功能入口、依赖关系与现有测试，供实现前决策使用。"
model = "gpt-5.6-luna"
model_reasoning_effort = "medium"
sandbox_mode = "read-only"
developer_instructions = """
围绕父任务指定的问题定位代码，不修改文件。
返回入口、关键调用链、相关测试及文件位置。
区分代码已证实的事实与待验证假设。
最多列出五个关键发现，不转发完整搜索日志。
"""
```

**实现角色：`.codex/agents/implementer.toml`**

```toml
name = "implementer"
description = "在已明确的文件范围内实现改动，并验证受影响行为。"
model = "gpt-5.6-terra"
model_reasoning_effort = "medium"
sandbox_mode = "workspace-write"
developer_instructions = """
先确认父任务分配的文件范围和验收条件。
只修改该范围内的文件；需要跨范围变更时向父 agent 报告。
保留其他执行者的修改，不顺手重构相邻模块。
运行与改动直接相关的检查。
返回变更摘要、验证命令及结果、未解决问题。
"""
```

**审查角色：`.codex/agents/risk_reviewer.toml`**

```toml
name = "risk_reviewer"
description = "审查候选改动的行为回归、边界条件与测试缺口。"
model = "gpt-5.6-sol"
model_reasoning_effort = "high"
sandbox_mode = "read-only"
developer_instructions = """
独立检查父任务指定的差异及相关调用路径，不修改文件。
仅报告有代码证据的问题，避免纯风格建议。
每条发现包含严重程度、文件位置、触发条件和影响。
复现需要写入环境时，返回步骤交由父 agent 执行。
未发现问题时，明确审查范围与仍未验证的行为。
"""
```

角色文件中的模型和推理强度优先于 spawn 时选择的值；未被角色文件覆盖的这两项，按“显式 spawn 参数 → `[agents]` 默认值 → 父 agent”解析。若显式选择模型却没有指定推理强度，存在采用该模型默认强度的规则，因此本文在角色中成对设置两项。[〔3〕](https://learn.chatgpt.com/docs/agent-configuration/subagents#custom-agents)

`sandbox_mode` 描述执行权限，`developer_instructions` 描述职责。自然语言中的“只读”不能代替权限限制；父会话的实时权限覆盖也可能重新应用到子会话，验收时应检查实际权限。[〔3〕](https://learn.chatgpt.com/docs/agent-configuration/subagents#approvals-and-sandbox-controls) 沙箱与审批分别约束执行范围和授权流程。[〔6〕](https://learn.chatgpt.com/docs/agent-approvals-security)

### 2.4 显式触发，并按依赖安排执行

角色配置定义可用能力，不等于每次请求都会自动启动全部角色。当前本地 Codex 在用户直接要求，或适用的 `AGENTS.md`、skill 明确要求委派时使用 subagents；CLI 可用 `/agent` 查看子线程。[〔3〕](https://learn.chatgpt.com/docs/agent-configuration/subagents)

例如，针对一次分页接口改动：

```text
请使用已配置的 subagents 完成分页接口修改。

第一阶段并行：
- repo_mapper 定位接口实现、调用方和测试入口。
- risk_reviewer 检查现有分页语义，列出必须保留的行为。

等待两者返回后，由主 agent 确定修改范围和验收条件，
再交给 implementer 实现。写入完成后，risk_reviewer 审查最终差异。
主 agent 汇总证据、验证结果和未解决问题。
```

**本文建议让并行发生在独立任务之间。** 上例中的“实现”和“最终差异审查”有先后依赖，不应同时开始。多人写入同一模块时，为每个任务指定文件所有者；主 agent 负责处理跨范围修改。

## 3. 用三层结构配置 Memory

### 3.1 持久指令：`AGENTS.md`

Codex 启动时构建指令链：先读取全局文件，再沿项目根目录到当前工作目录逐层读取；每层优先选择非空的 `AGENTS.override.md`，其次是 `AGENTS.md`，再尝试配置的备用文件名。同层最多加载一个文件，较近目录的指令覆盖较早的冲突项。默认项目指令预算为 32 KiB。[〔7〕](https://learn.chatgpt.com/docs/agent-configuration/agents-md)

建议把全局文件留给跨项目偏好，把仓库文件留给当前项目的执行约定。以下为仓库级示例，路径与测试命令应按项目替换：

```markdown
# 项目工作约定

## 执行
- 开始修改前，查阅 README 中的构建与测试入口。
- 仅当存在独立且可验收的子任务时，委派给已配置的 subagents。
- 为每个写入任务指定文件范围；主 agent 负责集成与最终验证。

## 知识使用
- 涉及架构或历史决策时，先读 docs/agent-knowledge/index.md，
  再读取与任务相关的条目。
- 历史结论必须与当前代码核对；冲突时记录差异并重新验证。
- 任务完成后，将可复用发现作为文档补丁提出，保留证据位置。
```

修改指令后，启动新会话验证加载结果，避免仅凭旧会话中的回答判断配置是否生效。子目录专用约定可从对应目录启动 Codex 验证。[〔7〕](https://learn.chatgpt.com/docs/agent-configuration/agents-md)

### 3.2 项目知识：保存证据，而非堆积聊天记录

`docs/agent-knowledge/` 是本文设计的普通文档目录，**不是 Codex 自动发现的特殊 memory 路径**。上面的 `AGENTS.md` 负责告诉 agent 何时读取它。

建议 `index.md` 只保留索引，具体条目记录五项信息：

| 字段 | 应记录的内容 |
| :--- | :--- |
| 结论 | 一条可用于后续决策的事实或约束 |
| 范围 | 适用模块、版本或运行环境 |
| 证据 | 代码符号、测试、提交或正式文档 |
| 核验日期 | 最近一次验证时间 |
| 失效条件 | 何种变化发生后必须重新检查 |

例如，与其记录“分页存在一些坑”，不如记录“排序字段相同时必须增加唯一键排序”，并附上对应查询实现和回归测试。未经验证的猜测应留在任务记录中，不直接成为长期结论。

需要按角色复用知识时，可将索引分成 `architecture.md`、`testing.md` 等文件，再在角色指令中指定相关入口。**按角色组织文档是一种工作约定，不构成独立的权限隔离。**

### 3.3 自动记忆：开启本地 memories

本地 memories 默认关闭，可在支持的桌面客户端中通过 **Settings → Personalization → Enable memories** 开启，也可合并以下内容到 `~/.codex/config.toml`。它与 ChatGPT 网页端 memory 使用不同的存储与控制。[〔1〕](https://learn.chatgpt.com/docs/customization/memories)

```toml
[features]
memories = true

[memories]
generate_memories = true
use_memories = true
disable_on_external_context = false
```

若已有 `[features]` 或 `[memories]` 表，应在原表中补充字段，不能重复声明同名 TOML 表。

| 字段 | 含义 |
| :--- | :--- |
| `generate_memories` | 是否允许新建会话作为记忆生成输入 |
| `use_memories` | 是否在未来会话中注入已有记忆 |
| `disable_on_external_context` | 设为 `true` 时，排除使用 MCP、网页搜索等外部上下文的会话，不用于记忆生成 |

以上三个字段默认分别为 `true`、`true`、`false`，但功能总开关仍需开启。**停止生成与停止使用是不同操作**；这些开关也不应被理解为删除历史记忆。[〔4〕](https://learn.chatgpt.com/docs/config-file/config-reference)

日常使用 `/memories` 控制当前会话能否读取记忆、能否贡献未来记忆；会话级选择不改变全局设置。生成文件默认位于 `~/.codex/memories/`，应视为系统生成状态，主要通过设置管理。[〔1〕](https://learn.chatgpt.com/docs/customization/memories)

记忆在后台异步生成，刚结束会话不一定立即出现新条目。当前默认要求候选会话闲置至少 **6 小时**，且剩余额度满足 **25%** 的门槛；因此“没有立即记住”并不能直接证明配置失败。[〔4〕](https://learn.chatgpt.com/docs/config-file/config-reference)

## 4. 让分工与知识形成可验证的工作流

以下是本文建议的执行流程，不是 Codex 内置调度保证：

1. **主 agent 定义任务契约**：目标、输入、文件范围、交付格式、验收条件。
2. **子 agent 读取相关知识**：结合当前代码检查历史结论是否仍成立。
3. **按依赖执行任务**：独立调查可并行；实现、最终审查与集成按顺序进行。
4. **用证据完成验收**：比较实际差异、测试结果和目标，处理相互矛盾的发现。
5. **沉淀可复用结论**：主 agent 汇总知识补丁，经审查后纳入版本管理。

团队知识建议采用“**多方提出、统一合并**”：每个 subagent 可以提出新发现，但不要同时改写同一个知识文件。这样既降低冲突，也避免未经验证的中间结论被反复引用。

评估配置效果时，建议固定一组代表性任务，比较单 agent 与分工流程的**完成时间、总用量、首次验收通过率、人工返工量**。角色数量和推理强度只有改善这些指标时才值得增加。

## 5. 验证与排错

先检查客户端版本，再在新会话中执行以下验证：

```bash
codex --version
codex "列出当前加载的项目指令及来源；不要修改文件。"
```

随后要求 `repo_mapper` 只定位一个已知函数，并通过 `/agent` 或客户端的子任务活动核对角色与输出。memory 则先用 `/memories` 检查会话设置，再在满足生成条件后观察后续会话是否能召回相关背景。

| 现象 | 优先检查 |
| :--- | :--- |
| 角色没有启动 | 请求是否明确要求委派；角色名称与文件必填字段是否正确；项目是否受信任 |
| 模型与预期不同 | 角色文件是否覆盖了 spawn 选择；模型是否对当前登录方式可用 |
| 子目录规则未加载 | 启动目录是否位于该规则覆盖路径；是否被同层 override 替代 |
| memory 未生成 | 总开关、会话生成许可、外部上下文排除项、闲置时间及额度门槛 |
| 记忆与代码冲突 | 重新验证当前实现，修正文档中的结论、适用范围及核验日期 |

上述排查入口分别依据配置加载、角色定义、指令发现与 memory 控制文档。[〔2〕](https://learn.chatgpt.com/docs/config-file/config-basic) [〔3〕](https://learn.chatgpt.com/docs/agent-configuration/subagents) [〔7〕](https://learn.chatgpt.com/docs/agent-configuration/agents-md) [〔4〕](https://learn.chatgpt.com/docs/config-file/config-reference)

## References

以下均为 **OpenAI 官方一手文档**，访问及核验日期统一为 **2026-09-06**。正文使用编号关联技术依据；角色提示词、知识目录与验收流程为本文设计。在线文档会持续更新，复现时应同时记录客户端版本。

1. **OpenAI.** [*Memories*](https://learn.chatgpt.com/docs/customization/memories). ChatGPT Learn，在线产品文档。重点章节：*How local Codex memories work*、*Local memory storage*、*Configure local memories*。用于核对本地记忆边界、存储与控制入口。
2. **OpenAI.** [*Config basics*](https://learn.chatgpt.com/docs/config-file/config-basic). ChatGPT Learn，在线配置指南。重点章节：*Codex configuration file*、*Configuration precedence*。用于核对配置路径、项目信任与覆盖顺序。
3. **OpenAI.** [*Subagents*](https://learn.chatgpt.com/docs/agent-configuration/subagents). ChatGPT Learn，在线功能与配置指南。重点章节：*Custom agents*、*Custom agent file schema*、*Approvals and sandbox controls*。用于核对独立 TOML 角色、模型解析与权限继承。
4. **OpenAI.** [*Configuration Reference*](https://learn.chatgpt.com/docs/config-file/config-reference). ChatGPT Learn，配置字段参考。重点条目：`agents.*`、`features.memories`、`memories.*`。用于核对字段类型、默认值、兼容别名与生成门槛。
5. **OpenAI.** [*Models*](https://learn.chatgpt.com/docs/models). ChatGPT Learn，模型使用指南。重点章节：*Choose a model*、*Recommended models*、*Pick a reasoning effort*。用于核对模型标识、选择入口和可用性边界。
6. **OpenAI.** [*Agent approvals & security*](https://learn.chatgpt.com/docs/agent-approvals-security). ChatGPT Learn，权限与执行安全指南。重点章节：*Common sandbox and approval combinations*。用于区分角色职责、沙箱权限与审批策略。
7. **OpenAI.** [*Custom instructions with AGENTS.md*](https://learn.chatgpt.com/docs/agent-configuration/agents-md). ChatGPT Learn，持久指令指南。重点章节：*How Codex discovers guidance*、*Layer project instructions*。用于核对分层加载、override 行为与指令预算。
